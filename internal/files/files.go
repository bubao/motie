// Package files 负责字帖内容文件（txt / md）的读写与最近文件列表。
// 路径安全：仅接受绝对路径、限定扩展名、拒绝 NUL 与目录穿越形态。
package files

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"motie/internal/domain"
)

var allowedExt = map[string]bool{".txt": true, ".md": true}

const maxRecent = 20

// ErrUnsafePath 表示路径未通过安全校验。
var ErrUnsafePath = errors.New("unsafe file path")

/* SafePath 校验并清洗路径：绝对路径、合法扩展名、无 NUL、无目录穿越残留。 */
func SafePath(path string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("%w: 空路径", ErrUnsafePath)
	}
	if strings.ContainsRune(path, 0) {
		return "", fmt.Errorf("%w: 含 NUL", ErrUnsafePath)
	}
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("%w: 需绝对路径", ErrUnsafePath)
	}
	clean := filepath.Clean(path)
	if strings.Contains(clean, "..") {
		return "", fmt.Errorf("%w: 目录穿越", ErrUnsafePath)
	}
	if !allowedExt[strings.ToLower(filepath.Ext(clean))] {
		return "", fmt.Errorf("%w: 仅支持 .txt / .md", ErrUnsafePath)
	}
	return clean, nil
}

/* ResolveScoped 把前端传入的相对路径解析到 base 下的受控子树：
 * 仅允许相对路径、限定顶层目录（如 workspace / export）、限定扩展名。
 * 用于桌面端——前端永远拿不到任意绝对路径，杜绝越界读写。 */
func ResolveScoped(base string, allowedTop []string, p string) (string, error) {
	if p == "" {
		return "", fmt.Errorf("%w: 空路径", ErrUnsafePath)
	}
	if strings.ContainsRune(p, 0) {
		return "", fmt.Errorf("%w: 含 NUL", ErrUnsafePath)
	}
	if filepath.IsAbs(p) || strings.HasPrefix(p, "/") {
		return "", fmt.Errorf("%w: 不接受绝对路径", ErrUnsafePath)
	}
	clean := filepath.Clean(p)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: 目录穿越", ErrUnsafePath)
	}
	top := strings.Split(clean, string(filepath.Separator))[0]
	ok := false
	for _, t := range allowedTop {
		if t == top {
			ok = true
			break
		}
	}
	if !ok {
		return "", fmt.Errorf("%w: 仅允许目录 %v", ErrUnsafePath, allowedTop)
	}
	if !allowedExt[strings.ToLower(filepath.Ext(clean))] {
		return "", fmt.Errorf("%w: 仅支持 .txt / .md", ErrUnsafePath)
	}
	full := filepath.Join(base, clean)
	/* 二次校验：拼接后仍在 base 内（防御性） */
	rel, err := filepath.Rel(base, full)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: 越出根目录", ErrUnsafePath)
	}
	return full, nil
}

type RecentStore interface {
	Load() ([]string, error)
	Save([]string) error
}

/* FileRecentStore 把最近文件列表落在配置目录 recents.json。 */
type FileRecentStore struct{ Path string }

func (s FileRecentStore) Load() ([]string, error) {
	data, err := os.ReadFile(s.Path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var list []string
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, fmt.Errorf("parse recents: %w", err)
	}
	return list, nil
}

func (s FileRecentStore) Save(list []string) error {
	if err := os.MkdirAll(filepath.Dir(s.Path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.Path, data, 0o600)
}

type Service struct {
	mu     sync.Mutex
	store  RecentStore
	recent []string
	/* 桌面端受控子树（可选）：非空时所有读写仅限 base 下 allowedTop 列出的目录，
	 * 且前端只能传相对路径。空 = 旧行为（绝对路径 + 通用安全校验）。 */
	base       string
	allowedTop []string
}

func New(store RecentStore) (*Service, error) {
	return NewScoped(store, "", nil)
}

/* NewScoped 创建受控服务：base 为应用数据目录，allowedTop 为允许的顶层子目录
 * （如 "workspace" / "export"）。base 为空时退化为旧行为。 */
func NewScoped(store RecentStore, base string, allowedTop []string) (*Service, error) {
	s := &Service{store: store, base: base, allowedTop: allowedTop}
	if store != nil {
		list, err := store.Load()
		if err != nil {
			return nil, err
		}
		s.recent = s.sanitizeList(list)
	}
	return s, nil
}

/* sanitizeList 过滤掉已不存在 / 非安全路径的条目；落库条目统一为 displayPath 口径。 */
func (s *Service) sanitizeList(list []string) []string {
	out := make([]string, 0, len(list))
	seen := map[string]bool{}
	for _, p := range list {
		clean, err := s.resolve(p)
		if err != nil || seen[clean] {
			continue
		}
		if _, err := os.Stat(clean); err != nil {
			continue // 文件已不存在
		}
		seen[clean] = true
		out = append(out, s.displayPath(clean))
	}
	return out
}

/* displayPath 把内核绝对路径转成对前端暴露的路径：受控模式返回 base 下的相对路径
 * （前端只能持有 / 回传相对路径，与 ResolveScoped 的入参口径一致），否则原样返回。 */
func (s *Service) displayPath(clean string) string {
	if s.base == "" {
		return clean
	}
	rel, err := filepath.Rel(s.base, clean)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return clean
	}
	return rel
}

/* resolve 按配置选择校验策略：受控模式走 ResolveScoped，否则走 SafePath。 */
func (s *Service) resolve(p string) (string, error) {
	if s.base == "" {
		return SafePath(p)
	}
	return ResolveScoped(s.base, s.allowedTop, p)
}

/* Read 读取 txt / md 内容（路径先经安全校验）。 */
func (s *Service) Read(path string) (domain.WorkspaceFile, error) {
	clean, err := s.resolve(path)
	if err != nil {
		return domain.WorkspaceFile{}, err
	}
	data, err := os.ReadFile(clean)
	if err != nil {
		return domain.WorkspaceFile{}, err
	}
	info, err := os.Stat(clean)
	if err != nil {
		return domain.WorkspaceFile{}, err
	}
	return domain.WorkspaceFile{
		Path:    s.displayPath(clean),
		Content: string(data),
		ModTime: info.ModTime().UTC().Format("2006-01-02T15:04:05Z07:00"),
	}, nil
}

/* Write 保存内容并把路径记入最近文件（新路径置顶）。 */
func (s *Service) Write(f domain.WorkspaceFile) error {
	clean, err := s.resolve(f.Path)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(clean), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(clean, []byte(f.Content), 0o600); err != nil {
		return err
	}
	s.pushRecent(s.displayPath(clean))
	return nil
}

func (s *Service) pushRecent(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := make([]string, 0, maxRecent)
	list = append(list, path)
	for _, p := range s.recent {
		if p != path {
			list = append(list, p)
		}
		if len(list) >= maxRecent {
			break
		}
	}
	s.recent = list
	if s.store != nil {
		_ = s.store.Save(list)
	}
}

/* ListRecent 按「最近打开在前」返回（新路径在 pushRecent 处置顶）。 */
func (s *Service) ListRecent() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, len(s.recent))
	copy(out, s.recent)
	return out
}
