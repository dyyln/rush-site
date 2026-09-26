package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/rushsite/agent/internal/hostmetrics"
	"github.com/rushsite/agent/internal/manager"
	"github.com/rushsite/agent/internal/match"
	"github.com/rushsite/agent/internal/procrun"
	"github.com/rushsite/agent/internal/slots"
	"github.com/rushsite/agent/internal/update"
)

const (
	token   = "test-token-0123456789"
	matchID = "44444444-4444-4444-8444-444444444444"
)

func newAPI(t *testing.T) (*httptest.Server, *manager.Manager, *update.Updater) {
	t.Helper()
	return newAPIWith(t, nil)
}

func newAPIWith(t *testing.T, metrics *hostmetrics.Sampler) (*httptest.Server, *manager.Manager, *update.Updater) {
	t.Helper()
	root := t.TempDir()
	m := manager.New(manager.Config{
		CS2Dir:       filepath.Join(root, "cs2"),
		CS2Bin:       "/bin/false",
		DataDir:      filepath.Join(root, "data"),
		PublicIP:     "198.51.100.4",
		TVPortOffset: 100,
		StopGrace:    time.Second,
	}, match.DefaultModes(), &procrun.FakeRunner{}, slots.New(27015, 27016, nil), nil)
	u := update.New(update.Config{CS2Dir: root}, nil, m, &procrun.FakeRunner{}, nil)
	s := &Server{Token: token, Servers: m, Updates: u, Version: func() string { return "1.41.8.2" }, Metrics: metrics, PublicIP: "198.51.100.4"}
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return ts, m, u
}

func do(t *testing.T, method, url, auth, body string) (*http.Response, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(method, url, strings.NewReader(body))
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp, out
}

const startBody = `{
  "matchId": "` + matchID + `",
  "mode": "rush3v3",
  "map": {"id": "rush_001", "displayName": "Complex", "mapName": "rush_001"},
  "gslt": "ABCDEF0123456789ABCDEF0123456789",
  "password": "abc123",
  "allowedSteamIds": ["76561198000000001", "76561198000000002"],
  "teams": [{"name": "A", "steamIds": ["76561198000000001"]}, {"name": "B", "steamIds": ["76561198000000002"]}],
  "webhookUrl": "http://api:3000/webhooks/match/` + matchID + `",
  "webhookSecret": "whsec",
  "demoUpload": {"bucket": "demos", "key": "x.dem", "presignedPutUrl": "https://s3/put"},
  "cs2": {"gameType": 0, "gameMode": 6, "execCfg": "rushsite_rush3v3.cfg", "mapName": "rush_001"}
}`

func TestAuthRequired(t *testing.T) {
	ts, _, _ := newAPI(t)
	for _, auth := range []string{"", "Bearer wrong", token} {
		resp, _ := do(t, "GET", ts.URL+"/health", auth, "")
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("auth %q: status %d", auth, resp.StatusCode)
		}
	}
}

func TestHealthAndLifecycle(t *testing.T) {
	ts, _, u := newAPI(t)
	bearer := "Bearer " + token

	resp, h := do(t, "GET", ts.URL+"/health", bearer, "")
	if resp.StatusCode != 200 || h["ok"] != true || h["cs2Version"] != "1.41.8.2" || h["updating"] != false {
		t.Fatalf("health %d %v", resp.StatusCode, h)
	}
	if sl := h["slots"].(map[string]any); sl["total"] != 2.0 || sl["free"] != 2.0 {
		t.Fatalf("slots %v", sl)
	}

	resp, body := do(t, "POST", ts.URL+"/servers", bearer, startBody)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("start %d %v", resp.StatusCode, body)
	}
	if body["connect"] != "connect 198.51.100.4:27015; password abc123" || body["port"] != 27015.0 || body["ip"] != "198.51.100.4" {
		t.Fatalf("start body %v", body)
	}

	resp, body = do(t, "POST", ts.URL+"/servers", bearer, startBody)
	if resp.StatusCode != http.StatusConflict || body["error"] != "exists" {
		t.Fatalf("duplicate %d %v", resp.StatusCode, body)
	}

	req, _ := http.NewRequest("GET", ts.URL+"/servers", nil)
	req.Header.Set("Authorization", bearer)
	lr, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var list []manager.Info
	_ = json.NewDecoder(lr.Body).Decode(&list)
	lr.Body.Close()
	if len(list) != 1 || list[0].MatchID != matchID || list[0].Status != manager.StatusRunning {
		t.Fatalf("list %+v", list)
	}

	u.Trigger()
	resp, body = do(t, "POST", ts.URL+"/servers", bearer, strings.Replace(startBody, "44444444-4444-4444", "55555555-5555-4555", 2))
	if resp.StatusCode != http.StatusServiceUnavailable || body["error"] != "updating" {
		t.Fatalf("while updating %d %v", resp.StatusCode, body)
	}
	_, h = do(t, "GET", ts.URL+"/health", bearer, "")
	if h["updating"] != true {
		t.Fatalf("health while draining %v", h)
	}

	resp, _ = do(t, "DELETE", ts.URL+"/servers/"+matchID, bearer, "")
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete %d", resp.StatusCode)
	}
	resp, _ = do(t, "DELETE", ts.URL+"/servers/"+matchID, bearer, "")
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("second delete %d", resp.StatusCode)
	}
	resp, _ = do(t, "DELETE", ts.URL+"/servers/not-a-uuid", bearer, "")
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad id delete %d", resp.StatusCode)
	}
}

