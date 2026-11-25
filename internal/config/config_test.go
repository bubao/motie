package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
)

/* 每个用例独立配置目录。darwin 的 os.UserConfigDir 取
 * $HOME/Library/Application Support，故重定向 HOME。 */
func useTempDir(t *testing.T) string {
	t.Helper()
	home := filepath.Join(t.TempDir(), "home")
	t.Setenv("HOME", home)
	return filepath.Join(home, "Library", "Application Support", appName)
}

/* 默认值必须与前端 web/src/core/config.js DEFAULTS 逐字段一致（三处一致性的 Go 侧保障；
 * Swift defaultServerURL 待 native_macos 落地后补测）。 */
func TestDefaultConfigMatchesFrontendDefaults(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "web", "src", "core", "config.js"))
	if err != nil {
		t.Fatalf("读取前端 config.js：%v", err)
	}
	text := string(src)

	str := func(re string) string {
		m := regexp.MustCompile(re).FindStringSubmatch(text)
		if len(m) < 2 {
			t.Fatalf("config.js 中未找到 %s", re)
		}
		return strings.Trim(m[1], `'"`)
	}
	num := func(re string) float64 {
		v, err := strconv.ParseFloat(str(re), 64)
		if err != nil {
			t.Fatalf("解析 %s：%v", re, err)
		}
		return v
	}

	cfg := DefaultConfig()
	if cfg.Theme != str(`Theme:\s*'([^']+)'`) {
		t.Errorf("Theme = %q", cfg.Theme)
	}
	if cfg.Template != str(`Template:\s*'([^']+)'`) {
		t.Errorf("Template = %q", cfg.Template)
	}
	if cfg.ZgType != str(`ZgType:\s*'([^']+)'`) {
		t.Errorf("ZgType = %q", cfg.ZgType)
	}
	if cfg.InkColor != str(`InkColor:\s*'([^']+)'`) {
		t.Errorf("InkColor = %q", cfg.InkColor)
	}
	if cfg.InkAlpha != num(`InkAlpha:\s*([0-9.]+)`) {
		t.Errorf("InkAlpha = %v", cfg.InkAlpha)
	}
	if cfg.FontWeight != str(`FontWeight:\s*'([^']+)'`) {
		t.Errorf("FontWeight = %q", cfg.FontWeight)
	}
	if cfg.FontSource.Type != str(`FontSource:\s*\{\s*type:\s*'([^']+)'`) {
		t.Errorf("FontSource.Type = %q", cfg.FontSource.Type)
	}
	if cfg.Page.Width != num(`width:\s*([0-9.]+),\s*height`) || cfg.Page.Height != num(`height:\s*([0-9.]+)\s*\},\s*/\* 纸张`) {
		t.Errorf("Page = %v", cfg.Page)
	}
	if cfg.Margin.Top != num(`Margin:\s*\{\s*top:\s*([0-9.]+)`) ||
		cfg.Margin.Right != num(`right:\s*([0-9.]+)`) ||
		cfg.Margin.Bottom != num(`bottom:\s*([0-9.]+)`) ||
		cfg.Margin.Left != num(`left:\s*([0-9.]+)`) {
		t.Errorf("Margin = %v", cfg.Margin)
	}
	/* 桌面端自有字段（架构约定，无前端常量） */
	if cfg.DefaultPort != 39130 || cfg.BindAddr != "127.0.0.1" {
		t.Errorf("DefaultPort/BindAddr = %d/%q", cfg.DefaultPort, cfg.BindAddr)
	}
}

func TestLoadMissingReturnsDefaults(t *testing.T) {
	useTempDir(t)
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg != DefaultConfig() {
		t.Errorf("缺省文件应返回 DefaultConfig，实际 %+v", cfg)
	}
}

