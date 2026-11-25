//go:build linux

package fonts

import "os"

/* SystemFontDirs 返回 fontconfig 标准字体目录（用户级 + 系统级）。
 * 扫描仅读取名称表，不复制任何文件；缺失目录由 scan 跳过。 */
func SystemFontDirs() []string {
	dirs := []string{"/usr/share/fonts", "/usr/local/share/fonts"}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		dirs = append([]string{home + "/.fonts", home + "/.local/share/fonts"}, dirs...)
	}
	return dirs
}
