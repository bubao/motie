// Package library 是字帖索引库（SQLite）：保存「本机 .md/.txt 内容源」的管理元数据
// （标题 / 字数快照 / 收藏 / 归档 / 时间），并提供列表与搜索能力。
// 文件内容本身仍由 internal/files 读写——本包只做索引，不做第二份内容存储。
//
// 封装方式与本机另一 Go + SQLite 项目一致：纯 Go 驱动 modernc.org/sqlite（零 CGO）、
// WAL + busy_timeout、连接池上限 1、迁移以 //go:embed 随二进制分发并版本化幂等执行。
package library

import (
	"database/sql"
	"embed"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"motie/internal/domain"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// ErrNotFound 表示按 id / path 查不到记录。
var ErrNotFound = errors.New("document not found")

const listLimit = 200

// Store 持有数据库连接；Close 后不可再用。
type Store struct {
	db *sql.DB
}

/* dsnFor 拼装纯 Go SQLite 的连接参数：WAL 读写并发、忙等待、外键、NORMAL 同步。 */
func dsnFor(path string) string {
	return "file:" + path +
		"?_pragma=busy_timeout(5000)" +
		"&_pragma=journal_mode(WAL)" +
		"&_pragma=foreign_keys(1)" +
		"&_pragma=synchronous(NORMAL)"
}

/* Open 打开（必要时创建）磁盘库；目录不存在时自动建。 */
func Open(path string) (*Store, error) {
	if err := ensureDir(path); err != nil {
		return nil, err
	}
	db, err := open(dsnFor(path))
	if err != nil {
		return nil, err
	}
	return &Store{db: db}, nil
}

/* OpenInMemory 供测试使用。 */
func OpenInMemory() (*Store, error) {
	db, err := open(":memory:")
	if err != nil {
		return nil, err
	}
	return &Store{db: db}, nil
}

func open(dsn string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func ensureDir(dbPath string) error {
	dir := filepath.Dir(dbPath)
	if dir == "" || dir == "." {
		return nil
	}
	return os.MkdirAll(dir, 0o755)
}

/* Close 关闭底层连接。 */
func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

/* Migrate 按文件名顺序执行 migrations/*.sql，schema_migrations 记录已应用版本，可重复调用。 */
func (s *Store) Migrate() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version    TEXT PRIMARY KEY,
		applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		return err
	}
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, name := range names {
		var applied int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, strings.TrimSuffix(name, ".sql")).Scan(&applied); err != nil {
			return err
		}
		if applied > 0 {
			continue
		}
		body, err := fs.ReadFile(migrationsFS, "migrations/"+name)
		if err != nil {
			return err
		}
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(body)); err != nil {
			tx.Rollback()
			return err
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations (version) VALUES (?)`, strings.TrimSuffix(name, ".sql")); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

/* List 返回未归档的字帖：收藏置顶，再按更新时间倒序。 */
func (s *Store) List() ([]domain.DocumentEntry, error) {
	return s.query(`WHERE archived = 0 ORDER BY favorite DESC, updated_at DESC, id DESC LIMIT ` + itoa(listLimit))
}

/* All 返回全部字帖（含归档）：收藏置顶，再按更新时间倒序。 */
func (s *Store) All() ([]domain.DocumentEntry, error) {
	return s.query(`ORDER BY favorite DESC, updated_at DESC, id DESC LIMIT ` + itoa(listLimit))
}

/* Search 按标题或路径做大小写无关的包含匹配（未归档）。 */
func (s *Store) Search(q string) ([]domain.DocumentEntry, error) {
	like := "%" + strings.ToLower(q) + "%"
	return s.query(`WHERE archived = 0 AND (lower(title) LIKE ? OR lower(path) LIKE ?)
		ORDER BY favorite DESC, updated_at DESC, id DESC LIMIT `+itoa(listLimit), like, like)
}

func (s *Store) query(where string, args ...any) ([]domain.DocumentEntry, error) {
	rows, err := s.db.Query(`SELECT id, path, title, chars, favorite, archived, created_at, updated_at
		FROM documents `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.DocumentEntry
	for rows.Next() {
		var (
			d                  domain.DocumentEntry
			favorite, archived int
		)
		if err := rows.Scan(&d.ID, &d.Path, &d.Title, &d.Chars, &favorite, &archived, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		d.Favorite = favorite != 0
		d.Archived = archived != 0
		out = append(out, d)
	}
	return out, rows.Err()
}

/* Get 按主键取一条。 */
func (s *Store) Get(id int64) (domain.DocumentEntry, error) {
	var (
		d                  domain.DocumentEntry
		favorite, archived int
	)
	err := s.db.QueryRow(`SELECT id, path, title, chars, favorite, archived, created_at, updated_at
		FROM documents WHERE id = ?`, id).
		Scan(&d.ID, &d.Path, &d.Title, &d.Chars, &favorite, &archived, &d.CreatedAt, &d.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.DocumentEntry{}, ErrNotFound
	}
	if err != nil {
		return domain.DocumentEntry{}, err
	}
	d.Favorite = favorite != 0
	d.Archived = archived != 0
	return d, nil
}

/* Upsert 按 path 唯一键写入：命中则更新元数据（首次创建时补 created_at），返回主键。 */
func (s *Store) Upsert(d domain.DocumentEntry) (int64, error) {
	if d.Path == "" {
		return 0, errors.New("document path is required")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	var existingID int64
	var createdAt string
	err := s.db.QueryRow(`SELECT id, created_at FROM documents WHERE path = ?`, d.Path).Scan(&existingID, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		if d.CreatedAt == "" {
			d.CreatedAt = now
		}
		res, err := s.db.Exec(`INSERT INTO documents (path, title, chars, favorite, archived, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			d.Path, firstNonEmpty(d.Title, titleFromPath(d.Path)), d.Chars, b2i(d.Favorite), b2i(d.Archived), d.CreatedAt, nonEmptyTime(d.UpdatedAt, now))
		if err != nil {
			return 0, err
		}
		return res.LastInsertId()
	}
	if err != nil {
		return 0, err
	}
	if d.Title == "" {
		d.Title = titleFromPath(d.Path)
	}
	_, err = s.db.Exec(`UPDATE documents SET title = ?, chars = ?, favorite = ?, archived = ?, updated_at = ? WHERE id = ?`,
		d.Title, d.Chars, b2i(d.Favorite), b2i(d.Archived), nonEmptyTime(d.UpdatedAt, now), existingID)
	if err != nil {
		return 0, err
	}
	return existingID, nil
}

