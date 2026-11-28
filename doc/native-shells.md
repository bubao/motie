# 原生窗口壳（native shell）

内核（Go）启动后按 **同目录原生壳** 优先拉起窗口；未找到则回退 Chromium 系浏览器 `--app` 独立窗口。挂载点见 `desktop_darwin.go` / `desktop_windows.go` / `desktop_linux.go`，三平台契约一致：

| 契约 | 值 |
| --- | --- |
| 位置 | 与内核可执行文件同目录 |
| 文件名 | `motie-shell`（mac/Linux）/ `motie-shell.exe`（Windows） |
| 调用 | `shell <url>`（单参数，内核地址） |
| URL 来源 | 启动参数 > `MOTIE_SERVER_URL` > `http://127.0.0.1:39130/` |
| 生命周期 | 壳自管；内核侧对壳进程不跟踪、不因壳退出而关闭服务 |

## 实现现状

| 平台 | 源码 | 状态 |
| --- | --- | --- |
| macOS | `native_macos/main.swift`（WKWebView） | ✅ 可用：菜单 / Dock / 托盘 / 加载重试 / alert·confirm·prompt / 外链 / JS 桥 fullscreen·print |
| Linux | `native_linux/motie-shell.c`（GTK3 + WebKit2GTK） | 🚧 源码已备，**本机不可编译/运行**；源码已对照 gi-docgen stable 复核并修正，仍需在目标机首次构建验证 |
| Windows | `native_windows/motie-shell.cs`（WinForms + WebView2） | 🚧 源码已备，**本机不可编译/运行**；源码已对照 Microsoft Learn / .NET 文档复核并修正，仍需在目标机首次构建验证 |

> mac 壳的「关窗隐藏而非退出」（Dock 常驻）在 Linux/Windows 无对等托盘设计；这两平台取
> **关窗即退出壳进程**。内核服务是独立进程，不受影响，再次启动由内核单实例探测处理。
> 该差异已写入各壳头注释。

## 构建

### Linux（目标机）

```bash
sudo apt install build-essential libgtk-3-dev libwebkit2gtk-4.1-dev   # Debian/Ubuntu
native_linux/build-linux-shell.sh        # 产物 build/motie-shell
```

### Windows（目标机，PowerShell）

```powershell
powershell -ExecutionPolicy Bypass -File native_windows\build-windows-shell.ps1            # 需 .NET 8 Desktop Runtime
powershell -ExecutionPolicy Bypass -File native_windows\build-windows-shell.ps1 -SelfContained  # 独立包
```

产物与 `motie(.exe)` 放同一目录即可被内核自动拉起。

## 本机复核修正记录（2026-11-27）

目标机不可得时，已对照官方文档逐项复核两壳源码并修正可确定的偏差：

- **Linux**（依据 gi-docgen stable / API 4.1 / 库 2.42.5）：
  - `decide-policy` 与 `load-failed` 信号声明均返回 `gboolean`，原回调为 `void`——已按声明返回（已决策 TRUE / 未决策 FALSE，load-failed 恒 TRUE 接管以避免默认错误页闪现）；
  - `create` 信号返回 `GtkWidget*`，回调签名同步改为 `GtkWidget *`（返回 NULL 语义不变）；
  - `webkit_settings_set_application_name_for_user_agent` **不在 stable API 表中**，改用官方等价物 `webkit_settings_set_user_agent_with_application_details(settings, "motie-desktop", NULL)`；
  - decide-policy / create 回调补 `uri` 为空边界处理（无 URI 时忽略决策 / 不新建窗口，避免 NULL 进入 `open_external`）。
- **Windows**（依据 Microsoft Learn / .NET 文档）：
  - `Uri.Host` 对 IPv6 返回带括号形式 `[::1]`（官方示例），`IsLocalUri` 原只匹配 `"::1"` 会误判回环为外链——已同时接受；
  - `--application-name` 不是 Chromium / WebView2 开关，改用官方属性 `CoreWebView2Settings.UserAgent` 追加（Runtime 过旧时 try/catch 静默降级，仅缺 UA 标注）；
  - `NewWindowRequested` 的 `e.Uri` 可能为空（`window.open()` 无参数），原逻辑会对空串调用系统浏览器，已加空值拦截。

## 已知缺口 / 未验证项

- 两平台壳均**未经编译与运行验证**（本机 macOS 无法构建）；上述复核只覆盖 API 用法与签名，运行时行为仍需目标机确认。首次构建失败时以 gi-docgen / WebView2 官方文档为准并回填。
- Linux 未接 alert / confirm / prompt 原生面板（走 WebKitGTK 默认行为）。
- Windows `print` 依赖较新 WebView2 Runtime 的 `PrintAsync`，旧 Runtime 会弹提示而非打印。
- `alert/confirm/prompt` 在 WebView2 下为内置弹窗，与 mac 原生面板外观不同。

## 目标机首次验收清单

### Linux

1. 构建：`sudo apt install build-essential libgtk-3-dev libwebkit2gtk-4.1-dev` → `native_linux/build-linux-shell.sh` → 产物 `build/motie-shell`。
2. 把壳与 `motie` 内核放同一目录，启动内核：应自动拉起壳窗口（无浏览器 `--app` 回退窗口）。
3. 行为检查点：标题「墨帖」、约 1180×860 居中；首页正常渲染；点击外链由 `xdg-open` 交系统浏览器而窗口内不跳；`window.open` 同规则；停内核后重载失败自动重试，超 60 次弹 GTK 提示且「重试 / 退出」可用；UA 含 `motie-desktop`（如需核对可临时开启 `enable-developer-extras` 后查 `navigator.userAgent`）。

### Windows

1. 构建：目标机 PowerShell 执行 `native_windows\build-windows-shell.ps1`（需 .NET 8 Desktop Runtime；`-SelfContained` 出独立包）。
2. 需要 WebView2 Runtime；未安装时用 `-SelfContained` 或先装 Evergreen Runtime。把 `motie-shell.exe` 与 `motie.exe` 放同一目录后启动内核。
3. 行为检查点：标题「墨帖」、约 1180×860 居中；首页正常渲染；外链与 `window.open` 交系统默认浏览器；地址为 `http://[::1]:<port>/` 时仍在窗口内打开（IPv6 回环回归）；打印调起系统打印对话框（旧 Runtime 弹不支持提示）；关窗即退壳、内核服务不停；UA 含 `motie-desktop`（DevTools 控制台查看，旧 Runtime 可能无）。
4. 排查入口：WebKitGTK 信号见 gi-docgen（`webkitgtk.org/reference/webkit2gtk/stable/signal.WebView.*.html`）；WebView2 事件见 Microsoft Learn `CoreWebView2` 类页。
