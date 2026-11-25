// Package kindle 提供「导出 Kindle 版」：把内嵌的 lite/index.html（零依赖单文件）
// 复制到应用的 export/ 目录，供拷贝到 Kindle / 断网环境 file:// 直开。
package kindle

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

const (
	entryName      = "index.html"
	ExportFileName = "墨帖-lite.html" // 固定安全文件名，无路径分隔与非法字符
)

var ErrUnavailable = errors.New("内置 lite 版本不可用")

type Service struct {
	liteFS fs.FS  // embed 的 lite/ 子树
	dir    string // 默认导出目录（应用数据目录/export）
}

func New(liteFS fs.FS, dir string) *Service { return &Service{liteFS: liteFS, dir: dir} }

/* Export 复制 lite/index.html 到默认目录；同名覆盖。返回绝对路径。 */
func (s *Service) Export() (string, error) {
	if s.liteFS == nil {
		return "", ErrUnavailable
	}
	dir := s.dir
	data, err := fs.ReadFile(s.liteFS, entryName)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if dir == "" {
		return "", errors.New("未配置导出目录")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("mkdir export dir: %w", err)
	}
	dst := filepath.Join(dir, ExportFileName)
	if err := os.WriteFile(dst, data, 0o600); err != nil {
		return "", fmt.Errorf("write kindle export: %w", err)
	}
	abs, err := filepath.Abs(dst)
	if err != nil {
		abs = dst
	}
	return abs, nil
}
