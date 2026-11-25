package fonts

import (
	"encoding/binary"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

/* 字体文件扩展名白名单（与前端 FontManager FONT_EXT_RE 一致）。 */
var FontExts = map[string]bool{
	".ttf":   true,
	".otf":   true,
	".woff":  true,
	".woff2": true,
}

/* ---------- sfnt name 表解析（仅取家族名，不复制文件） ----------
 *
 * 支持 ttf（0x00010000）、otf（'OTTO'）与 ttc（'ttcf'，取集合首个子字体）。
 * 只解析 name 表中的 nameID=1（Family），缺失时回退 4（Full name）。
 * platform 3（Windows）为 UTF-16BE；platform 1（Mac）按原字节输出（英文可辨）。 */

var errNotFont = errors.New("not a font file")

type tableDir struct {
	offset, length uint32
}

// readTableDir 读 sfnt 头与表目录（12 + 16*numTables 字节，无需整文件）。
func readTableDir(f *os.File) (map[string]tableDir, error) {
	var head [12]byte
	if _, err := io.ReadFull(f, head[:]); err != nil {
		return nil, errNotFont
	}
	ver := binary.BigEndian.Uint32(head[0:4])
	if ver == 0x74746366 /* ttcf */ {
		var ttc [8]byte // version(4) + numFonts(4)
		if _, err := io.ReadFull(f, ttc[:]); err != nil {
			return nil, errNotFont
		}
		var offBuf [4]byte
		if _, err := io.ReadFull(f, offBuf[:]); err != nil {
			return nil, errNotFont
		}
		if _, err := f.Seek(int64(binary.BigEndian.Uint32(offBuf[:])), io.SeekStart); err != nil {
			return nil, errNotFont
		}
		if _, err := io.ReadFull(f, head[:]); err != nil {
			return nil, errNotFont
		}
		ver = binary.BigEndian.Uint32(head[0:4])
	}
	if ver != 0x00010000 && ver != 0x4F54544F /* OTTO */ {
		return nil, errNotFont
	}
	numTables := int(binary.BigEndian.Uint16(head[4:6]))
	buf := make([]byte, 16*numTables)
	if _, err := io.ReadFull(f, buf); err != nil {
		return nil, errNotFont
	}
	dir := make(map[string]tableDir, numTables)
	for i := 0; i < numTables; i++ {
		rec := buf[i*16 : (i+1)*16]
		dir[string(rec[0:4])] = tableDir{
			offset: binary.BigEndian.Uint32(rec[8:12]),
			length: binary.BigEndian.Uint32(rec[12:16]),
		}
	}
	return dir, nil
}

type nameRec struct{ platform, nameID, length, off int }

// parseNameTable 从 name 表字节中提取家族名（nameID=1 优先，回退 4）。
func parseNameTable(data []byte) string {
	if len(data) < 6 {
		return ""
	}
	count := int(binary.BigEndian.Uint16(data[2:4]))
	stringOff := int(binary.BigEndian.Uint16(data[4:6]))
	if stringOff > len(data) {
		return ""
	}
	fam, full := -1, -1
	var recs []nameRec
	for i := 0; i < count; i++ {
		base := 6 + i*12
		if base+12 > len(data) {
			break
		}
		r := nameRec{
			platform: int(binary.BigEndian.Uint16(data[base : base+2])),
			nameID:   int(binary.BigEndian.Uint16(data[base+6 : base+8])),
			length:   int(binary.BigEndian.Uint16(data[base+8 : base+10])),
			off:      stringOff + int(binary.BigEndian.Uint16(data[base+10:base+12])),
		}
		if r.off < 0 || r.off+r.length > len(data) {
			continue
		}
		switch {
		case r.nameID == 1 && (fam < 0 || preferPlatform(r.platform, recs[fam].platform)):
			fam = len(recs)
		case r.nameID == 4 && (full < 0 || preferPlatform(r.platform, recs[full].platform)):
			full = len(recs)
		}
		recs = append(recs, r)
	}
	if fam >= 0 {
		return decodeName(data[recs[fam].off:recs[fam].off+recs[fam].length], recs[fam].platform)
	}
	if full >= 0 {
		return decodeName(data[recs[full].off:recs[full].off+recs[full].length], recs[full].platform)
	}
	return ""
}

// preferPlatform：同 nameID 多条时优先 Windows（UTF-16BE，覆盖中文族名）。
func preferPlatform(cand, cur int) bool {
	return cand == 3 && cur != 3
}

func decodeName(raw []byte, platform int) string {
	if len(raw) == 0 {
		return ""
	}
	var b strings.Builder
	if platform == 3 || platform == 0 { // Windows / Unicode：UTF-16BE
		for i := 0; i+1 < len(raw); i += 2 {
			u := binary.BigEndian.Uint16(raw[i : i+2])
			if u == 0xFEFF && i == 0 {
				continue // BOM
			}
			b.WriteRune(rune(u))
		}
	} else { // Mac Roman：按原字节输出（英文族名可辨）
		b.Write(raw)
	}
	return strings.TrimSpace(strings.ReplaceAll(b.String(), "\x00", ""))
}

/* ---------- 系统字体扫描（进程内一次，安装新字体重启后生效） ---------- */

type systemScanner struct {
	dirs []string
	once sync.Once
	list []string
}

func newSystemScanner(dirs []string) *systemScanner { return &systemScanner{dirs: dirs} }

/* familyNameOf 分段读取单个字体文件的家族名（避免整文件载入内存）。 */
func familyNameOf(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer func() { _ = f.Close() }()
	dir, err := readTableDir(f)
	if err != nil {
		return ""
	}
	tbl, ok := dir["name"]
	if !ok || tbl.offset >= (1<<31) || tbl.length >= (1<<24) { // 异常偏移 / 超 16MB 跳过
		return ""
	}
	buf := make([]byte, tbl.length)
	if _, err := f.ReadAt(buf, int64(tbl.offset)); err != nil {
		return ""
	}
	return parseNameTable(buf)
}

/* scan 递归收集目录下字体家族名（去重、排序）；首次调用后缓存。 */
func (s *systemScanner) scan() []string {
	s.once.Do(func() {
		seen := map[string]struct{}{}
		for _, root := range s.dirs {
			_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
				if err != nil || d.IsDir() {
					return nil // 无权限 / 缺失目录：跳过
				}
				if !FontExts[strings.ToLower(filepath.Ext(p))] {
					return nil
				}
				if name := familyNameOf(p); name != "" {
					seen[name] = struct{}{}
				}
				return nil
			})
		}
		out := make([]string, 0, len(seen))
		for name := range seen {
			out = append(out, name)
		}
		sort.Strings(out)
		s.list = out
	})
	return s.list
}

