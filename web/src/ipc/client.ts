/**
 * 桌面版 IPC 客户端（阶段 0 骨架 → 阶段 1/2 接入 UI）。
 *
 * transport 抽象两种实现：
 *   - HTTPTransport：连 Go 内核 REST + SSE（http://127.0.0.1:<port>）；
 *   - MockTransport：浏览器内行为（localStorage 存配置、内存文件 / 字体 / 预设），UI 先用它，行为不回退。
 *
 * createClient() 自动选择：window.__MOTIE_DESKTOP__ 存在时用 HTTP，否则 mock。
 * 契约类型来自 web/src/generated/types.ts（由 cmd/typegen 从 internal/domain 生成）。
 */
import { EVENTS } from '../generated/types';
import type { Config, DocumentEntry, FontEntry, FontLibrary, WorkspaceFile } from '../generated/types';
import samples from '../generated/samples.json';
/* 契约对齐（U6）：本地模式与 Go 内核返回同一形状——config 只回偏好白名单，
 * 与 internal/api/handlers_config.go 的 domain.Config 一致。 */
import { pickPrefs } from '../core/config.js';
/* 本地快照键与数据备份（E3）共用同一真源，避免两处字面量漂移。 */
import { MOCK_STATE_KEY } from '../core/backup.js';

export interface EventPayload {
	event: string;
	data: any;
}

/* /api/update/latest 响应（检查更新）。 */
export interface UpdateInfo {
	current: string;
	latest: string;
	url?: string;
	published_at?: string;
	newer: boolean;
}

export type Unsubscribe = () => void;

export interface Transport {
	readonly kind: 'http' | 'mock';
	get<T>(path: string): Promise<T>;
	put<T>(path: string, body: unknown): Promise<T>;
	del<T>(path: string): Promise<T>;
	/** POST 原始二进制（字体上传），可带自定义头。 */
	postRaw<T>(path: string, body: Blob | ArrayBuffer, headers?: Record<string, string>): Promise<T>;
	/** POST multipart/form-data（导出页面图像上传，Go 组装 PDF）。 */
	postMultipart<T>(path: string, form: FormData): Promise<T>;
	/** 绝对地址（字体文件等静态资源用）。 */
	resolve(path: string): string;
	/* SSE 订阅全部事件；返回取消函数。 */
	subscribe(handler: (payload: EventPayload) => void): Unsubscribe;
}

export class ApiError extends Error {
	constructor(
		public status: number,
		public detail: string,
	) {
		super(`api ${status}: ${detail}`);
		this.name = 'ApiError';
	}
}

/* ---------------- HTTP（Go 内核） ---------------- */

export class HTTPTransport implements Transport {
	readonly kind = 'http' as const;

	constructor(private baseURL: string = '') {}

	resolve(path: string): string {
		return this.baseURL.replace(/\/$/, '') + path;
	}

	private url(path: string): string {
		return this.resolve(path);
	}

	async get<T>(path: string): Promise<T> {
		const res = await fetch(this.url(path), { headers: { Accept: 'application/json' } });
		if (!res.ok) throw new ApiError(res.status, await res.text());
		return res.json() as Promise<T>;
	}

