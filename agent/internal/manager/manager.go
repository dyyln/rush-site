// Package manager runs one CS2 process per slot and tracks its lifecycle.
package manager

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/rushsite/agent/internal/match"
	"github.com/rushsite/agent/internal/procrun"
	"github.com/rushsite/agent/internal/slots"
)

// Errors returned by Start.
var (
	ErrUpdating = errors.New("agent is updating CS2 and not accepting servers")
	ErrExists   = errors.New("a server for this match already exists")
	ErrNoSlots  = slots.ErrFull
)

// Statuses reported in Info.
const (
	StatusStarting = "starting"
	StatusRunning  = "running"
	StatusStopping = "stopping"
	StatusExited   = "exited"
	StatusCrashed  = "crashed"
	StatusStopped  = "stopped"
)

const maxExitRecords = 50

// Config is what the manager needs from the agent config.
type Config struct {
	CS2Dir       string
	CS2Bin       string
	DataDir      string
	PublicIP     string
	TVPortOffset int
	StopGrace    time.Duration
	ModeCfgDir   string
}

// Info describes a server for GET /servers.
type Info struct {
	MatchID   string     `json:"matchId"`
	Mode      match.Mode `json:"mode"`
	MapID     string     `json:"mapId"`
	Port      int        `json:"port"`
	TVPort    int        `json:"tvPort"`
	PID       int        `json:"pid,omitempty"`
	Connect   string     `json:"connect"`
	Status    string     `json:"status"`
	StartedAt time.Time  `json:"startedAt"`
	EndedAt   *time.Time `json:"endedAt,omitempty"`
	ExitCode  *int       `json:"exitCode,omitempty"`
	LogPath   string     `json:"logPath"`
}

type server struct {
	info     Info
	proc     procrun.Process
	stopping bool
	adopted  bool
	webhook  hook
	dir      string
	log      *os.File
	done     chan struct{}
}

// hook is where crash events go. Kept out of Info so the secret never reaches GET /servers.
type hook struct {
	URL    string `json:"webhookUrl"`
	Secret string `json:"webhookSecret"`
}

// saved is one entry in the state file.
type saved struct {
	Info Info `json:"info"`
	hook
}

// Manager owns the slots and the CS2 processes. Safe for concurrent use.
type Manager struct {
	cfg    Config
	modes  match.ModeTable
	runner procrun.Runner
	slots  *slots.Allocator
	log    *slog.Logger

	// OnExit is called after a server exits and its slot is freed.
	OnExit func()
	// Alive checks that pid is still the CS2 server for matchID. Used by Recover.
	Alive func(pid int, matchID string) bool
	// Adopt wraps a surviving server process. Used by Recover.
	Adopt func(pid int) procrun.Process
	// OnCrash is called when a server exits without being asked to.
	// It gets the match webhook so the API can be told the match is abandoned.
	OnCrash func(info Info, webhookURL, webhookSecret string)

	mu        sync.Mutex
	servers   map[string]*server
	exits     []Info
	accepting bool
}

// New builds a manager. alloc hands out game ports.
func New(cfg Config, modes match.ModeTable, runner procrun.Runner, alloc *slots.Allocator, log *slog.Logger) *Manager {
	if log == nil {
		log = slog.Default()
	}
	return &Manager{
		cfg:       cfg,
		modes:     modes,
		runner:    runner,
		slots:     alloc,
		log:       log,
		Alive:     ProcAlive,
		Adopt:     func(pid int) procrun.Process { return procrun.Adopt(pid, 2*time.Second) },
		servers:   make(map[string]*server),
		accepting: true,
	}
}

// MatchesRoot is where per match cfg dirs live, inside the game cfg dir so +exec can reach them.
func (m *Manager) MatchesRoot() string {
	return filepath.Join(m.cfg.CS2Dir, "game", "csgo", "cfg", "rushsite", "matches")
}

func (m *Manager) logDir() string { return filepath.Join(m.cfg.DataDir, "logs") }

