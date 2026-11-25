package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"motie/internal/config"
	"motie/internal/domain"
	"motie/internal/files"
	"motie/internal/fonts"
	"motie/internal/workspace"
)

/* 内存配置服务（骨架阶段；正式实现在 internal/app 装配）。
 * Set 成功后在总线上广播，与 app.configService 行为一致。 */
type memConfig struct {
	cfg domain.Config
	bus *Bus
}

func (m *memConfig) Get() (domain.Config, error) { return m.cfg, nil }
func (m *memConfig) Set(c domain.Config) error {
	m.cfg = c
	if m.bus != nil {
		m.bus.Publish(domain.EventConfigChanged, c)
	}
	return nil
}

func testServer(t *testing.T) (*Server, *memConfig) {
	t.Helper()
	bus := NewBus()
	m := &memConfig{cfg: config.DefaultConfig(), bus: bus}
	deps := Deps{
		Config: m,
		WebFS: fstest.MapFS{
			"index.html":      &fstest.MapFile{Data: []byte("<!doctype html><html><head></head><body>motie</body></html>")},
			"lite/index.html": &fstest.MapFile{Data: []byte("<!doctype html><html><head></head><body>lite</body></html>")},
		},
		Bus:     bus,
		Version: "test",
	}
	s := New(deps)
	s.SetPort(39130)
	return s, m
}

func do(t *testing.T, h http.Handler, method, path, origin string, body io.Reader) *httptest.ResponseRecorder {
	t.Helper()
	return doWithHeader(t, h, method, path, origin, body, nil)
}

/* doWithHeader：同 do，但可带自定义请求头（二进制上传类接口用）。 */
func doWithHeader(t *testing.T, h http.Handler, method, path, origin string, body io.Reader, hdr map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, body)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

/* 未知 /api/* 必须 404 JSON，且不得返回 index.html。 */
func TestUnknownAPIRoutes404(t *testing.T) {
	s, _ := testServer(t)
	for _, p := range []string{"/api/nope", "/api/config/x", "/api/events/x"} {
		rec := do(t, s.Handler(), http.MethodGet, p, "", nil)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s → %d，期望 404", p, rec.Code)
		}
		if strings.Contains(rec.Body.String(), "<html>") {
			t.Errorf("%s 返回了 HTML 页面（契约漂移）", p)
		}
		var m map[string]string
		if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil || m["error"] == "" {
			t.Errorf("%s 响应应为 JSON error：%s", p, rec.Body.String())
		}
	}
}

func TestGetConfigMetaAndDefaults(t *testing.T) {
	s, _ := testServer(t)
	rec := do(t, s.Handler(), http.MethodGet, "/api/config", "", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/config → %d", rec.Code)
	}
	var resp domain.ConfigResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.App != "motie" || resp.Port != 39130 || resp.Version != "test" {
		t.Errorf("元信息错误：%+v", resp.ServerMeta)
	}
	if resp.Config.Theme != "system" || resp.Config.ZgType != "3" {
		t.Errorf("默认配置未注入：%+v", resp.Config)
	}
}

/* 写操作同源校验：缺失放行、本机端口放行、跨域拒绝；读操作始终放行。 */
func TestSameOriginWriteGuard(t *testing.T) {
	s, _ := testServer(t)
	body := io.NopCloser(strings.NewReader(`{"Theme":"dark"}`))

	rec := do(t, s.Handler(), http.MethodPut, "/api/config", "", body)
	if rec.Code != http.StatusOK {
		t.Errorf("无 Origin 应放行，实际 %d", rec.Code)
	}
	rec = do(t, s.Handler(), http.MethodPut, "/api/config", "http://127.0.0.1:39130", io.NopCloser(strings.NewReader(`{"Theme":"light"}`)))
	if rec.Code != http.StatusOK {
		t.Errorf("本机 Origin 应放行，实际 %d", rec.Code)
	}
	rec = do(t, s.Handler(), http.MethodPut, "/api/config", "http://evil.example.com", io.NopCloser(strings.NewReader(`{}`)))
	if rec.Code != http.StatusForbidden {
		t.Errorf("跨域写应 403，实际 %d", rec.Code)
	}
	rec = do(t, s.Handler(), http.MethodPut, "/api/config", "http://127.0.0.1:9999", io.NopCloser(strings.NewReader(`{}`)))
	if rec.Code != http.StatusForbidden {
		t.Errorf("非本机端口应 403，实际 %d", rec.Code)
	}
	/* 读操作不受同源限制 */
	rec = do(t, s.Handler(), http.MethodGet, "/api/config", "http://evil.example.com", nil)
	if rec.Code != http.StatusOK {
		t.Errorf("跨域读应放行，实际 %d", rec.Code)
	}
}