func TestSaveLoadRoundTrip(t *testing.T) {
	dir := useTempDir(t)
	cfg := DefaultConfig()
	cfg.Theme = "dark"
	cfg.InkAlpha = 0.9
	cfg.Margin.Left = 8
	if err := Save(cfg); err != nil {
		t.Fatal(err)
	}
	got, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if got != cfg {
		t.Errorf("往返不一致：%+v vs %+v", got, cfg)
	}
	/* 权限：目录 0700、文件 0600 */
	info, err := os.Stat(filepath.Join(dir, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("config.json 权限 = %o，期望 600", perm)
	}
	dinfo, err := os.Stat(dir)
	if err != nil {
		t.Fatal(err)
	}
	if perm := dinfo.Mode().Perm(); perm != 0o700 {
		t.Errorf("配置目录权限 = %o，期望 700", perm)
	}
}

func TestNormalizeInvalidFallsBack(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Theme = "blue"
	cfg.Template = "nope"
	cfg.ZgType = "9"
	cfg.ResourceMode = "offline"
	cfg.FontSource.Type = "weird"
	cfg.DefaultPort = 0
	cfg.BindAddr = "  "
	got := Normalize(cfg)
	d := DefaultConfig()
	if got.Theme != d.Theme || got.Template != d.Template || got.ZgType != d.ZgType ||
		got.ResourceMode != d.ResourceMode || got.FontSource.Type != d.FontSource.Type {
		t.Errorf("非法枚举未回退默认：%+v", got)
	}
	if got.DefaultPort != DefaultPort || got.BindAddr != DefaultBind {
		t.Errorf("端口/绑定未回退默认：%d/%q", got.DefaultPort, got.BindAddr)
	}
}

func TestNormalizeClamps(t *testing.T) {
	cfg := DefaultConfig()
	cfg.InkAlpha = 5
	cfg.Page.Width = 5
	cfg.Margin.Top = 999
	cfg.DefaultPort = 70000
	got := Normalize(cfg)
	if got.InkAlpha != 1 || got.Page.Width != 50 || got.Margin.Top != 60 || got.DefaultPort != DefaultPort {
		t.Errorf("夹取失效：alpha=%v pageW=%v marginT=%v port=%d",
			got.InkAlpha, got.Page.Width, got.Margin.Top, got.DefaultPort)
	}
}

/* 未知键忽略、缺失键保持默认（Unmarshal 到已初始化结构体） */
func TestLoadIgnoresUnknownFillsMissing(t *testing.T) {
	dir := useTempDir(t)
	raw := []byte(`{"Theme":"light","Whatever":123,"Page":{"width":100}}`)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Theme != "light" {
		t.Errorf("Theme = %q", cfg.Theme)
	}
	d := DefaultConfig()
	if cfg.Template != d.Template || cfg.Page.Height != d.Page.Height || cfg.Margin.Top != d.Margin.Top {
		t.Errorf("缺失字段未保持默认：%+v", cfg)
	}
	if cfg.Page.Width != 100 {
		t.Errorf("Page.width = %v", cfg.Page.Width)
	}
}

/* JSON 序列化键集合与 domain 契约一致（防 tag 漂移） */
func TestSavedJSONKeys(t *testing.T) {
	useTempDir(t)
	if err := Save(DefaultConfig()); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(AppConfigDirMust(t), "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"Theme", "ZgType", "FontSource", "Page", "Margin", "DefaultPort", "BindAddr"} {
		if _, ok := m[k]; !ok {
			t.Errorf("保存的 JSON 缺少键 %q", k)
		}
	}
}

func AppConfigDirMust(t *testing.T) string {
	t.Helper()
	dir, err := AppConfigDir()
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

/* 并发 Save 不 panic、不产生临时残留（-race 下验证原子写） */
func TestConcurrentSave(t *testing.T) {
	useTempDir(t)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			cfg := DefaultConfig()
			cfg.InkAlpha = 0.2 + float64(i)*0.05
			if err := Save(cfg); err != nil {
				t.Errorf("Save: %v", err)
			}
		}(i)
	}
	wg.Wait()
	entries, err := os.ReadDir(AppConfigDirMust(t))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Errorf("残留临时文件：%s", e.Name())
		}
	}
	if _, err := Load(); err != nil {
		t.Errorf("并发写后仍可加载：%v", err)
	}
}
