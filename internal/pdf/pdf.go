// Package pdf 接收前端光栅化的每页 JPEG，自写组装成 PDF 并落盘。
// 排版与光栅化仍在浏览器侧（web/src/core/pdf.js）；Go 只做拼装（ComposePDF）与原子写入。
package pdf

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Service struct {
	exportDir string
}

/* New 创建落盘服务；exportDir 为空时用配置目录下 pdf/。 */
func New(exportDir string) *Service {
	return &Service{exportDir: exportDir}
}

func (s *Service) Dir() string { return s.exportDir }

var unsafeChars = strings.NewReplacer(
	"/", "_", "\\", "_", ":", "_", "*", "_",
	"?", "_", "\"", "_", "<", "_", ">", "_", "|", "_",
	"\x00", "",
)

/* SafeFilename 清洗用户文件名：非法字符替换为 _，拒绝 . / .. 与空名，
 * 缺 .pdf 扩展名时补上；返回 basename（不含目录）。 */
func SafeFilename(name string) (string, error) {
	base := filepath.Base(strings.TrimSpace(name))
	if base == "." || base == ".." || base == "" {
		return "", fmt.Errorf("非法文件名 %q", name)
	}
	clean := unsafeChars.Replace(base)
	if clean == "" || clean == "." || clean == ".." {
		return "", fmt.Errorf("非法文件名 %q", name)
	}
	if !strings.HasSuffix(strings.ToLower(clean), ".pdf") {
		clean += ".pdf"
	}
	return clean, nil
}

/*
Export 把每页 JPEG 组装成 PDF（ComposePDF）并原子写入 exportDir/SafeFilename(filename)，
返回完整路径。pageW / pageH 为纸张尺寸（mm），由前端按版式真源传入。
*/
func (s *Service) Export(filename string, pages [][]byte, pageW, pageH float64) (string, error) {
	name, err := SafeFilename(filename)
	if err != nil {
		return "", err
	}
	data, err := ComposePDF(pages, pageW, pageH)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(s.exportDir, 0o700); err != nil {
		return "", err
	}
	full := filepath.Join(s.exportDir, name)
	tmp, err := os.CreateTemp(s.exportDir, ".pdf-*.tmp")
	if err != nil {
		return "", err
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(tmpName, full); err != nil {
		return "", err
	}
	return full, nil
}
