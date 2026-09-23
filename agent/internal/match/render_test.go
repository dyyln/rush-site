package match

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const testMatchID = "3f2b8c1e-9d4a-4e7b-8c2d-1a2b3c4d5e6f"

func sampleReq() StartRequest {
	a, b := "76561198000000001", "76561198000000002"
	return StartRequest{
		MatchID:         testMatchID,
		Mode:            Aim1v1,
		Map:             MapEntry{ID: "aim_map", DisplayName: "aim_map", WorkshopID: "3070208798"},
		GSLT:            "ABCDEF0123456789ABCDEF0123456789",
		Password:        "k3y-pass_9",
		AllowedSteamIDs: []string{a, b},
		Teams: []Team{
			{Name: `Alpha "; quit`, SteamIDs: []string{a}},
			{Name: "Bravo", SteamIDs: []string{b}},
		},
		WebhookURL:    "https://api.example.test/webhooks/match/" + testMatchID,
		WebhookSecret: "s3cret",
		DemoUpload:    DemoUpload{Bucket: "demos", Key: "k.dem", PresignedPutURL: "https://s3.example.test/put"},
	}
}

func sampleParams(t *testing.T) Params {
	t.Helper()
	req := sampleReq()
	spec, err := Validate(&req, DefaultModes())
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	return Params{Req: req, Spec: spec, Port: 27015, TVPort: 27115, TVPassword: "tvpw", CfgRel: "rushsite/matches/" + testMatchID}
}

func TestLaunchArgsWorkshopMap(t *testing.T) {
	p := sampleParams(t)
	got, err := LaunchArgs(p)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"-dedicated", "-console", "-port", "27015", "-maxplayers", "3",
		"+tv_port", "27115", "+tv_enable", "1", "+bot_quota", "0",
		"+game_type", "0", "+game_mode", "1",
		"+host_workshop_map", "3070208798",
		"+sv_setsteamaccount", "ABCDEF0123456789ABCDEF0123456789",
		"+sv_password", "k3y-pass_9",
		"+exec", "rushsite/matches/" + testMatchID + "/server.cfg",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("args\n got %q\nwant %q", got, want)
	}
}

func TestLaunchArgsPlainMapAndExtraArgs(t *testing.T) {
	p := sampleParams(t)
	p.Req.Map = MapEntry{ID: "arena_x", MapName: "de_rush_arena"}
	p.Spec.ExtraArgs = []string{"+mapgroup", "mg_rush"}
	got, err := LaunchArgs(p)
	if err != nil {
		t.Fatal(err)
	}
	line := strings.Join(got, " ")
	if !strings.Contains(line, "+game_mode 1 +mapgroup mg_rush +map de_rush_arena +sv_setsteamaccount") {
		t.Fatalf("unexpected order: %s", line)
	}
}

func TestLaunchArgsUnconfiguredMode(t *testing.T) {
	p := sampleParams(t)
	p.Spec = ModeSpec{TeamSize: 3, ExecCfg: "rushsite_rush3v3.cfg"}
	if _, err := LaunchArgs(p); !errors.Is(err, ErrModeNotConfigured) {
		t.Fatalf("want ErrModeNotConfigured, got %v", err)
	}
}

func TestServerCfg(t *testing.T) {
	p := sampleParams(t)
	cfg := ServerCfg(p)
	for _, line := range []string{
		`sv_password "k3y-pass_9"`,
		"tv_port 27115",
		`tv_password "tvpw"`,
		`mp_teamname_1 "Alpha  quit"`,
		`mp_teamname_2 "Bravo"`,
		"exec rushsite/matches/" + testMatchID + "/rushsite_aim1v1.cfg",
	} {
		if !strings.Contains(cfg, line+"\n") {
			t.Errorf("server.cfg missing %q\n%s", line, cfg)
		}
	}
	if strings.Count(cfg, `"`)%2 != 0 {
		t.Errorf("unbalanced quotes in server.cfg")
	}
}

func TestPluginJSONMatchesContract(t *testing.T) {
	p := sampleParams(t)
	b, err := PluginJSON(p)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	want := []string{"matchId", "mode", "allowedSteamIds", "teams", "password", "webhookUrl", "webhookSecret", "demoUpload", "winCondition"}
	if len(m) != len(want) {
		t.Errorf("match.json has %d keys, want %d: %v", len(m), len(want), m)
	}
	for _, k := range want {
		if _, ok := m[k]; !ok {
			t.Errorf("match.json missing %s", k)
		}
	}
	if m["winCondition"] != "first_to_16" {
		t.Errorf("winCondition=%v", m["winCondition"])
	}
	demo := m["demoUpload"].(map[string]any)
	if demo["presignedPutUrl"] != "https://s3.example.test/put" {
		t.Errorf("demoUpload=%v", demo)
	}
}