	async put<T>(path: string, body: unknown): Promise<T> {
		const res = await fetch(this.url(path), {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new ApiError(res.status, await res.text());
		return res.json() as Promise<T>;
	}

	async del<T>(path: string): Promise<T> {
		const res = await fetch(this.url(path), { method: 'DELETE', headers: { Accept: 'application/json' } });
		if (!res.ok) throw new ApiError(res.status, await res.text());
		return res.json() as Promise<T>;
	}

	async postRaw<T>(path: string, body: Blob | ArrayBuffer, headers?: Record<string, string>): Promise<T> {
		const res = await fetch(this.url(path), {
			method: 'POST',
			headers: Object.assign({}, headers, { Accept: 'application/json' }),
			body,
		});
		if (!res.ok) throw new ApiError(res.status, await res.text());
		return res.json() as Promise<T>;
	}

	async postMultipart<T>(path: string, form: FormData): Promise<T> {
		const res = await fetch(this.url(path), {
			method: 'POST',
			headers: { Accept: 'application/json' },
			body: form,
		});
		if (!res.ok) throw new ApiError(res.status, await res.text());
		return res.json() as Promise<T>;
	}

	/* 订阅全部事件（事件面见 domain.Events）：当前 main.jsx 仅消费 config.changed，
	 * file.saved / font.added / pdf.saved 为多窗口同步预留（登记监听，无 UI 消费者）。 */
	subscribe(handler: (payload: EventPayload) => void): Unsubscribe {
		const source = new EventSource(this.url('/api/events'));
		const names = Object.values(EVENTS) as string[];
		for (const name of names) {
			source.addEventListener(name, (e) => {
				let data: any = null;
				try {
					data = JSON.parse((e as MessageEvent).data);
				} catch {
					data = null;
				}
				handler({ event: name, data });
			});
		}
		return () => source.close();
	}
}

/* ---------------- 浏览器 mock（UI 不落地阶段使用） ---------------- */

const MOCK_STORAGE_KEY = 'zitie.config'; // 与现有 localStorage 主链一致
/* 本地模式统一状态（U6-e）：config / files / recent / library / presets 一次写入。
 * 目的：浏览器直开产物时字帖库与预设「刷新不丢」，与 IndexedDB 字体库共同组成浏览器侧后端；
 * 仅换设备 / 清浏览器数据才丢失（顶栏「本地模式」徽标已明示）。 */
interface MockState {
	config: Config;
	files: Record<string, WorkspaceFile>;
	recent: string[];
	documents: DocumentEntry[];
	nextDocId: number;
	presets: Record<string, unknown>;
}

function loadMockState(): Partial<MockState> {
	try {
		const raw = window.localStorage.getItem(MOCK_STATE_KEY);
		if (raw) return JSON.parse(raw);
	} catch {
		/* localStorage 不可用时退回内存态 */
	}
	/* 兼容旧版本地数据：只有配置键时迁移它 */
	try {
		const legacy = window.localStorage.getItem(MOCK_STORAGE_KEY);
		if (legacy) return { config: Object.assign({}, (samples as any).Config, JSON.parse(legacy)) };
	} catch {
		/* 忽略 */
	}
	return {};
}

function mockConfigInit(): Config {
	return Object.assign({}, (samples as any).Config, (loadMockState().config || {}) as Partial<Config>);
}

type MockHandler = (payload: EventPayload) => void;

interface MockFont {
	entry: FontEntry;
	blob: ArrayBuffer;
}

export class MockTransport implements Transport {
	readonly kind = 'mock' as const;

	private state: Partial<MockState> = loadMockState();
	private config: Config = mockConfigInit();
	private handlers = new Set<MockHandler>();
	/* 文件 / 字体 / 最近文件 / 预设 / PDF：浏览器模式下的本地后端（配置 / 文件 / 字帖 / 预设可持久） */
	readonly files = new Map<string, WorkspaceFile>(Object.entries(this.state.files || {}));
	readonly systemFonts: FontEntry[] = [];
	readonly userFonts: MockFont[] = [];
	readonly recent: string[] = Array.isArray(this.state.recent) ? [...this.state.recent] : [];
	/* 字帖索引库（mock）：与 recent 保持同步，供 M1 列表渲染 */
	readonly documents: DocumentEntry[] = Array.isArray(this.state.documents) ? [...this.state.documents] : [];
	private nextDocId = typeof this.state.nextDocId === 'number' ? this.state.nextDocId : 1;
	readonly presets = new Map<string, any>(Object.entries(this.state.presets || {}));
	readonly pdfs: string[] = [];
	/* 最近一次导出的页数（buildPDF 记录，供测试与调试）。 */
	pdfPages = 0;

	resolve(_path: string): string {
		return '';
	}

	async get<T>(path: string): Promise<T> {
		if (path === '/api/config') {
			return { app: 'motie', version: '', port: 0, config: pickPrefs(this.config) } as unknown as T;
		}
		if (path === '/api/fonts') {
			return {
				system: this.systemFonts.map((f) => ({ ...f })),
				user: this.userFonts.map((f) => ({ ...f.entry })),
			} as unknown as T;
		}
		if (path === '/api/files/recent') {
			return [...this.recent] as unknown as T;
		}
		if (path === '/api/library' || path.startsWith('/api/library?')) {
			var q = '';
			var qi = path.indexOf('?q=');
			if (qi >= 0) {
				try { q = decodeURIComponent(path.slice(qi + 3)); } catch { q = ''; }
			}
			var lower = q.toLowerCase();
			var all = this.documents.map((d) => ({ ...d }));
			return (lower ? all.filter(function (d) {
				return d.title.toLowerCase().indexOf(lower) >= 0 || d.path.toLowerCase().indexOf(lower) >= 0;
			}) : all) as unknown as T;
		}
		if (path.startsWith('/api/files?')) {
			const q = new URLSearchParams(path.slice('/api/files?'.length));
			const f = this.files.get(q.get('path') || '');
			if (!f) throw new ApiError(404, `mock: 无此文件`);
			return { ...f } as unknown as T;
		}
		if (path === '/api/presets') {
			return Object.fromEntries(this.presets) as unknown as T;
		}
		if (path === '/api/update/latest') {
			return { current: __ZITIE_VERSION__, latest: __ZITIE_VERSION__, newer: false } as unknown as T;
		}
		throw new ApiError(404, `mock: unhandled GET ${path}`);
	}

	async put<T>(path: string, body: unknown): Promise<T> {
		if (path === '/api/config') {
			this.config = Object.assign({}, this.config, body) as Config;
			this.persist();
			this.broadcast(EVENTS.ConfigChanged, this.config);
			return { ok: 'true' } as unknown as T;
		}
		if (path === '/api/files') {
			const f = body as WorkspaceFile;
			this.files.set(f.path, Object.assign({}, f));
			this.recent.unshift(f.path);
			this.recent = this.recent.slice(0, 20);
			this.rememberDocument(f.path);
			this.persist();
			return { ok: 'true', path: f.path } as unknown as T;
		}
		if (path.startsWith('/api/presets/')) {
			const name = decodeURIComponent(path.slice('/api/presets/'.length));
			this.presets.set(name, body);
			this.persist();
			return { ok: 'true' } as unknown as T;
		}
		if (path === '/api/kindle') {
			return { ok: 'true', path: '/mock/export/墨帖-lite.html' } as unknown as T;
		}
		throw new ApiError(404, `mock: unhandled PUT ${path}`);
	}

	async del<T>(path: string): Promise<T> {
		if (path.startsWith('/api/fonts/')) {
			const id = decodeURIComponent(path.slice('/api/fonts/'.length));
			const i = this.userFonts.findIndex((f) => f.entry.id === id);
			if (i < 0) throw new ApiError(404, 'mock: 字体不存在');
			this.userFonts.splice(i, 1);
			return { ok: 'true' } as unknown as T;
		}
		if (path.startsWith('/api/presets/')) {
			const name = decodeURIComponent(path.slice('/api/presets/'.length));
			if (!this.presets.delete(name)) throw new ApiError(404, 'mock: 预设不存在');
			this.persist();
			return { ok: 'true' } as unknown as T;
		}
		throw new ApiError(404, `mock: unhandled DELETE ${path}`);
	}

	async postMultipart<T>(path: string, form: FormData): Promise<T> {
		if (path === '/api/pdf/build') {
			const name = String(form.get('filename') || '');
			this.pdfs.push(name);
			this.pdfPages = Number(form.get('count') || 0);
			return { ok: 'true', path: `/mock/export/${name}` } as unknown as T;
		}
		throw new ApiError(404, `mock: unhandled POST(multipart) ${path}`);
	}

	async postRaw<T>(path: string, body: Blob | ArrayBuffer, headers?: Record<string, string>): Promise<T> {
		if (path === '/api/fonts') {
			const buf = body instanceof ArrayBuffer ? body : await (body as Blob).arrayBuffer();
			const filename = decodeHeader((headers && headers['X-Filename']) || '');
			const label = decodeHeader((headers && headers['X-Label']) || '') || filename.replace(/\.[^.]+$/, '') || '未命名字体';
			const entry: FontEntry = {
				id: 'm' + Math.random().toString(36).slice(2, 10),
				name: label,
				source: 'user',
				size: buf.byteLength,
				enabled: true,
				path: '',
				created_at: new Date().toISOString(),
				tags: [],
			};
			this.userFonts.push({ entry, blob: buf });
			return { ...entry } as unknown as T;
		}
		if (path === '/api/fonts/rename') {
			const req = parseJSONBody<{ id?: string; name?: string }>(body);
			const hit = this.userFonts.find((f) => f.entry.id === req.id);
			if (!hit) throw new ApiError(404, 'mock: 字体不存在');
			hit.entry.name = String(req.name || '');
			return { ok: 'true' } as unknown as T;
		}
		if (path === '/api/fonts/tags') {
			const req = parseJSONBody<{ id?: string; tags?: string[] }>(body);
			const hit = this.userFonts.find((f) => f.entry.id === req.id);
			if (!hit) throw new ApiError(404, 'mock: 字体不存在');
			hit.entry.tags = Array.isArray(req.tags) ? req.tags.map(String) : [];
			return { ok: 'true' } as unknown as T;
		}
		if (path === '/api/presets/rename') {
			const req = parseJSONBody<{ old?: string; new?: string }>(body);
			const data = this.presets.get(String(req.old));
			if (data === undefined) throw new ApiError(404, 'mock: 预设不存在');
			if (this.presets.has(String(req.new))) throw new ApiError(409, 'mock: 已存在同名预设');
			this.presets.delete(String(req.old));
			this.presets.set(String(req.new), data);
			this.persist();
			return { ok: 'true' } as unknown as T;
		}
		if (path === '/api/library/rename') {
			const req = parseJSONBody<{ id?: number; title?: string }>(body);
			const hit = this.documents.find(function (d) { return d.id === Number(req.id); });
			if (!hit || !String(req.title || '').trim()) throw new ApiError(400, 'mock: id/title invalid');
			hit.title = String(req.title).trim();
			hit.updated_at = new Date().toISOString();
			this.documents.sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; });
			this.persist();
			return { ok: 'true' } as unknown as T;
		}
		if (path === '/api/library/favorite') {
			const req = parseJSONBody<{ id?: number; favorite?: boolean }>(body);
			const hit = this.documents.find(function (d) { return d.id === Number(req.id); });
			if (!hit) throw new ApiError(404, 'mock: document not found');
			hit.favorite = Boolean(req.favorite);
			this.documents.sort(function (a, b) {
				if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
				return a.updated_at < b.updated_at ? 1 : -1;
			});
			this.persist();
			return { ok: 'true' } as unknown as T;
		}
		if (path === '/api/library/delete') {
			const req = parseJSONBody<{ id?: number }>(body);
			const idx = this.documents.findIndex(function (d) { return d.id === Number(req.id); });
			if (idx < 0) throw new ApiError(404, 'mock: document not found');
			const doc = this.documents[idx];
			this.files.delete(doc.path);
			this.recent = this.recent.filter(function (p) { return p !== doc.path; });
			this.documents.splice(idx, 1);
			this.persist();
			return { ok: 'true' } as unknown as T;
		}
		if (path === '/api/library/reindex') {
			const req = parseJSONBody<{ paths?: string[] }>(body);
			let added = 0;
			for (const p of req.paths || []) {
				if (!p || !this.documents.some((d) => d.path === p)) {
					if (p) {
					this.rememberDocument(p);
					added++;
				}
			}
		}
			this.persist();
			return { ok: 'true', added } as unknown as T;
		}
		throw new ApiError(404, `mock: unhandled POST ${path}`);
	}