/* 测试辅助：构造只含 name 表的最小 sfnt 字节串（UTF-16BE 中文族名）。 */
func buildFakeFontBytes(name string) []byte {
	u16 := func(v uint16) []byte { b := make([]byte, 2); binary.BigEndian.PutUint16(b, v); return b }
	var str []byte
	for _, r := range name {
		str = append(str, byte(byte(r>>8)&0xFF), byte(r&0xFF))
	}
	var nt []byte
	nt = append(nt, u16(0)...)      // format
	nt = append(nt, u16(1)...)      // count
	nt = append(nt, u16(6+12)...)   // stringOffset
	nt = append(nt, u16(3)...)      // platformID: Windows
	nt = append(nt, u16(1)...)      // encodingID
	nt = append(nt, u16(0x0409)...) // languageID
	nt = append(nt, u16(1)...)      // nameID: Family
	nt = append(nt, u16(uint16(len(str)))...)
	nt = append(nt, u16(0)...) // offset
	nt = append(nt, str...)

	var out []byte
	out = append(out, 0x00, 0x01, 0x00, 0x00)                         // sfnt version 1.0
	out = append(out, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00) // numTables=1, 其余 0
	out = append(out, []byte("name")...)
	csum := uint32(0)
	for _, b := range nt {
		csum += uint32(b)
	}
	var cbuf [4]byte
	binary.BigEndian.PutUint32(cbuf[:], csum)
	out = append(out, cbuf[:]...)
	var obuf [4]byte
	binary.BigEndian.PutUint32(obuf[:], uint32(12+16))
	out = append(out, obuf[:]...)
	var lbuf [4]byte
	binary.BigEndian.PutUint32(lbuf[:], uint32(len(nt)))
	out = append(out, lbuf[:]...)
	out = append(out, nt...)
	return out
}
