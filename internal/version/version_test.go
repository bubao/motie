package version

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

/* REST /api/app 与界面口径一致的前提：解析出的版本 == package.json == VERSION 文件。 */
func TestMatchesPackageJSON(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	var pkg struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(raw, &pkg); err != nil {
		t.Fatal(err)
	}
	if pkg.Version == "" {
		t.Fatal("package.json 缺少 version")
	}
	if got := ResolveVersion(); got != pkg.Version {
		t.Errorf("ResolveVersion() = %q，package.json = %q", got, pkg.Version)
	}
}

/* 多源回退链：ldflags 注入 > 内嵌内容 > 本地 VERSION 文件；占位值（dev/unknown）不视为注入。 */
func TestResolveVersionSources(t *testing.T) {
	orig := Version
	defer func() { Version = orig }()

	// ldflags 注入优先（含 v 前缀归一）
	Version = "v1.2.3"
	if got := ResolveVersion("9.9.9"); got != "1.2.3" {
		t.Fatalf("注入优先: got %q", got)
	}

	// 占位值视为未注入
	for _, ph := range []string{"", "dev", "unknown"} {
		Version = ph
		if got := ResolveVersion("0.4.5\n"); got != "0.4.5" {
			t.Fatalf("占位 %q 时应取内嵌: got %q", ph, got)
		}
	}

	// 内嵌内容（带 v 与换行）归一
	Version = ""
	if got := ResolveVersion("v0.6.7\n"); got != "0.6.7" {
		t.Fatalf("内嵌归一: got %q", got)
	}

	// 本地 VERSION 文件（切到临时目录避免受仓库影响）
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "VERSION"), []byte("0.8.1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	oldWD, _ := os.Getwd()
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = os.Chdir(oldWD) }()
	if got := ResolveVersion(""); got != "0.8.1" {
		t.Fatalf("本地 VERSION 文件: got %q", got)
	}
}

/* 无任何来源时兜底 0.0.1（临时目录 + 无内嵌 + 注入占位）。 */
func TestResolveVersionFallback(t *testing.T) {
	orig := Version
	defer func() { Version = orig }()
	Version = ""

	dir := t.TempDir()
	oldWD, _ := os.Getwd()
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = os.Chdir(oldWD) }()

	got := ResolveVersion("")
	if got == "" || got == "dev" || got == "unknown" {
		t.Fatalf("兜底不应为空/占位: %q", got)
	}
}