	subscribe(handler: MockHandler): Unsubscribe {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
	}

	/* rememberDocument 把一个 workspace 路径登记为字帖条目（同路径刷新更新时间，不重复）。 */
	private rememberDocument(path: string): void {
		const base = (path || '').split('/').pop() || '';
		const title = base.replace(/\.[^.]+$/, '') || base;
		const now = new Date().toISOString();
		const hit = this.documents.find((d) => d.path === path);
		if (hit) {
			hit.updated_at = now;
			this.documents.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
			return;
		}
		this.documents.unshift({
			id: this.nextDocId++,
			path,
			title,
			chars: 0,
			favorite: false,
			archived: false,
			created_at: now,
			updated_at: now,
		});
	}

	/* 把可持久部分一次性写入 localStorage（字体走 IndexedDB，不入此快照）。
	 * 同时回写旧的 zitie.config 键，保持既有读取方兼容。 */
	private persist(): void {
		try {
			const snapshot: MockState = {
				config: this.config,
				files: Object.fromEntries(this.files),
				recent: this.recent,
				documents: this.documents,
				nextDocId: this.nextDocId,
				presets: Object.fromEntries(this.presets)
			};
			window.localStorage.setItem(MOCK_STATE_KEY, JSON.stringify(snapshot));
			window.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(this.config));
		} catch {
			/* 隐私模式 / 存储满：退回内存态 */
		}
	}

	private broadcast(event: string, data: unknown): void {
		const payload: EventPayload = { event, data };
		for (const h of Array.from(this.handlers)) h(payload);
	}
}

