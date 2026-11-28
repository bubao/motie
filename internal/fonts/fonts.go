// Package fonts 提供桌面端字体库：macOS 系统字体扫描（仅名称，不复制文件）
// 与用户字体库（二进制落盘到应用数据目录 + JSON 索引）。
package fonts

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"motie/internal/domain"
)

// MaxFontSize 与前端 FontManager MAX_FONT_SIZE 一致（20MB）。
const MaxFontSize = domain.MaxFontFileSize

/* 个人字体标签上限：单标签字数与总个数（与前端 FONT_TAG_LIMITS 一致）。 */
const (
	maxTagRunes = 20
	maxFontTags = 8
)

var (
	ErrBadExt   = errors.New("不支持的字体格式（仅 ttf / otf / woff / woff2）")
	ErrTooLarge = errors.New("字体超过 20MB 上限")
	ErrNotFound = errors.New("字体不存在")
)

type Service struct {
	baseDir   string // 用户字体文件目录（AppConfigDir/fonts）
	indexPath string // 索引 JSON 路径
	scanner   *systemScanner

	mu    sync.RWMutex // 保护索引读写
	index []domain.FontEntry
}

/* New 创建字体服务。sysDirs 为系统字体扫描目录（darwin 注入，其余平台为空）。 */
func New(baseDir, indexPath string, sysDirs []string) *Service {
	return &Service{
		baseDir:   baseDir,
		indexPath: indexPath,
		scanner:   newSystemScanner(sysDirs),
	}
}

/* ---------- 系统字体 ---------- */

// ListSystem 返回去重排序后的系统字体家族名（进程内扫描一次，重启后刷新）。
func (s *Service) ListSystem() []domain.FontEntry {
	names := s.scanner.scan()
	out := make([]domain.FontEntry, 0, len(names))
	for _, n := range names {
		out = append(out, domain.FontEntry{Name: n, Source: "system", Enabled: true})
	}
	return out
}

/* ---------- 用户字体 ---------- */

// ListUser 读取索引；文件缺失或损坏时返回空列表（不阻断启动）。
func (s *Service) ListUser() ([]domain.FontEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.index != nil {
		out := make([]domain.FontEntry, len(s.index))
		copy(out, s.index)
		return out, nil
	}
	data, err := os.ReadFile(s.indexPath)
	if errors.Is(err, os.ErrNotExist) {
		return []domain.FontEntry{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read font index: %w", err)
	}
	var list []domain.FontEntry
	if len(strings.TrimSpace(string(data))) > 0 {
		if err := json.Unmarshal(data, &list); err != nil {
			return []domain.FontEntry{}, nil // 索引损坏按空库处理
		}
	}
	s.index = list
	out := make([]domain.FontEntry, len(list))
	copy(out, list)
	return out, nil
}

func (s *Service) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.indexPath), 0o700); err != nil {
		return fmt.Errorf("mkdir fonts dir: %w", err)
	}
	data, err := json.MarshalIndent(s.index, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal font index: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.indexPath), ".fonts-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp index: %w", err)
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("chmod temp index: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write temp index: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp index: %w", err)
	}
	if err := os.Rename(tmpName, s.indexPath); err != nil {
		return fmt.Errorf("rename font index: %w", err)
	}
	return nil
}

/* Add 落盘二进制并写入索引；name 为显示名（最长 60 字），ext 必须在白名单内。 */
func (s *Service) Add(name, ext string, data []byte) (domain.FontEntry, error) {
	ext = strings.ToLower(ext)
	if !FontExts[ext] {
		return domain.FontEntry{}, ErrBadExt
	}
	if len(data) == 0 || len(data) > MaxFontSize {
		return domain.FontEntry{}, ErrTooLarge
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = "未命名字体"
	}
	if runes := []rune(name); len(runes) > 60 {
		name = string(runes[:60])
	}
	id, err := newID()
	if err != nil {
		return domain.FontEntry{}, err
	}
	if err := os.MkdirAll(s.baseDir, 0o700); err != nil {
		return domain.FontEntry{}, fmt.Errorf("mkdir fonts dir: %w", err)
	}
	if err := os.WriteFile(filepath.Join(s.baseDir, id+ext), data, 0o600); err != nil {
		return domain.FontEntry{}, fmt.Errorf("write font file: %w", err)
	}
	entry := domain.FontEntry{
		ID:        id,
		Name:      name,
		Source:    "user",
		Size:      int64(len(data)),
		CreatedAt: time.Now().Format(time.RFC3339),
		Enabled:   true,
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.index = append(s.index, entry)
	if err := s.saveLocked(); err != nil {
		_ = os.Remove(filepath.Join(s.baseDir, id+ext)) // 回滚文件
		return domain.FontEntry{}, err
	}
	return entry, nil
}

// File 返回用户字体二进制与其扩展名（供 HTTP 直接输出）。
func (s *Service) File(id string) ([]byte, string, error) {
	if id == "" || !isSafeID(id) {
		return nil, "", ErrNotFound
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var hit *domain.FontEntry
	for i := range s.index {
		if s.index[i].ID == id {
			hit = &s.index[i]
			break
		}
	}
	if hit == nil {
		return nil, "", ErrNotFound
	}
	for ext := range FontExts {
		p := filepath.Join(s.baseDir, id+ext)
		data, err := os.ReadFile(p)
		if err == nil {
			return data, ext, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return nil, "", err
		}
	}
	return nil, "", ErrNotFound
}

// Remove 删除索引项与磁盘文件（文件缺失也视为成功）。
func (s *Service) Remove(id string) error {
	if id == "" || !isSafeID(id) {
		return ErrNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	idx := -1
	for i := range s.index {
		if s.index[i].ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		return ErrNotFound
	}
	s.index = append(s.index[:idx], s.index[idx+1:]...)
	if err := s.saveLocked(); err != nil {
		return err
	}
	for ext := range FontExts {
		_ = os.Remove(filepath.Join(s.baseDir, id+ext))
	}
	return nil
}

// UpdateTags 设置个人字体标签（trim、去空、去重；单个≤20 runes，总数≤8）。
func (s *Service) UpdateTags(id string, tags []string) error {
	clean := make([]string, 0, len(tags))
	seen := make(map[string]bool, len(tags))
	for _, t := range tags {
		t = strings.TrimSpace(t)
		if t == "" || seen[t] || len(clean) >= maxFontTags {
			continue
		}
		if runes := []rune(t); len(runes) > maxTagRunes {
			t = string(runes[:maxTagRunes])
		}
		seen[t] = true
		clean = append(clean, t)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.index {
		if s.index[i].ID == id {
			s.index[i].Tags = clean
			return s.saveLocked()
		}
	}
	return ErrNotFound
}

// Rename 只改显示名。
func (s *Service) Rename(id, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("名称不能为空")
	}
	if runes := []rune(name); len(runes) > 60 {
		name = string(runes[:60])
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.index {
		if s.index[i].ID == id {
			s.index[i].Name = name
			return s.saveLocked()
		}
	}
	return ErrNotFound
}

func isSafeID(id string) bool {
	if len(id) < 2 || len(id) > 64 || id[0] != 'f' {
		return false
	}
	for _, r := range id[1:] {
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'v') {
			return false
		}
	}
	return true
}

func newID() (string, error) {
	b := make([]byte, 5)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("rand id: %w", err)
	}
	return "f" + hex.EncodeToString(b), nil
}