func TestHealthPublicIP(t *testing.T) {
	bearer := "Bearer " + token
	ts, m, u := newAPI(t)
	_, h := do(t, "GET", ts.URL+"/health", bearer, "")
	if h["publicIp"] != "198.51.100.4" {
		t.Fatalf("publicIp %v", h["publicIp"])
	}

	// Unset means the field is left out, as older agents do
	bare := httptest.NewServer((&Server{Token: token, Servers: m, Updates: u}).Handler())
	t.Cleanup(bare.Close)
	_, h = do(t, "GET", bare.URL+"/health", bearer, "")
	if _, ok := h["publicIp"]; ok || h["ok"] != true {
		t.Fatalf("health without public ip %v", h)
	}
}

func TestHealthMetrics(t *testing.T) {
	bearer := "Bearer " + token
	ts, _, _ := newAPI(t)
	_, h := do(t, "GET", ts.URL+"/health", bearer, "")
	if _, ok := h["metrics"]; ok {
		t.Fatalf("no sampler should mean no metrics block, got %v", h["metrics"])
	}

	proc := t.TempDir()
	if err := os.WriteFile(filepath.Join(proc, "meminfo"), []byte("MemTotal: 1000 kB\nMemAvailable: 250 kB\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	ts, _, _ = newAPIWith(t, &hostmetrics.Sampler{Root: proc})
	if resp, body := do(t, "POST", ts.URL+"/servers", bearer, startBody); resp.StatusCode != http.StatusCreated {
		t.Fatalf("start %d %v", resp.StatusCode, body)
	}
	_, h = do(t, "GET", ts.URL+"/health", bearer, "")
	m, ok := h["metrics"].(map[string]any)
	if !ok {
		t.Fatalf("metrics missing in %v", h)
	}
	if m["memUsedBytes"] != 750.0*1024 || m["memTotalBytes"] != 1000.0*1024 {
		t.Fatalf("memory %v", m)
	}
	servers := m["servers"].([]any)
	if len(servers) != 1 {
		t.Fatalf("servers %v", servers)
	}
	srv := servers[0].(map[string]any)
	if srv["matchId"] != matchID || srv["port"] != 27015.0 || srv["pid"] != 1001.0 {
		t.Fatalf("server %v", srv)
	}
}

func TestStartValidationErrors(t *testing.T) {
	ts, _, _ := newAPI(t)
	bearer := "Bearer " + token
	resp, body := do(t, "POST", ts.URL+"/servers", bearer, "{not json")
	if resp.StatusCode != 400 {
		t.Fatalf("bad json %d %v", resp.StatusCode, body)
	}
	resp, body = do(t, "POST", ts.URL+"/servers", bearer, strings.Replace(startBody, `"abc123"`, `"a b"`, 1))
	if resp.StatusCode != 400 || body["error"] != "bad_request" {
		t.Fatalf("bad password %d %v", resp.StatusCode, body)
	}
	resp, body = do(t, "POST", ts.URL+"/servers", bearer, strings.Replace(startBody, "rushsite_rush3v3.cfg", "gamemode_rush.cfg", 1))
	if resp.StatusCode != 400 || body["error"] != "bad_request" {
		t.Fatalf("unknown execCfg %d %v", resp.StatusCode, body)
	}
}