/* ---------------- 领域客户端 ---------------- */

function parseJSONBody<T>(body: unknown): T {
	if (typeof body === 'string') {
		try {
			return JSON.parse(body) as T;
		} catch {
			return {} as T;
		}
	}
	return (body || {}) as T;
}

/* 头部允许 URL 编码（与 Go 端 unescapeHeader 对齐）。 */
function decodeHeader(v: string): string {
	try {
		return decodeURIComponent(v);
	} catch {
		return v;
	}
}

export interface MotieClient {
	readonly transport: Transport;
	getConfig(): Promise<Config>;
	setConfig(cfg: Config): Promise<void>;
	/** 最近打开的文件路径列表（files 服务）。 */
	listRecent(): Promise<string[]>;
	/** 字帖索引库列表（library 服务，按更新时间倒序；query 非空则按标题/路径搜索）。 */
	listDocuments(query?: string): Promise<DocumentEntry[]>;
	/** 把最近文件列表并入索引库，返回本次新增条数。 */
	reindexLibrary(paths: string[]): Promise<number>;
	/** 重命名（仅改索引标题，不动文件名）。 */
	renameDocument(id: number, title: string): Promise<void>;
	/** 收藏切换（收藏项在列表置顶）。 */
	setDocumentFavorite(id: number, favorite: boolean): Promise<void>;
	/** 删除字帖：移除内容文件与索引条目。 */
	deleteDocument(id: number): Promise<void>;
	/** 读取 txt / md 内容（files 服务）。 */
	readFile(path: string): Promise<WorkspaceFile>;
	/** 保存 txt / md（files 服务）。 */
	writeFile(file: WorkspaceFile): Promise<void>;
	/** 落盘 PDF：把每页 JPEG 上传给 Go 内核组装（multipart），返回完整保存路径。 */
	buildPDF(filename: string, pageWMM: number, pageHMM: number, pages: Blob[]): Promise<string>;
	/** 字体库总览：系统扫描 + 用户字体（fonts 服务）。 */
	listFonts(): Promise<FontLibrary>;
	/** 导入用户字体（二进制 + 原始文件名），返回新条目。 */
	addFont(data: Blob | ArrayBuffer, filename: string, label?: string): Promise<FontEntry>;
	removeFont(id: string): Promise<void>;
	renameFont(id: string, name: string): Promise<void>;
	/** 设置字体标签（分类用，trim/去重由内核做）。 */
	setFontTags(id: string, tags: string[]): Promise<void>;
	/** 用户字体文件的可加载地址（桌面端 http(s)；浏览器模式为空串）。 */
	fontFileURL(id: string): string;
	/** 版式预设列表（workspace 服务）。 */
	listPresets(): Promise<Record<string, any>>;
	savePreset(name: string, data: unknown): Promise<void>;
	deletePreset(name: string): Promise<void>;
	renamePreset(oldName: string, newName: string): Promise<void>;
	/** 导出 Kindle 版（复制 lite 单文件到 export/），返回路径。 */
	exportKindle(): Promise<string>;
	/** 检查 GitHub Releases 是否有新版本（仅桌面端）。 */
	checkUpdate(): Promise<UpdateInfo>;
	subscribe(handler: (payload: EventPayload) => void): Unsubscribe;
}