func (m *Manager) statePath() string { return filepath.Join(m.cfg.DataDir, "servers.json") }

// Recover adopts CS2 servers that outlived a previous agent run and removes stale match dirs.
// The systemd unit uses KillMode=process so servers survive an agent restart.
func (m *Manager) Recover() (int, error) {
	if err := os.MkdirAll(m.cfg.DataDir, 0o755); err != nil {
		return 0, err
	}
	var entries []saved
	b, err := os.ReadFile(m.statePath())
	switch {
	case err == nil:
		if err := json.Unmarshal(b, &entries); err != nil {
			m.log.Warn("ignoring unreadable state file", "path", m.statePath(), "err", err)
			entries = nil
		}
	case !os.IsNotExist(err):
		return 0, err
	}

	keep := map[string]bool{}
	var adopted []*server
	m.mu.Lock()
	for _, e := range entries {
		info := e.Info
		if !match.ValidMatchID(info.MatchID) || !m.Alive(info.PID, info.MatchID) {
			continue
		}
		if err := m.slots.Claim(info.Port, info.MatchID); err != nil {
			m.log.Warn("cannot adopt server", "match", info.MatchID, "err", err)
			continue
		}
		info.Status = StatusRunning
		s := &server{
			info:    info,
			proc:    m.Adopt(info.PID),
			adopted: true,
			webhook: e.hook,
			dir:     filepath.Join(m.MatchesRoot(), info.MatchID),
			done:    make(chan struct{}),
		}
		m.servers[info.MatchID] = s
		keep[info.MatchID] = true
		adopted = append(adopted, s)
	}
	m.persistLocked()
	m.mu.Unlock()

	for _, s := range adopted {
		m.log.Info("adopted running server", "match", s.info.MatchID, "port", s.info.Port, "pid", s.info.PID)
		go m.watch(s)
	}
	dirs, err := os.ReadDir(m.MatchesRoot())
	if err != nil && !os.IsNotExist(err) {
		return len(adopted), err
	}
	for _, e := range dirs {
		if !keep[e.Name()] {
			_ = os.RemoveAll(filepath.Join(m.MatchesRoot(), e.Name()))
		}
	}
	return len(adopted), nil
}

// persistLocked writes live servers to the state file. Caller holds m.mu.
func (m *Manager) persistLocked() {
	live := make([]saved, 0, len(m.servers))
	for _, s := range m.servers {
		if s.proc != nil {
			live = append(live, saved{Info: s.info, hook: s.webhook})
		}
	}
	b, err := json.Marshal(live)
	if err == nil {
		tmp := m.statePath() + ".tmp"
		if err = os.WriteFile(tmp, b, 0o600); err == nil {
			err = os.Rename(tmp, m.statePath())
		}
	}
	if err != nil {
		m.log.Warn("write state file", "err", err)
	}
}

// ProcAlive reports whether pid is alive and its command line mentions matchID.
func ProcAlive(pid int, matchID string) bool {
	if !procrun.Alive(pid) {
		return false
	}
	b, err := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid))
	if err != nil {
		return false
	}
	return bytes.Contains(b, []byte(matchID))
}

// SetAccepting opens or closes the manager to new servers.
func (m *Manager) SetAccepting(ok bool) {
	m.mu.Lock()
	m.accepting = ok
	m.mu.Unlock()
}

// Running is the number of servers that are starting, running or stopping.
func (m *Manager) Running() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.servers)
}

// Slots returns total and free slot counts.
func (m *Manager) Slots() (total, free int) {
	return m.slots.Total(), m.slots.Free()
}

