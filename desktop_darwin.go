//go:build darwin

package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

/* nativeAppPath：macOS 原生 WKWebView 壳的安装位置（native_macos 构建产物）。 */
const nativeAppPath = "/Applications/Motie.app"

/* openWindowPlatform 优先级：
 *   1) 原生启动器二进制 motie-shell（.app 内 Contents/MacOS/，多路径候选）；
 *   2) 完整 .app bundle（open -n -a motie.app）；
 *   3) Chromium 系浏览器 --app 独立窗口（独立 Profile，关闭即取消主 Context）；
 *   4) 系统默认浏览器（open，opener 不可跟踪，返回 nil）。
 *
 * 原生壳关窗隐藏而非退出、进程常驻（见 native_macos/main.swift），故返回 nil 不跟踪，
 * 避免其常驻特性让内核服务永远等不到退出信号。 */
func openWindowPlatform(parent context.Context, url string) (*windowProc, error) {
	if self, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(self)
		home, _ := os.UserHomeDir()
		candidates := []string{
			filepath.Join(exeDir, "motie-shell"),
			filepath.Join(exeDir, "..", "MacOS", "motie-shell"),
			filepath.Join(exeDir, "..", "..", "MacOS", "motie-shell"),
			filepath.Join("/Applications", "motie.app", "Contents", "MacOS", "motie-shell"),
		}
		if home != "" {
			candidates = append(candidates,
				filepath.Join(home, "Applications", "motie.app", "Contents", "MacOS", "motie-shell"))
		}
		for _, bin := range candidates {
			if st, err := os.Stat(bin); err == nil && !st.IsDir() {
				cmd := exec.CommandContext(parent, bin, url)
				if err := cmd.Start(); err != nil {
					break
				}
				_ = cmd.Process.Release()
				return nil, nil
			}
		}
	}

	if st, err := os.Stat(nativeAppPath); err == nil && st.IsDir() {
		cmd := exec.CommandContext(parent, "open", "-n", "-a", nativeAppPath, "--args", url)
		if err := cmd.Start(); err != nil {
			return nil, fmt.Errorf("拉起原生窗口失败：%w", err)
		}
		_ = cmd.Process.Release()
		return nil, nil
	}

	browsers := []string{
		"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
		"/Applications/Arc.app/Contents/MacOS/Arc",
		"/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
	}
	for _, b := range browsers {
		if st, err := os.Stat(b); err == nil && !st.IsDir() {
			fmt.Println("motie: 未发现原生壳，回退 " + filepath.Base(b) + " 应用窗口打开")
			cmd := exec.CommandContext(parent, b, browserAppArgs(url)...)
			if err := cmd.Start(); err != nil {
				continue
			}
			proc := &windowProc{done: make(chan struct{})}
			go func() {
				_ = cmd.Wait()
				close(proc.done)
			}()
			return proc, nil
		}
	}

	fmt.Println("motie: 未发现原生壳或 Chromium 系浏览器，回退系统默认浏览器打开")
	_ = exec.Command("open", url).Start()
	return nil, nil
}