class Client implements MotieClient {
	constructor(public readonly transport: Transport) {}

	async getConfig(): Promise<Config> {
		const resp = await this.transport.get<{ config: Config }>('/api/config');
		return resp.config;
	}

	async setConfig(cfg: Config): Promise<void> {
		await this.transport.put('/api/config', cfg);
	}

	async listRecent(): Promise<string[]> {
		return this.transport.get<string[]>('/api/files/recent');
	}

	async listDocuments(query?: string): Promise<DocumentEntry[]> {
		const path = query && query.trim() ? '/api/library?q=' + encodeURIComponent(query.trim()) : '/api/library';
		const list = await this.transport.get<DocumentEntry[]>(path);
		return Array.isArray(list) ? list : [];
	}

	async renameDocument(id: number, title: string): Promise<void> {
		await this.transport.postRaw<{ ok?: string }>(
			'/api/library/rename',
			JSON.stringify({ id, title }),
			{ 'Content-Type': 'application/json' },
		);
	}

	async setDocumentFavorite(id: number, favorite: boolean): Promise<void> {
		await this.transport.postRaw<{ ok?: string }>(
			'/api/library/favorite',
			JSON.stringify({ id, favorite }),
			{ 'Content-Type': 'application/json' },
		);
	}

	async deleteDocument(id: number): Promise<void> {
		await this.transport.postRaw<{ ok?: string }>(
			'/api/library/delete',
			JSON.stringify({ id }),
			{ 'Content-Type': 'application/json' },
		);
	}

