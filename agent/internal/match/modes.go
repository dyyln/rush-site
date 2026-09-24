package match

import "regexp"

// ModeRules are the per mode facts the agent needs besides the launch block.
// Launch settings come only from the request. TestSharedModesFixture checks these against shared config.
type ModeRules struct {
	TeamSize     int
	WinCondition string
}

// ModeTable maps each mode to its rules.
type ModeTable map[Mode]ModeRules

// ModeSpec is one resolved launch, built from the request's cs2 block.
type ModeSpec struct {
	ModeRules
	GameType  int
	GameMode  int
	ExecCfg   string
	ExtraArgs []string
	// Exactly one of WorkshopID and MapName is set.
	WorkshopID string
	MapName    string
}

var reCfgName = regexp.MustCompile(`^[A-Za-z0-9_\-]{1,64}\.cfg$`)

// DefaultModes returns the rules for the platform modes.
func DefaultModes() ModeTable {
	return ModeTable{
		Aim1v1:  {TeamSize: 1, WinCondition: "first_to_13"},
		Aim2v2:  {TeamSize: 2, WinCondition: "first_to_13"},
		Rush3v3: {TeamSize: 3, WinCondition: "valve_rush"},
		Rush1v1: {TeamSize: 1, WinCondition: "valve_rush"},
		Rush2v2: {TeamSize: 2, WinCondition: "valve_rush"},
	}
}
