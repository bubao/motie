// Package api 是桌面版的接口层（纯传输层）：REST + SSE + 同源校验 + 静态托管。
// 领域逻辑由 internal/app 组合根注入的 Deps 提供，不在此实现。
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"motie/internal/domain"
)

/* ---------- SSE 事件总线 ---------- */

type Bus struct {
	mu   sync.RWMutex
	subs map[chan []byte]struct{}
}

func NewBus() *Bus {
	return &Bus{subs: map[chan []byte]struct{}{}}
}

func (b *Bus) Subscribe() chan []byte {
	ch := make(chan []byte, 16)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *Bus) Unsubscribe(ch chan []byte) {
	b.mu.Lock()
	if _, ok := b.subs[ch]; ok {
		delete(b.subs, ch)
		close(ch)
	}
	b.mu.Unlock()
}

// Count 返回当前订阅数（供运维与测试使用）。
func (b *Bus) Count() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.subs)
}

/* Publish 向所有订阅者广播 SSE 帧：event: <name>\ndata: <json>\n\n。 */
func (b *Bus) Publish(event string, data any) {
	payload, err := json.Marshal(data)
	if err != nil {
		return
	}
	frame := []byte(fmt.Sprintf("event: %s\ndata: %s\n\n", event, payload))
	b.mu.RLock()
	defer b.mu.RUnlock()
	for ch := range b.subs {
		select {
		case ch <- frame:
		default: // 慢订阅者丢帧而非阻塞总线
		}
	}
}

/* ---------- 依赖（由组合根装配） ---------- */

// ConfigService 是配置服务契约；阶段 0 由 app 注入，接口保持稳定。
type ConfigService interface {
	Get() (domain.Config, error)
	Set(domain.Config) error
}

// FileService 是工作区文件服务契约（组合根注入）。
type FileService interface {
	Read(path string) (domain.WorkspaceFile, error)
	Delete(path string) error
	Write(domain.WorkspaceFile) error
	ListRecent() []string
}

// PDFService 接收前端光栅化的每页 JPEG（+ 纸张尺寸），组装成 PDF 并落盘，返回完整路径。
type PDFService interface {
	Export(filename string, pages [][]byte, pageW, pageH float64) (string, error)
}

// FontsService 为字体库契约；允许 nil（接口返回空列表 / 404）。
type FontsService interface {
	ListSystem() []domain.FontEntry
	ListUser() ([]domain.FontEntry, error)
	Add(name, ext string, data []byte) (domain.FontEntry, error)
	Remove(id string) error
	Rename(id, name string) error
	UpdateTags(id string, tags []string) error
	File(id string) ([]byte, string, error)
}

// PresetsService 为版式预设契约。
type PresetsService interface {
	List() (map[string]any, error)
	Save(name string, data any) error
	Delete(name string) error
	Rename(old, next string) error
}

// KindleService 导出内置 lite 单文件到 export/。
type KindleService interface {
	Export() (string, error)
}

// LibraryService 是字帖索引库契约（组合根注入；允许 nil）。
type LibraryService interface {
	List() ([]domain.DocumentEntry, error)
	Search(q string) ([]domain.DocumentEntry, error)
	Get(id int64) (domain.DocumentEntry, error)
	UpdateTitle(id int64, title string) error
	SetFavorite(id int64, fav bool) error
	Delete(id int64) error
	ReindexFromRecents(paths []string) (int, error)
	SyncContentStats(path string, chars int) error
}

// Updater 为更新检查契约（查 GitHub Releases latest）。
type UpdaterInterface interface {
	Latest(ctx context.Context) (UpdateInfo, error)
}

type Deps struct {
	Config  ConfigService
	Files   FileService
	PDF     PDFService
	Fonts   FontsService
	Presets PresetsService
	Kindle  KindleService
	Library LibraryService
	Update  UpdaterInterface
	WebFS   fs.FS // //go:embed dist
	Bus     *Bus
	Version string
}

/* ---------- Server ---------- */

