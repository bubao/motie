package files

import (
	"os"
	"path/filepath"
	"testing"

	"motie/internal/domain"
)

func TestSafePath(t *testing.T) {
	tmp := t.TempDir()
	ok := filepath.Join(tmp, "a.txt")
	cases := []struct {
		in   string
		want bool
	}{
		{ok, true},
		{filepath.Join(tmp, "b.md"), true},
		{"relative/a.txt", false},
		{filepath.Join(tmp, "..", "etc", "passwd"), false},
		{filepath.Join(tmp, "c.png"), false},
		{"", false},
	}
	for _, c := range cases {
		_, err := SafePath(c.in)
		if (err == nil) != c.want {
			t.Errorf("SafePath(%q) err=%v，want ok=%v", c.in, err, c.want)
		}
	}
}

func TestReadWriteAndRecent(t *testing.T) {
	dir := t.TempDir()
	svc, err := New(nil)
	if err != nil {
		t.Fatal(err)
	}
	p1 := filepath.Join(dir, "一.txt")
	p2 := filepath.Join(dir, "二.md")
	if err := svc.Write(domain.WorkspaceFile{Path: p1, Content: "天地玄黄"}); err != nil {
		t.Fatal(err)
	}
	if err := svc.Write(domain.WorkspaceFile{Path: p2, Content: "# 标题"}); err != nil {
		t.Fatal(err)
	}
	f, err := svc.Read(p1)
	if err != nil {
		t.Fatal(err)
	}
	if f.Content != "天地玄黄" || f.ModTime == "" {
		t.Errorf("读取不符：%+v", f)
	}
	/* 最近文件：最新写入置顶 */
	got := svc.ListRecent()
	if len(got) != 2 || got[0] != p2 {
		t.Errorf("recent = %v", got)
	}
	/* 重复写同一文件不产生重复条目，且移到最前 */
	if err := svc.Write(domain.WorkspaceFile{Path: p1, Content: "更新"}); err != nil {
		t.Fatal(err)
	}
	got = svc.ListRecent()
	if len(got) != 2 || got[0] != p1 {
		t.Errorf("recent = %v", got)
	}
}

func TestRecentStoreRoundTripAndSanitize(t *testing.T) {
	dir := t.TempDir()
	store := FileRecentStore{Path: filepath.Join(dir, "recents.json")}
	svc, err := New(store)
	if err != nil {
		t.Fatal(err)
	}
	if got := svc.ListRecent(); len(got) != 0 {
		t.Errorf("初始应为空：%v", got)
	}
	good := filepath.Join(dir, "ok.txt")
	if _, err := os.Create(good); err != nil {
		t.Fatal(err)
	}
	_ = svc.store.Save([]string{good, filepath.Join(dir, "missing.md"), "../evil.txt", "relative.md"})
	svc2, err := New(store)
	if err != nil {
		t.Fatal(err)
	}
	got := svc2.ListRecent()
	if len(got) != 1 || got[0] != good {
		t.Errorf("sanitize 后 recent = %v", got)
	}
}

func TestRecentCap20(t *testing.T) {
	dir := t.TempDir()
	svc, _ := New(nil)
	for i := 0; i < 25; i++ {
		if err := svc.Write(domain.WorkspaceFile{
			Path:    filepath.Join(dir, string(rune('a'+i%26))+".txt"),
			Content: "x",
		}); err != nil {
			t.Fatal(err)
		}
	}
	if got := svc.ListRecent(); len(got) != maxRecent {
		t.Errorf("recent 数 = %d，期望 %d", len(got), maxRecent)
	}
}

func TestReadMissingFile(t *testing.T) {
	svc, _ := New(nil)
	_, err := svc.Read(filepath.Join(t.TempDir(), "nope.txt"))
	if err == nil {
		t.Fatal("读不存在文件应报错")
	}
}

/* 受控模式（生产装配口径）：recents / Read 均暴露相对路径；重启后 recent 不丢失；
 * 且仍拒绝绝对路径入参（旧实现存绝对路径导致 sanitizeList 全量过滤、每次重启清零）。 */
func TestScopedRelativePathsAndRecentSurviveRestart(t *testing.T) {
	base := t.TempDir()
	store := FileRecentStore{Path: filepath.Join(base, "recents.json")}
	svc, err := NewScoped(store, base, []string{"workspace", "export"})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Write(domain.WorkspaceFile{Path: "workspace/字帖.txt", Content: "永"}); err != nil {
		t.Fatal(err)
	}
	if got := svc.ListRecent(); len(got) != 1 || got[0] != "workspace/字帖.txt" {
		t.Fatalf("recent = %v，期望相对路径", got)
	}
	f, err := svc.Read("workspace/字帖.txt")
	if err != nil {
		t.Fatal(err)
	}
	if f.Path != "workspace/字帖.txt" || f.Content != "永" {
		t.Errorf("Read 返回 %+v，期望相对路径", f)
	}

	/* 绝对路径入参仍被拒绝（受控边界） */
	if err := svc.Write(domain.WorkspaceFile{Path: filepath.Join(base, "workspace/x.txt"), Content: "x"}); err == nil {
		t.Error("受控模式接受绝对路径写入，边界失效")
	}

	/* 同 store 重建服务（模拟重启）：recent 应保留
	 * （旧实现写入绝对路径 → ResolveScoped 拒绝 → 全部被过滤清空） */
	svc2, err := NewScoped(store, base, []string{"workspace", "export"})
	if err != nil {
		t.Fatal(err)
	}
	if got := svc2.ListRecent(); len(got) != 1 || got[0] != "workspace/字帖.txt" {
		t.Errorf("重启后 recent = %v，期望保留 workspace/字帖.txt", got)
	}
}