	async reindexLibrary(paths: string[]): Promise<number> {
		const resp = await this.transport.postRaw<{ ok?: string; added?: number }>(
			'/api/library/reindex',
			JSON.stringify({ paths: paths || [] }),
			{ 'Content-Type': 'application/json' },
		);
		return Number(resp.added || 0);
	}

	async readFile(path: string): Promise<WorkspaceFile> {
		return this.transport.get<WorkspaceFile>('/api/files?path=' + encodeURIComponent(path));
	}

	async writeFile(file: WorkspaceFile): Promise<void> {
		await this.transport.put('/api/files', file);
	}

	async buildPDF(filename: string, pageWMM: number, pageHMM: number, pages: Blob[]): Promise<string> {
		const form = new FormData();
		form.append('filename', filename);
		form.append('width_mm', String(pageWMM));
		form.append('height_mm', String(pageHMM));
		form.append('count', String(pages.length));
		pages.forEach((blob, i) => form.append('page', blob, `page${i + 1}.jpg`));
		const resp = await this.transport.postMultipart<{ ok?: string; path?: string }>('/api/pdf/build', form);
		return resp.path || '';
	}

	async listFonts(): Promise<FontLibrary> {
		const lib = await this.transport.get<FontLibrary>('/api/fonts');
		return { system: lib.system || [], user: lib.user || [] };
	}

	async addFont(data: Blob | ArrayBuffer, filename: string, label?: string): Promise<FontEntry> {
		const headers: Record<string, string> = { 'X-Filename': encodeURIComponent(filename) };
		if (label !== undefined) headers['X-Label'] = encodeURIComponent(label);
		return this.transport.postRaw<FontEntry>('/api/fonts', data, headers);
	}

	async removeFont(id: string): Promise<void> {
		await this.transport.del('/api/fonts/' + encodeURIComponent(id));
	}

	async renameFont(id: string, name: string): Promise<void> {
		await this.transport.postRaw('/api/fonts/rename', JSON.stringify({ id, name }), {
			'Content-Type': 'application/json',
		});
	}

	async setFontTags(id: string, tags: string[]): Promise<void> {
		await this.transport.postRaw('/api/fonts/tags', JSON.stringify({ id, tags: Array.isArray(tags) ? tags : [] }), {
			'Content-Type': 'application/json',
		});
	}

	fontFileURL(id: string): string {
		return this.transport.resolve('/api/fonts/file/' + encodeURIComponent(id));
	}

