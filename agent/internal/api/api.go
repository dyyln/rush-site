// Package api serves the agent HTTP API from docs/CONTRACTS.md.
package api

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/rushsite/agent/internal/manager"
	"github.com/rushsite/agent/internal/match"
	"github.com/rushsite/agent/internal/update"
)

// Servers is the part of the manager the API uses.
type Servers interface {
	Start(req match.StartRequest) (match.StartResponse, error)
	Stop(matchID string) error
	List(includeExited bool) []manager.Info
	Slots() (total, free int)
}

// Updates is the part of the updater the API uses.
type Updates interface {
	Status() update.Status
	Trigger()
}

// Server holds the handler dependencies.
type Server struct {
	Token   string
	Servers Servers
	Updates Updates
	Version func() string
	Log     *slog.Logger
}

// Health is the GET /health body.
type Health struct {
	OK         bool          `json:"ok"`
	CS2Version string        `json:"cs2Version"`
	Slots      SlotCount     `json:"slots"`
	Updating   bool          `json:"updating"`
	Update     update.Status `json:"update"`
}

// SlotCount is the slots field of Health.
type SlotCount struct {
	Total int `json:"total"`
	Free  int `json:"free"`
}

type errorBody struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

// Handler returns the routed and authenticated handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("GET /servers", s.list)
	mux.HandleFunc("POST /servers", s.start)
	mux.HandleFunc("DELETE /servers/{matchId}", s.stop)
	mux.HandleFunc("POST /update", s.triggerUpdate)
	return s.auth(mux)
}

func (s *Server) auth(next http.Handler) http.Handler {
	want := []byte("Bearer " + s.Token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := []byte(r.Header.Get("Authorization"))
		if s.Token == "" || subtle.ConstantTimeCompare(got, want) != 1 {
			writeError(w, http.StatusUnauthorized, "unauthorized", "missing or wrong bearer token")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	total, free := s.Servers.Slots()
	st := s.Updates.Status()
	version := ""
	if s.Version != nil {
		version = s.Version()
	}
	writeJSON(w, http.StatusOK, Health{
		OK:         true,
		CS2Version: version,
		Slots:      SlotCount{Total: total, Free: free},
		Updating:   st.State != update.Idle,
		Update:     st,
	})
}

func (s *Server) list(w http.ResponseWriter, r *http.Request) {
	include := r.URL.Query().Get("include") == "exited"
	writeJSON(w, http.StatusOK, s.Servers.List(include))
}

func (s *Server) start(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req match.StartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	resp, err := s.Servers.Start(req)
	switch {
	case err == nil:
		writeJSON(w, http.StatusCreated, resp)
	case match.IsValidation(err):
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
	case errors.Is(err, match.ErrModeNotConfigured):
		writeError(w, http.StatusUnprocessableEntity, "mode_not_configured", err.Error())
	case errors.Is(err, manager.ErrExists):
		writeError(w, http.StatusConflict, "exists", err.Error())
	case errors.Is(err, manager.ErrUpdating):
		writeError(w, http.StatusServiceUnavailable, "updating", err.Error())
	case errors.Is(err, manager.ErrNoSlots):
		writeError(w, http.StatusServiceUnavailable, "no_free_slots", err.Error())
	default:
		s.logger().Error("start server", "match", req.MatchID, "err", err)
		writeError(w, http.StatusInternalServerError, "start_failed", err.Error())
	}
}

func (s *Server) stop(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("matchId"))
	if !match.ValidMatchID(id) {
		writeError(w, http.StatusBadRequest, "bad_request", "matchId must be a UUID")
		return
	}
	if err := s.Servers.Stop(id); err != nil {
		s.logger().Error("stop server", "match", id, "err", err)
		writeError(w, http.StatusInternalServerError, "stop_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// triggerUpdate is an operator hook. It drains and updates without waiting for the checker.
func (s *Server) triggerUpdate(w http.ResponseWriter, _ *http.Request) {
	s.Updates.Trigger()
	writeJSON(w, http.StatusAccepted, s.Updates.Status())
}

func (s *Server) logger() *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return slog.Default()
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, kind, msg string) {
	writeJSON(w, code, errorBody{Error: kind, Message: msg})
}
