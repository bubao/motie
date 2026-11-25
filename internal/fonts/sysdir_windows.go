//go:build windows

package fonts

import (
	"os"
	"path/filepath"
)

/* SystemFontDirs 返回 Windows 标准字体目录（系统级 + 当前用户级）。
 * 扫描仅读取名称表，不复制任何文件；缺失目录由 scan 跳过。 */
func SystemFontDirs() []string {
	var dirs []string
	if root := os.Getenv("SystemRoot"); root != "" {
		dirs = append(dirs, filepath.Join(root, "Fonts"))
	} else if windir := os.Getenv("windir"); windir != "" {
		dirs = append(dirs, filepath.Join(windir, "Fonts"))
	}
	if local := os.Getenv("LOCALAPPDATA"); local != "" {
		dirs = append(dirs, filepath.Join(local, "Microsoft", "Windows", "Fonts"))
	}
	return dirs
}
