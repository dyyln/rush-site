package match

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

// ValidationError is a bad request from the API.
type ValidationError struct{ Msg string }

func (e *ValidationError) Error() string { return e.Msg }

func invalid(format string, a ...any) error {
	return &ValidationError{Msg: fmt.Sprintf(format, a...)}
}

var (
	reUUID     = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	reSteamID  = regexp.MustCompile(`^[0-9]{17}$`)
	reMapName  = regexp.MustCompile(`^[A-Za-z0-9_]{1,64}$`)
	reWorkshop = regexp.MustCompile(`^[0-9]{1,20}$`)
	reGSLT     = regexp.MustCompile(`^[A-Za-z0-9]{8,64}$`)
	rePassword = regexp.MustCompile(`^[A-Za-z0-9_\-]{4,64}$`)
	reArgFlag  = regexp.MustCompile(`^[+-][A-Za-z0-9_]{1,64}$`)
	reArgValue = regexp.MustCompile(`^[A-Za-z0-9_.\-]{1,64}$`)
)

// resolveCS2 turns the request's cs2 block into a launch spec.
// The block comes from the API, so every field is checked and execCfg must be a cfg this agent has.
func resolveCS2(rules ModeRules, req *StartRequest, cfgDir string) (ModeSpec, error) {
	o := req.CS2
	if o == nil {
		return ModeSpec{}, invalid("cs2 is required")
	}
	if o.GameType == nil || *o.GameType < 0 || *o.GameType > 100 {
		return ModeSpec{}, invalid("cs2.gameType is missing or out of range")
	}
	if o.GameMode == nil || *o.GameMode < 0 || *o.GameMode > 100 {
		return ModeSpec{}, invalid("cs2.gameMode is missing or out of range")
	}
	if !reCfgName.MatchString(o.ExecCfg) {
		return ModeSpec{}, invalid("cs2.execCfg must be a plain file name ending in .cfg")
	}
	if !HasModeCfg(o.ExecCfg, cfgDir) {
		return ModeSpec{}, invalid("no mode cfg named %s on this agent", o.ExecCfg)
	}
	if len(o.ExtraArgs) > 16 {
		return ModeSpec{}, invalid("cs2.extraArgs has too many entries")
	}
	for _, a := range o.ExtraArgs {
		if !reArgFlag.MatchString(a) && !reArgValue.MatchString(a) {
			return ModeSpec{}, invalid("cs2.extraArgs entry %q is not allowed", a)
		}
	}
	if (o.WorkshopID == "") == (o.MapName == "") {
		return ModeSpec{}, invalid("cs2 needs exactly one of workshopId or mapName")
	}
	if o.WorkshopID != "" {
		if !reWorkshop.MatchString(o.WorkshopID) {
			return ModeSpec{}, invalid("cs2.workshopId must be numeric")
		}
		if req.Map.WorkshopID != o.WorkshopID {
			return ModeSpec{}, invalid("cs2.workshopId does not match map.workshopId")
		}
	} else {
		if !reMapName.MatchString(o.MapName) {
			return ModeSpec{}, invalid("cs2.mapName %q must be A-Z a-z 0-9 _", o.MapName)
		}
		if name, _ := LevelName(req.Map); req.Map.WorkshopID != "" || name != o.MapName {
			return ModeSpec{}, invalid("cs2.mapName does not match map")
		}
	}
	return ModeSpec{
		ModeRules:  rules,
		GameType:   *o.GameType,
		GameMode:   *o.GameMode,
		ExecCfg:    o.ExecCfg,
		ExtraArgs:  o.ExtraArgs,
		WorkshopID: o.WorkshopID,
		MapName:    o.MapName,
	}, nil
}

// ValidMatchID reports whether id is a UUID. Match ids end up in file paths so this is strict.
func ValidMatchID(id string) bool { return reUUID.MatchString(id) }

// Validate checks req and returns the launch spec from its cs2 block.
// cfgDir is the operator cfg dir that may add or replace mode cfgs, empty for embedded only.
func Validate(req *StartRequest, modes ModeTable, cfgDir string) (ModeSpec, error) {
	if !ValidMatchID(req.MatchID) {
		return ModeSpec{}, invalid("matchId must be a UUID")
	}
	rules, ok := modes[req.Mode]
	if !ok {
		return ModeSpec{}, invalid("unknown mode %q", req.Mode)
	}
	if req.Map.ID == "" {
		return ModeSpec{}, invalid("map.id is required")
	}
	if req.Map.WorkshopID != "" && !reWorkshop.MatchString(req.Map.WorkshopID) {
		return ModeSpec{}, invalid("map.workshopId must be numeric")
	}
	if req.Map.WorkshopID == "" {
		if _, err := LevelName(req.Map); err != nil {
			return ModeSpec{}, err
		}
	}
	spec, err := resolveCS2(rules, req, cfgDir)
	if err != nil {
		return ModeSpec{}, err
	}
	if !reGSLT.MatchString(req.GSLT) {
		return ModeSpec{}, invalid("gslt is malformed")
	}
	if !rePassword.MatchString(req.Password) {
		return ModeSpec{}, invalid("password must be 4 to 64 of A-Z a-z 0-9 _ -")
	}
	if len(req.AllowedSteamIDs) == 0 {
		return ModeSpec{}, invalid("allowedSteamIds is empty")
	}
	allowed := make(map[string]bool, len(req.AllowedSteamIDs))
	for _, id := range req.AllowedSteamIDs {
		if !reSteamID.MatchString(id) {
			return ModeSpec{}, invalid("bad steamId %q", id)
		}
		allowed[id] = true
	}
	if len(req.Teams) != 2 {
		return ModeSpec{}, invalid("want exactly 2 teams, got %d", len(req.Teams))
	}
	for i, t := range req.Teams {
		if len(t.SteamIDs) == 0 || len(t.SteamIDs) > spec.TeamSize {
			return ModeSpec{}, invalid("team %d has %d players, mode allows 1 to %d", i, len(t.SteamIDs), spec.TeamSize)
		}
		for _, id := range t.SteamIDs {
			if !allowed[id] {
				return ModeSpec{}, invalid("team %d player %q is not in allowedSteamIds", i, id)
			}
		}
	}
	u, err := url.Parse(req.WebhookURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ModeSpec{}, invalid("webhookUrl must be an http or https URL")
	}
	if req.WebhookSecret == "" {
		return ModeSpec{}, invalid("webhookSecret is required")
	}
	return spec, nil
}

// LevelName is the map name passed to +map when there is no workshop id.
func LevelName(m MapEntry) (string, error) {
	name := m.MapName
	if name == "" {
		name = m.ID
	}
	if !reMapName.MatchString(name) {
		return "", invalid("map name %q must be A-Z a-z 0-9 _", name)
	}
	return name, nil
}

// CfgString makes s safe inside a double quoted cfg value.
func CfgString(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '"' || r == ';' || r == '\\' || r < 0x20 || r == 0x7f:
			continue
		default:
			b.WriteRune(r)
		}
	}
	out := b.String()
	if len([]rune(out)) > 32 {
		out = string([]rune(out)[:32])
	}
	return out
}

// IsValidation reports whether err is a request validation error.
func IsValidation(err error) bool {
	var v *ValidationError
	return errors.As(err, &v)
}
