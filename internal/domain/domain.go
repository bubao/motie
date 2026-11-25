// Package domain 定义桌面版的领域契约：DTO（typegen 输入）与 SSE 事件常量。
// JSON tag 与前端 zitie.config 键名保持一致（ZgType / FontURL / FontSource ...），
// 使 Go 内核与 web/src 共享同一套配置词汇，ipc 客户端可无映射透传。
package domain

/* ---------- 事件常量（kebab-case；前后端镜像同步） ----------
 * config.changed：内核保存配置后广播，前端 SSE 已消费（applyRemotePrefs）；
 * file.saved / font.added / pdf.saved：服务端在对应动作后发布，多窗口同步预留，
 * 当前前端仅登记监听、无 UI 消费。新增事件必须同步 typegen 产物与测试清单。 */

const (
	EventConfigChanged = "config.changed"
	EventFileSaved     = "file.saved"
	EventFontAdded     = "font.added"
	EventPDFSaved      = "pdf.saved"
)

// Events 全部事件名，供测试与前端订阅列表校验唯一性。
var Events = []string{
	EventConfigChanged,
	EventFileSaved,
	EventFontAdded,
	EventPDFSaved,
}

/* ---------- 纸张与边距（mm，与 sheet-layout 内置默认一致） ---------- */

/* 嵌套键小写（width/height ...），外层 Config 用 json:"Page"/"Margin"，
 * 序列化结构与前端 zitie.config 的 Page/Margin 对象完全一致。 */
type PageSize struct {
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type Margin struct {
	Top    float64 `json:"top"`
	Right  float64 `json:"right"`
	Bottom float64 `json:"bottom"`
	Left   float64 `json:"left"`
}

/* ---------- 字体来源：default 系统默认 / url 网络地址 / local 本地字体 ---------- */

type FontSource struct {
	Type string `json:"type"`
	URL  string `json:"url,omitempty"`
	ID   string `json:"id,omitempty"`
}

/* ---------- 用户偏好 SSOT（JSON 落盘于 os.UserConfigDir()/motie/config.json） ---------- */

type Config struct {
	Theme        string     `json:"Theme"`
	Template     string     `json:"Template"`
	ZgType       string     `json:"ZgType"`
	InkColor     string     `json:"InkColor"`
	InkAlpha     float64    `json:"InkAlpha"`
	FontWeight   string     `json:"FontWeight"`
	FontURL      string     `json:"FontURL"`
	FontSource   FontSource `json:"FontSource"`
	ResourceMode string     `json:"ResourceMode"`
	Page         PageSize   `json:"Page"`
	Margin       Margin     `json:"Margin"`
	DefaultPort  int        `json:"DefaultPort"`
	BindAddr     string     `json:"BindAddr"`
}

/* ---------- 服务元信息（单实例探测：GET /api/config 的 app == "motie"） ---------- */

type ServerMeta struct {
	App     string `json:"app"`
	Version string `json:"version,omitempty"`
	Port    int    `json:"port"`
}

// ConfigResponse 是 GET /api/config 的响应体。
type ConfigResponse struct {
	ServerMeta
	Config Config `json:"config"`
}

/* ---------- 工作区文件 ---------- */

type WorkspaceFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	/* RFC3339 字符串，避免 typegen 处理 time.Time */
	ModTime string `json:"mod_time"`
}

/* ---------- 字体库条目（仅名称入库；系统字体不复制文件） ----------
 * 用户字体：ID 定位文件与 @font-face 地址，Size/CreatedAt 供界面展示；
 * 系统字体：只有 Name/Source，不落盘。 */

type FontEntry struct {
	ID        string `json:"id,omitempty"`
	Name      string `json:"name"`
	Source    string `json:"source"` // system / user
	Path      string `json:"path,omitempty"`
	Size      int64  `json:"size,omitempty"`
	CreatedAt string `json:"created_at,omitempty"`
	Enabled   bool   `json:"enabled"`
}

/* ---------- 字体库总览（GET /api/fonts） ---------- */

type FontLibrary struct {
	System []FontEntry `json:"system"`
	User   []FontEntry `json:"user"`
}

/* ---------- 字体文件大小上限（与前端 FontManager MAX_FONT_SIZE 一致） ---------- */

const MaxFontFileSize = 20 * 1024 * 1024

/* MaxPDFSize：单次导出的总体积上限（多页 JPEG 上传 + Go 生成的 PDF），留足千页级余量。 */
const MaxPDFSize = 256 * 1024 * 1024

/* ---------- PDF / 打印（PDF 由 Go 组装页面图像生成；打印仍由前端面板承接） ---------- */

type PrintRequest struct {
	HTML string `json:"html"`
}