type Server struct {
	deps Deps
	mux  *http.ServeMux
	port int
}

func New(deps Deps) *Server {
	if deps.Bus == nil {
		deps.Bus = NewBus()
	}
	s := &Server{deps: deps}
	s.register()
	return s
}

// SetPort 记录实际监听端口（同源校验与 /api/config 元信息使用）。
func (s *Server) SetPort(p int) { s.port = p }

func (s *Server) Handler() http.Handler {
	return sameOrigin(s.mux, s.port)
}

func (s *Server) register() {
	s.mux = http.NewServeMux()

	s.mux.HandleFunc("GET /api/config", s.handleConfigGet)
	s.mux.HandleFunc("PUT /api/config", s.handleConfigPut)
	s.mux.HandleFunc("GET /api/update/latest", s.handleUpdateLatest)
	s.mux.HandleFunc("GET /api/events", s.handleEvents)

	/* 工作区文件：只接受受控子树内的相对路径（见 files.ResolveScoped）。 */
	s.mux.HandleFunc("GET /api/files/recent", s.handleFilesRecent)
	s.mux.HandleFunc("GET /api/files", s.handleFilesGet)
	s.mux.HandleFunc("PUT /api/files", s.handleFilesPut)

	/* 字体库：系统扫描（只读名称）+ 用户字体落盘。 */
	s.mux.HandleFunc("GET /api/fonts", s.handleFontsList)
	s.mux.HandleFunc("POST /api/fonts", s.handleFontsAdd)
	s.mux.HandleFunc("DELETE /api/fonts/{id}", s.handleFontsRemove)
	s.mux.HandleFunc("GET /api/fonts/file/{id}", s.handleFontFile)
	s.mux.HandleFunc("POST /api/fonts/rename", s.handleFontsRename)
	s.mux.HandleFunc("POST /api/fonts/tags", s.handleFontsTags)

	/* 版式预设。 */
	s.mux.HandleFunc("GET /api/presets", s.handlePresetsList)
	s.mux.HandleFunc("PUT /api/presets/{name}", s.handlePresetsPut)
	s.mux.HandleFunc("DELETE /api/presets/{name}", s.handlePresetsDelete)
	s.mux.HandleFunc("POST /api/presets/rename", s.handlePresetsRename)

	/* 字帖索引库：列表/搜索 + 重命名/删除 + 从最近文件重建索引（M1/M3）。 */
	s.mux.HandleFunc("GET /api/library", s.handleLibraryList)
	s.mux.HandleFunc("POST /api/library/reindex", s.handleLibraryReindex)
	s.mux.HandleFunc("POST /api/library/rename", s.handleLibraryRename)
	s.mux.HandleFunc("POST /api/library/favorite", s.handleLibraryFavorite)
	s.mux.HandleFunc("POST /api/library/delete", s.handleLibraryDelete)

	/* PDF 导出：前端光栅化每页 JPEG，Go 组装成 PDF。 */
	s.mux.HandleFunc("POST /api/pdf/build", s.handlePDFBuild)

	/* 导出 Kindle 版（复制内置 lite 单文件到 export/）。 */
	s.mux.HandleFunc("PUT /api/kindle", s.handleKindlePut)

	/* 未知 /api/* 必须 404（JSON），不得降级为 index.html——防止契约漂移被伪装成正常页面。 */
	s.mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	})

	/* lite 子树（embed dist/lite）：Kindle / 老浏览器访问，缺失即 404，不回退完整版。 */
	s.mux.HandleFunc("GET /lite/", s.serveLite)

	/* 静态托管：SPA 回退到 index.html。 */
	s.mux.HandleFunc("/", s.serveStatic)
}

/* serveLite 托管内嵌 lite 子树：/lite/ 与 /lite/index.html 均返回练字版单文件；
 * 其余路径按相对名读取，缺失 404（不得回退完整版 index.html）。 */
