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
import type { Config, FontEntry, FontLibrary, WorkspaceFile } from '../generated/types';
import samples from '../generated/samples.json';

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

function mockConfigInit(): Config {
	try {
		const raw = window.localStorage.getItem(MOCK_STORAGE_KEY);
		if (raw) return Object.assign({}, (samples as any).Config, JSON.parse(raw));
	} catch {
		/* localStorage 不可用时退回样本默认值 */
	}
	return Object.assign({}, (samples as any).Config);
}

type MockHandler = (payload: EventPayload) => void;

interface MockFont {
	entry: FontEntry;
	blob: ArrayBuffer;
}

export class MockTransport implements Transport {
	readonly kind = 'mock' as const;

	private config: Config = mockConfigInit();
	private handlers = new Set<MockHandler>();
	/* 内存文件 / 字体 / 最近文件 / 预设 / PDF：浏览器模式下的本地后端 */
	readonly files = new Map<string, WorkspaceFile>();
	readonly systemFonts: FontEntry[] = [];
	readonly userFonts: MockFont[] = [];
	readonly recent: string[] = [];
	readonly presets = new Map<string, any>();
	readonly pdfs: string[] = [];
	/* 最近一次导出的页数（buildPDF 记录，供测试与调试）。 */
	pdfPages = 0;

	resolve(_path: string): string {
		return '';
	}

	async get<T>(path: string): Promise<T> {
		if (path === '/api/config') {
			return { app: 'motie', version: '', port: 0, config: this.config } as unknown as T;
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
			try {
				window.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(this.config));
			} catch {
				/* 忽略持久化失败 */
			}
			this.broadcast(EVENTS.ConfigChanged, this.config);
			return { ok: 'true' } as unknown as T;
		}
		if (path === '/api/files') {
			const f = body as WorkspaceFile;
			this.files.set(f.path, Object.assign({}, f));
			this.recent.unshift(f.path);
			this.recent = this.recent.slice(0, 20);
			return { ok: 'true', path: f.path } as unknown as T;
		}
		if (path.startsWith('/api/presets/')) {
			const name = decodeURIComponent(path.slice('/api/presets/'.length));
			this.presets.set(name, body);
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
		if (path === '/api/presets/rename') {
			const req = parseJSONBody<{ old?: string; new?: string }>(body);
			const data = this.presets.get(String(req.old));
			if (data === undefined) throw new ApiError(404, 'mock: 预设不存在');
			if (this.presets.has(String(req.new))) throw new ApiError(409, 'mock: 已存在同名预设');
			this.presets.delete(String(req.old));
			this.presets.set(String(req.new), data);
			return { ok: 'true' } as unknown as T;
		}
		throw new ApiError(404, `mock: unhandled POST ${path}`);
	}

	subscribe(handler: MockHandler): Unsubscribe {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
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

export function isDesktopEnv(): boolean {
	return typeof window !== 'undefined' && (window as any).__MOTIE_DESKTOP__ === true;
}

export function createClient(transport?: Transport): MotieClient {
	const t =
		transport ||
		(isDesktopEnv()
			? new HTTPTransport(typeof window !== 'undefined' ? (window as any).__MOTIE_BASE_URL__ || '' : '')
			: new MockTransport());
	return new Client(t);
}

/* 进程级共享实例：UI 各处的无参 createClient() 统一走这里，避免 MockTransport 的内存态
 * （files / fonts / presets / pdfPages）在不同调用点分叉，也避免桌面端重复建 EventSource。
 * 需要隔离状态的测试仍可显式 createClient(transport)。 */
let sharedInstance: MotieClient | null = null;
export function sharedClient(): MotieClient {
	if (!sharedInstance) sharedInstance = createClient();
	return sharedInstance;
}
