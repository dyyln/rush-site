// Package update keeps the shared CS2 install current.
//
// States:
//
//	idle      accepting servers, checking Steam on an interval
//	draining  an update is due, new servers refused, waiting for running ones to end
//	updating  steamcmd is running
//
// A failed steamcmd run goes back to draining and is retried on the next step.
package update

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/rushsite/agent/internal/procrun"
)

// State of the updater.
type State string

const (
	Idle     State = "idle"
	Draining State = "draining"
	Updating State = "updating"
)

// Checker says whether the installed build is behind Steam.
type Checker interface {
	Outdated(ctx context.Context) (bool, error)
}

// Gate is the part of the server manager the updater drives.
type Gate interface {
	SetAccepting(ok bool)
	Running() int
}

// Config for the updater.
type Config struct {
	SteamCMD      string
	CS2Dir        string
	LogDir        string
	Validate      bool
	PatchGameinfo bool
	CheckInterval time.Duration
	DrainPoll     time.Duration
}

// Status is reported on /health.
type Status struct {
	State      State      `json:"state"`
	LastCheck  *time.Time `json:"lastCheck,omitempty"`
	LastUpdate *time.Time `json:"lastUpdate,omitempty"`
	LastError  string     `json:"lastError,omitempty"`
	Attempts   int        `json:"attempts,omitempty"`
	// Rush room veto script: off (not installed), on, stale (Valve changed rush_001) or error.
	RushRooms       RushRoomsState `json:"rushRooms,omitempty"`
	RushRoomsDetail string         `json:"rushRoomsDetail,omitempty"`
}

// Updater runs the update state machine.
type Updater struct {
	cfg     Config
	checker Checker
	gate    Gate
	runner  procrun.Runner
	log     *slog.Logger
	kick    chan struct{}

	mu     sync.Mutex
	status Status
}

// New builds an updater. checker may be nil to disable update checks.
func New(cfg Config, checker Checker, gate Gate, runner procrun.Runner, log *slog.Logger) *Updater {
	if log == nil {
		log = slog.Default()
	}
	return &Updater{
		cfg:     cfg,
		checker: checker,
		gate:    gate,
		runner:  runner,
		log:     log,
		kick:    make(chan struct{}, 1),
		status:  Status{State: Idle},
	}
}

// PatchGameinfo checks the Rush script VPK and puts the Metamod and Rush lines in gameinfo.gi.
// Called at start and after every CS2 update. Does nothing when patching is turned off.
func (u *Updater) PatchGameinfo() error {
	if !u.cfg.PatchGameinfo {
		return nil
	}
	state, detail := CheckRushRooms(u.cfg.CS2Dir)
	u.set(func(s *Status) { s.RushRooms, s.RushRoomsDetail = state, detail })
	switch state {
	case RushRoomsStale, RushRoomsError:
		u.log.Error("Rush room veto script left out, Valve's random draw runs", "state", state, "detail", detail)
	case RushRoomsOn:
		u.log.Info("Rush room veto script enabled")
	}
	changed, err := EnsureGameinfo(GameinfoPath(u.cfg.CS2Dir), state == RushRoomsOn)
	if err != nil {
		return fmt.Errorf("patch gameinfo.gi: %w", err)
	}
	if changed {
		u.log.Info("updated gameinfo.gi search paths", "rushRooms", state)
	}
	return nil
}

// Status returns a copy of the current status.
func (u *Updater) Status() Status {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.status
}

// Updating reports whether the agent is refusing servers because of an update.
func (u *Updater) Updating() bool { return u.Status().State != Idle }

// Kick wakes the loop early, for example when a server exits during a drain.
func (u *Updater) Kick() {
	select {
	case u.kick <- struct{}{}:
	default:
	}
}

// Trigger starts a drain and update without asking the checker.
func (u *Updater) Trigger() {
	u.mu.Lock()
	if u.status.State == Idle {
		u.gate.SetAccepting(false)
		u.status.State = Draining
		u.log.Info("update requested, draining")
	}
	u.mu.Unlock()
	u.Kick()
}

func (u *Updater) set(f func(s *Status)) {
	u.mu.Lock()
	f(&u.status)
	u.mu.Unlock()
}

// Step advances the state machine once.
func (u *Updater) Step(ctx context.Context) {
	switch u.Status().State {
	case Idle:
		if u.checker == nil {
			return
		}
		outdated, err := u.checker.Outdated(ctx)
		now := time.Now().UTC()
		u.set(func(s *Status) {
			s.LastCheck = &now
			if err != nil {
				s.LastError = "check: " + err.Error()
			}
		})
		if err != nil {
			u.log.Warn("update check failed", "err", err)
			return
		}
		if !outdated {
			return
		}
		u.log.Info("CS2 update available, draining")
		u.mu.Lock()
		u.gate.SetAccepting(false)
		u.status.State = Draining
		u.mu.Unlock()
		u.drain(ctx)
	case Draining:
		u.drain(ctx)
	}
}

func (u *Updater) drain(ctx context.Context) {
	if n := u.gate.Running(); n > 0 {
		u.log.Info("waiting for matches to end before update", "running", n)
		return
	}
	u.set(func(s *Status) { s.State = Updating; s.Attempts++ })
	err := u.runSteamCMD(ctx)
	if err == nil {
		err = u.PatchGameinfo()
	}
	if err != nil {
		u.log.Error("CS2 update failed, will retry", "err", err)
		u.set(func(s *Status) { s.State = Draining; s.LastError = "update: " + err.Error() })
		return
	}
	now := time.Now().UTC()
	u.mu.Lock()
	u.status = Status{State: Idle, LastCheck: u.status.LastCheck, LastUpdate: &now,
		RushRooms: u.status.RushRooms, RushRoomsDetail: u.status.RushRoomsDetail}
	u.gate.SetAccepting(true)
	u.mu.Unlock()
	u.log.Info("CS2 updated, accepting servers again")
}

// SteamCMDArgs is the argument list for installing or updating CS2.
func SteamCMDArgs(installDir string, validate bool) []string {
	args := []string{"+force_install_dir", installDir, "+login", "anonymous", "+app_update", "730"}
	if validate {
		args = append(args, "validate")
	}
	return append(args, "+quit")
}

func (u *Updater) runSteamCMD(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	var out *os.File
	if u.cfg.LogDir != "" {
		if err := os.MkdirAll(u.cfg.LogDir, 0o755); err == nil {
			out, _ = os.OpenFile(filepath.Join(u.cfg.LogDir, "steamcmd.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o640)
		}
	}
	spec := procrun.Spec{Path: u.cfg.SteamCMD, Args: SteamCMDArgs(u.cfg.CS2Dir, u.cfg.Validate)}
	if out != nil {
		defer out.Close()
		fmt.Fprintf(out, "rushsite-agent: %s running steamcmd\n", time.Now().UTC().Format(time.RFC3339))
		spec.Stdout = out
	}
	code, err := procrun.Run(u.runner, spec)
	if err != nil {
		return err
	}
	if code != 0 {
		return fmt.Errorf("steamcmd exited with code %d", code)
	}
	return nil
}

// Run loops until ctx is done. It steps at once, then every CheckInterval while idle
// and every DrainPoll while draining.
func (u *Updater) Run(ctx context.Context) {
	for {
		u.Step(ctx)
		wait := u.cfg.CheckInterval
		if u.Status().State != Idle {
			wait = u.cfg.DrainPoll
		}
		t := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-u.kick:
			t.Stop()
		case <-t.C:
		}
	}
}
