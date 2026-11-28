/**
 * 数据备份（E3）：浏览器本地模式（mock）状态的整包导出 / 导入。
 *
 * 背景：配置早有独立「导出 / 导入 JSON」，预设也有分享链接 / JSON（G5）；
 * 但字帖库 + 最近文件及其内容没有整包备份——清浏览器数据 / 换设备即丢
 * （顶栏「本地模式」已明示该边界）。本模块把 `zitie.mock.v1` 快照
 * （见 ipc/client.ts MockTransport.persist）打包成一个带版本与校验的 JSON，
 * 导入采用**合并**语义（同名跳过、按路径去重），完成后由调用方刷新页面生效。
 *
 * 桌面端（http 模式）数据在 Go 侧磁盘，不经此模块；UI 仅本地模式显示。
 */

export const MOCK_STATE_KEY = 'zitie.mock.v1';
export const BACKUP_KIND = 'zitie-backup';
export const BACKUP_VERSION = 1;

/** 与 MockTransport.persist 写出的快照同构（字段全部可选，便于容错合并） */
export interface BackupSnapshot {
	config?: Record<string, unknown>;
	files?: Record<string, { path?: string; content?: string }>;
	recent?: string[];
	documents?: Array<Record<string, unknown>>;
	nextDocId?: number;
	presets?: Record<string, unknown>;
}

export interface BackupPayload {
	app: string;
	kind: string;
	version: number;
	exportedAt: string;
	config: Record<string, unknown>;
	files: Record<string, { path?: string; content?: string }>;
	recent: string[];
	documents: Array<Record<string, unknown>>;
	nextDocId: number;
	presets: Record<string, unknown>;
}

export interface BackupSummary {
	configFields: number;
	presets: number;
	files: number;
	documents: number;
	recent: number;
}

export type ParseResult =
	| { ok: true; payload: BackupPayload; summary: BackupSummary }
	| { ok: false; error: string };

export interface MergeResult {
	addedPresets: number;
	addedFiles: number;
	addedDocuments: number;
	skippedPresets: number;
	skippedFiles: number;
	skippedDocuments: number;
	mergedRecent: number;
	nextDocId: number;
}

export function readSnapshot(): BackupSnapshot {
	try {
		const raw = window.localStorage.getItem(MOCK_STATE_KEY);
		if (raw) return JSON.parse(raw) as BackupSnapshot;
	} catch {
		/* localStorage 不可用 / 损坏：当作空快照 */
	}
	return {};
}

export function summarize(payload: BackupPayload): BackupSummary {
	return {
		configFields: Object.keys(payload.config || {}).length,
		presets: Object.keys(payload.presets || {}).length,
		files: Object.keys(payload.files || {}).length,
		documents: Array.isArray(payload.documents) ? payload.documents.length : 0,
		recent: Array.isArray(payload.recent) ? payload.recent.length : 0
	};
}

/** 导出：读当前快照打成带校验头的 JSON；快照不可用（无 config）时返回 null */
export function encodeBackup(now: Date = new Date()): string | null {
	const snap = readSnapshot();
	if (!snap.config) return null; /* 从未持久化过（内存态）：无可信备份源 */
	const payload: BackupPayload = {
		app: 'motie',
		kind: BACKUP_KIND,
		version: BACKUP_VERSION,
		exportedAt: now.toISOString(),
		config: snap.config,
		files: snap.files || {},
		recent: Array.isArray(snap.recent) ? snap.recent : [],
		documents: Array.isArray(snap.documents) ? snap.documents : [],
		nextDocId: typeof snap.nextDocId === 'number' ? snap.nextDocId : 1,
		presets: snap.presets || {}
	};
	return JSON.stringify(payload);
}

/**
 * 导入前解析校验：必须是本应用、本类型、支持的版本；
 * 容器块允许缺省（例如只备份字帖库的裁剪包），补默认值；给了就必须类型正确。
 */
export function parseBackup(text: string): ParseResult {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return { ok: false, error: '文件不是有效的 JSON。' };
	}
	const obj = data as Partial<BackupPayload>;
	if (!obj || typeof obj !== 'object') return { ok: false, error: '备份内容为空。' };
	if (obj.app !== 'motie') return { ok: false, error: '不是墨帖的备份文件。' };
	if (obj.kind !== BACKUP_KIND) return { ok: false, error: '备份类型不符（期望 ' + BACKUP_KIND + '）。' };
	if (obj.version !== BACKUP_VERSION) return { ok: false, error: '备份版本不支持（v' + String(obj.version) + '）。' };
	if (obj.config != null && (typeof obj.config !== 'object' || Array.isArray(obj.config))) return { ok: false, error: '备份配置块损坏。' };
	if (obj.files != null && (typeof obj.files !== 'object' || Array.isArray(obj.files))) return { ok: false, error: '备份文件块损坏。' };
	if (obj.presets != null && (typeof obj.presets !== 'object' || Array.isArray(obj.presets))) return { ok: false, error: '备份预设块损坏。' };
	if (obj.documents != null && !Array.isArray(obj.documents)) return { ok: false, error: '备份字帖列表损坏。' };
	if (obj.recent != null && !Array.isArray(obj.recent)) return { ok: false, error: '备份最近列表损坏。' };
	const payload: BackupPayload = {
		app: obj.app,
		kind: obj.kind,
		version: obj.version,
		exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
		config: obj.config || {},
		files: obj.files || {},
		recent: (obj.recent || []).filter((p): p is string => typeof p === 'string'),
		documents: (obj.documents || []).filter((d): d is Record<string, unknown> => !!d && typeof d === 'object'),
		nextDocId: typeof obj.nextDocId === 'number' ? obj.nextDocId : 1,
		presets: obj.presets || {}
	};
	return { ok: true, payload, summary: summarize(payload) };
}

