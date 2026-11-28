-- 字帖索引库 v1：documents 表保存内容源文件的路径与管理元数据。
CREATE TABLE IF NOT EXISTS documents (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	path       TEXT    NOT NULL UNIQUE,             -- workspace 内相对路径（安全子树，永不写绝对路径）
	title      TEXT    NOT NULL,
	chars      INTEGER NOT NULL DEFAULT 0,          -- 正文字数快照，列表展示用
	favorite   INTEGER NOT NULL DEFAULT 0,          -- 0/1，M4 收藏
	archived   INTEGER NOT NULL DEFAULT 0,          -- 0/1，M3 归档
	created_at TEXT    NOT NULL,                    -- RFC3339
	updated_at TEXT    NOT NULL                     -- RFC3339，按它倒序排列
);
CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at DESC);