// Start launches a server for req.
func (m *Manager) Start(req match.StartRequest) (match.StartResponse, error) {
	spec, err := match.Validate(&req, m.modes, m.cfg.ModeCfgDir)
	if err != nil {
		return match.StartResponse{}, err
	}

	m.mu.Lock()
	if !m.accepting {
		m.mu.Unlock()
		return match.StartResponse{}, ErrUpdating
	}
	if _, dup := m.servers[req.MatchID]; dup {
		m.mu.Unlock()
		return match.StartResponse{}, ErrExists
	}
	port, err := m.slots.Acquire(req.MatchID)
	if err != nil {
		m.mu.Unlock()
		return match.StartResponse{}, err
	}
	s := &server{
		info: Info{
			MatchID:   req.MatchID,
			Mode:      req.Mode,
			MapID:     req.Map.ID,
			Port:      port,
			TVPort:    port + m.cfg.TVPortOffset,
			Connect:   match.Connect(m.cfg.PublicIP, port, req.Password),
			Status:    StatusStarting,
			StartedAt: time.Now().UTC(),
			LogPath:   filepath.Join(m.logDir(), req.MatchID+".log"),
		},
		webhook: hook{URL: req.WebhookURL, Secret: req.WebhookSecret},
		dir:     filepath.Join(m.MatchesRoot(), req.MatchID),
		done:    make(chan struct{}),
	}
	m.servers[req.MatchID] = s
	m.mu.Unlock()

	proc, err := m.launch(s, req, spec)
	if err != nil {
		m.log.Error("server start failed", "match", req.MatchID, "port", port, "err", err)
		m.mu.Lock()
		delete(m.servers, req.MatchID)
		m.slots.Release(port)
		m.mu.Unlock()
		m.cleanupFiles(s)
		close(s.done)
		return match.StartResponse{}, fmt.Errorf("start cs2: %w", err)
	}

	m.mu.Lock()
	s.proc = proc
	s.info.PID = proc.Pid()
	stopNow := s.stopping
	if !stopNow {
		s.info.Status = StatusRunning
	}
	m.persistLocked()
	m.mu.Unlock()
	m.log.Info("server started", "match", req.MatchID, "mode", req.Mode, "map", req.Map.ID, "port", port, "pid", s.info.PID)

	go m.watch(s)
	if stopNow {
		go proc.Stop(m.cfg.StopGrace)
	}
	return match.StartResponse{MatchID: req.MatchID, IP: m.cfg.PublicIP, Port: port, Connect: s.info.Connect}, nil
}

func (m *Manager) launch(s *server, req match.StartRequest, spec match.ModeSpec) (procrun.Process, error) {
	tvpw, err := randomHex(12)
	if err != nil {
		return nil, err
	}
	p := match.Params{
		Req:        req,
		Spec:       spec,
		Port:       s.info.Port,
		TVPort:     s.info.TVPort,
		TVPassword: tvpw,
		CfgRel:     "rushsite/matches/" + req.MatchID,
		ModeCfgDir: m.cfg.ModeCfgDir,
	}
	files, err := match.RenderFiles(p)
	if err != nil {
		return nil, err
	}
	args, err := match.LaunchArgs(p)
	if err != nil {
		return nil, err
	}
	if err := match.WriteDir(s.dir, files); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(m.logDir(), 0o755); err != nil {
		return nil, err
	}
	lf, err := os.OpenFile(s.info.LogPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o640)
	if err != nil {
		return nil, err
	}
	fmt.Fprintf(lf, "rushsite-agent: %s starting %s %s\n", time.Now().UTC().Format(time.RFC3339), m.cfg.CS2Bin, strings.Join(redactArgs(args), " "))
	proc, err := m.runner.Start(procrun.Spec{
		Path:   m.cfg.CS2Bin,
		Args:   args,
		Dir:    m.cfg.CS2Dir,
		Env:    m.processEnv(s),
		Stdout: lf,
	})
	if err != nil {
		lf.Close()
		return nil, err
	}
	s.log = lf
	return proc, nil
}

