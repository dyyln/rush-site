package match

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
)

// ModeSpec is how the agent launches one mode. It mirrors the cs2 block of the shared ModeConfig.
type ModeSpec struct {
	TeamSize     int    `json:"teamSize"`
	GameType     *int   `json:"gameType"`
	GameMode     *int   `json:"gameMode"`
	ExecCfg      string `json:"execCfg"`
	WinCondition string `json:"winCondition"`
	// ExtraArgs are appended to the launch line after game_type and game_mode.
	// Operator config only, never from the API. Meant for things like a Rush mapgroup.
	ExtraArgs []string `json:"extraArgs,omitempty"`
}

// ModeTable maps each mode to its launch settings.
type ModeTable map[Mode]ModeSpec

// ErrModeNotConfigured means the mode has no game_type or game_mode yet.
var ErrModeNotConfigured = errors.New("mode is not configured on this agent")

var reCfgName = regexp.MustCompile(`^[A-Za-z0-9_\-]{1,64}\.cfg$`)

func intp(n int) *int { return &n }

// DefaultModes returns the built in table. RUSHSITE_MODES_FILE can override any field.
// Rush values come from Valve's gamemodes.txt. See agent/RUSH.md.
func DefaultModes() ModeTable {
	return ModeTable{
		Aim1v1: {
			TeamSize: 1, GameType: intp(0), GameMode: intp(1),
			ExecCfg: "rushsite_aim1v1.cfg", WinCondition: "first_to_16",
		},
		Aim2v2: {
			TeamSize: 2, GameType: intp(0), GameMode: intp(1),
			ExecCfg: "rushsite_aim2v2.cfg", WinCondition: "first_to_16",
		},
		Rush3v3: {
			TeamSize: 3, GameType: intp(0), GameMode: intp(6),
			ExecCfg: "rushsite_rush3v3.cfg", WinCondition: "valve_rush",
		},
	}
}

// LoadModes reads a JSON object keyed by mode and merges it over the defaults.
// Fields left out keep their default value.
func LoadModes(path string) (ModeTable, error) {
	t := DefaultModes()
	if path == "" {
		return t, nil
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var raw map[Mode]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	for mode, msg := range raw {
		spec, known := t[mode]
		if !known {
			return nil, fmt.Errorf("%s: unknown mode %q", path, mode)
		}
		if err := json.Unmarshal(msg, &spec); err != nil {
			return nil, fmt.Errorf("%s: mode %s: %w", path, mode, err)
		}
		t[mode] = spec
	}
	for mode, spec := range t {
		if err := spec.check(); err != nil {
			return nil, fmt.Errorf("%s: mode %s: %w", path, mode, err)
		}
	}
	return t, nil
}

func (s ModeSpec) check() error {
	if s.TeamSize < 1 || s.TeamSize > 5 {
		return fmt.Errorf("teamSize %d out of range", s.TeamSize)
	}
	if !reCfgName.MatchString(s.ExecCfg) {
		return fmt.Errorf("execCfg %q must be a plain file name ending in .cfg", s.ExecCfg)
	}
	return nil
}

// Configured reports whether the mode can be launched.
func (s ModeSpec) Configured() bool { return s.GameType != nil && s.GameMode != nil }