/**
 * 合并写回快照：config 覆盖但保留本机草稿（Content / Title）；预设同名跳过；
 * 文件 / 字帖按 path 去重（已有不覆盖）；字帖 id 冲突时重新分配；recent 并集去重。
 * 写回后由调用方刷新页面，MockTransport 重新初始化即生效。
 */
export function mergeBackup(payload: BackupPayload): MergeResult | null {
	const snap = readSnapshot();
	const result: MergeResult = {
		addedPresets: 0, addedFiles: 0, addedDocuments: 0,
		skippedPresets: 0, skippedFiles: 0, skippedDocuments: 0,
		mergedRecent: 0, nextDocId: 1
	};

	/* 配置：包内字段覆盖本机，但保留本机当前草稿（Content / Title） */
	const mergedConfig: Record<string, unknown> = Object.assign({}, snap.config || {}, payload.config);
	if (snap.config && snap.config.Content != null) mergedConfig.Content = snap.config.Content;
	if (snap.config && snap.config.Title != null) mergedConfig.Title = snap.config.Title;

	/* 预设：本机为主，包内同名跳过（与 G5 导入一致） */
	const mergedPresets: Record<string, unknown> = Object.assign({}, snap.presets || {});
	for (const name of Object.keys(payload.presets || {})) {
		if (mergedPresets[name] !== undefined) {
			result.skippedPresets += 1;
			continue;
		}
		mergedPresets[name] = payload.presets[name];
		result.addedPresets += 1;
	}

	/* 文件：以 path 为主键，已有跳过（不覆盖本机内容） */
	const mergedFiles: Record<string, { path?: string; content?: string }> = Object.assign({}, snap.files || {});
	const existingPaths = new Set(Object.values(mergedFiles).map((f) => f && f.path).filter(Boolean) as string[]);
	for (const key of Object.keys(payload.files || {})) {
		const file = payload.files[key];
		const filePath = (file && file.path) || key;
		if (!filePath || existingPaths.has(filePath)) {
			result.skippedFiles += 1;
			continue;
		}
		mergedFiles[filePath] = { path: filePath, content: (file && file.content) || '' };
		existingPaths.add(filePath);
		result.addedFiles += 1;
	}

	/* 字帖：按 path 去重；id 与本机冲突且 path 不同时重新分配，避免主键撞车 */
	const mergedDocs: Array<Record<string, unknown>> = Array.isArray(snap.documents) ? snap.documents.map((d) => ({ ...d })) : [];
	const docPaths = new Set(mergedDocs.map((d) => d.path).filter(Boolean) as string[]);
	const usedIds = new Set(mergedDocs.map((d) => Number(d.id)).filter((n) => Number.isFinite(n)));
	let nextId = Math.max(
		typeof snap.nextDocId === 'number' ? snap.nextDocId : 1,
		typeof payload.nextDocId === 'number' ? payload.nextDocId : 1,
		...Array.from(usedIds)
	);
	for (const doc of payload.documents) {
		const path = typeof doc.path === 'string' ? doc.path : '';
		if (!path || docPaths.has(path)) {
			result.skippedDocuments += 1;
			continue;
		}
		let entry = { ...doc };
		const id = Number(entry.id);
		if (!Number.isFinite(id) || usedIds.has(id)) {
			while (usedIds.has(nextId)) nextId += 1;
			entry = { ...entry, id: nextId };
			usedIds.add(nextId);
			nextId += 1;
		} else {
			usedIds.add(id);
			if (id >= nextId) nextId = id + 1;
		}
		mergedDocs.push(entry);
		docPaths.add(path);
		result.addedDocuments += 1;
	}
	result.nextDocId = nextId;

	/* 最近：包内路径优先前置，与本机并集去重，沿用 MockTransport 的 20 条上限 */
	const seenRecent = new Set<string>();
	const mergedRecent: string[] = [];
	for (const path of [...(payload.recent || []), ...(Array.isArray(snap.recent) ? snap.recent : [])]) {
		if (!path || seenRecent.has(path)) continue;
		seenRecent.add(path);
		mergedRecent.push(path);
	}
	mergedRecent.splice(20);
	result.mergedRecent = mergedRecent.length;

	try {
		window.localStorage.setItem(MOCK_STATE_KEY, JSON.stringify({
			config: mergedConfig,
			files: mergedFiles,
			recent: mergedRecent,
			documents: mergedDocs,
			nextDocId: result.nextDocId,
			presets: mergedPresets
		} satisfies BackupSnapshot));
	} catch {
		/* 存储不可用：导入未生效，返回 null 让 UI 提示失败 */
		return null;
	}
	return result;
}
