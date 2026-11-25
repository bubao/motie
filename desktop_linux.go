//go:build linux

package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

/* openWindowPlatform：优先与主程序同目录的原生壳 motie-shell（WebKitGTK 宿主，
 * 见 native_macos/main.swift 的同构实现）；未安装则回退 Chromium 系浏览器 --app
 * 独立窗口；均无则系统默认浏览器。
 *
 * 原生壳返回 nil（生命周期由壳自身管理）；浏览器分支返回可跟踪进程——关闭即取消主 Context；
 * opener（xdg-open）不可跟踪，同样返回 nil，避免命令立即退出被误判为关窗而杀掉服务。 */
func openWindowPlatform(parent context.Context, url string) (*windowProc, error) {
	if exe, err := os.Executable(); err == nil {
		shell := filepath.Join(filepath.Dir(exe), "motie-shell")
		if st, serr := os.Stat(shell); serr == nil && !st.IsDir() {
			cmd := exec.CommandContext(parent, shell, url)
			if err := cmd.Start(); err != nil {
				return nil, fmt.Errorf("拉起原生窗口失败：%w", err)
			}
			_ = cmd.Process.Release()
			return nil, nil
		}
	}

	browser := chromiumPath()
	if browser == "" {
		fmt.Println("motie: 未发现 motie-shell 或 Chromium 系浏览器，回退系统默认浏览器打开")
		_ = exec.Command("xdg-open", url).Start()
		return nil, nil
	}
	fmt.Println("motie: 未发现原生壳，回退 " + filepath.Base(browser) + " 应用窗口打开")
	cmd := exec.CommandContext(parent, browser, browserAppArgs(url)...)
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("打开浏览器失败：%w", err)
	}
	proc := &windowProc{done: make(chan struct{})}
	go func() {
		_ = cmd.Wait()
		close(proc.done)
	}()
	return proc, nil
}

var chromiumCandidates = []string{
	"chromium", "chromium-browser",
	"google-chrome", "google-chrome-stable",
	"microsoft-edge", "microsoft-edge-stable", "msedge",
	"brave", "brave-browser",
	"vivaldi", "vivaldi-stable",
	"opera",
}

/* chromiumPath 经 PATH 查找常见 Chromium 系浏览器。 */
func chromiumPath() string {
	for _, name := range chromiumCandidates {
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
	}
	return ""
}
