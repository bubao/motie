package main

import (
	"context"
	"os"
	"path/filepath"
)

/* windowProc 表示一次拉起的窗口 / 浏览器进程；Done 在窗口关闭后关闭。
 * 平台实现见 desktop_darwin.go / desktop_windows.go / desktop_linux.go。 */
type windowProc struct {
	done chan struct{}
}

func (p *windowProc) Done() <-chan struct{} { return p.done }

/* openWindow 拉起显示 url 的窗口。约定：
 *   - 各平台优先拉起同目录原生壳（motie.app / motie-shell.exe / motie-shell），未安装则回退 Chromium 系浏览器；
 *   - 返回 nil 表示该窗口无可跟踪子进程（原生壳自管生命周期，或 opener 类命令无法跟踪），主服务不受窗口影响；
 *   - 返回 proc 表示跟踪浏览器进程：窗口关闭（进程退出）即取消主 Context。 */
func openWindow(parent context.Context, url string) (*windowProc, error) {
	return openWindowPlatform(parent, url)
}

/* browserProfileDir 返回浏览器 --app 独立窗口使用的专用 Profile 目录。
 *
 * 固定路径（而非每次随机临时目录）保证窗口状态在多次启动之间持久；
 * 独立 Profile 保证 --app 启动的是独立浏览器进程——若复用系统浏览器正在使用的
 * Profile，命令会被既有进程接管后立即返回，配合 cmd.Wait() 监听会误杀内核服务。 */
func browserProfileDir() string {
	dir, err := os.UserCacheDir()
	if err != nil || dir == "" {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "motie", "browser-profile")
}

/* browserAppArgs 构造浏览器独立应用窗口（--app）的启动参数。
 *
 * --user-data-dir 指向 browserProfileDir()；--no-first-run / --no-default-browser-check
 * 用于跳过全新 Profile 的欢迎页与默认浏览器提示。三平台浏览器分支共用。 */
func browserAppArgs(url string) []string {
	return []string{
		"--app=" + url,
		"--user-data-dir=" + browserProfileDir(),
		"--no-first-run",
		"--no-default-browser-check",
	}
}
