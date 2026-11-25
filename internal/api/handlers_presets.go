package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"motie/internal/workspace"
)

/* ---------- 版式预设 ---------- */

func (s *Server) handlePresetsList(w http.ResponseWriter, r *http.Request) {
	if s.deps.Presets == nil {
		writeJSON(w, http.StatusOK, map[string]any{})
		return
	}
	m, err := s.deps.Presets.List()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (s *Server) handlePresetsPut(w http.ResponseWriter, r *http.Request) {
	if s.deps.Presets == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "presets service unavailable"})
		return
	}
	var data any
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if err := s.deps.Presets.Save(r.PathValue("name"), data); err != nil {
		writeJSON(w, presetErrStatus(err), map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func (s *Server) handlePresetsDelete(w http.ResponseWriter, r *http.Request) {
	if s.deps.Presets == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "presets service unavailable"})
		return
	}
	if err := s.deps.Presets.Delete(r.PathValue("name")); err != nil {
		writeJSON(w, presetErrStatus(err), map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func (s *Server) handlePresetsRename(w http.ResponseWriter, r *http.Request) {
	if s.deps.Presets == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "presets service unavailable"})
		return
	}
	var req struct {
		Old string `json:"old"`
		New string `json:"new"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Old) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if err := s.deps.Presets.Rename(req.Old, req.New); err != nil {
		writeJSON(w, presetErrStatus(err), map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func presetErrStatus(err error) int {
	switch {
	case errors.Is(err, workspace.ErrNoExist):
		return http.StatusNotFound
	case errors.Is(err, workspace.ErrBadName):
		return http.StatusBadRequest
	default:
		if strings.Contains(err.Error(), "已存在") {
			return http.StatusConflict
		}
		return http.StatusInternalServerError
	}
}