	async listPresets(): Promise<Record<string, any>> {
		const m = await this.transport.get<Record<string, any>>('/api/presets');
		return m || {};
	}

	async savePreset(name: string, data: unknown): Promise<void> {
		await this.transport.put('/api/presets/' + encodeURIComponent(name), data);
	}

	async deletePreset(name: string): Promise<void> {
		await this.transport.del('/api/presets/' + encodeURIComponent(name));
	}

	async renamePreset(oldName: string, newName: string): Promise<void> {
		await this.transport.postRaw(
			'/api/presets/rename',
			JSON.stringify({ old: oldName, new: newName }),
			{ 'Content-Type': 'application/json' },
		);
	}

	async exportKindle(): Promise<string> {
		const resp = await this.transport.put<{ ok?: string; path?: string }>('/api/kindle', {});
		return resp.path || '';
	}

	async checkUpdate(): Promise<UpdateInfo> {
		return this.transport.get<UpdateInfo>('/api/update/latest');
	}

	subscribe(handler: (payload: EventPayload) => void): Unsubscribe {
		return this.transport.subscribe(handler);
	}
}

/**
 * 是否在原生窗口内（macOS / Windows / Linux 壳）。
 * 仅用于「壳独有能力」：WKWebView 原生打印桥。能力路径（字体 / 字帖 / PDF / 预设）
 * 一律用 isBackendOnline()，避免「谁托管」决定功能有无。
 */
export function isDesktopEnv(): boolean {
	return typeof window !== 'undefined' && (window as any).__MOTIE_DESKTOP__ === true;
}

/* ---------------- 后端探测（U6）：能否走 Go 内核取决于「后端可达」，而非「谁托管」 ---------------- */

export type BackendKind = 'http' | 'mock';

/** 本机内核端口记忆键：设置页「接入」可手动固定，detectBackend 启动时优先探测。 */
export const BACKEND_PORT_KEY = 'zitie.backend.port';
/** 与 serve.go 的默认端口一致；导供测试与文档口径引用 */
export const DEFAULT_BACKEND_PORT = 39130;
/** 与 Go 单实例探测同源：/api/config 的 app 字段必须为该值 */
export const BACKEND_APP_NAME = 'motie';

function win(): any {
	return typeof window !== 'undefined' ? window : undefined;
}

/* 壳注入：内嵌窗口与内核同源自带，无需网络往返 */
function injectedBaseURL(): string | null {
	const w = win();
	if (w && w.__MOTIE_DESKTOP__ === true) return w.__MOTIE_BASE_URL__ || '';
	return null;
}

function portFrom(text: string): number | null {
	const m = /[?&#]port=(\d{2,5})/.exec(text || '');
	if (!m) return null;
	const p = Number(m[1]);
	return p > 0 && p < 65536 ? p : null;
}

/** 读取手动固定 / 上次命中的本机内核端口（非法值视为未设置）。 */
export function readBackendPort(): number | null {
	const w = win();
	if (!w || !w.localStorage) return null;
	let port: number | null = null;
	try { port = Number(w.localStorage.getItem(BACKEND_PORT_KEY)) || null; } catch { return null; }
	if (!port || !Number.isFinite(port)) return null;
	port = Math.floor(port);
	return port > 0 && port < 65536 ? port : null;
}

/** 固定本机内核端口（1–65535）；非法值或存储不可用时返回 false，不写入。 */
export function writeBackendPort(port: number): boolean {
	const p = Math.floor(Number(port));
	if (!Number.isFinite(p) || p <= 0 || p >= 65536) return false;
	const w = win();
	if (!w || !w.localStorage) return false;
	try { w.localStorage.setItem(BACKEND_PORT_KEY, String(p)); return true; } catch { return false; }
}

export function clearBackendPort(): void {
	const w = win();
	if (!w || !w.localStorage) return;
	try { w.localStorage.removeItem(BACKEND_PORT_KEY); } catch { /* 忽略 */ }
}

/** 按端口探测墨帖内核（设置页「测试连接」用）；非法定端口直接 false。 */
export async function probeBackendPort(port: number, timeoutMs = 700): Promise<boolean> {
	const p = Math.floor(Number(port));
	if (!Number.isFinite(p) || p <= 0 || p >= 65536) return false;
	return probeBackend('http://127.0.0.1:' + p, timeoutMs);
}

async function probeBackend(base: string, timeoutMs: number): Promise<boolean> {
	try {
		const ctrl = new AbortController();
		const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs);
		const res = await fetch(base.replace(/\/$/, '') + '/api/config', {
			headers: { Accept: 'application/json' },
			signal: ctrl.signal,
		});
		clearTimeout(timer);
		if (!res.ok) return false;
		const data = await res.json();
		return !!data && data.app === BACKEND_APP_NAME;
	} catch {
		return false;
	}
}

