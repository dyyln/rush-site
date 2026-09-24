// Command rushsite-agent runs CS2 match servers on one host and keeps the install updated.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/rushsite/agent/internal/api"
	"github.com/rushsite/agent/internal/config"
	"github.com/rushsite/agent/internal/manager"
	"github.com/rushsite/agent/internal/match"
	"github.com/rushsite/agent/internal/procrun"
	"github.com/rushsite/agent/internal/slots"
	"github.com/rushsite/agent/internal/update"
	"github.com/rushsite/agent/internal/webhook"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	slog.SetDefault(log)
	if err := run(log); err != nil {
		log.Error("agent stopped", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.FromEnv(os.Getenv)
	if err != nil {
		return err
	}
	modes := match.DefaultModes()

	runner := procrun.ExecRunner{}
	offset := cfg.TVPortOffset
	alloc := slots.New(cfg.PortLo, cfg.PortHi, func(p int) bool { return slots.UDPFree(p, p+offset) })
	mgr := manager.New(manager.Config{
		CS2Dir:       cfg.CS2Dir,
		CS2Bin:       cfg.CS2Bin,
		DataDir:      cfg.DataDir,
		PublicIP:     cfg.PublicIP,
		TVPortOffset: cfg.TVPortOffset,
		StopGrace:    cfg.StopGrace,
		ModeCfgDir:   cfg.ModeCfgDir,
	}, modes, runner, alloc, log)

	sender := webhook.Sender{Attempts: 5, Backoff: 2 * time.Second}
	mgr.OnCrash = func(info manager.Info, url, secret string) {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			if err := sender.Send(ctx, url, secret, webhook.ServerCrashed()); err != nil {
				log.Error("crash webhook failed", "match", info.MatchID, "err", err)
				return
			}
			log.Info("crash webhook sent", "match", info.MatchID)
		}()
	}

	adopted, err := mgr.Recover()
	if err != nil {
		return err
	}
	log.Info("recovered servers from previous run", "adopted", adopted)

	var checker update.Checker
	switch cfg.UpdateCheck {
	case config.CheckSteamAPI:
		checker = update.SteamAPIChecker{CS2Dir: cfg.CS2Dir, BaseURL: cfg.SteamAPIBase}
	case config.CheckSteamCMD:
		checker = update.SteamCMDChecker{CS2Dir: cfg.CS2Dir, SteamCMD: cfg.SteamCMD, Runner: runner}
	}
	upd := update.New(update.Config{
		SteamCMD:      cfg.SteamCMD,
		CS2Dir:        cfg.CS2Dir,
		LogDir:        filepath.Join(cfg.DataDir, "logs"),
		Validate:      cfg.UpdateValidate,
		PatchGameinfo: cfg.PatchGameinfo,
		CheckInterval: cfg.UpdateInterval,
		DrainPoll:     cfg.DrainPoll,
	}, checker, mgr, runner, log)
	mgr.OnExit = upd.Kick
	if err := upd.PatchGameinfo(); err != nil {
		log.Warn("could not patch gameinfo.gi", "err", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go upd.Run(ctx)

	srv := &http.Server{
		Addr: cfg.ListenAddr,
		Handler: (&api.Server{
			Token:   cfg.Token,
			Servers: mgr,
			Updates: upd,
			Version: func() string { return update.InstalledVersion(cfg.CS2Dir) },
			Log:     log,
		}).Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      60 * time.Second,
	}
	errc := make(chan error, 1)
	go func() {
		log.Info("agent listening", "addr", cfg.ListenAddr, "ports", alloc.Total(), "publicIp", cfg.PublicIP)
		errc <- srv.ListenAndServe()
	}()

	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
	}
	// Running CS2 servers are left alone so matches survive an agent restart.
	// The next run adopts them from the state file.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	log.Info("agent shutting down, leaving CS2 servers running", "running", mgr.Running())
	return srv.Shutdown(shutdownCtx)
}