// processEnv passes the agent env through minus its own settings, so the token never reaches CS2.
func (m *Manager) processEnv(s *server) []string {
	var env []string
	for _, kv := range os.Environ() {
		if strings.HasPrefix(kv, "RUSHSITE_") || strings.HasPrefix(kv, "LD_LIBRARY_PATH=") {
			continue
		}
		env = append(env, kv)
	}
	binDir := filepath.Dir(m.cfg.CS2Bin)
	return append(env,
		"LD_LIBRARY_PATH="+binDir,
		"RUSHSITE_MATCH_ID="+s.info.MatchID,
		"RUSHSITE_MATCH_DIR="+s.dir,
		"RUSHSITE_MATCH_JSON="+filepath.Join(s.dir, match.MatchJSONName),
	)
}

func (m *Manager) watch(s *server) {
	code := s.proc.Wait()
	ended := time.Now().UTC()

	m.mu.Lock()
	if m.servers[s.info.MatchID] == s {
		delete(m.servers, s.info.MatchID)
	}
	m.slots.Release(s.info.Port)
	rec := s.info
	rec.EndedAt = &ended
	rec.ExitCode = &code
	switch {
	case s.stopping:
		rec.Status = StatusStopped
	case s.adopted:
		rec.Status = StatusExited
		rec.ExitCode = nil
	case code == 0:
		rec.Status = StatusExited
	default:
		rec.Status = StatusCrashed
	}
	m.exits = append(m.exits, rec)
	if len(m.exits) > maxExitRecords {
		m.exits = m.exits[len(m.exits)-maxExitRecords:]
	}
	m.persistLocked()
	m.mu.Unlock()

	if rec.Status == StatusCrashed {
		m.log.Error("server crashed", "match", rec.MatchID, "port", rec.Port, "code", code, "log", rec.LogPath)
	} else {
		m.log.Info("server ended", "match", rec.MatchID, "port", rec.Port, "code", code, "status", rec.Status)
	}
	if s.log != nil {
		fmt.Fprintf(s.log, "rushsite-agent: %s process ended with code %d (%s)\n", ended.Format(time.RFC3339), code, rec.Status)
		s.log.Close()
	}
	m.cleanupFiles(s)
	close(s.done)
	// Adopted servers have no exit code, so any exit we did not ask for counts.
	unexpected := rec.Status == StatusCrashed || (s.adopted && rec.Status == StatusExited)
	if unexpected && m.OnCrash != nil && s.webhook.URL != "" {
		m.OnCrash(rec, s.webhook.URL, s.webhook.Secret)
	}
	if m.OnExit != nil {
		m.OnExit()
	}
}

func (m *Manager) cleanupFiles(s *server) {
	if err := os.RemoveAll(s.dir); err != nil {
		m.log.Warn("remove match dir", "dir", s.dir, "err", err)
	}
}

// Stop stops the server for matchID and waits until its slot is free.
// Unknown ids are not an error so DELETE stays idempotent.
func (m *Manager) Stop(matchID string) error {
	m.mu.Lock()
	s, ok := m.servers[matchID]
	if !ok {
		m.mu.Unlock()
		return nil
	}
	s.stopping = true
	s.info.Status = StatusStopping
	proc := s.proc
	m.mu.Unlock()

	if proc != nil {
		proc.Stop(m.cfg.StopGrace)
	}
	select {
	case <-s.done:
		return nil
	case <-time.After(m.cfg.StopGrace + 10*time.Second):
		return fmt.Errorf("server %s did not stop in time", matchID)
	}
}

// List returns live servers sorted by port, then recent exits when includeExited is set.
func (m *Manager) List(includeExited bool) []Info {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Info, 0, len(m.servers))
	for _, s := range m.servers {
		out = append(out, s.info)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Port < out[j].Port })
	if includeExited {
		for i := len(m.exits) - 1; i >= 0; i-- {
			out = append(out, m.exits[i])
		}
	}
	return out
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// redactArgs hides the GSLT and password in logs.
func redactArgs(args []string) []string {
	out := make([]string, len(args))
	copy(out, args)
	for i := 0; i+1 < len(out); i++ {
		if out[i] == "+sv_setsteamaccount" || out[i] == "+sv_password" {
			out[i+1] = "<redacted>"
		}
	}
	return out
}
