package update

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/rushsite/agent/internal/procrun"
)

type fakeGate struct {
	mu        sync.Mutex
	accepting bool
	running   int
	history   []bool
}

func (g *fakeGate) SetAccepting(ok bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.accepting = ok
	g.history = append(g.history, ok)
}

func (g *fakeGate) Running() int {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.running
}

func (g *fakeGate) setRunning(n int) {
	g.mu.Lock()
	g.running = n
	g.mu.Unlock()
}

type fakeChecker struct {
	outdated bool
	err      error
	calls    int
}

func (c *fakeChecker) Outdated(context.Context) (bool, error) {
	c.calls++
	return c.outdated, c.err
}

const gameinfo = "\"GameInfo\"\n{\n\tFileSystem\n\t{\n\t\tSearchPaths\n\t\t{\n\t\t\tGame_LowViolence\tcsgo_lv // Perfect World content override\n\t\t\tGame\tcsgo\n\t\t}\n\t}\n}\n"

func setup(t *testing.T, codes ...int) (*Updater, *fakeGate, *fakeChecker, *procrun.FakeRunner, string) {
	t.Helper()
	dir := t.TempDir()
	gi := GameinfoPath(dir)
	if err := os.MkdirAll(filepath.Dir(gi), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(gi, []byte(gameinfo), 0o644); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	runner := &procrun.FakeRunner{Behavior: func(procrun.Spec) procrun.FakeBehavior {
		mu.Lock()
		defer mu.Unlock()
		code := 0
		if len(codes) > 0 {
			code, codes = codes[0], codes[1:]
		}
		return procrun.FakeBehavior{ExitNow: true, Code: code, Output: "Success! App '730' fully installed.\n"}
	}}
	gate := &fakeGate{accepting: true}
	checker := &fakeChecker{}
	u := New(Config{SteamCMD: "/usr/games/steamcmd", CS2Dir: dir, LogDir: filepath.Join(dir, "logs"), PatchGameinfo: true}, checker, gate, runner, nil)
	return u, gate, checker, runner, dir
}

func TestUpToDateStaysIdle(t *testing.T) {
	u, gate, checker, runner, _ := setup(t)
	u.Step(context.Background())
	if u.Status().State != Idle || !gate.accepting || runner.StartCount() != 0 || checker.calls != 1 {
		t.Fatalf("state=%s accepting=%v starts=%d", u.Status().State, gate.accepting, runner.StartCount())
	}
	if u.Status().LastCheck == nil {
		t.Fatal("lastCheck not set")
	}
}

func TestCheckErrorStaysIdle(t *testing.T) {
	u, gate, checker, _, _ := setup(t)
	checker.err = errors.New("steam down")
	u.Step(context.Background())
	st := u.Status()
	if st.State != Idle || !gate.accepting || !strings.Contains(st.LastError, "steam down") {
		t.Fatalf("status %+v", st)
	}
}

func TestOutdatedWithNoMatchesUpdatesAtOnce(t *testing.T) {
	u, gate, checker, runner, dir := setup(t)
	checker.outdated = true
	u.Step(context.Background())
	st := u.Status()
	if st.State != Idle || st.LastUpdate == nil || st.LastError != "" {
		t.Fatalf("status %+v", st)
	}
	if runner.StartCount() != 1 {
		t.Fatalf("steamcmd runs=%d", runner.StartCount())
	}
	got := strings.Join(runner.Specs[0].Args, " ")
	if got != "+force_install_dir "+dir+" +login anonymous +app_update 730 +quit" {
		t.Fatalf("steamcmd args %s", got)
	}
	if len(gate.history) != 2 || gate.history[0] || !gate.history[1] {
		t.Fatalf("gate history %v", gate.history)
	}
	gi, _ := os.ReadFile(GameinfoPath(dir))
	if !strings.Contains(string(gi), "csgo/addons/metamod") {
		t.Fatalf("gameinfo not patched:\n%s", gi)
	}
}

func TestDrainWaitsForRunningMatches(t *testing.T) {
	u, gate, checker, runner, _ := setup(t)
	gate.setRunning(2)
	checker.outdated = true
	ctx := context.Background()

	u.Step(ctx)
	if u.Status().State != Draining || gate.accepting || runner.StartCount() != 0 {
		t.Fatalf("after detect: state=%s accepting=%v starts=%d", u.Status().State, gate.accepting, runner.StartCount())
	}
	if !u.Updating() {
		t.Fatal("Updating() should be true while draining")
	}

	checker.outdated = false
	gate.setRunning(1)
	u.Step(ctx)
	if u.Status().State != Draining || runner.StartCount() != 0 || checker.calls != 1 {
		t.Fatalf("still one running: state=%s starts=%d checks=%d", u.Status().State, runner.StartCount(), checker.calls)
	}

	gate.setRunning(0)
	u.Step(ctx)
	if u.Status().State != Idle || !gate.accepting || runner.StartCount() != 1 {
		t.Fatalf("after drain: state=%s accepting=%v starts=%d", u.Status().State, gate.accepting, runner.StartCount())
	}
}

func TestFailedUpdateRetriesAndKeepsRefusing(t *testing.T) {
	u, gate, checker, runner, _ := setup(t, 8, 0)
	checker.outdated = true
	ctx := context.Background()

	u.Step(ctx)
	st := u.Status()
	if st.State != Draining || gate.accepting || !strings.Contains(st.LastError, "code 8") || st.Attempts != 1 {
		t.Fatalf("after failure %+v accepting=%v", st, gate.accepting)
	}
	u.Step(ctx)
	st = u.Status()
	if st.State != Idle || !gate.accepting || runner.StartCount() != 2 || st.LastError != "" {
		t.Fatalf("after retry %+v accepting=%v starts=%d", st, gate.accepting, runner.StartCount())
	}
}

func TestTriggerForcesUpdate(t *testing.T) {
	u, gate, checker, runner, _ := setup(t)
	gate.setRunning(1)
	u.Trigger()
	if u.Status().State != Draining || gate.accepting {
		t.Fatalf("trigger did not drain")
	}
	gate.setRunning(0)
	u.Step(context.Background())
	if u.Status().State != Idle || runner.StartCount() != 1 || checker.calls != 0 {
		t.Fatalf("state=%s starts=%d checks=%d", u.Status().State, runner.StartCount(), checker.calls)
	}
}

func TestNilCheckerNeverUpdates(t *testing.T) {
	u, gate, _, runner, _ := setup(t)
	u.checker = nil
	u.Step(context.Background())
	if u.Status().State != Idle || !gate.accepting || runner.StartCount() != 0 {
		t.Fatal("nil checker should do nothing")
	}
}

func TestEnsureGameinfoMetamodIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gameinfo.gi")
	if err := os.WriteFile(path, []byte(gameinfo), 0o644); err != nil {
		t.Fatal(err)
	}
	changed, err := EnsureGameinfo(path, false)
	if err != nil || !changed {
		t.Fatalf("first patch changed=%v err=%v", changed, err)
	}
	b, _ := os.ReadFile(path)
	want := "\t\t\tGame_LowViolence\tcsgo_lv // Perfect World content override\n\t\t\tGame\tcsgo/addons/metamod\n\t\t\tGame\tcsgo\n"
	if !strings.Contains(string(b), want) {
		t.Fatalf("patched file:\n%s", b)
	}
	changed, err = EnsureGameinfo(path, false)
	if err != nil || changed {
		t.Fatalf("second patch changed=%v err=%v", changed, err)
	}
	if err := os.WriteFile(path, []byte("\"GameInfo\" {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := EnsureGameinfo(path, false); err == nil {
		t.Fatal("want error when anchor line is missing")
	}
}

func TestSteamAPIChecker(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Dir(SteamInfPath(dir)), 0o755); err != nil {
		t.Fatal(err)
	}
	inf := "ClientVersion=2000914\nServerVersion=2000914\nPatchVersion=1.41.8.2\nProductName=cs2\nappID=730\n"
	if err := os.WriteFile(SteamInfPath(dir), []byte(inf), 0o644); err != nil {
		t.Fatal(err)
	}
	upToDate := true
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		if upToDate {
			_, _ = w.Write([]byte(`{"response":{"success":true,"up_to_date":true,"version_is_listable":true}}`))
			return
		}
		_, _ = w.Write([]byte(`{"response":{"success":true,"up_to_date":false,"version_is_listable":false,"required_version":14183,"message":"Your server is out of date, please upgrade"}}`))
	}))
	defer srv.Close()
	c := SteamAPIChecker{CS2Dir: dir, BaseURL: srv.URL}
	out, err := c.Outdated(context.Background())
	if err != nil || out {
		t.Fatalf("up to date: out=%v err=%v", out, err)
	}
	if gotQuery != "appid=730&version=14182" {
		t.Fatalf("query %q", gotQuery)
	}
	upToDate = false
	out, err = c.Outdated(context.Background())
	if err != nil || !out {
		t.Fatalf("outdated: out=%v err=%v", out, err)
	}
}

