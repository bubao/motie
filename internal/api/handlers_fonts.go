package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"

	"motie/internal/domain"
	"motie/internal/fonts"
)

/* ---------- 字体库：系统列表 / 用户字体上传与管理 ---------- */

func (s *Server) handleFontsList(w http.ResponseWriter, r *http.Request) {
	lib := domain.FontLibrary{System: []domain.FontEntry{}, User: []domain.FontEntry{}}
	if s.deps.Fonts == nil {
		writeJSON(w, http.StatusOK, lib)
		return
	}
	lib.System = s.deps.Fonts.ListSystem()
	if lib.System == nil {
		lib.System = []domain.FontEntry{}
	}
	user, err := s.deps.Fonts.ListUser()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if user != nil {
		lib.User = user
	}
	writeJSON(w, http.StatusOK, lib)
}

/* handleFontsAdd 收原始二进制（前端 FontManager 直传 File），
 * X-Filename 决定扩展名、X-Label 为显示名；两者允许 URL 编码。 */
func (s *Server) handleFontsAdd(w http.ResponseWriter, r *http.Request) {
	if s.deps.Fonts == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "fonts service unavailable"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, domain.MaxFontFileSize+1024)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "读取字体失败或超过 20MB 上限"})
		return
	}
	filename := unescapeHeader(r.Header.Get("X-Filename"))
	label := unescapeHeader(r.Header.Get("X-Label"))
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == "" {
		ext = strings.ToLower(filepath.Ext(label))
	}
	name := label
	if name == "" {
		name = strings.TrimSuffix(filename, filepath.Ext(filename))
	}
	entry, err := s.deps.Fonts.Add(name, ext, data)
	if err != nil {
		writeJSON(w, fontErrStatus(err), map[string]string{"error": err.Error()})
		return
	}
	if s.deps.Bus != nil {
		s.deps.Bus.Publish(domain.EventFontAdded, entry)
	}
	writeJSON(w, http.StatusOK, entry)
}

func unescapeHeader(v string) string {
	if v == "" {
		return ""
	}
	if out, err := url.PathUnescape(v); err == nil {
		return out
	}
	return v
}

func (s *Server) handleFontsRemove(w http.ResponseWriter, r *http.Request) {
	if s.deps.Fonts == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "fonts service unavailable"})
		return
	}
	if err := s.deps.Fonts.Remove(r.PathValue("id")); err != nil {
		writeJSON(w, fontErrStatus(err), map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

/* handleFontsTags 设置个人字体标签（分类用）。 */
func (s *Server) handleFontsTags(w http.ResponseWriter, r *http.Request) {
	if s.deps.Fonts == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "fonts service unavailable"})
		return
	}
	var req struct {
		ID   string   `json:"id"`
		Tags []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.ID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if err := s.deps.Fonts.UpdateTags(req.ID, req.Tags); err != nil {
		status := fontErrStatus(err)
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func (s *Server) handleFontsRename(w http.ResponseWriter, r *http.Request) {
	if s.deps.Fonts == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "fonts service unavailable"})
		return
	}
	var req struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.ID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if err := s.deps.Fonts.Rename(req.ID, req.Name); err != nil {
		status := fontErrStatus(err)
		if status == http.StatusInternalServerError && strings.Contains(err.Error(), "名称") {
			status = http.StatusBadRequest
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func fontErrStatus(err error) int {
	switch {
	case errors.Is(err, fonts.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, fonts.ErrBadExt), errors.Is(err, fonts.ErrTooLarge):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

/* handleFontFile 输出用户字体二进制（@font-face src 指向本地址）。 */
func (s *Server) handleFontFile(w http.ResponseWriter, r *http.Request) {
	if s.deps.Fonts == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "fonts service unavailable"})
		return
	}
	data, ext, err := s.deps.Fonts.File(r.PathValue("id"))
	if err != nil {
		writeJSON(w, fontErrStatus(err), map[string]string{"error": err.Error()})
		return
	}
	switch ext {
	case ".woff":
		w.Header().Set("Content-Type", "font/woff")
	case ".woff2":
		w.Header().Set("Content-Type", "font/woff2")
	case ".otf":
		w.Header().Set("Content-Type", "font/otf")
	default:
		w.Header().Set("Content-Type", "font/ttf")
	}
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
