package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"

	"motie/internal/domain"
	"motie/internal/files"
)

/* ---------- 工作区文件（受控子树相对路径） ---------- */

func (s *Server) handleFilesGet(w http.ResponseWriter, r *http.Request) {
	if s.deps.Files == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "files service unavailable"})
		return
	}
	p := r.URL.Query().Get("path")
	if p == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing path"})
		return
	}
	f, err := s.deps.Files.Read(p)
	if err != nil {
		status := http.StatusInternalServerError
		if os.IsNotExist(err) {
			status = http.StatusNotFound
		} else if errors.Is(err, files.ErrUnsafePath) {
			status = http.StatusBadRequest
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, f)
}

func (s *Server) handleFilesPut(w http.ResponseWriter, r *http.Request) {
	if s.deps.Files == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "files service unavailable"})
		return
	}
	var f domain.WorkspaceFile
	if err := json.NewDecoder(r.Body).Decode(&f); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if err := s.deps.Files.Write(f); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, files.ErrUnsafePath) {
			status = http.StatusBadRequest
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	if s.deps.Bus != nil {
		s.deps.Bus.Publish(domain.EventFileSaved, f)
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true", "path": f.Path})
}

func (s *Server) handleFilesRecent(w http.ResponseWriter, r *http.Request) {
	if s.deps.Files == nil {
		writeJSON(w, http.StatusOK, []string{})
		return
	}
	writeJSON(w, http.StatusOK, s.deps.Files.ListRecent())
}