func TestPutConfigUpdatesAndPublishes(t *testing.T) {
	s, m := testServer(t)
	ch := s.deps.Bus.Subscribe()
	defer s.deps.Bus.Unsubscribe(ch)

	rec := do(t, s.Handler(), http.MethodPut, "/api/config", "http://127.0.0.1:39130",
		io.NopCloser(strings.NewReader(`{"Theme":"dark","InkAlpha":5}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT → %d", rec.Code)
	}
	if m.cfg.Theme != "dark" {
		t.Errorf("配置未更新：%+v", m.cfg)
	}
	select {
	case frame := <-ch:
		if !strings.Contains(string(frame), "event: config.changed") {
			t.Errorf("事件名错误：%s", frame)
		}
	case <-timeAfter():
		t.Fatal("未收到 config.changed 事件")
	}
}

/* PUT /api/config 是部分字段更新：未提供的键（内核管理的 DefaultPort/BindAddr 等）保留现值；
 * 显式提供的零值（如 fontURL=""）照常生效；事件广播合并后的完整配置。 */
func TestPutConfigPartialUpdateKeepsServerFields(t *testing.T) {
	s, m := testServer(t)
	m.cfg.DefaultPort = 45678
	m.cfg.BindAddr = "0.0.0.0"
	m.cfg.FontURL = "https://example.com/font.ttf"
	ch := s.deps.Bus.Subscribe()
	defer s.deps.Bus.Unsubscribe(ch)

	rec := do(t, s.Handler(), http.MethodPut, "/api/config", "",
		io.NopCloser(strings.NewReader(`{"Theme":"dark"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT → %d %s", rec.Code, rec.Body.String())
	}
	if m.cfg.Theme != "dark" {
		t.Errorf("Theme 未更新：%+v", m.cfg)
	}
	if m.cfg.DefaultPort != 45678 || m.cfg.BindAddr != "0.0.0.0" {
		t.Errorf("未提供的字段被重置回默认：%+v", m.cfg)
	}

	/* 显式提供的零值应覆盖旧值（按键合并，而非「零值视为未提供」） */
	rec = do(t, s.Handler(), http.MethodPut, "/api/config", "",
		io.NopCloser(strings.NewReader(`{"FontURL":""}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT FontURL → %d", rec.Code)
	}
	if m.cfg.FontURL != "" {
		t.Errorf("显式清空未生效：%q", m.cfg.FontURL)
	}

	/* 事件帧为合并后的完整配置（含内核字段） */
	select {
	case frame := <-ch:
		if !strings.Contains(string(frame), `event: config.changed`) ||
			!strings.Contains(string(frame), `"DefaultPort":45678`) {
			t.Errorf("事件帧异常：%s", frame)
		}
	case <-timeAfter():
		t.Fatal("未收到 config.changed 事件")
	}

	/* 未知键忽略；字段类型错误 400 */
	rec = do(t, s.Handler(), http.MethodPut, "/api/config", "",
		io.NopCloser(strings.NewReader(`{"Unknown":"x"}`)))
	if rec.Code != http.StatusOK {
		t.Errorf("未知键应被忽略，实际 %d", rec.Code)
	}
	rec = do(t, s.Handler(), http.MethodPut, "/api/config", "",
		io.NopCloser(strings.NewReader(`{"InkAlpha":"abc"}`)))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("非法字段类型应 400，实际 %d", rec.Code)
	}
}

func TestStaticServesIndexAndSPAFallback(t *testing.T) {
	s, _ := testServer(t)
	rec := do(t, s.Handler(), http.MethodGet, "/index.html", "", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "motie") {
		t.Errorf("/index.html → %d %q", rec.Code, rec.Body.String())
	}
	rec = do(t, s.Handler(), http.MethodGet, "/", "", nil)
	if rec.Code != http.StatusOK {
		t.Errorf("/ → %d", rec.Code)
	}
	rec = do(t, s.Handler(), http.MethodGet, "/some/spa/route", "", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "<html>") {
		t.Errorf("SPA 回退失败：%d", rec.Code)
	}
}

/* lite 子树：/lite/ 与 /lite/index.html 返回练字版；缺失路径 404，不回退完整版。 */
func TestServeLiteSubtree(t *testing.T) {
	s, _ := testServer(t)
	for _, p := range []string{"/lite/", "/lite/index.html"} {
		rec := do(t, s.Handler(), http.MethodGet, p, "", nil)
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "lite") {
			t.Errorf("%s → %d %q", p, rec.Code, rec.Body.String())
		}
		if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
			t.Errorf("%s Content-Type = %q", p, ct)
		}
	}
	rec := do(t, s.Handler(), http.MethodGet, "/lite/missing.js", "", nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("/lite/missing.js → %d，期望 404", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "<html>") {
		t.Error("lite 缺失路径回退成了完整版页面")
	}
	/* 路径穿越不得逃出 lite 子树读到完整版 */
	rec = do(t, s.Handler(), http.MethodGet, "/lite/../index.html", "", nil)
	if rec.Code != http.StatusNotFound && strings.Contains(rec.Body.String(), "motie") {
		t.Errorf("穿越防护失效：%d %q", rec.Code, rec.Body.String())
	}
}

/* SSE：连接即建流，总线事件到达客户端；断开后清理订阅。 */
func TestSSEStream(t *testing.T) {
	s, _ := testServer(t)
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/api/events", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("Content-Type = %q", ct)
	}

	/* SSE 帧 = event 行 + data 行（读到第二行即可断言；不必等 EOF）。 */
	reader := make(chan string, 1)
	go func() {
		br := bufio.NewReader(resp.Body)
		var b strings.Builder
		for i := 0; i < 2; i++ {
			line, err := br.ReadString('\n')
			if err != nil {
				break
			}
			b.WriteString(line)
		}
		reader <- b.String()
	}()

	s.deps.Bus.Publish(domain.EventConfigChanged, map[string]any{"Theme": "dark"})
	select {
	case got := <-reader:
		if !strings.Contains(got, "event: config.changed") || !strings.Contains(got, `"Theme":"dark"`) {
			t.Errorf("SSE 帧异常：%q", got)
		}
	case <-timeAfter2():
		t.Fatal("SSE 未收到事件")
	}
	if n := s.deps.Bus.Count(); n != 1 {
		t.Errorf("订阅数 = %d，期望 1", n)
	}
	cancel()
	resp.Body.Close()
	time.Sleep(50 * time.Millisecond)
	if n := s.deps.Bus.Count(); n != 0 {
		t.Errorf("断开清理失败，剩余订阅 %d", n)
	}
}

/* ---------- files / pdf 端点（阶段 1） ---------- */

type memFiles struct {
	bus    *Bus
	files  map[string]domain.WorkspaceFile
	recent []string
}

func (m *memFiles) Read(path string) (domain.WorkspaceFile, error) {
	if filepath.IsAbs(path) {
		return domain.WorkspaceFile{}, fmt.Errorf("%w: 不接受绝对路径", files.ErrUnsafePath)
	}
	if f, ok := m.files[path]; ok {
		return f, nil
	}
	return domain.WorkspaceFile{}, errors.New("not found: " + path)
}

func (m *memFiles) Write(f domain.WorkspaceFile) error {
	m.files[f.Path] = f
	m.recent = append([]string{f.Path}, m.recent...)
	if m.bus != nil {
		m.bus.Publish(domain.EventFileSaved, f)
	}
	return nil
}

func (m *memFiles) ListRecent() []string { return m.recent }

type memPDF struct {
	saved string
	pages int
}

func (m *memPDF) Export(filename string, pages [][]byte, pageW, pageH float64) (string, error) {
	if len(pages) == 0 {
		return "", errors.New("没有可导出的页面")
	}
	for i, p := range pages {
		if len(p) < 3 || p[0] != 0xFF {
			return "", fmt.Errorf("第 %d 页不是 JPEG 图像", i+1)
		}
	}
	m.pages = len(pages)
	m.saved = "/tmp/export/" + filename
	return m.saved, nil
}

func testServerWithFiles(t *testing.T) (*Server, *memFiles, *memPDF) {
	t.Helper()
	bus := NewBus()
	m := &memConfig{cfg: config.DefaultConfig(), bus: bus}
	filesSvc := &memFiles{bus: bus, files: map[string]domain.WorkspaceFile{}}
	pdfSvc := &memPDF{}
	s := New(Deps{
		Config:  m,
		Files:   filesSvc,
		PDF:     pdfSvc,
		WebFS:   fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<!doctype html><html><head></head><body>motie</body></html>")}},
		Bus:     bus,
		Version: "test",
	})
	s.SetPort(39130)
	return s, filesSvc, pdfSvc
}

/* PUT /api/files 落盘并广播 file.saved；GET /api/files?path= 读回；recent 列表。 */
func TestFilesEndpointsRoundTrip(t *testing.T) {
	s, filesSvc, _ := testServerWithFiles(t)
	ch := s.deps.Bus.Subscribe()
	defer s.deps.Bus.Unsubscribe(ch)

	rec := do(t, s.Handler(), http.MethodPut, "/api/files", "",
		io.NopCloser(strings.NewReader(`{"path":"workspace/字帖.txt","content":"永"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT /api/files → %d %s", rec.Code, rec.Body.String())
	}
	select {
	case frame := <-ch:
		if !strings.Contains(string(frame), "event: file.saved") {
			t.Errorf("事件名错误：%s", frame)
		}
	case <-timeAfter():
		t.Fatal("未收到 file.saved")
	}

	rec = do(t, s.Handler(), http.MethodGet, "/api/files?path=workspace/%E5%AD%97%E5%B8%96.txt", "", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"content":"永"`) {
		t.Errorf("GET /api/files → %d %s", rec.Code, rec.Body.String())
	}
	rec = do(t, s.Handler(), http.MethodGet, "/api/files?path=/etc/passwd", "", nil)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("绝对路径应由服务层拒绝（400），实际 %d", rec.Code)
	}
	rec = do(t, s.Handler(), http.MethodGet, "/api/files/recent", "", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "workspace/字帖.txt") {
		t.Errorf("recent → %d %s", rec.Code, rec.Body.String())
	}
	if len(filesSvc.recent) != 1 || filesSvc.recent[0] != "workspace/字帖.txt" {
		t.Errorf("recent 记录 = %v", filesSvc.recent)
	}
}

/* PUT /api/pdf：成功返回路径并广播 pdf.saved；非法内容 400。 */
/* mpFile / doMultipart：multipart 上传请求（PDF 组装接口用）。 */
type mpFile struct{ data []byte }

func doMultipart(t *testing.T, h http.Handler, method, path, origin string, fields map[string]string, files []mpFile) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for k, v := range fields {
		if err := mw.WriteField(k, v); err != nil {
			t.Fatal(err)
		}
	}
	for i, f := range files {
		w, err := mw.CreateFormFile("page", "page"+strconv.Itoa(i+1)+".jpg")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(f.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(method, path, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// encodeTestJPEG：生成一页最小 baseline JPEG。
func encodeTestJPEG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			img.Set(x, y, color.White)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

/* POST /api/pdf/build：multipart 上传每页 JPEG，Go 组装 PDF 落盘并广播 pdf.saved。 */
func TestPDFBuildEndpoint(t *testing.T) {
	s, _, pdfSvc := testServerWithFiles(t)
	ch := s.deps.Bus.Subscribe()
	defer s.deps.Bus.Unsubscribe(ch)

	rec := doMultipart(t, s.Handler(), http.MethodPost, "/api/pdf/build", "",
		map[string]string{"filename": "墨帖.pdf", "width_mm": "210", "height_mm": "297"},
		[]mpFile{{data: encodeTestJPEG(t)}, {data: encodeTestJPEG(t)}})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), pdfSvc.saved) {
		t.Fatalf("POST /api/pdf/build → %d %s", rec.Code, rec.Body.String())
	}
	if pdfSvc.pages != 2 {
		t.Errorf("页数 = %d，期望 2", pdfSvc.pages)
	}
	select {
	case frame := <-ch:
		if !strings.Contains(string(frame), "event: pdf.saved") {
			t.Errorf("事件名错误：%s", frame)
		}
	case <-timeAfter():
		t.Fatal("未收到 pdf.saved")
	}

	/* 缺少页面文件 */
	rec = doMultipart(t, s.Handler(), http.MethodPost, "/api/pdf/build", "",
		map[string]string{"filename": "x.pdf", "width_mm": "210", "height_mm": "297"}, nil)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("无页面图像应 400，实际 %d", rec.Code)
	}
	/* 缺文件名 */
	rec = doMultipart(t, s.Handler(), http.MethodPost, "/api/pdf/build", "",
		map[string]string{"width_mm": "210", "height_mm": "297"},
		[]mpFile{{data: encodeTestJPEG(t)}})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("缺文件名应 400，实际 %d", rec.Code)
	}
	/* 非法纸张尺寸 */
	rec = doMultipart(t, s.Handler(), http.MethodPost, "/api/pdf/build", "",
		map[string]string{"filename": "x.pdf", "width_mm": "abc", "height_mm": "297"},
		[]mpFile{{data: encodeTestJPEG(t)}})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("非法宽度应 400，实际 %d", rec.Code)
	}
	/* 非 JPEG 页 */
	rec = doMultipart(t, s.Handler(), http.MethodPost, "/api/pdf/build", "",
		map[string]string{"filename": "x.pdf", "width_mm": "210", "height_mm": "297"},
		[]mpFile{{data: []byte("%PDF-1.7 not jpeg")}})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("非 JPEG 页应 400，实际 %d", rec.Code)
	}
}

/* index.html 注入桌面 boot（标记 + SSOT 主题），供前端选 transport / 跳检测 / 防白闪。 */
func TestIndexInjectsDesktopBoot(t *testing.T) {
	s, m := testServer(t)
	m.cfg.Theme = "dark"
	rec := do(t, s.Handler(), http.MethodGet, "/", "", nil)
	body := rec.Body.String()
	if !strings.Contains(body, "window.__MOTIE_DESKTOP__=true") {
		t.Error("未注入 __MOTIE_DESKTOP__")
	}
	if !strings.Contains(body, `ZITIE_BOOT=Object.assign(window.ZITIE_BOOT||{},{Theme:"dark"})`) {
		t.Errorf("未注入主题：%s", body)
	}
	/* 注入须先于既有内联脚本（detect / 早期主题）执行 */
	if strings.Index(body, "__MOTIE_DESKTOP__") > strings.Index(body, "浏览器能力检测") &&
		strings.Contains(body, "浏览器能力检测") {
		t.Error("boot 注入位置晚于 detect 脚本")
	}
}

/* 小工具：避免在测试里重复写 time.After。 */
func timeAfter() <-chan time.Time  { return time.After(2 * time.Second) }
func timeAfter2() <-chan time.Time { return time.After(3 * time.Second) }

/* ================= 阶段 2：字体库 / 预设 / Kindle ================= */

type memFontLib struct {
	system []domain.FontEntry
	user   []domain.FontEntry
}

func (m *memFontLib) ListSystem() []domain.FontEntry        { return m.system }
func (m *memFontLib) ListUser() ([]domain.FontEntry, error) { return m.user, nil }
func (m *memFontLib) Add(name, ext string, data []byte) (domain.FontEntry, error) {
	if !strings.HasSuffix(ext, "tf") && ext != ".woff" && ext != ".woff2" {
		return domain.FontEntry{}, fonts.ErrBadExt
	}
	e := domain.FontEntry{ID: "f-test", Name: name, Source: "user", Size: int64(len(data)), Enabled: true}
	m.user = append(m.user, e)
	return e, nil
}
func (m *memFontLib) Remove(id string) error {
	for i := range m.user {
		if m.user[i].ID == id {
			m.user = append(m.user[:i], m.user[i+1:]...)
			return nil
		}
	}
	return fonts.ErrNotFound
}
func (m *memFontLib) Rename(id, name string) error {
	for i := range m.user {
		if m.user[i].ID == id {
			m.user[i].Name = name
			return nil
		}
	}
	return fonts.ErrNotFound
}
func (m *memFontLib) File(id string) ([]byte, string, error) {
	if id != "f-test" {
		return nil, "", fonts.ErrNotFound
	}
	return []byte("fake-font"), ".ttf", nil
}

type memKindle struct{ path string }

func (k *memKindle) Export() (string, error) { return k.path, nil }

func stage2Server(t *testing.T) (*Server, *memFontLib, *workspace.PresetService, *memKindle) {
	t.Helper()
	bus := NewBus()
	lib := &memFontLib{system: []domain.FontEntry{{Name: "Kaiti SC", Source: "system", Enabled: true}}}
	presets := workspace.NewPresetService(filepath.Join(t.TempDir(), "presets.json"))
	k := &memKindle{path: "/tmp/export/墨帖-lite.html"}
	s := New(Deps{
		Config:  &memConfig{cfg: config.DefaultConfig(), bus: bus},
		WebFS:   fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html><head></head><body>motie</body></html>")}},
		Bus:     bus,
		Version: "test",
		Fonts:   lib,
		Presets: presets,
		Kindle:  k,
	})
	s.SetPort(39130)
	return s, lib, presets, k
}

func TestFontsEndpointsRoundTrip(t *testing.T) {
	s, lib, _, _ := stage2Server(t)
	ch := s.deps.Bus.Subscribe()
	defer s.deps.Bus.Unsubscribe(ch)

	rec := do(t, s.Handler(), http.MethodGet, "/api/fonts", "", nil)
	var lib0 domain.FontLibrary
	if err := json.Unmarshal(rec.Body.Bytes(), &lib0); err != nil {
		t.Fatal(err)
	}
	if len(lib0.System) != 1 || lib0.System[0].Name != "Kaiti SC" {
		t.Errorf("系统列表异常：%+v", lib0.System)
	}

	/* POST 原始二进制 + 头部 */
	req := httptest.NewRequest(http.MethodPost, "/api/fonts", strings.NewReader("fake-bytes"))
	req.Header.Set("Origin", "http://127.0.0.1:39130")
	req.Header.Set("X-Filename", encodeURIComponent("我的楷体.ttf"))
	req.Header.Set("X-Label", encodeURIComponent("我的楷体"))
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/fonts → %d %s", rec.Code, rec.Body.String())
	}
	var entry domain.FontEntry
	if err := json.Unmarshal(rec.Body.Bytes(), &entry); err != nil {
		t.Fatal(err)
	}
	if entry.Name != "我的楷体" || entry.Size != 10 {
		t.Errorf("Add 返回异常：%+v", entry)
	}
	select {
	case frame := <-ch:
		if !strings.Contains(string(frame), "event: font.added") {
			t.Errorf("未广播 font.added：%s", frame)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("未收到 font.added")
	}

	/* 文件输出 */
	rec = do(t, s.Handler(), http.MethodGet, "/api/fonts/file/f-test", "", nil)
	if rec.Code != http.StatusOK || rec.Body.String() != "fake-font" || rec.Header().Get("Content-Type") != "font/ttf" {
		t.Errorf("file 端点异常：%d %q %s", rec.Code, rec.Body.String(), rec.Header().Get("Content-Type"))
	}
	rec = do(t, s.Handler(), http.MethodGet, "/api/fonts/file/nope", "", nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("不存在 id 应 404，实际 %d", rec.Code)
	}

	/* 删除 */
	rec = do(t, s.Handler(), http.MethodDelete, "/api/fonts/f-test", "", nil)
	if rec.Code != http.StatusOK {
		t.Errorf("DELETE → %d", rec.Code)
	}
	if list, _ := lib.ListUser(); len(list) != 0 {
		t.Errorf("删除后仍有 %+v", list)
	}
	rec = do(t, s.Handler(), http.MethodDelete, "/api/fonts/f-test", "", nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("重复删除应 404，实际 %d", rec.Code)
	}

	/* 跨域写拒绝（POST 也是写操作） */
	req2 := httptest.NewRequest(http.MethodPost, "/api/fonts", strings.NewReader("x"))
	req2.Header.Set("Origin", "http://evil.example.com")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req2)
	if rec.Code != http.StatusForbidden {
		t.Errorf("跨域 POST 应 403，实际 %d", rec.Code)
	}
}

// encodeURIComponent 等价物（测试用）。
func encodeURIComponent(s string) string {
	return url.QueryEscape(s)
}

func TestPresetsEndpointsCRUD(t *testing.T) {
	s, _, presets, _ := stage2Server(t)
	name := url.QueryEscape("硬笔")
	rec := do(t, s.Handler(), http.MethodPut, "/api/presets/"+name, "",
		io.NopCloser(strings.NewReader(`{"Template":"trace","Cols":8}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT preset → %d %s", rec.Code, rec.Body.String())
	}
	rec = do(t, s.Handler(), http.MethodGet, "/api/presets", "", nil)
	var all map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &all); err != nil {
		t.Fatal(err)
	}
	if all["硬笔"] == nil {
		t.Fatalf("列表缺少「硬笔」：%+v", all)
	}
	/* 改名 */
	rec = do(t, s.Handler(), http.MethodPost, "/api/presets/rename", "",
		io.NopCloser(strings.NewReader(`{"old":"硬笔","new":"钢笔"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("rename → %d", rec.Code)
	}
	got, err := presets.List()
	if err != nil {
		t.Fatal(err)
	}
	if got["钢笔"] == nil || got["硬笔"] != nil {
		t.Errorf("改名结果异常：%+v", got)
	}
	/* 目标已存在 → 409 */
	_ = presets.Save("A", map[string]any{})
	_ = presets.Save("B", map[string]any{})
	rec = do(t, s.Handler(), http.MethodPost, "/api/presets/rename", "",
		io.NopCloser(strings.NewReader(`{"old":"A","new":"B"}`)))
	if rec.Code != http.StatusConflict {
		t.Errorf("重名应 409，实际 %d", rec.Code)
	}
	/* 删除 */
	rec = do(t, s.Handler(), http.MethodDelete, "/api/presets/"+url.QueryEscape("钢笔"), "", nil)
	if rec.Code != http.StatusOK {
		t.Errorf("DELETE → %d", rec.Code)
	}
	rec = do(t, s.Handler(), http.MethodDelete, "/api/presets/"+url.QueryEscape("钢笔"), "", nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("重复删除应 404，实际 %d", rec.Code)
	}
	/* 非法名 */
	rec = do(t, s.Handler(), http.MethodPut, "/api/presets/"+url.QueryEscape("a/b"), "",
		io.NopCloser(strings.NewReader(`{}`)))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("非法名应 400，实际 %d", rec.Code)
	}
}

func TestKindleEndpoint(t *testing.T) {
	s, _, _, _ := stage2Server(t)
	rec := do(t, s.Handler(), http.MethodPut, "/api/kindle", "", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT /api/kindle → %d", rec.Code)
	}
	var resp map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["ok"] != "true" || resp["path"] == "" {
		t.Errorf("响应异常：%+v", resp)
	}
}

/* 服务未注入时降级：GET 空列表、写操作 404 JSON（不得 panic / 500）。 */
func TestStage2ServicesNilFallback(t *testing.T) {
	s, _ := testServer(t)
	rec := do(t, s.Handler(), http.MethodGet, "/api/fonts", "", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"system":[]`) {
		t.Errorf("nil fonts → %d %s", rec.Code, rec.Body.String())
	}
	rec = do(t, s.Handler(), http.MethodGet, "/api/presets", "", nil)
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "{}" {
		t.Errorf("nil presets → %d %s", rec.Code, rec.Body.String())
	}
	rec = do(t, s.Handler(), http.MethodPut, "/api/kindle", "", nil)
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "error") {
		t.Errorf("nil kindle → %d %s", rec.Code, rec.Body.String())
	}
}
