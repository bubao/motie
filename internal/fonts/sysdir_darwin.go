//go:build darwin

package fonts

import "os"

/* SystemFontDirs 返回 macOS 标准字体目录（含用户库）。
 * 扫描仅读取名称表，不复制任何文件。 */
func SystemFontDirs() []string {
	dirs := []string{
		"/System/Library/Fonts",
		"/Library/Fonts",
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		dirs = append(dirs, home+"/Library/Fonts")
	}
	return dirs
}