/* SetFavorite 切换收藏；favorite=1 的条目在列表中置顶。不动 updated_at（只表内容源变更时间）。 */
func (s *Store) SetFavorite(id int64, fav bool) error {
	res, err := s.db.Exec(`UPDATE documents SET favorite = ? WHERE id = ?`, b2i(fav), id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

/* UpdateTitle 仅改索引标题（不动文件本身，保持内容源文件名稳定）。 */
func (s *Store) UpdateTitle(id int64, title string) error {
	res, err := s.db.Exec(`UPDATE documents SET title = ?, updated_at = ? WHERE id = ?`,
		title, time.Now().UTC().Format(time.RFC3339), id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

/* Delete 按主键删除。 */
func (s *Store) Delete(id int64) error {
	res, err := s.db.Exec(`DELETE FROM documents WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

/* ReindexFromRecents 把最近文件列表并入索引：新路径建条（缺省标题/0 字），已有条目原样保留。
 * recents.json 本身仍是 files 服务的最近列表，这里是单向导入，返回本次新增条数。 */
func (s *Store) ReindexFromRecents(paths []string) (int, error) {
	added := 0
	for _, p := range paths {
		if strings.TrimSpace(p) == "" {
			continue
		}
		var exists int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM documents WHERE path = ?`, p).Scan(&exists); err != nil {
			return added, err
		}
		if exists > 0 {
			continue
		}
		now := time.Now().UTC().Format(time.RFC3339)
		if _, err := s.db.Exec(`INSERT INTO documents (path, title, chars, favorite, archived, created_at, updated_at)
			VALUES (?, ?, 0, 0, 0, ?, ?)`, p, titleFromPath(p), now, now); err != nil {
			return added, err
		}
		added++
	}
	return added, nil
}

/* SyncContentStats 由内容源写入方调用（files 落盘后）：按 path 刷新字数快照与修改时间。
 * 命中已存在条目时**只动 chars / updated_at**，保留用户命名的 title 与 favorite；
 * 不存在则新建（标题取文件名）。
 * 修复前的缺口：ReindexFromRecents 对已有路径原样跳过、Upsert 无生产调用者，
 * 导致 documents.chars 恒为初始值、字帖列表的字数永远不显示。 */
func (s *Store) SyncContentStats(p string, chars int) error {
	if strings.TrimSpace(p) == "" {
		return errors.New("document path is required")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	var id int64
	err := s.db.QueryRow(`SELECT id FROM documents WHERE path = ?`, p).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		_, err = s.db.Exec(`INSERT INTO documents (path, title, chars, favorite, archived, created_at, updated_at)
			VALUES (?, ?, ?, 0, 0, ?, ?)`, p, titleFromPath(p), chars, now, now)
		return err
	}
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE documents SET chars = ?, updated_at = ? WHERE id = ?`, chars, now, id)
	return err
}

/* Count 返回未归档条数（测试与 IPC 诊断用）。 */
func (s *Store) Count() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM documents WHERE archived = 0`).Scan(&n)
	return n, err
}

/* --- 小工具：避免为 strconv 散落在多处 --- */

func itoa(n int) string { return strconv.Itoa(n) }

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

func nonEmptyTime(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

/* titleFromPath 取文件名去扩展名作为缺省标题（displayPath 安全边界之外的纯展示逻辑）。 */
func titleFromPath(p string) string {
	base := filepath.Base(p)
	return strings.TrimSuffix(base, filepath.Ext(base))
}
