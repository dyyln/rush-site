package manager

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/rushsite/agent/internal/match"
	"github.com/rushsite/agent/internal/procrun"
	"github.com/rushsite/agent/internal/slots"
)

const (
	idA = "11111111-1111-4111-8111-111111111111"
	idB = "22222222-2222-4222-8222-222222222222"
	idC = "33333333-3333-4333-8333-333333333333"
)

func req(id string) match.StartRequest {
	a, b := "76561198000000001", "76561198000000002"
	return match.StartRequest{
		MatchID:         id,
		Mode:            match.Aim1v1,
		Map:             match.MapEntry{ID: "aim_map", MapName: "aim_map"},
		GSLT:            "ABCDEF0123456789",
		Password:        "pw1234",
		AllowedSteamIDs: []string{a, b},
		Teams:           []match.Team{{Name: "A", SteamIDs: []string{a}}, {Name: "B", SteamIDs: []string{b}}},
		WebhookURL:      "http://api.local/webhooks/match/" + id,
		WebhookSecret:   "secret",
	}
}

func newManager(t *testing.T, runner procrun.Runner, lo, hi int) *Manager {
	t.Helper()
	root := t.TempDir()
	cfg := Config{
		CS2Dir:       filepath.Join(root, "cs2"),
		CS2Bin:       filepath.Join(root, "cs2", "game", "bin", "linuxsteamrt64", "cs2"),
		DataDir:      filepath.Join(root, "data"),
		PublicIP:     "203.0.113.7",
		TVPortOffset: 100,
		StopGrace:    time.Second,
	}
	return New(cfg, match.DefaultModes(), runner, slots.New(lo, hi, nil), nil)
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestStartWritesFilesAndLaunches(t *testing.T) {
	r := &procrun.FakeRunner{}
	m := newManager(t, r, 27015, 27016)
	resp, err := m.Start(req(idA))
	if err != nil {
		t.Fatal(err)
	}
	if resp.Port != 27015 || resp.IP != "203.0.113.7" || resp.Connect != "connect 203.0.113.7:27015; password pw1234" {
		t.Fatalf("resp %+v", resp)
	}
	dir := filepath.Join(m.MatchesRoot(), idA)
	for _, f := range []string{"server.cfg", "rushsite_aim1v1.cfg", "match.json"} {
		if _, err := os.Stat(filepath.Join(dir, f)); err != nil {
			t.Errorf("missing %s: %v", f, err)
		}
	}
	spec := r.Last().Spec
	line := strings.Join(spec.Args, " ")
	if !strings.Contains(line, "-port 27015") || !strings.Contains(line, "+tv_port 27115") || !strings.Contains(line, "+exec rushsite/matches/"+idA+"/server.cfg") {
		t.Fatalf("args %s", line)
	}
	var sawJSON bool
	for _, kv := range spec.Env {
		if strings.HasPrefix(kv, "RUSHSITE_AGENT_TOKEN=") {
			t.Fatal("agent token leaked into CS2 env")
		}
		if kv == "RUSHSITE_MATCH_JSON="+filepath.Join(dir, "match.json") {
			sawJSON = true
		}
	}
	if !sawJSON {
		t.Fatal("RUSHSITE_MATCH_JSON not set")
	}
	list := m.List(false)
	if len(list) != 1 || list[0].Status != StatusRunning || list[0].PID == 0 {
		t.Fatalf("list %+v", list)
	}
	if _, err := m.Start(req(idA)); !errors.Is(err, ErrExists) {
		t.Fatalf("want ErrExists, got %v", err)
	}
	logb, _ := os.ReadFile(list[0].LogPath)
	if strings.Contains(string(logb), "ABCDEF0123456789") || strings.Contains(string(logb), "pw1234") {
		t.Fatalf("secrets in log: %s", logb)
	}
}

func TestSlotsExhaustAndFreeOnCrash(t *testing.T) {
	r := &procrun.FakeRunner{}
	m := newManager(t, r, 27015, 27016)
	exited := make(chan struct{}, 4)
	m.OnExit = func() { exited <- struct{}{} }
	if _, err := m.Start(req(idA)); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Start(req(idB)); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Start(req(idC)); !errors.Is(err, ErrNoSlots) {
		t.Fatalf("want ErrNoSlots, got %v", err)
	}
	r.Procs[0].Exit(139)
	<-exited
	if total, free := m.Slots(); total != 2 || free != 1 {
		t.Fatalf("slots %d/%d", free, total)
	}
	if _, err := os.Stat(filepath.Join(m.MatchesRoot(), idA)); !os.IsNotExist(err) {
		t.Fatalf("match dir not cleaned: %v", err)
	}
	all := m.List(true)
	if len(all) != 2 || all[1].MatchID != idA || all[1].Status != StatusCrashed || *all[1].ExitCode != 139 {
		t.Fatalf("list %+v", all)
	}
	resp, err := m.Start(req(idC))
	if err != nil || resp.Port != 27015 {
		t.Fatalf("restart got %+v %v", resp, err)
	}
}

func TestStopIsIdempotentAndFreesSlot(t *testing.T) {
	r := &procrun.FakeRunner{}
	m := newManager(t, r, 27015, 27015)
	if _, err := m.Start(req(idA)); err != nil {
		t.Fatal(err)
	}
	if err := m.Stop(idA); err != nil {
		t.Fatal(err)
	}
	if !r.Procs[0].Stopped() {
		t.Fatal("process not stopped")
	}
	if m.Running() != 0 {
		t.Fatalf("running=%d", m.Running())
	}
	if _, free := m.Slots(); free != 1 {
		t.Fatalf("free=%d", free)
	}
	if got := m.List(true); len(got) != 1 || got[0].Status != StatusStopped {
		t.Fatalf("list %+v", got)
	}
	if err := m.Stop(idA); err != nil {
		t.Fatalf("second stop: %v", err)
	}
}

func TestNotAcceptingRefusesStart(t *testing.T) {
	m := newManager(t, &procrun.FakeRunner{}, 27015, 27016)
	m.SetAccepting(false)
	if _, err := m.Start(req(idA)); !errors.Is(err, ErrUpdating) {
		t.Fatalf("want ErrUpdating, got %v", err)
	}
	m.SetAccepting(true)
	if _, err := m.Start(req(idA)); err != nil {
		t.Fatal(err)
	}
}

func TestLaunchFailureReleasesSlot(t *testing.T) {
	r := &procrun.FakeRunner{Behavior: func(procrun.Spec) procrun.FakeBehavior {
		return procrun.FakeBehavior{Err: errors.New("exec format error")}
	}}
	m := newManager(t, r, 27015, 27015)
	if _, err := m.Start(req(idA)); err == nil {
		t.Fatal("want error")
	}
	if m.Running() != 0 {
		t.Fatalf("running=%d", m.Running())
	}
	if _, free := m.Slots(); free != 1 {
		t.Fatalf("free=%d", free)
	}
}

func TestUnconfiguredModeRefused(t *testing.T) {
	m := newManager(t, &procrun.FakeRunner{}, 27015, 27015)
	m.modes = match.ModeTable{match.Aim1v1: {TeamSize: 1, ExecCfg: "rushsite_aim1v1.cfg"}}
	if _, err := m.Start(req(idA)); !errors.Is(err, match.ErrModeNotConfigured) {
		t.Fatalf("want ErrModeNotConfigured, got %v", err)
	}
	if _, free := m.Slots(); free != 1 {
		t.Fatalf("free=%d", free)
	}
}

func TestRushLaunchLine(t *testing.T) {
	r := &procrun.FakeRunner{}
	m := newManager(t, r, 27015, 27015)
	rq := req(idA)
	rq.Mode = match.Rush3v3
	rq.Map = match.MapEntry{ID: "rush_001", MapName: "rush_001"}
	if _, err := m.Start(rq); err != nil {
		t.Fatal(err)
	}
	line := strings.Join(r.Last().Spec.Args, " ")
	want := "-maxplayers 7 +tv_port 27115 +tv_enable 1 +bot_quota 0 +game_type 0 +game_mode 6 +map rush_001 +sv_setsteamaccount"
	if !strings.Contains(line, want) {
		t.Fatalf("rush line %s", line)
	}
}

func TestRecoverAdoptsLiveServersAndCleansStale(t *testing.T) {
	r := &procrun.FakeRunner{}
	m := newManager(t, r, 27015, 27017)
	if _, err := m.Start(req(idA)); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Start(req(idB)); err != nil {
		t.Fatal(err)
	}
	pidA := m.List(false)[0].PID
	stale := filepath.Join(m.MatchesRoot(), idC)
	if err := os.MkdirAll(stale, 0o700); err != nil {
		t.Fatal(err)
	}

	// A fresh agent on the same dirs, as after a restart. Only match A is still alive.
	m2 := New(m.cfg, match.DefaultModes(), r, slots.New(27015, 27017, nil), nil)
	adoptedProc := procrun.NewFakeProcess(pidA)
	m2.Alive = func(pid int, id string) bool { return pid == pidA && id == idA }
	m2.Adopt = func(pid int) procrun.Process { return adoptedProc }
	n, err := m2.Recover()
	if err != nil || n != 1 {
		t.Fatalf("recover n=%d err=%v", n, err)
	}
	list := m2.List(false)
	if len(list) != 1 || list[0].MatchID != idA || list[0].Port != 27015 || list[0].Status != StatusRunning {
		t.Fatalf("list %+v", list)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("stale dir kept: %v", err)
	}
	if _, err := os.Stat(filepath.Join(m.MatchesRoot(), idA)); err != nil {
		t.Fatalf("adopted dir removed: %v", err)
	}
	if resp, err := m2.Start(req(idC)); err != nil || resp.Port != 27016 {
		t.Fatalf("start after recover %+v %v", resp, err)
	}
	if err := m2.Stop(idA); err != nil || !adoptedProc.Stopped() {
		t.Fatalf("stop adopted err=%v stopped=%v", err, adoptedProc.Stopped())
	}
}

func TestCrashCallsOnCrashButStopDoesNot(t *testing.T) {
	r := &procrun.FakeRunner{}
	m := newManager(t, r, 27015, 27016)
	type call struct{ id, url, secret string }
	calls := make(chan call, 4)
	m.OnCrash = func(info Info, url, secret string) { calls <- call{info.MatchID, url, secret} }
	if _, err := m.Start(req(idA)); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Start(req(idB)); err != nil {
		t.Fatal(err)
	}
	if err := m.Stop(idB); err != nil {
		t.Fatal(err)
	}
	r.Procs[0].Exit(134)
	select {
	case c := <-calls:
		if c.id != idA || c.url != "http://api.local/webhooks/match/"+idA || c.secret != "secret" {
			t.Fatalf("call %+v", c)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("OnCrash not called")
	}
	select {
	case c := <-calls:
		t.Fatalf("unexpected call %+v", c)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestStateFileKeepsWebhookForAdoptedCrash(t *testing.T) {
	r := &procrun.FakeRunner{}
	m := newManager(t, r, 27015, 27016)
	if _, err := m.Start(req(idA)); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(m.statePath())
	if !strings.Contains(string(b), "webhookSecret") {
		t.Fatalf("state file lacks webhook: %s", b)
	}
	pid := m.List(false)[0].PID

	m2 := New(m.cfg, match.DefaultModes(), r, slots.New(27015, 27016, nil), nil)
	p := procrun.NewFakeProcess(pid)
	m2.Alive = func(int, string) bool { return true }
	m2.Adopt = func(int) procrun.Process { return p }
	got := make(chan string, 1)
	m2.OnCrash = func(info Info, url, secret string) { got <- secret }
	if _, err := m2.Recover(); err != nil {
		t.Fatal(err)
	}
	for _, info := range m2.List(false) {
		if strings.Contains(info.Connect, "secret") {
			t.Fatal("secret leaked into Info")
		}
	}
	p.Exit(-1)
	select {
	case s := <-got:
		if s != "secret" {
			t.Fatalf("secret %q", s)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("OnCrash not called for adopted exit")
	}
}
