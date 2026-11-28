// Package version 提供构建信息解析：以仓库根 VERSION 文件为单一手写真相源，
// 编译期可用 -ldflags -X 覆盖（main.* 与 motie/internal/version.* 同名注入）。
//
// 解析优先级见 ResolveVersion；版本输出统一不带 "v" 前缀（沿用 motie 既有口径），
// 与 package.json / VERSION / Info.plist / REST 元信息保持一致。
package version

import (
	"os"
	"os/exec"
	"runtime/debug"
	"strings"
)

var (
	// Version 由 -X motie/internal/version.Version=... 注入；空则按 ResolveVersion 链解析。
	Version string
	// GitCommit / BuildDate 由 -X 注入，缺省 dev / unknown（仅诊断展示用）。
	GitCommit = "dev"
	BuildDate = "unknown"
)

/* Get 返回当前生效版本（无 v 前缀）。 */
func Get() string { return ResolveVersion() }

/*
ResolveVersion 动态计算并返回当前运行环境的真实版本号（无 v 前缀）：

 1. 编译时 -ldflags 注入 Version（打包权威版本）
 2. 传入的内嵌 VERSION 内容（go:embed，与源码 100% 同步）
 3. 本地根目录 VERSION 文件
 4. Go module 构建元数据 runtime/debug.ReadBuildInfo()
 5. Git 本地最新 Tag（git describe --tags --abbrev=0）
 6. 兜底 "0.0.1"
*/
func ResolveVersion(embedded ...string) string {
	if v := normalize(Version); v != "" {
		return v
	}
	for _, e := range embedded {
		if v := normalize(e); v != "" {
			return v
		}
	}
	if data, err := os.ReadFile("VERSION"); err == nil {
		if v := normalize(string(data)); v != "" {
			return v
		}
	}
	if info, ok := debug.ReadBuildInfo(); ok {
		if mv := normalize(info.Main.Version); mv != "" && mv != "devel" {
			return mv
		}
	}
	if out, err := exec.Command("git", "describe", "--tags", "--abbrev=0").Output(); err == nil {
		if v := normalize(string(out)); v != "" {
			return v
		}
	}
	return "0.0.1"
}

/* normalize 去空白与可选 v 前缀；占位值（空 / dev / unknown / (devel)）视为未注入。 */
func normalize(s string) string {
	s = strings.TrimSpace(s)
	if s == "" || s == "dev" || s == "unknown" || s == "(devel)" {
		return ""
	}
	return strings.TrimPrefix(s, "v")
}