const appInfo = `"730"
{
	"common"
	{
		"name"		"Counter-Strike 2"
	}
	"depots"
	{
		"branches"
		{
			"beta"
			{
				"buildid"		"1111"
			}
			"public"
			{
				"buildid"		"2000914"
				"timeupdated"		"1790000000"
			}
		}
	}
}
`

func TestSteamCMDChecker(t *testing.T) {
	if id, err := PublicBuildID(appInfo); err != nil || id != "2000914" {
		t.Fatalf("PublicBuildID=%q err=%v", id, err)
	}
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Dir(AppManifestPath(dir)), 0o755); err != nil {
		t.Fatal(err)
	}
	manifest := "\"AppState\"\n{\n\t\"appid\"\t\t\"730\"\n\t\"buildid\"\t\t\"2000913\"\n}\n"
	if err := os.WriteFile(AppManifestPath(dir), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	runner := &procrun.FakeRunner{Behavior: func(procrun.Spec) procrun.FakeBehavior {
		return procrun.FakeBehavior{ExitNow: true, Output: appInfo}
	}}
	c := SteamCMDChecker{CS2Dir: dir, SteamCMD: "steamcmd", Runner: runner}
	out, err := c.Outdated(context.Background())
	if err != nil || !out {
		t.Fatalf("out=%v err=%v", out, err)
	}
	if v := InstalledVersion(dir); v != "(build 2000913)" {
		t.Fatalf("InstalledVersion=%q", v)
	}
}
