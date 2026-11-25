package fonts

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestParseFamilyName(t *testing.T) {
	cases := []struct{ in, want string }{
		{"苹方-简", "苹方-简"},
		{"Kaiti SC", "Kaiti SC"},
	}
	for _, c := range cases {
		if got := parseNameTable(nameTableOf(c.in)); got != c.want {
			t.Errorf("parseNameTable(%q) = %q，期望 %q", c.in, got, c.want)
		}
	}
	if got := parseNameTable(nil); got != "" {
		t.Errorf("空字节应返回空串，实际 %q", got)
	}
}

// nameTableOf 包一层 buildFakeFontBytes 的 name 段，便于直接测解析函数。
func nameTableOf(name string) []byte {
	full := buildFakeFontBytes(name)
	// sfnt：表目录在 12，name.offset 在记录 +8，length 在 +12
	off := int(full[12+8])<<24 | int(full[12+9])<<16 | int(full[12+10])<<8 | int(full[12+11])
	len := int(full[12+12])<<24 | int(full[12+13])<<16 | int(full[12+14])<<8 | int(full[12+15])
	return full[off : off+len]
}

func TestSystemScanDedupAndSort(t *testing.T) {
	dirA := t.TempDir()
	dirB := t.TempDir()
	writeFont := func(dir, file, family string) {
		p := filepath.Join(dir, file)
		if err := os.WriteFile(p, buildFakeFontBytes(family), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	writeFont(dirA, "a.ttf", "苹方-简")
	writeFont(dirA, "b.otf", "Songti SC")
	writeFont(dirB, "c.ttc", "苹方-简") // 同名去重
	if err := os.WriteFile(filepath.Join(dirB, "ignore.txt"), []byte("no"), 0o600); err != nil {
		t.Fatal(err)
	}
	svc := New(filepath.Join(t.TempDir(), "fonts"), filepath.Join(t.TempDir(), "index.json"), []string{dirA, dirB})
	got := svc.ListSystem()
	if len(got) != 2 || got[0].Name != "Songti SC" || got[1].Name != "苹方-简" {
		t.Fatalf("系统扫描结果异常：%+v", got)
	}
	if got[0].Source != "system" || !got[0].Enabled {
		t.Errorf("系统条目字段错误：%+v", got[0])
	}
	/* 二次调用走缓存 */
	if again := svc.ListSystem(); len(again) != 2 {
		t.Errorf("缓存结果异常：%+v", again)
	}
}

func newTestService(t *testing.T) *Service {
	t.Helper()
	base := filepath.Join(t.TempDir(), "fonts")
	return New(base, filepath.Join(t.TempDir(), "index.json"), nil)
}

func TestUserFontAddListFileRemove(t *testing.T) {
	svc := newTestService(t)
	e, err := svc.Add("我的楷体", ".ttf", []byte("fake-ttf-bytes"))
	if err != nil {
		t.Fatal(err)
	}
	if e.ID == "" || e.Name != "我的楷体" || e.Source != "user" || !e.Enabled || e.Size != int64(len("fake-ttf-bytes")) {
		t.Fatalf("Add 返回异常：%+v", e)
	}
	list, err := svc.ListUser()
	if err != nil || len(list) != 1 || list[0].ID != e.ID {
		t.Fatalf("ListUser = %+v, %v", list, err)
	}
	data, ext, err := svc.File(e.ID)
	if err != nil || string(data) != "fake-ttf-bytes" || ext != ".ttf" {
		t.Fatalf("File = %q, %q, %v", data, ext, err)
	}
	if err := svc.Remove(e.ID); err != nil {
		t.Fatal(err)
	}
	if list, _ := svc.ListUser(); len(list) != 0 {
		t.Errorf("删除后仍有 %+v", list)
	}
	if _, _, err := svc.File(e.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("已删字体 File 应报 ErrNotFound，实际 %v", err)
	}
	/* 索引持久化：新实例读同一 indexPath 仍可见（先 Add 再建新实例） */
	svc2base := filepath.Join(t.TempDir(), "fonts")
	idx := filepath.Join(t.TempDir(), "index.json")
	svcA := New(svc2base, idx, nil)
	e2, err := svcA.Add("持久化", ".woff2", []byte("woff2data"))
	if err != nil {
		t.Fatal(err)
	}
	svcB := New(svc2base, idx, nil)
	listB, errB := svcB.ListUser()
	if errB != nil || len(listB) != 1 || listB[0].ID != e2.ID {
		t.Fatalf("重建实例后 ListUser = %+v, %v", listB, errB)
	}
}

func TestAddRejectsBadExtAndOversize(t *testing.T) {
	svc := newTestService(t)
	if _, err := svc.Add("x", ".exe", []byte("bad")); !errors.Is(err, ErrBadExt) {
		t.Errorf("非法扩展名应 ErrBadExt，实际 %v", err)
	}
	if _, err := svc.Add("x", ".ttf", make([]byte, MaxFontSize+1)); !errors.Is(err, ErrTooLarge) {
		t.Errorf("超限应 ErrTooLarge，实际 %v", err)
	}
}

func TestRenameAndSafeID(t *testing.T) {
	svc := newTestService(t)
	e, err := svc.Add("原名", ".otf", []byte("data"))
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Rename(e.ID, "新名"); err != nil {
		t.Fatal(err)
	}
	list, _ := svc.ListUser()
	if list[0].Name != "新名" {
		t.Errorf("改名失败：%+v", list[0])
	}
	if err := svc.Rename("", "x"); !errors.Is(err, ErrNotFound) {
		t.Errorf("空 id 应 ErrNotFound，实际 %v", err)
	}
	/* 越权 id：File / Remove 必须拒绝路径拼接风险 */
	for _, bad := range []string{"../evil", "f..", "a/b", ""} {
		if isSafeID(bad) {
			t.Errorf("isSafeID(%q) 应为 false", bad)
		}
	}
	if _, _, err := svc.File("../../etc/passwd"); !errors.Is(err, ErrNotFound) {
		t.Errorf("危险 id 应 ErrNotFound，实际 %v", err)
	}
}