func TestModeCfgOverrideAndWriteDir(t *testing.T) {
	p := sampleParams(t)
	emb, err := ModeCfg(p)
	if err != nil || !strings.Contains(string(emb), "mp_maxrounds 31") {
		t.Fatalf("embedded cfg: %v %q", err, emb)
	}
	over := t.TempDir()
	if err := os.WriteFile(filepath.Join(over, "rushsite_aim1v1.cfg"), []byte("custom 1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	p.ModeCfgDir = over
	files, err := RenderFiles(p)
	if err != nil {
		t.Fatal(err)
	}
	if string(files["rushsite_aim1v1.cfg"]) != "custom 1\n" {
		t.Fatalf("override not used: %q", files["rushsite_aim1v1.cfg"])
	}
	dir := filepath.Join(t.TempDir(), "m")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "stale.cfg"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := WriteDir(dir, files); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(dir)
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	if !reflect.DeepEqual(names, []string{"match.json", "rushsite_aim1v1.cfg", "server.cfg"}) {
		t.Fatalf("dir contents %v", names)
	}
}

func TestEveryDefaultModeHasEmbeddedCfg(t *testing.T) {
	for mode, spec := range DefaultModes() {
		if _, err := ModeCfg(Params{Spec: spec}); err != nil {
			t.Errorf("%s: %v", mode, err)
		}
	}
}

func TestValidateRejects(t *testing.T) {
	cases := map[string]func(r *StartRequest){
		"path traversal id": func(r *StartRequest) { r.MatchID = "../../etc" },
		"unknown mode":      func(r *StartRequest) { r.Mode = "ffa" },
		"cfg injection pw":  func(r *StartRequest) { r.Password = `x"; rcon_password "y` },
		"bad map name":      func(r *StartRequest) { r.Map = MapEntry{ID: "aim;quit"} },
		"bad workshop":      func(r *StartRequest) { r.Map.WorkshopID = "12a" },
		"bad gslt":          func(r *StartRequest) { r.GSLT = "abc def" },
		"one team":          func(r *StartRequest) { r.Teams = r.Teams[:1] },
		"team too big": func(r *StartRequest) {
			r.Teams[0].SteamIDs = append(r.Teams[0].SteamIDs, "76561198000000002")
		},
		"stranger in team": func(r *StartRequest) { r.Teams[1].SteamIDs = []string{"76561198000000009"} },
		"bad webhook":      func(r *StartRequest) { r.WebhookURL = "ftp://x" },
		"no secret":        func(r *StartRequest) { r.WebhookSecret = "" },
	}
	for name, mutate := range cases {
		r := sampleReq()
		mutate(&r)
		if _, err := Validate(&r, DefaultModes()); !IsValidation(err) {
			t.Errorf("%s: want validation error, got %v", name, err)
		}
	}
	r := sampleReq()
	modes := DefaultModes()
	modes[Aim1v1] = ModeSpec{TeamSize: 1, ExecCfg: "rushsite_aim1v1.cfg"}
	if _, err := Validate(&r, modes); !errors.Is(err, ErrModeNotConfigured) {
		t.Errorf("want ErrModeNotConfigured, got %v", err)
	}
}

func TestLoadModesMergesOverDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "modes.json")
	body := `{"rush3v3": {"gameType": 7, "gameMode": 9, "extraArgs": ["+mapgroup", "mg_rush_001"]}}`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	m, err := LoadModes(path)
	if err != nil {
		t.Fatal(err)
	}
	rush := m[Rush3v3]
	if !rush.Configured() || *rush.GameType != 7 || *rush.GameMode != 9 || rush.TeamSize != 3 || rush.ExecCfg != "rushsite_rush3v3.cfg" {
		t.Fatalf("rush spec %+v", rush)
	}
	if err := os.WriteFile(path, []byte(`{"ffa": {}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadModes(path); err == nil {
		t.Fatal("want error for unknown mode")
	}
	if err := os.WriteFile(path, []byte(`{"aim1v1": {"execCfg": "../x.cfg"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadModes(path); err == nil {
		t.Fatal("want error for bad execCfg")
	}
}

func TestRushDefaults(t *testing.T) {
	rush := DefaultModes()[Rush3v3]
	if !rush.Configured() || *rush.GameType != 0 || *rush.GameMode != 6 || rush.TeamSize != 3 {
		t.Fatalf("rush defaults %+v", rush)
	}
	cfg, err := ModeCfg(Params{Spec: rush})
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(string(cfg), "\n") {
		if strings.HasPrefix(line, "mp_match_end_restart") || strings.HasPrefix(line, "mp_maxrounds") {
			t.Errorf("rush cfg must not override Valve rules: %s", line)
		}
	}
}

func TestConnect(t *testing.T) {
	if got := Connect("1.2.3.4", 27015, "pw"); got != "connect 1.2.3.4:27015; password pw" {
		t.Fatal(got)
	}
}
