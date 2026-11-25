package main

import (
	"path/filepath"
	"strings"
	"testing"
)

/* TestBrowserProfileDir：固定使用 <UserCacheDir>/motie/browser-profile。 */
func TestBrowserProfileDir(t *testing.T) {
	dir := browserProfileDir()
	if dir == "" {
		t.Fatal("browserProfileDir 返回空路径")
	}
	if !filepath.IsAbs(dir) {
		t.Errorf("期望绝对路径，实际 %q", dir)
	}
	if filepath.Base(filepath.Dir(dir)) != "motie" || filepath.Base(dir) != "browser-profile" {
		t.Errorf("profile 路径不符合 motie/browser-profile 约定：%q", dir)
	}
}

/* TestBrowserAppArgs：--app=URL + 独立 user-data-dir + 跳过首启/默认浏览器检查。 */
func TestBrowserAppArgs(t *testing.T) {
	const url = "http://127.0.0.1:39130/"
	args := browserAppArgs(url)
	want := []string{
		"--app=" + url,
		"--user-data-dir=" + browserProfileDir(),
		"--no-first-run",
		"--no-default-browser-check",
	}
	if len(args) != len(want) {
		t.Fatalf("参数个数 %d，期望 %d：%v", len(args), len(want), args)
	}
	for i := range want {
		if args[i] != want[i] {
			t.Errorf("args[%d]=%q，期望 %q", i, args[i], want[i])
		}
	}
	if !strings.HasPrefix(args[0], "--app=http") {
		t.Errorf("--app 参数异常：%q", args[0])
	}
}
