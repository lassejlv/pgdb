package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"

	"pgdb/daemon/internal/core"
	"pgdb/daemon/internal/model"
)

var versionRe = regexp.MustCompile(`^\d+$`)

type Handlers struct {
	Logger    *slog.Logger
	Deployer  *core.Deployer
	StatusSvc *core.StatusService
	Destroyer *core.Destroyer
}

func (h *Handlers) Register(mux *http.ServeMux, token string) {
	secured := AuthMiddleware(token, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/deploy":
			h.handleDeploy(w, r)
		case r.Method == http.MethodGet && r.URL.Path == "/v1/status":
			h.handleStatus(w, r)
		case r.Method == http.MethodDelete && matchesDBDeletePath(r.URL.Path):
			h.handleDestroy(w, r)
		default:
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "not found"})
		}
	}))

	mux.Handle("/", secured)
}

func (h *Handlers) handleDeploy(w http.ResponseWriter, r *http.Request) {
	var req model.DeployRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, http.ErrBodyReadAfterClose) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json body"})
		return
	}

	if req.Version != 0 && !versionRe.MatchString(strconv.Itoa(req.Version)) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "version must be a major integer"})
		return
	}

	resp, err := h.Deployer.Deploy(req, r.Host)
	if err != nil {
		h.Logger.Error("deploy failed", "error", err)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *Handlers) handleStatus(w http.ResponseWriter, _ *http.Request) {
	resp, err := h.StatusSvc.Status()
	if err != nil {
		h.Logger.Error("status failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *Handlers) handleDestroy(w http.ResponseWriter, r *http.Request) {
	name, err := parseNameFromPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}

	keepData := r.URL.Query().Get("keep_data") == "true"
	if err := h.Destroyer.Destroy(name, keepData); err != nil {
		h.Logger.Error("destroy failed", "name", name, "error", err)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func matchesDBDeletePath(path string) bool {
	return len(path) > len("/v1/db/") && path[:len("/v1/db/")] == "/v1/db/"
}

func parseNameFromPath(path string) (string, error) {
	if !matchesDBDeletePath(path) {
		return "", fmt.Errorf("invalid destroy path")
	}
	name := path[len("/v1/db/"):]
	if name == "" {
		return "", fmt.Errorf("database name is required")
	}
	return name, nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
