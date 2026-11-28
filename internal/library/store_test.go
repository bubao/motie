package library

import (
	"path/filepath"
	"testing"

	"motie/internal/domain"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := OpenInMemory()
	if err != nil {
		t.Fatalf("OpenInMemory: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	if err := s.Migrate(); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	return s
}

func TestMigrateIdempotent(t *testing.T) {
	s := newTestStore(t)
	/* 重复执行不应报错、也不产生重复版本记录 */
	if err := s.Migrate(); err != nil {
		t.Fatalf("second Migrate: %v", err)
	}
	var versions int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&versions); err != nil {
		t.Fatal(err)
	}
	if versions != 1 {
		t.Fatalf("schema_migrations rows = %d, want 1", versions)
	}
}

func TestUpsertInsertThenUpdate(t *testing.T) {
	s := newTestStore(t)
	id, err := s.Upsert(domain.DocumentEntry{Path: "workspace/春晓.md", Title: "春晓", Chars: 20})
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	if id <= 0 {
		t.Fatalf("id = %d, want > 0", id)
	}
	got, err := s.Get(id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Title != "春晓" || got.Chars != 20 {
		t.Fatalf("got %+v", got)
	}
	if got.CreatedAt == "" || got.UpdatedAt == "" {
		t.Fatalf("timestamps empty: %+v", got)
	}
	/* 同 path 再写 → 更新而非新增 */
	id2, err := s.Upsert(domain.DocumentEntry{Path: "workspace/春晓.md", Title: "春晓（改）", Chars: 32})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if id2 != id {
		t.Fatalf("id changed: %d -> %d", id, id2)
	}
	n, _ := s.Count()
	if n != 1 {
		t.Fatalf("count = %d, want 1", n)
	}
	got, _ = s.Get(id)
	if got.Title != "春晓（改）" || got.Chars != 32 {
		t.Fatalf("not updated: %+v", got)
	}
}

func TestUpsertEmptyTitleUsesFilename(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.Upsert(domain.DocumentEntry{Path: "export/静夜思.txt"}); err != nil {
		t.Fatal(err)
	}
	list, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Title != "静夜思" {
		t.Fatalf("list = %+v", list)
	}
}

func TestUpsertRequiresPath(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.Upsert(domain.DocumentEntry{Title: "无路径"}); err == nil {
		t.Fatal("want error for empty path")
	}
}

func TestListOrderAndArchive(t *testing.T) {
	s := newTestStore(t)
	must := func(d domain.DocumentEntry) {
		t.Helper()
		if _, err := s.Upsert(d); err != nil {
			t.Fatal(err)
		}
	}
	must(domain.DocumentEntry{Path: "workspace/a.md", Title: "A", UpdatedAt: "2026-01-01T00:00:00Z"})
	must(domain.DocumentEntry{Path: "workspace/b.md", Title: "B", UpdatedAt: "2026-03-01T00:00:00Z"})
	must(domain.DocumentEntry{Path: "workspace/c.md", Title: "C", UpdatedAt: "2026-02-01T00:00:00Z"})
	list, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 3 || list[0].Title != "B" || list[1].Title != "C" || list[2].Title != "A" {
		t.Fatalf("order = %v / %v / %v", list[0].Title, list[1].Title, list[2].Title)
	}
	/* 归档 C：默认列表消失，All 仍可见且 archived=true */
	c := list[1]
	id, err := s.Upsert(domain.DocumentEntry{ID: c.ID, Path: c.Path, Title: c.Title, Archived: true})
	if err != nil {
		t.Fatal(err)
	}
	if id != c.ID {
		t.Fatalf("archive upsert id = %d, want %d", id, c.ID)
	}
	list, _ = s.List()
	if len(list) != 2 {
		t.Fatalf("after archive len = %d, want 2", len(list))
	}
	all, _ := s.All()
	if len(all) != 3 {
		t.Fatalf("All len = %d, want 3", len(all))
	}
}

func TestSearch(t *testing.T) {
	s := newTestStore(t)
	for _, d := range []domain.DocumentEntry{
		{Path: "workspace/春晓.md", Title: "春晓", UpdatedAt: "2026-01-01T00:00:00Z"},
		{Path: "workspace/登鹳雀楼.txt", Title: "登鹳雀楼", UpdatedAt: "2026-01-01T00:00:00Z"},
	} {
		if _, err := s.Upsert(d); err != nil {
			t.Fatal(err)
		}
	}
	hit, err := s.Search("春晓")
	if err != nil || len(hit) != 1 || hit[0].Title != "春晓" {
		t.Fatalf("search 春晓 = %+v, %v", hit, err)
	}
	/* 大小写无关（对路径中 ASCII 部分有效） */
	hit, _ = s.Search("CHUN")
	if len(hit) != 0 {
		t.Fatalf("lower() on non-ASCII path unexpected hit %+v", hit)
	}
	hit, _ = s.Search("")
	if len(hit) != 2 {
		t.Fatalf("empty query = %d, want 2", len(hit))
	}
}

func TestDelete(t *testing.T) {
	s := newTestStore(t)
	id, err := s.Upsert(domain.DocumentEntry{Path: "workspace/x.md", Title: "X"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(id); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := s.Get(id); err != ErrNotFound {
		t.Fatalf("get after delete = %v, want ErrNotFound", err)
	}
	if err := s.Delete(id); err != ErrNotFound {
		t.Fatalf("second delete = %v, want ErrNotFound", err)
	}
}

func TestReindexFromRecents(t *testing.T) {
	s := newTestStore(t)
	recents := []string{"workspace/春晓.md", "export/word.txt", "", "workspace/春晓.md"}
	added, err := s.ReindexFromRecents(recents)
	if err != nil {
		t.Fatal(err)
	}
	if added != 2 {
		t.Fatalf("added = %d, want 2（空串与重复项跳过）", added)
	}
	n, _ := s.Count()
	if n != 2 {
		t.Fatalf("count = %d, want 2", n)
	}
	list, _ := s.List()
	titles := []string{list[0].Title, list[1].Title}
	if !contains(titles, "春晓") || !contains(titles, "word") {
		t.Fatalf("titles = %v", titles)
	}
	/* 已有条目保留原样：不因 reindex 被覆盖 */
	if _, err := s.Upsert(domain.DocumentEntry{Path: "workspace/春晓.md", Title: "改名了", Chars: 8}); err != nil {
		t.Fatal(err)
	}
	added, err = s.ReindexFromRecents(recents)
	if err != nil {
		t.Fatal(err)
	}
	if added != 0 {
		t.Fatalf("reindex existing added = %d, want 0", added)
	}
	doc, _ := s.Get(1)
	if doc.Title != "改名了" || doc.Chars != 8 {
		t.Fatalf("existing row overwritten: %+v", doc)
	}
}

func TestOpenDiskCreatesDir(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "nested", "motie.db")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()
	if err := s.Migrate(); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	if _, err := s.Upsert(domain.DocumentEntry{Path: "workspace/t.md", Title: "T"}); err != nil {
		t.Fatal(err)
	}
	/* 重开同一文件数据仍在 */
	s2, err := Open(dbPath)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer s2.Close()
	if err := s2.Migrate(); err != nil {
		t.Fatal(err)
	}
	n, _ := s2.Count()
	if n != 1 {
		t.Fatalf("after reopen count = %d, want 1", n)
	}
}

func contains(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}

func TestSetFavoritePinsTop(t *testing.T) {
	s := newTestStore(t)
	for _, d := range []domain.DocumentEntry{
		{Path: "workspace/a.md", Title: "A", UpdatedAt: "2026-01-03T00:00:00Z"},
		{Path: "workspace/b.md", Title: "B", UpdatedAt: "2026-01-02T00:00:00Z"},
	} {
		if _, err := s.Upsert(d); err != nil {
			t.Fatal(err)
		}
	}
	list, _ := s.List()
	if list[0].Title != "A" {
		t.Fatalf("before pin order = %v", list[0].Title)
	}
	/* 收藏 B：B 置顶，A 其次 */
	b := list[1]
	if err := s.SetFavorite(b.ID, true); err != nil {
		t.Fatal(err)
	}
	list, _ = s.List()
	if list[0].Title != "B" || !list[0].Favorite {
		t.Fatalf("after pin = %+v", list[0])
	}
	got, _ := s.Get(b.ID)
	if !got.Favorite {
		t.Fatalf("Get favorite = %+v", got)
	}
	/* 幂等与取消 */
	if err := s.SetFavorite(b.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := s.SetFavorite(b.ID, false); err != nil {
		t.Fatal(err)
	}
	list, _ = s.List()
	if list[0].Title != "A" || list[0].Favorite {
		t.Fatalf("after unpin = %+v", list[0])
	}
	if err := s.SetFavorite(9999, true); err != ErrNotFound {
		t.Fatalf("missing id → %v, want ErrNotFound", err)
	}
	/* 搜索同样收藏优先 */
	if err := s.SetFavorite(list[1].ID, true); err != nil {
		t.Fatal(err)
	}
	hit, _ := s.Search("")
	if hit[0].Favorite != true {
		t.Fatalf("search order = %+v", hit[0])
	}
}

/* --- SyncContentStats：字数快照写入链路（修复 chars 恒为初始值的断裂点） --- */

func TestSyncContentStatsInsertsNewEntry(t *testing.T) {
	s := newTestStore(t)
	if err := s.SyncContentStats("workspace/春晓.txt", 128); err != nil {
		t.Fatalf("SyncContentStats: %v", err)
	}
	list, err := s.List()
	if err != nil || len(list) != 1 {
		t.Fatalf("List = %+v, err=%v", list, err)
	}
	if list[0].Chars != 128 {
		t.Fatalf("chars = %d，期望 128", list[0].Chars)
	}
	if list[0].Title != "春晓" {
		t.Fatalf("新条目标题应取文件名：%+v", list[0])
	}
}

func TestSyncContentStatsUpdatesCharsButKeepsUserTitleAndFavorite(t *testing.T) {
	s := newTestStore(t)
	// 先入库并由用户重命名、收藏
	if _, err := s.Upsert(domain.DocumentEntry{Path: "workspace/a.txt", Title: "我的命名"}); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	id, _ := s.Search("我的命名")
	if len(id) != 1 {
		t.Fatalf("预置条目缺失")
	}
	if err := s.SetFavorite(id[0].ID, true); err != nil {
		t.Fatalf("SetFavorite: %v", err)
	}

	if err := s.SyncContentStats("workspace/a.txt", 77); err != nil {
		t.Fatalf("SyncContentStats: %v", err)
	}
	got, err := s.Get(id[0].ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Chars != 77 {
		t.Fatalf("chars = %d，期望 77", got.Chars)
	}
	if got.Title != "我的命名" {
		t.Fatalf("用户命名被覆盖：%+v", got)
	}
	if !got.Favorite {
		t.Fatal("收藏状态被重置")
	}
}

func TestSyncContentStatsRequiresPath(t *testing.T) {
	s := newTestStore(t)
	if err := s.SyncContentStats("  ", 1); err == nil {
		t.Fatal("空路径应报错")
	}
}
