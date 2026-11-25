package api

import (
	"encoding/json"
	"net/http"

	"motie/internal/domain"
)

/* ---------- 配置读取 / 更新（PUT 为按键合并语义，见 handleConfigPut） ---------- */

func (s *Server) handleConfigGet(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.deps.Config.Get()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	resp := domain.ConfigResponse{
		ServerMeta: domain.ServerMeta{App: "motie", Version: s.deps.Version, Port: s.port},
		Config:     cfg,
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleUpdateLatest(w http.ResponseWriter, r *http.Request) {
	if s.deps.Update == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "update service unavailable"})
		return
	}
	info, err := s.deps.Update.Latest(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, info)
}

/* mergeConfigPatch 把请求体按键合并进现配置：只有请求中出现的键才覆盖，
 * 未提供的键（如内核管理的 DefaultPort / BindAddr）保留现值。 */
func mergeConfigPatch(cur domain.Config, patch map[string]json.RawMessage) (domain.Config, error) {
	base, err := json.Marshal(cur)
	if err != nil {
		return domain.Config{}, err
	}
	merged := make(map[string]json.RawMessage, len(patch)+1)
	if err := json.Unmarshal(base, &merged); err != nil {
		return domain.Config{}, err
	}
	for k, v := range patch {
		merged[k] = v
	}
	data, err := json.Marshal(merged)
	if err != nil {
		return domain.Config{}, err
	}
	var cfg domain.Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return domain.Config{}, err
	}
	return cfg, nil
}

/* handleConfigPut 是部分字段更新：请求体中出现的键覆盖现配置，未出现的键保留。
 * 前端只同步偏好子集（见 web/src/core/config.js PREFS_KEYS，不含 DefaultPort/BindAddr），
 * 全量替换会把内核管理的字段重置回默认；语义与 MockTransport.put 的合并行为一致。 */
func (s *Server) handleConfigPut(w http.ResponseWriter, r *http.Request) {
	cur, err := s.deps.Config.Get()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	var patch map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	cfg, err := mergeConfigPatch(cur, patch)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid config fields"})
		return
	}
	/* 事件由 ConfigService.Set 在保存成功后统一广播（避免双发）。 */
	if err := s.deps.Config.Set(cfg); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}
