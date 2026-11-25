// Package workspace 承载桌面端工作区状态：版式预设的持久化。
// 内容与光标由前端状态承担（导入导出见 files，最近文件见 files recents），
// 本服务只负责「具名预设」的保存 / 载入 / 列表 / 改名 / 删除。
package workspace

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

var (
	ErrBadName = errors.New("预设名称无效")
	ErrNoExist = errors.New("预设不存在")
)

type PresetService struct {
	path string // presets.json

	mu   sync.Mutex
	data map[string]any
}

func NewPresetService(path string) *PresetService {
	return &PresetService{path: path}
}

// validName 过滤路径分隔与空名（预设名是展示键，不做文件系统映射）。
func validName(name string) bool {
	if strings.TrimSpace(name) == "" || name != strings.TrimSpace(name) {
		return false
	}
	if len([]rune(name)) > 60 {
		return false
	}
	return !strings.ContainsAny(name, "/\\\x00")
}

func (s *PresetService) loadLocked() (map[string]any, error) {
	if s.data != nil {
		return s.data, nil
	}
	m := map[string]any{}
	raw, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		s.data = m
		return s.data, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read presets: %w", err)
	}
	if len(strings.TrimSpace(string(raw))) > 0 {
		if err := json.Unmarshal(raw, &m); err != nil {
			return nil, fmt.Errorf("parse presets %s: %w", s.path, err)
		}
	}
	if m == nil {
		m = map[string]any{}
	}
	s.data = m
	return s.data, nil
}

func (s *PresetService) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("mkdir presets dir: %w", err)
	}
	data, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal presets: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".presets-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp presets: %w", err)
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("chmod temp presets: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write temp presets: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp presets: %w", err)
	}
	if err := os.Rename(tmpName, s.path); err != nil {
		return fmt.Errorf("rename presets: %w", err)
	}
	return nil
}

/* List 返回全部预设（副本，避免调用方改内部状态）。 */
func (s *PresetService) List() (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, err := s.loadLocked()
	if err != nil {
		return nil, err
	}
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out, nil
}

/* Save 覆盖同名预设。 */
func (s *PresetService) Save(name string, data any) error {
	if !validName(name) {
		return ErrBadName
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	m, err := s.loadLocked()
	if err != nil {
		return err
	}
	m[name] = data
	return s.saveLocked()
}

func (s *PresetService) Delete(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, err := s.loadLocked()
	if err != nil {
		return err
	}
	if _, ok := m[name]; !ok {
		return ErrNoExist
	}
	delete(m, name)
	return s.saveLocked()
}

/* Rename 保留原数据；目标已存在时拒绝（不静默覆盖）。 */
func (s *PresetService) Rename(oldName, next string) error {
	if !validName(next) {
		return ErrBadName
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	m, err := s.loadLocked()
	if err != nil {
		return err
	}
	data, ok := m[oldName]
	if !ok {
		return ErrNoExist
	}
	if _, exists := m[next]; exists {
		return fmt.Errorf("预设「%s」已存在", next)
	}
	delete(m, oldName)
	m[next] = data
	return s.saveLocked()
}