/**
 * 探测可达的 Go 内核：壳注入（同源）→ 当前 origin（反代 / 本机部署）→ URL 端口 →
 * 上次成功的端口 → 默认端口。命中后记下端口，下次直开可快速命中；全部不可达才回退本地模式。
 */
export async function detectBackend(timeoutMs = 700): Promise<string | null> {
	const injected = injectedBaseURL();
	if (injected !== null) return injected;

	const candidates: string[] = [];
	const protocol = typeof location !== 'undefined' ? location.protocol : '';
	if (protocol === 'http:' || protocol === 'https:') candidates.push(location.origin);

	const w = win();
	const urlPort = w ? portFrom(w.location.search) || portFrom(w.location.hash) : null;
	if (urlPort) candidates.push('http://127.0.0.1:' + urlPort);

	const savedPort = readBackendPort();
	if (savedPort) candidates.push('http://127.0.0.1:' + savedPort);

	candidates.push('http://127.0.0.1:' + DEFAULT_BACKEND_PORT);

	const seen = new Set<string>();
	for (const base of candidates) {
		const key = base.replace(/\/$/, '');
		if (seen.has(key)) continue;
		seen.add(key);
		if (await probeBackend(key, timeoutMs)) {
			const m = /:(\d+)$/.exec(key);
			if (m && w && w.localStorage) {
				try { w.localStorage.setItem(BACKEND_PORT_KEY, m[1]); } catch { /* 忽略写失败 */ }
			}
			return key;
		}
	}
	return null;
}

export function createClient(transport?: Transport): MotieClient {
	/* 未显式 initSharedClient 的兼底路径（正常启动都会先 init）：
	 * 已解析则用解析结果；否则原生窗口（壳注入同源）走 HTTP，其余本地模式。 */
	const base = typeof window !== 'undefined' ? (window as any).__MOTIE_BASE_URL__ || '' : '';
	var kind: BackendKind = resolvedKind || (isDesktopEnv() ? 'http' : 'mock');
	const t = transport || (kind === 'http' ? new HTTPTransport(base) : new MockTransport());
	return new Client(t);
}

/* 进程级共享实例：UI 各处的无参 createClient() 统一走这里，避免 MockTransport 的内存态
 * （files / fonts / presets / pdfPages）在不同调用点分叉，也避免桌面端重复建连 EventSource。
 * 需要隔离状态的测试仍可显式 createClient(transport)。 */
let sharedInstance: MotieClient | null = null;
let resolvedKind: BackendKind | null = null;

/** 启动期解析（U6）：先探测后端再构造共享客户端；boot 必须 await 它，
 * 这样字体 / 字帖 / 预设管理拿到的是真实后端或明确的本地模式，而不是两套实现各走各的。 */
export async function initSharedClient(timeoutMs = 700): Promise<MotieClient> {
	if (sharedInstance) return sharedInstance;
	const base = await detectBackend(timeoutMs);
	sharedInstance = new Client(base !== null ? new HTTPTransport(base) : new MockTransport());
	resolvedKind = base !== null ? 'http' : 'mock';
	return sharedInstance;
}

/** 当前接入模式（init 之前为 null）：供界面标注「本地模式」与 SW 注册策略使用。 */
export function backendKind(): BackendKind | null {
	return resolvedKind;
}

export function sharedClient(): MotieClient {
	if (!sharedInstance) sharedInstance = createClient();
	return sharedInstance;
}
