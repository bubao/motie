//go:build windows

package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

/* openWindowPlatform：若与主程序同目录存在原生壳 motie-shell.exe（WebView2 宿主），
 * 优先拉起。该壳尚未随仓库 / 分发包提供（mac 有 Motie.app，见 native_macos/main.swift），
 * 故当前一律回退 Chromium 系浏览器 --app 独立窗口（Edge/Chrome/Brave/Vivaldi/Opera）；
 * 均无则系统默认浏览器。此处保留壳挂载点，壳就位后调用方无需改动。
 *
 * 原生壳返回 nil（生命周期由壳自身管理）；浏览器分支返回可跟踪进程——关闭即取消主 Context；
 * opener（cmd /c start）不可跟踪，同样返回 nil，避免命令立即退出被误判为关窗而杀掉服务。 */
func openWindowPlatform(parent context.Context, url string) (*windowProc, error) {
	if exe, err := os.Executable(); err == nil {
		shell := filepath.Join(filepath.Dir(exe), "motie-shell.exe")
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
		fmt.Println("motie: 未发现 motie-shell.exe 或 Chromium 系浏览器，回退系统默认浏览器打开")
		_ = exec.Command("cmd", "/c", "start", url).Start()
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

/* chromiumPath 在常见安装位置查找 Chromium 系浏览器（系统级 / 用户级）。 */
func chromiumPath() string {
	var bases []string
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
		if v := os.Getenv(env); v != "" {
			bases = append(bases, v)
		}
	}
	rels := [][2]string{
		{`Microsoft\Edge\Application`, "msedge.exe"},
		{`Google\Chrome\Application`, "chrome.exe"},
		{`BraveSoftware\Brave-Browser\Application`, "brave.exe"},
		{`Vivaldi\Application`, "vivaldi.exe"},
		{`Programs\Opera`, "launcher.exe"},
	}
	for _, base := range bases {
		for _, rel := range rels {
			p := filepath.Join(base, rel[0], rel[1])
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				return p
			}
		}
	}
	return ""
}
