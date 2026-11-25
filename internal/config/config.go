// Package config 是桌面端用户偏好的单一事实源（SSOT）：JSON 落盘于
// os.UserConfigDir()/motie/config.json。字段契约见 internal/domain.Config。
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"motie/internal/domain"
)

const (
	appName     = "motie"
	DefaultPort = 39130
	DefaultBind = "127.0.0.1"
)

// AppConfigDir 返回配置目录。每次实时计算（os.UserConfigDir 无共享状态，
// 天然并发安全），从而在测试 / 多配置目录下都取到当前值。
func AppConfigDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("user config dir: %w", err)
	}
	return filepath.Join(base, appName), nil
}

// ConfigPath 返回配置文件绝对路径。
func ConfigPath() (string, error) {
	dir, err := AppConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.json"), nil
}

// DefaultConfig 与前端 web/src/core/config.js DEFAULTS、Swift defaultServerURL 三处对齐；
// 一致性由 config_test.go 跨文件断言保证。
func DefaultConfig() domain.Config {
	return domain.Config{
		Theme:        "system",
		Template:     "normal",
		ZgType:       "3",
		InkColor:     "cinnabar",
		InkAlpha:     0.62,
		FontWeight:   "normal",
		FontSource:   domain.FontSource{Type: "default"},
		ResourceMode: "cdn",
		Page:         domain.PageSize{Width: 210, Height: 297},
		Margin:       domain.Margin{Top: 5, Right: 16, Bottom: 5, Left: 16},
		DefaultPort:  DefaultPort,
		BindAddr:     DefaultBind,
	}
}

var (
	themes        = []string{"light", "dark", "system"}
	templates     = []string{"normal", "trace", "trace3", "lead", "rhythm", "blank"}
	zgTypes       = []string{"1", "2", "3", "4", "5", "6", "7"}
	inkColors     = []string{"cinnabar", "ink", "ochre"}
	fontWeights   = []string{"normal", "bold"}
	resourceModes = []string{"cdn", "local"}
	fontSrcTypes  = []string{"default", "url", "local", "system"}
)

func oneOf(v string, list []string, fallback string) string {
	for _, x := range list {
		if v == x {
			return v
		}
	}
	return fallback
}

/* clampF / clampI 与前端 normalizeField(int/percent) 同语义：越界夹取到边界。 */
func clampF(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// Normalize 逐字段校验 / 夹取，非法值回退默认（与前端 normalizeField 同语义）。
func Normalize(c domain.Config) domain.Config {
	d := DefaultConfig()
	c.Theme = oneOf(c.Theme, themes, d.Theme)
	c.Template = oneOf(c.Template, templates, d.Template)
	c.ZgType = oneOf(c.ZgType, zgTypes, d.ZgType)
	c.InkColor = oneOf(c.InkColor, inkColors, d.InkColor)
	c.InkAlpha = clampF(c.InkAlpha, 0.15, 1)
	c.FontWeight = oneOf(c.FontWeight, fontWeights, d.FontWeight)
	c.ResourceMode = oneOf(c.ResourceMode, resourceModes, d.ResourceMode)
	c.FontSource.Type = oneOf(c.FontSource.Type, fontSrcTypes, d.FontSource.Type)
	if strings.TrimSpace(c.BindAddr) == "" {
		c.BindAddr = d.BindAddr
	} else {
		c.BindAddr = strings.TrimSpace(c.BindAddr)
	}
	/* 端口非法（含 0）回退默认，由 serve 层做占用顺延。 */
	if c.DefaultPort < 1 || c.DefaultPort > 65535 {
		c.DefaultPort = d.DefaultPort
	}
	c.Page.Width = clampF(c.Page.Width, 50, 600)
	c.Page.Height = clampF(c.Page.Height, 50, 600)
	c.Margin.Top = clampF(c.Margin.Top, 0, 60)
	c.Margin.Right = clampF(c.Margin.Right, 0, 60)
	c.Margin.Bottom = clampF(c.Margin.Bottom, 0, 60)
	c.Margin.Left = clampF(c.Margin.Left, 0, 60)
	return c
}

// Load 读取配置；文件缺失返回默认配置。字段缺失保持默认，未知键忽略。
func Load() (domain.Config, error) {
	dir, err := AppConfigDir()
	if err != nil {
		return domain.Config{}, err
	}
	return LoadFrom(dir)
}

/* LoadFrom 从指定目录读取（组合根注入配置根用）。 */
func LoadFrom(dir string) (domain.Config, error) {
	path := filepath.Join(dir, "config.json")
	cfg := DefaultConfig()
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return cfg, nil
	}
	if err != nil {
		return domain.Config{}, fmt.Errorf("read config: %w", err)
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return cfg, nil
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return domain.Config{}, fmt.Errorf("parse config %s: %w", path, err)
	}
	return Normalize(cfg), nil
}

// Save 原子写入（同目录临时文件 + rename），目录 0700 / 文件 0600。
func Save(c domain.Config) error {
	dir, err := AppConfigDir()
	if err != nil {
		return err
	}
	return SaveTo(dir, c)
}

/* SaveTo 写入指定目录（组合根注入配置根用）。 */
func SaveTo(dir string, c domain.Config) error {
	c = Normalize(c)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("mkdir config dir: %w", err)
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".config-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp config: %w", err)
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("chmod temp config: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write temp config: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp config: %w", err)
	}
	if err := os.Rename(tmpName, filepath.Join(dir, "config.json")); err != nil {
		return fmt.Errorf("rename config: %w", err)
	}
	return nil
}
