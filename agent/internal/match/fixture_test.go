package match

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// sharedFixture is agent/testdata/modes.json, exported from packages/shared.
// A shared vitest fails when the file is stale, so a drift fails one side or the other.
type sharedFixture struct {
	ExecCfgs []string `json:"execCfgs"`
	Modes    map[Mode]struct {
		TeamSize     int    `json:"teamSize"`
		WinCondition string `json:"winCondition"`
		Launches     []struct {
			Map MapEntry    `json:"map"`
			CS2 CS2Settings `json:"cs2"`
		} `json:"launches"`
	} `json:"modes"`
}

func loadFixture(t *testing.T) sharedFixture {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "testdata", "modes.json"))
	if err != nil {
		t.Fatalf("read fixture, run pnpm -C packages/shared export:modes: %v", err)
	}
	var f sharedFixture
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestSharedModesFixture(t *testing.T) {
	f := loadFixture(t)
	rules := DefaultModes()
	if len(f.Modes) != len(rules) {
		t.Fatalf("shared has %d modes, agent has %d", len(f.Modes), len(rules))
	}
	for mode, m := range f.Modes {
		r, ok := rules[mode]
		if !ok {
			t.Fatalf("agent does not know mode %s", mode)
		}
		if r.TeamSize != m.TeamSize || r.WinCondition != m.WinCondition {
			t.Errorf("%s: agent rules %+v, shared teamSize %d winCondition %s", mode, r, m.TeamSize, m.WinCondition)
		}
		if len(m.Launches) == 0 {
			t.Errorf("%s: no launches", mode)
		}
		for _, l := range m.Launches {
			t.Run(string(mode)+"/"+l.Map.ID, func(t *testing.T) {
				req := sampleReq()
				req.Mode = mode
				req.Map = l.Map
				cs2 := l.CS2
				req.CS2 = &cs2
				spec, err := Validate(&req, rules, "")
				if err != nil {
					t.Fatalf("agent rejects the shared launch: %v", err)
				}
				p := Params{Req: req, Spec: spec, Port: 27015, TVPort: 27115, CfgRel: "rushsite/matches/" + testMatchID}
				args, err := LaunchArgs(p)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := RenderFiles(p); err != nil {
					t.Fatal(err)
				}
				line := strings.Join(args, " ")
				want := "+game_type " + strconv.Itoa(*cs2.GameType) + " +game_mode " + strconv.Itoa(*cs2.GameMode)
				if len(cs2.ExtraArgs) > 0 {
					want += " " + strings.Join(cs2.ExtraArgs, " ")
				}
				if cs2.WorkshopID != "" {
					want += " +host_workshop_map " + cs2.WorkshopID
				} else {
					want += " +map " + cs2.MapName
				}
				if !strings.Contains(line, want) {
					t.Errorf("launch line %q does not contain %q", line, want)
				}
				if !strings.HasSuffix(line, "+exec rushsite/matches/"+testMatchID+"/mode.cfg") {
					t.Errorf("launch line must end by exec'ing mode.cfg: %s", line)
				}
			})
		}
	}
}

func TestSharedExecCfgsAreShipped(t *testing.T) {
	f := loadFixture(t)
	for _, name := range f.ExecCfgs {
		if !HasModeCfg(name, "") {
			t.Errorf("shared names %s but the agent does not ship it", name)
		}
	}
	shipped := EmbeddedCfgs()
	want := append([]string(nil), f.ExecCfgs...)
	sort.Strings(shipped)
	sort.Strings(want)
	if strings.Join(shipped, ",") != strings.Join(want, ",") {
		t.Errorf("agent ships %v, shared uses %v", shipped, want)
	}
}

func TestRushLaunchFromShared(t *testing.T) {
	f := loadFixture(t)
	l := f.Modes[Rush3v3].Launches[0]
	if l.CS2.ExecCfg != "rushsite_rush3v3.cfg" || l.CS2.MapName != "rush_001" || *l.CS2.GameType != 0 || *l.CS2.GameMode != 6 {
		t.Fatalf("rush launch %+v", l.CS2)
	}
	t1 := f.Modes[Rush1v1].Launches[0]
	if t1.CS2.ExecCfg != "rushsite_rush1v1.cfg" || t1.CS2.MapName != "rush_001" || *t1.CS2.GameType != 0 || *t1.CS2.GameMode != 6 {
		t.Fatalf("rush test launch %+v", t1.CS2)
	}
}
