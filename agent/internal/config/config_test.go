package config

import (
	"strings"
	"testing"
)

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func base() map[string]string {
	return map[string]string{
		"RUSHSITE_AGENT_TOKEN": "0123456789abcdef0123",
		"RUSHSITE_CS2_DIR":     "/srv/cs2",
		"RUSHSITE_PORT_RANGE":  "27015-27030",
		"RUSHSITE_PUBLIC_IP":   "203.0.113.10",
	}
}

func TestDefaults(t *testing.T) {
	c, err := FromEnv(env(base()))
	if err != nil {
		t.Fatal(err)
	}
	if c.PortLo != 27015 || c.PortHi != 27030 || c.ListenAddr != "0.0.0.0:8080" || c.TVPortOffset != 100 {
		t.Fatalf("%+v", c)
	}
	if c.CS2Bin != "/srv/cs2/game/bin/linuxsteamrt64/cs2" || c.SteamCMD != "/usr/games/steamcmd" || c.UpdateCheck != CheckSteamAPI {
		t.Fatalf("%+v", c)
	}
}

func TestErrors(t *testing.T) {
	cases := map[string]string{
		"RUSHSITE_PORT_RANGE":     "27030-27015",
		"RUSHSITE_PUBLIC_IP":      "not-an-ip",
		"RUSHSITE_AGENT_TOKEN":    "short",
		"RUSHSITE_CS2_DIR":        "relative/dir",
		"RUSHSITE_TV_PORT_OFFSET": "5",
		"RUSHSITE_UPDATE_CHECK":   "sometimes",
		"RUSHSITE_STOP_GRACE":     "soon",
	}
	for k, v := range cases {
		m := base()
		m[k] = v
		if _, err := FromEnv(env(m)); err == nil || !strings.Contains(err.Error(), k) {
			t.Errorf("%s=%s: err %v", k, v, err)
		}
	}
}

func TestParsePortRange(t *testing.T) {
	for _, s := range []string{"", "27015", "a-b", "80-90", "27015-70000"} {
		if _, _, err := ParsePortRange(s); err == nil {
			t.Errorf("%q accepted", s)
		}
	}
	if lo, hi, err := ParsePortRange(" 27015 - 27015 "); err != nil || lo != 27015 || hi != 27015 {
		t.Fatalf("%d %d %v", lo, hi, err)
	}
}
