# 桌面版落地 TODO（阶段 0–4）

> 依据：[桌面版架构设计](desktop-architecture.md)。约定：每项完成即勾，全部完成的阶段在标题标注「已完成」；**未勾完不删本文档**（区别于一次性 TODO 清单）。
> 全局验收命令：`go test ./...`、`cd web && npm test`、`go run ./cmd/typegen -check`、mac 真机冒烟。

## 阶段 0：抽象与契约（不改 UI 行为）

- [ ] `internal/domain`：定义 DTO 与事件常量
  - `Config`（主题 / 模板 / 字格 / 页边距 / 字体 / 资源模式 / 默认端口 / 绑定地址）
  - `WorkspaceFile`（路径、内容、修改时间）、`FontEntry`（名称、来源、路径、启用）
  - `PDFExportRequest`（文件名、base64）、`PrintRequest`（html）
  - 事件常量（kebab-case）：`config.changed` / `workspace.opened` / `file.saved` / `font.added` / `pdf.saved`
- [ ] `internal/config`：SSOT JSON 落盘
  - `ConfigPath()` / `AppConfigDir()` 并发安全；默认端口 `39130`；默认绑定 `127.0.0.1`
  - 默认值与前端常量、Swift `defaultServerURL` 三处一致性测试
- [ ] `internal/api`：`Server` 骨架
  - 路由注册、静态托管、**未知 `/api/*` 必须 404**
  - **同源校验中间件**：写操作仅放行 `Origin: http://127.0.0.1:<port>` 或缺失；读操作放行
  - SSE `/api/events` 事件总线
- [ ] `web/src/ipc/client.ts` + 浏览器 mock 传输
  - transport 抽象（desktop / browser 两种），UI 先用 mock，行为不变
- [ ] `cmd/typegen`：`go/ast` → `web/src/generated/types.ts` + JSON 样本，支持 `-check`
- 验收：`go test ./...` 通过；`go run ./cmd/typegen -check` 无漂移；`npm test` 全绿；前端在浏览器 mock 下功能不回退

## 阶段 1：Go 内核 + mac 壳（MVP）

- [ ] `main.go`：`//go:embed web/dist/*`、`VERSION` 注入（与 `internal/version` 同名同值）
- [ ] `serve.go`：端口顺延（CLI > 配置 > 39130）、单实例探测、根 Context、退出收尾（信号 + 窗口钩子）
- [ ] `internal/app`：组合根 `New(webFS)` + 幂等 `Close()`
- [ ] `internal/files`：txt / md 读写 + 最近文件（路径安全校验，限制目录穿越）
- [ ] `internal/pdf`：接收 jsPDF blob 落盘（文件名非法字符处理）
- [ ] `internal/print`：mac 原生打印（`NSPrintOperation`）
- [ ] `native_macos/main.swift`：WKWebView 壳
  - 菜单（关于 / 隐藏 / 退出，Cmd+Q）、Dock 点击重开、关窗隐藏
  - 加载失败重试（≤60 次 / 800ms）、`alert/confirm/prompt` 桥接、外链交系统浏览器、`window.open` 拦截
  - 预留 JS→原生桥：全屏 / 原生打印 / 字体选择
- [ ] `desktop.go`：窗口拉起 + 子进程跟踪 + 退出钩子（回退浏览器 `--app`）
- [ ] 前端接入：`config` / `files` / `pdf` / `print` 切到 IPC（去掉浏览器检测与 lite 跳转）
- 验收：mac 真机启动 → 编辑 → 导出 PDF → 打印 → 重启后配置恢复；关窗不残留进程；`lsof` 无孤儿监听

## 阶段 2：桌面能力补齐

- [ ] `internal/fonts`：mac 系统字体扫描（仅名称，不复制文件）+ 用户字体库（SQLite 索引 + 文件落盘）
- [ ] `internal/workspace`：版式预设（保存 / 载入 / 列表；内容、光标、最近文件）
- [ ] 前端字体选择器切到 `fonts` 服务（替换 IndexedDB 导入）
- [ ] 「导出 Kindle 版」入口（拷贝 `lite/index.html`）
- 验收：导入字体后在预览生效；预设可保存/载入；导出文件在 Kindle file:// 可开

## 阶段 3：Windows / Linux

- [ ] Win 壳：WebView2 优先，回退 Edge `--app`；Linux：WebKitGTK 优先，回退 Chromium `--app`
- [ ] `internal/fonts` 平台实现（Win 注册表 / Linux fontconfig）
- [ ] 打印平台实现（Win / Linux）
- [ ] 打包：Win NSIS / 便携 zip；Linux AppImage / deb / rpm（GoReleaser）
- 验收：三平台真机冒烟（启动 / 编辑 / 导出 / 打印）；安装包可分发给朋友（ad-hoc / 未签名说明）

## 阶段 4：打磨与可选

- [ ] 完全离线：`vendor` 内联（pinyin-pro / HanziWriter），默认 `ResourceMode=local`
- [ ] Go server 托管 `/lite/`（复用字体服务，lite 仍保持 file:// 独立）
- [ ] Dock / 托盘、多窗口、自动更新（可选）
- [ ] MCP 工具（AI 组词 / 抄书，可选；若做需重新评估安全模型）
- 验收：断网可用全部核心功能 + 拼音 / 笔顺；`/lite/` 与独立文件行为一致
