package app

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"motie/internal/domain"
)

// encodeJPEG：生成一页最小 baseline JPEG（导出用例只关心链路，不关心内容）。
func encodeJPEG(t *testing.T) []byte {
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

func newTestApp(t *testing.T) (*App, string) {
	t.Helper()
	home := t.TempDir()
	a, err := New(Options{
		WebFS:      fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html>motie</html>")}},
		ConfigHome: home,
		Version:    "test",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = a.Close() })
	return a, home
}

/* 组合根装配完整：GET /api/config 有元信息与默认配置；PUT 落盘到注入目录并广播事件。 */
func TestServerConfigRoundTrip(t *testing.T) {
	a, home := newTestApp(t)
	a.Server.SetPort(39130)

	rec := httptest.NewRecorder()
	a.Server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/config", nil))
	var resp domain.ConfigResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.App != "motie" || resp.Version != "test" || resp.Config.Theme != "system" {
		t.Errorf("响应异常：%+v", resp)
	}

	ch := a.bus.Subscribe()
	defer a.bus.Unsubscribe(ch)
	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/config",
		io.NopCloser(strings.NewReader(`{"Theme":"dark"}`)))
	a.Server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT → %d", rec.Code)
	}
	select {
	case frame := <-ch:
		if !strings.Contains(string(frame), "config.changed") {
			t.Errorf("事件帧异常：%s", frame)
		}
	default:
		t.Error("未收到 config.changed")
	}
	/* 落盘位置 = 注入的配置根 */
	data, err := os.ReadFile(filepath.Join(home, "config.json"))
	if err != nil {
		t.Fatalf("配置未写入注入目录：%v", err)
	}
	if !strings.Contains(string(data), `"Theme": "dark"`) {
		t.Errorf("落盘内容异常：%s", data)
	}
}

func TestFilesAndPDFInjected(t *testing.T) {
	a, home := newTestApp(t)
	/* 桌面端文件服务受控：前端只能传 workspace/ export/ 下的相对路径 */
	if err := a.Files.Write(domain.WorkspaceFile{Path: "workspace/字帖.txt", Content: "永"}); err != nil {
		t.Fatal(err)
	}
	/* 受控模式 recents 暴露相对路径（与前端可读 / 可回写口径一致，见 files.displayPath） */
	if got := a.Files.ListRecent(); len(got) != 1 || got[0] != "workspace/字帖.txt" {
		t.Errorf("recent = %v", got)
	}
	if _, err := os.Stat(filepath.Join(home, "workspace", "字帖.txt")); err != nil {
		t.Errorf("文件应已落盘：%v", err)
	}
	/* 越界路径必须被拒（绝对路径 / 非白名单目录） */
	for _, bad := range []string{"/etc/evil.txt", "../evil.txt", "pdf/x.txt", "workspace/x.pdf"} {
		if err := a.Files.Write(domain.WorkspaceFile{Path: bad, Content: "x"}); err == nil {
			t.Errorf("应拒绝越界路径 %q", bad)
		}
	}
	full, err := a.PDF.Export("导出 1:2.pdf", [][]byte{encodeJPEG(t)}, 210, 297)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(full) != filepath.Join(home, "pdf") {
		t.Errorf("PDF 目录 = %q", filepath.Dir(full))
	}
	if filepath.Base(full) != "导出 1_2.pdf" {
		t.Errorf("文件名清洗 = %q", filepath.Base(full))
	}
}

func TestCloseIdempotentAndCancelsCtx(t *testing.T) {
	a, _ := newTestApp(t)
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	if err := a.Close(); err != nil {
		t.Errorf("重复 Close 应幂等：%v", err)
	}
	select {
	case <-a.Ctx().Done():
	default:
		t.Error("Close 后根 Context 应已取消")
	}
}

/* 字帖索引库（M1）：LibraryAt 注入；启动时把现有 recents.json 并入库（幂等）。 */
func TestLibraryWired(t *testing.T) {
	home := t.TempDir()
	dbPath := filepath.Join(home, "custom", "lib.db")
	opts := Options{
		WebFS:      fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html>motie</html>")}},
		ConfigHome: home,
		LibraryAt:  dbPath,
		Version:    "test",
	}
	a, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	/* 第一次启动：写一个工作区文件 → 进 recents.json */
	if err := a.Files.Write(domain.WorkspaceFile{Path: "workspace/春晓.txt", Content: "春眠不觉晓"}); err != nil {
		t.Fatal(err)
	}
	if err := a.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	/* 第二次启动：recents 应被自动并入索引 */
	a2, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	defer a2.Close()
	list, err := a2.Library.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Title != "春晓" || list[0].Path != "workspace/春晓.txt" {
		t.Fatalf("list = %+v", list)
	}

	/* IPC 契约可达 */
	rec := httptest.NewRecorder()
	a2.Server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/library", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "春晓") {
		t.Fatalf("GET /api/library → %d %s", rec.Code, rec.Body.String())
	}
}

/* 阶段 2：fonts / presets / kindle 装配与端到端行为。 */
func TestStage2ServicesWired(t *testing.T) {
	home := t.TempDir()
	a, err := New(Options{
		WebFS:      fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html>motie</html>")}},
		LiteFS:     fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html>lite</html>")}},
		ConfigHome: home,
		Version:    "test",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = a.Close() })

	/* 字体库：初始空，可增删 */
	if user, err := a.Fonts.ListUser(); err != nil || len(user) != 0 {
		t.Fatalf("初始用户字体应为空：%+v, %v", user, err)
	}
	e, err := a.Fonts.Add("测试楷体", ".ttf", []byte("fontdata"))
	if err != nil {
		t.Fatal(err)
	}
	if data, ext, err := a.Fonts.File(e.ID); err != nil || string(data) != "fontdata" || ext != ".ttf" {
		t.Fatalf("File = %q, %q, %v", data, ext, err)
	}

	/* 预设：保存 / 列表 / 删除 */
	if m, err := a.Presets.List(); err != nil || len(m) != 0 {
		t.Fatalf("初始预设应为空：%+v, %v", m, err)
	}
	if err := a.Presets.Save("硬笔", map[string]any{"Cols": 8}); err != nil {
		t.Fatal(err)
	}
	if m, _ := a.Presets.List(); m["硬笔"] == nil {
		t.Fatalf("预设未落盘：%+v", m)
	}
	raw, err := os.ReadFile(filepath.Join(home, "workspace", "presets.json"))
	if err != nil || !strings.Contains(string(raw), "硬笔") {
		t.Fatalf("预设文件异常：%s, %v", raw, err)
	}

	/* Kindle：导出 lite 到 export/ */
	got, err := a.Kindle.Export()
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(got) != filepath.Join(home, "export") {
		t.Errorf("Kindle 目录 = %q", filepath.Dir(got))
	}
	body, err := os.ReadFile(got)
	if err != nil || string(body) != "<html>lite</html>" {
		t.Fatalf("Kindle 内容异常：%s, %v", body, err)
	}
}
