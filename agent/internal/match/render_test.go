package match

import (
	"encoding/json"
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
		CS2:           &CS2Settings{GameType: intp(0), GameMode: intp(1), ExecCfg: "rushsite_aim1v1.cfg", WorkshopID: "3070208798"},
	}
}

func intp(n int) *int { return &n }

func sampleParams(t *testing.T) Params {
	t.Helper()
	req := sampleReq()
	spec, err := Validate(&req, DefaultModes(), "")
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
		"+exec", "rushsite/matches/" + testMatchID + "/mode.cfg",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("args\n got %q\nwant %q", got, want)
	}
}

func TestLaunchArgsPlainMapAndExtraArgs(t *testing.T) {
	p := sampleParams(t)
	p.Spec.WorkshopID, p.Spec.MapName = "", "de_rush_arena"
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

func TestServerCfg(t *testing.T) {
	p := sampleParams(t)
	cfg := ServerCfg(p)
	for _, line := range []string{
		`sv_password "k3y-pass_9"`,
		"tv_port 27115",
		`tv_password "tvpw"`,
		`mp_teamname_1 "Alpha  quit"`,
		`mp_teamname_2 "Bravo"`,
	} {
		if !strings.Contains(cfg, line+"\n") {
			t.Errorf("server.cfg missing %q\n%s", line, cfg)
		}
	}
	if strings.Contains(cfg, "\nexec ") {
		t.Errorf("server.cfg must not exec the mode cfg, the launch line does\n%s", cfg)
	}
	if strings.Count(cfg, `"`)%2 != 0 {
		t.Errorf("unbalanced quotes in server.cfg")
	}
}

func TestServerCfgUsesDisplayName(t *testing.T) {
	p := sampleParams(t)
	p.Req.Teams[0].DisplayName = "Night Owls"
	cfg := ServerCfg(p)
	if !strings.Contains(cfg, `mp_teamname_1 "Night Owls"`+"\n") || !strings.Contains(cfg, `mp_teamname_2 "Bravo"`+"\n") {
		t.Errorf("display name not used\n%s", cfg)
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
	want := []string{"matchId", "mode", "map", "allowedSteamIds", "teams", "password", "webhookUrl", "webhookSecret", "demoUpload", "winCondition"}
	if len(m) != len(want) {
		t.Errorf("match.json has %d keys, want %d: %v", len(m), len(want), m)
	}
	for _, k := range want {
		if _, ok := m[k]; !ok {
			t.Errorf("match.json missing %s", k)
		}
	}
	if m["winCondition"] != "first_to_13" {
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
	if err != nil || !strings.Contains(string(emb), "mp_startmoney 16000") {
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
	if !strings.HasSuffix(string(files["mode.cfg"]), "\ncustom 1\n") {
		t.Fatalf("override not used: %q", files["mode.cfg"])
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
	if !reflect.DeepEqual(names, []string{"match.json", "mode.cfg", "server.cfg"}) {
		t.Fatalf("dir contents %v", names)
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
		"no cs2":           func(r *StartRequest) { r.CS2 = nil },
		"no game type":     func(r *StartRequest) { r.CS2.GameType = nil },
		"no game mode":     func(r *StartRequest) { r.CS2.GameMode = nil },
		"negative mode":    func(r *StartRequest) { r.CS2.GameMode = intp(-1) },
		"cfg path":         func(r *StartRequest) { r.CS2.ExecCfg = "../../x.cfg" },
		"valve cfg name":   func(r *StartRequest) { r.CS2.ExecCfg = "gamemode_rush.cfg" },
		"unknown cfg":      func(r *StartRequest) { r.CS2.ExecCfg = "missing.cfg" },
		"bad arg":          func(r *StartRequest) { r.CS2.ExtraArgs = []string{"+exec", "a;quit"} },
		"space arg":        func(r *StartRequest) { r.CS2.ExtraArgs = []string{"+map de_dust2"} },
		"two targets":      func(r *StartRequest) { r.CS2.MapName = "aim_map" },
		"no target":        func(r *StartRequest) { r.CS2.WorkshopID = "" },
		"other workshop":   func(r *StartRequest) { r.CS2.WorkshopID = "1" },
		"map name drift": func(r *StartRequest) {
			r.Map = MapEntry{ID: "rush_001", MapName: "rush_001"}
			r.CS2.WorkshopID, r.CS2.MapName = "", "rush_002"
		},
	}
	for name, mutate := range cases {
		r := sampleReq()
		mutate(&r)
		if _, err := Validate(&r, DefaultModes(), ""); !IsValidation(err) {
			t.Errorf("%s: want validation error, got %v", name, err)
		}
	}
}

func TestValidateUsesOperatorCfgDir(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "rushsite_test.cfg"), []byte("sv_cheats 0\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	r := sampleReq()
	r.CS2.ExecCfg = "rushsite_test.cfg"
	if _, err := Validate(&r, DefaultModes(), ""); !IsValidation(err) {
		t.Fatalf("want validation error without the dir, got %v", err)
	}
	spec, err := Validate(&r, DefaultModes(), dir)
	if err != nil || spec.ExecCfg != "rushsite_test.cfg" {
		t.Fatalf("spec %+v err %v", spec, err)
	}
}

func TestRushCfgKeepsValveRules(t *testing.T) {
	cfg, err := modeCfgSource("rushsite_rush3v3.cfg", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(string(cfg), "\n") {
		for _, cvar := range []string{"mp_match_end_restart", "mp_maxrounds", "mp_warmup_pausetimer", "mp_warmuptime", "mp_roundtime", "mp_halftime", "mp_freezetime", "mp_buytime", "mp_startmoney", "mp_maxmoney", "mp_match_can_clinch", "exec"} {
			if strings.HasPrefix(line, cvar) {
				t.Errorf("rush cfg must not override Valve rules: %s", line)
			}
		}
	}
}

func TestAimCfgs(t *testing.T) {
	for _, name := range []string{"rushsite_aim1v1.cfg", "rushsite_aim2v2.cfg"} {
		cfg, err := modeCfgSource(name, "")
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(string(cfg), "\n")
		for _, line := range lines {
			for _, cvar := range []string{"mp_maxrounds", "mp_match_can_clinch", "mp_overtime_enable", "mp_halftime"} {
				if strings.HasPrefix(line, cvar) {
					t.Errorf("%s sets %s, the plugin owns it", name, line)
				}
			}
		}
		for _, want := range []string{"mp_startmoney 16000", "mp_afterroundmoney 16000", "mp_give_player_c4 0", "mp_buy_anywhere 1"} {
			if !containsLine(lines, want) {
				t.Errorf("%s missing %q", name, want)
			}
		}
	}
}

func containsLine(lines []string, want string) bool {
	for _, l := range lines {
		if strings.TrimSpace(l) == want {
			return true
		}
	}
	return false
}

func TestConnect(t *testing.T) {
	if got := Connect("1.2.3.4", 27015, "pw"); got != "connect 1.2.3.4:27015; password pw" {
		t.Fatal(got)
	}
}

func sampleSeries(r *StartRequest) {
	up := func(n string) DemoUpload {
		return DemoUpload{Bucket: "demos", Key: "k_m" + n + ".dem", PresignedPutURL: "https://s3.example.test/put" + n}
	}
	r.Series = &Series{
		BestOf:         3,
		Maps:           []MapEntry{r.Map, {ID: "aim_redline", WorkshopID: "123"}, {ID: "awp_india", MapName: "awp_india"}},
		StartMapNumber: 1,
		Wins:           map[string]int{"A": 0, "B": 0},
		DemoUploads:    []DemoUpload{up("1"), up("2"), up("3")},
	}
}

func TestSeriesReachesMatchJSON(t *testing.T) {
	r := sampleReq()
	sampleSeries(&r)
	spec, err := Validate(&r, DefaultModes(), "")
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	b, err := PluginJSON(Params{Req: r, Spec: spec})
	if err != nil {
		t.Fatal(err)
	}
	var pc PluginConfig
	if err := json.Unmarshal(b, &pc); err != nil {
		t.Fatal(err)
	}
	if pc.Series == nil || len(pc.Series.Maps) != 3 || pc.Series.Maps[2].MapName != "awp_india" || pc.Series.DemoUploads[1].Key != "k_m2.dem" {
		t.Errorf("series=%+v", pc.Series)
	}
}

func TestBrandAndSlugReachMatchJSON(t *testing.T) {
	r := sampleReq()
	r.Brand = &Brand{Name: "rushsite", SiteURL: "https://site.example.test"}
	r.Slug = "brave-amber-falcon"
	spec, err := Validate(&r, DefaultModes(), "")
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	b, err := PluginJSON(Params{Req: r, Spec: spec})
	if err != nil {
		t.Fatal(err)
	}
	var pc PluginConfig
	if err := json.Unmarshal(b, &pc); err != nil {
		t.Fatal(err)
	}
	if pc.Brand == nil || pc.Brand.Name != "rushsite" || pc.Brand.SiteURL != "https://site.example.test" || pc.Slug != "brave-amber-falcon" {
		t.Errorf("brand=%+v slug=%q", pc.Brand, pc.Slug)
	}
	r = sampleReq()
	b, err = PluginJSON(Params{Req: r, Spec: spec})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), `"brand"`) || strings.Contains(string(b), `"slug"`) {
		t.Errorf("empty brand or slug written: %s", b)
	}
}

func TestValidateRejectsBadSeries(t *testing.T) {
	cases := map[string]func(s *Series){
		"bestOf one":     func(s *Series) { s.BestOf = 1 },
		"short maps":     func(s *Series) { s.Maps = s.Maps[:2] },
		"short uploads":  func(s *Series) { s.DemoUploads = s.DemoUploads[:2] },
		"start past end": func(s *Series) { s.StartMapNumber = 4 },
		"start zero":     func(s *Series) { s.StartMapNumber = 0 },
		"bad map name":   func(s *Series) { s.Maps[2] = MapEntry{ID: "x", MapName: "a;quit"} },
		"bad workshop":   func(s *Series) { s.Maps[1].WorkshopID = "1a" },
		"start not map":  func(s *Series) { s.StartMapNumber = 2 },
		"map without id": func(s *Series) { s.Maps[1].ID = "" },
		"bad loadout": func(s *Series) {
			s.Maps[1].Loadout = &Loadout{Primary: &WeaponPair{CT: "weapon_ak47; quit"}}
		},
	}
	for name, mutate := range cases {
		r := sampleReq()
		sampleSeries(&r)
		mutate(r.Series)
		if _, err := Validate(&r, DefaultModes(), ""); !IsValidation(err) {
			t.Errorf("%s: want validation error, got %v", name, err)
		}
	}
}

// The API leaves demoUpload and series.demoUploads out when recording is off
func recordOffReq(t *testing.T) StartRequest {
	t.Helper()
	r := sampleReq()
	if err := json.Unmarshal([]byte(`{"recordDemo":false}`), &r); err != nil {
		t.Fatal(err)
	}
	r.DemoUpload = DemoUpload{}
	sampleSeries(&r)
	r.Series.DemoUploads = nil
	return r
}

func TestRecordDemoOffReachesMatchJSON(t *testing.T) {
	r := recordOffReq(t)
	if r.RecordsDemo() {
		t.Fatal("recordDemo false was not read")
	}
	spec, err := Validate(&r, DefaultModes(), "")
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	b, err := PluginJSON(Params{Req: r, Spec: spec})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	if v, ok := m["recordDemo"]; !ok || v != false {
		t.Errorf("recordDemo=%v, want false", v)
	}
	// Older plugins require demoUpload, so a blank one is written
	demo, ok := m["demoUpload"].(map[string]any)
	if !ok || demo["presignedPutUrl"] != "" || demo["bucket"] != "" || demo["key"] != "" {
		t.Errorf("demoUpload=%v, want blank", m["demoUpload"])
	}
	series := m["series"].(map[string]any)
	if _, ok := series["demoUploads"]; ok {
		t.Errorf("series.demoUploads written with recording off: %v", series["demoUploads"])
	}
}

func TestRecordDemoOffDropsUploadUrls(t *testing.T) {
	r := sampleReq()
	off := false
	r.RecordDemo = &off
	sampleSeries(&r)
	spec, err := Validate(&r, DefaultModes(), "")
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	b, err := PluginJSON(Params{Req: r, Spec: spec})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "s3.example.test") {
		t.Errorf("upload url written with recording off: %s", b)
	}
}

func TestRecordDemoMissingMeansRecord(t *testing.T) {
	var r StartRequest
	if err := json.Unmarshal([]byte(`{"matchId":"x"}`), &r); err != nil {
		t.Fatal(err)
	}
	if !r.RecordsDemo() {
		t.Error("a request without recordDemo should record")
	}
	p := sampleParams(t)
	b, err := PluginJSON(p)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "recordDemo") {
		t.Errorf("recordDemo written for a recording match: %s", b)
	}
	on := true
	p.Req.RecordDemo = &on
	if b, _ = PluginJSON(p); strings.Contains(string(b), "recordDemo") || !strings.Contains(string(b), "s3.example.test/put") {
		t.Errorf("recordDemo true should match an old request: %s", b)
	}
}

func TestRecordingSeriesStillNeedsUploads(t *testing.T) {
	r := sampleReq()
	sampleSeries(&r)
	r.Series.DemoUploads = nil
	if _, err := Validate(&r, DefaultModes(), ""); !IsValidation(err) {
		t.Errorf("want validation error, got %v", err)
	}
}
