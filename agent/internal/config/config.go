// Package config reads agent settings from the environment.
package config

import (
	"errors"
	"fmt"
	"net"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Config holds every agent setting.
type Config struct {
	Token      string
	CS2Dir     string
	CS2Bin     string
	PortLo     int
	PortHi     int
	PublicIP   string
	ListenAddr string
	DataDir    string

	TVPortOffset int
	StopGrace    time.Duration

	ModesFile  string
	ModeCfgDir string

	SteamCMD       string
	UpdateCheck    string
	UpdateInterval time.Duration
	DrainPoll      time.Duration
	UpdateValidate bool
	PatchGameinfo  bool
	SteamAPIBase   string
}

// Update check strategies.
const (
	CheckSteamAPI = "steamapi"
	CheckSteamCMD = "steamcmd"
	CheckOff      = "off"
)

// FromEnv builds a Config using getenv, normally os.Getenv.
func FromEnv(getenv func(string) string) (Config, error) {
	get := func(k, def string) string {
		if v := strings.TrimSpace(getenv(k)); v != "" {
			return v
		}
		return def
	}
	var errs []error
	c := Config{
		Token:        get("RUSHSITE_AGENT_TOKEN", ""),
		CS2Dir:       get("RUSHSITE_CS2_DIR", ""),
		PublicIP:     get("RUSHSITE_PUBLIC_IP", ""),
		ListenAddr:   get("RUSHSITE_LISTEN", "0.0.0.0:8080"),
		DataDir:      get("RUSHSITE_DATA_DIR", "/var/lib/rushsite-agent"),
		ModesFile:    get("RUSHSITE_MODES_FILE", ""),
		ModeCfgDir:   get("RUSHSITE_MODE_CFG_DIR", ""),
		SteamCMD:     get("RUSHSITE_STEAMCMD", "/usr/games/steamcmd"),
		UpdateCheck:  strings.ToLower(get("RUSHSITE_UPDATE_CHECK", CheckSteamAPI)),
		SteamAPIBase: get("RUSHSITE_STEAM_API_BASE", "https://api.steampowered.com"),
	}
	if len(c.Token) < 16 {
		errs = append(errs, errors.New("RUSHSITE_AGENT_TOKEN must be set and at least 16 characters"))
	}
	if c.CS2Dir == "" {
		errs = append(errs, errors.New("RUSHSITE_CS2_DIR must be set"))
	} else if !filepath.IsAbs(c.CS2Dir) {
		errs = append(errs, errors.New("RUSHSITE_CS2_DIR must be an absolute path"))
	}
	c.CS2Bin = get("RUSHSITE_CS2_BIN", filepath.Join(c.CS2Dir, "game", "bin", "linuxsteamrt64", "cs2"))
	if ip := net.ParseIP(c.PublicIP); ip == nil {
		errs = append(errs, errors.New("RUSHSITE_PUBLIC_IP must be a valid IP address"))
	}
	lo, hi, err := ParsePortRange(get("RUSHSITE_PORT_RANGE", ""))
	if err != nil {
		errs = append(errs, fmt.Errorf("RUSHSITE_PORT_RANGE: %w", err))
	}
	c.PortLo, c.PortHi = lo, hi

	if c.TVPortOffset, err = intVar(get, "RUSHSITE_TV_PORT_OFFSET", 100); err != nil {
		errs = append(errs, err)
	} else if c.TVPortOffset <= c.PortHi-c.PortLo && c.TVPortOffset >= -(c.PortHi-c.PortLo) {
		errs = append(errs, errors.New("RUSHSITE_TV_PORT_OFFSET makes GOTV ports overlap the game port range"))
	} else if c.PortHi+c.TVPortOffset > 65535 || c.PortLo+c.TVPortOffset < 1 {
		errs = append(errs, errors.New("RUSHSITE_TV_PORT_OFFSET puts GOTV ports out of range"))
	}
	if c.StopGrace, err = durVar(get, "RUSHSITE_STOP_GRACE", 10*time.Second); err != nil {
		errs = append(errs, err)
	}
	if c.UpdateInterval, err = durVar(get, "RUSHSITE_UPDATE_INTERVAL", 5*time.Minute); err != nil {
		errs = append(errs, err)
	}
	if c.DrainPoll, err = durVar(get, "RUSHSITE_DRAIN_POLL", 10*time.Second); err != nil {
		errs = append(errs, err)
	}
	if c.UpdateValidate, err = boolVar(get, "RUSHSITE_UPDATE_VALIDATE", false); err != nil {
		errs = append(errs, err)
	}
	if c.PatchGameinfo, err = boolVar(get, "RUSHSITE_PATCH_GAMEINFO", true); err != nil {
		errs = append(errs, err)
	}
	switch c.UpdateCheck {
	case CheckSteamAPI, CheckSteamCMD, CheckOff:
	default:
		errs = append(errs, fmt.Errorf("RUSHSITE_UPDATE_CHECK must be %s, %s or %s", CheckSteamAPI, CheckSteamCMD, CheckOff))
	}
	return c, errors.Join(errs...)
}

// ParsePortRange parses "27015-27030" into an inclusive range.
func ParsePortRange(s string) (int, int, error) {
	a, b, ok := strings.Cut(strings.TrimSpace(s), "-")
	if !ok {
		return 0, 0, fmt.Errorf("want lo-hi, got %q", s)
	}
	lo, err1 := strconv.Atoi(strings.TrimSpace(a))
	hi, err2 := strconv.Atoi(strings.TrimSpace(b))
	if err1 != nil || err2 != nil {
		return 0, 0, fmt.Errorf("want lo-hi, got %q", s)
	}
	if lo < 1024 || hi > 65535 || lo > hi {
		return 0, 0, fmt.Errorf("range %d-%d is invalid", lo, hi)
	}
	return lo, hi, nil
}

func intVar(get func(string, string) string, k string, def int) (int, error) {
	v := get(k, "")
	if v == "" {
		return def, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", k, err)
	}
	return n, nil
}

func durVar(get func(string, string) string, k string, def time.Duration) (time.Duration, error) {
	v := get(k, "")
	if v == "" {
		return def, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		return 0, fmt.Errorf("%s: want a positive duration like 30s, got %q", k, v)
	}
	return d, nil
}

func boolVar(get func(string, string) string, k string, def bool) (bool, error) {
	v := get(k, "")
	if v == "" {
		return def, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return false, fmt.Errorf("%s: %w", k, err)
	}
	return b, nil
}
