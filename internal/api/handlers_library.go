package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"motie/internal/domain"
)

/* ---------- 字帖索引库（SQLite documents；内容仍由 files 服务读写） ---------- */

/* handleLibraryList 支持 ?q= 搜索（大小写无关包含匹配标题/路径）；无 q 为全量列表。 */
func (s *Server) handleLibraryList(w http.ResponseWriter, r *http.Request) {
	if s.deps.Library == nil {
		writeJSON(w, http.StatusOK, []domain.DocumentEntry{})
		return
	}
	var (
		list []domain.DocumentEntry
		err  error
	)
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		list, err = s.deps.Library.Search(q)
	} else {
		list, err = s.deps.Library.List()
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if list == nil {
		list = []domain.DocumentEntry{}
	}
	writeJSON(w, http.StatusOK, list)
}

/* rename 请求体 {id, title}；仅改索引标题，文件名不变。 */
func (s *Server) handleLibraryRename(w http.ResponseWriter, r *http.Request) {
	if s.deps.Library == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "library service unavailable"})
		return
	}
	var body struct {
		ID    int64  `json:"id"`
		Title string `json:"title"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if body.ID <= 0 || strings.TrimSpace(body.Title) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id and title are required"})
		return
	}
	if err := s.deps.Library.UpdateTitle(body.ID, strings.TrimSpace(body.Title)); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": "true"})
}

/* favorite 请求体 {id, favorite}；切换后收藏项在列表中置顶。 */
func (s *Server) handleLibraryFavorite(w http.ResponseWriter, r *http.Request) {
	if s.deps.Library == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "library service unavailable"})
		return
	}
	var body struct {
		ID       int64 `json:"id"`
		Favorite bool  `json:"favorite"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if body.ID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id is required"})
		return
	}
	if err := s.deps.Library.SetFavorite(body.ID, body.Favorite); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": "true"})
}

/* delete 请求体 {id}：先删内容文件（files 服务）再删索引条目，避免留下死链。 */
func (s *Server) handleLibraryDelete(w http.ResponseWriter, r *http.Request) {
	if s.deps.Library == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "library service unavailable"})
		return
	}
	if s.deps.Files == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "files service unavailable"})
		return
	}
	var body struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if body.ID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id is required"})
		return
	}
	doc, err := s.deps.Library.Get(body.ID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	if err := s.deps.Files.Delete(doc.Path); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err := s.deps.Library.Delete(body.ID); err != nil {
		/* 文件已删、索引残留：不报错给前端造成误解，但记录在响应里便于诊断 */
		writeJSON(w, http.StatusOK, map[string]any{"ok": "true", "warn": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": "true"})
}

/* reindex 请求体 {paths: [...]}；返回本次新增条数。 */
func (s *Server) handleLibraryReindex(w http.ResponseWriter, r *http.Request) {
	if s.deps.Library == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "library service unavailable"})
		return
	}
	var body struct {
		Paths []string `json:"paths"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	added, err := s.deps.Library.ReindexFromRecents(body.Paths)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": "true", "added": added})
}
