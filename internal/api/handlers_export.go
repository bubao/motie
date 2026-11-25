package api

import (
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"motie/internal/domain"
	"motie/internal/pdf"
)

/* ---------- 导出：Kindle 单文件复制 + PDF 组装（multipart 页面图像） ---------- */

func (s *Server) handleKindlePut(w http.ResponseWriter, r *http.Request) {
	if s.deps.Kindle == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "kindle export unavailable"})
		return
	}
	path, err := s.deps.Kindle.Export()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true", "path": path})
}

/*
handlePDFBuild：multipart 上传（POST /api/pdf/build）。
字段：filename / width_mm / height_mm；文件：page（同名多个，按出现顺序 = 页序，JPEG）。
与旧 PUT /api/pdf（前端 jsPDF 直传成品）相比，PDF 改由 Go 组装，避免纯 JS 解码长任务。
*/
func (s *Server) handlePDFBuild(w http.ResponseWriter, r *http.Request) {
	if s.deps.PDF == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "pdf service unavailable"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, domain.MaxPDFSize)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "解析导出表单失败"})
		return
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()
	filename := strings.TrimSpace(r.FormValue("filename"))
	if filename == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "缺少文件名（filename）"})
		return
	}
	pageW, err := strconv.ParseFloat(strings.TrimSpace(r.FormValue("width_mm")), 64)
	if err != nil || pageW <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "纸张宽度非法（width_mm）"})
		return
	}
	pageH, err := strconv.ParseFloat(strings.TrimSpace(r.FormValue("height_mm")), 64)
	if err != nil || pageH <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "纸张高度非法（height_mm）"})
		return
	}
	parts := r.MultipartForm.File["page"]
	if len(parts) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "没有页面图像（page）"})
		return
	}
	pages := make([][]byte, 0, len(parts))
	for i, part := range parts {
		f, err := part.Open()
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("打开第 %d 页失败", i+1)})
			return
		}
		data, readErr := io.ReadAll(f)
		_ = f.Close()
		if readErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("读取第 %d 页失败", i+1)})
			return
		}
		if !pdf.IsJPEG(data) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("第 %d 页不是 JPEG 图像", i+1)})
			return
		}
		pages = append(pages, data)
	}
	path, err := s.deps.PDF.Export(filename, pages, pageW, pageH)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if s.deps.Bus != nil {
		s.deps.Bus.Publish(domain.EventPDFSaved, map[string]string{"path": path})
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true", "path": path})
}