func (s *Server) serveLite(w http.ResponseWriter, r *http.Request) {
	if s.deps.WebFS == nil {
		http.NotFound(w, r)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/lite/")
	if name == "" {
		name = "index.html"
	}
	name = strings.TrimPrefix(path.Clean("/"+name), "/")
	data, err := fs.ReadFile(s.deps.WebFS, "lite/"+name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if ct := mime.TypeByExtension(filepath.Ext(name)); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}

/* serveStatic：自读 WebFS（单文件产物无子目录），缺失路径回退 index.html。
 * 不用 http.FileServer 是为了避开其对 /index.html 的 301 重定向。 */
func (s *Server) serveStatic(w http.ResponseWriter, r *http.Request) {
	if s.deps.WebFS == nil {
		http.NotFound(w, r)
		return
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" {
		name = "index.html"
	}
	data, err := fs.ReadFile(s.deps.WebFS, name)
	if err != nil {
		data, err = fs.ReadFile(s.deps.WebFS, "index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		name = "index.html"
	}
	if name == "index.html" {
		data = s.injectBoot(data)
	}
	if ct := mime.TypeByExtension(filepath.Ext(name)); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}

/* bootScript 注入桌面标记与主题（SSOT 读配置）：
 * __MOTIE_DESKTOP__ 供 ipc/client.ts 选择 HTTP transport、供 index.html 跳过浏览器检测；
 * ZITIE_BOOT.Theme 供首屏早期主题脚本使用，避免深色模式白闪。 */
func (s *Server) bootScript() string {
	theme := ""
	if s.deps.Config != nil {
		if c, err := s.deps.Config.Get(); err == nil {
			theme = c.Theme
		}
	}
	if theme == "" {
		theme = "system"
	}
	b, err := json.Marshal(theme)
	if err != nil {
		return ""
	}
	return "<script>window.__MOTIE_DESKTOP__=true;window.ZITIE_BOOT=Object.assign(window.ZITIE_BOOT||{},{Theme:" + string(b) + "});</script>"
}

/* injectBoot 把 boot script 插到 <head> 之后（先于既有内联脚本执行）。 */
func (s *Server) injectBoot(data []byte) []byte {
	const marker = "<head>"
	idx := bytes.Index(data, []byte(marker))
	if idx < 0 {
		return data
	}
	script := s.bootScript()
	if script == "" {
		return data
	}
	pos := idx + len(marker)
	out := make([]byte, 0, len(data)+len(script))
	out = append(out, data[:pos]...)
	out = append(out, []byte(script)...)
	out = append(out, data[pos:]...)
	return out
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	/* 先订阅再应答：客户端收到响应头与订阅注册之间存在窗口，
	 * 反序会让连接瞬间的事件丢失。 */
	ch := s.deps.Bus.Subscribe()
	defer s.deps.Bus.Unsubscribe(ch)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case frame := <-ch:
			if _, err := w.Write(frame); err != nil {
				return
			}
			flusher.Flush()
		case <-heartbeat.C:
			if _, err := w.Write([]byte(": ping\n\n")); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

/* ---------- 同源校验 ---------- */

var writeMethods = map[string]bool{
	http.MethodPost:   true,
	http.MethodPut:    true,
	http.MethodPatch:  true,
	http.MethodDelete: true,
}

// sameOrigin 只对写操作校验 Origin：放行缺失（原生窗口 / file://）或
// 恰好 http://127.0.0.1:<port>；其余跨域来源拒绝（防 DNS rebinding）。读操作放行。
func sameOrigin(next http.Handler, port int) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if writeMethods[r.Method] && !originAllowed(r.Header.Get("Origin"), port) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "cross-origin write rejected"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func originAllowed(origin string, port int) bool {
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	want := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	return u.Host == want
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

/* 供测试与组合根使用的辅助：从 listener 取实际端口。 */
func PortOf(ln net.Listener) int {
	if ln == nil {
		return 0
	}
	_, portStr, err := net.SplitHostPort(ln.Addr().String())
	if err != nil {
		return 0
	}
	p, _ := strconv.Atoi(portStr)
	return p
}
