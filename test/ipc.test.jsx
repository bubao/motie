import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	ApiError,
	createClient,
	HTTPTransport,
	isDesktopEnv,
	MockTransport,
} from '../web/src/ipc/client.ts';

beforeEach(() => {
	window.localStorage.clear();
	delete window.__MOTIE_DESKTOP__;
});

describe('ipc/client：mock 传输（浏览器模式）', function () {
	it('配置读写往返并落 localStorage（键与现有主链一致）', async function () {
		const t = new MockTransport();
		const client = createClient(t);
		const cfg0 = await client.getConfig();
		expect(cfg0.Theme).toBe('system');
		expect(cfg0.ZgType).toBe('3');
		await client.setConfig(Object.assign({}, cfg0, { Theme: 'dark', InkAlpha: 0.9 }));
		const saved = JSON.parse(window.localStorage.getItem('zitie.config'));
		expect(saved.Theme).toBe('dark');
		expect(saved.InkAlpha).toBe(0.9);
		expect((await client.getConfig()).Theme).toBe('dark');
	});

	it('setConfig 广播 config.changed 事件，订阅可取消', async function () {
		const t = new MockTransport();
		const client = createClient(t);
		const got = [];
		const off = client.subscribe(function (p) {
			got.push(p);
		});
		const cfg = await client.getConfig();
		await client.setConfig(Object.assign({}, cfg, { Template: 'trace' }));
		expect(got.length).toBe(1);
		expect(got[0].event).toBe('config.changed');
		expect(got[0].data.Template).toBe('trace');
		off();
		await client.setConfig(Object.assign({}, cfg, { Template: 'normal' }));
		expect(got.length).toBe(1);
	});

	it('文件 / 最近文件内存往返；读不存在文件报 404', async function () {
		const t = new MockTransport();
		const client = createClient(t);
		await client.writeFile({ path: '/a.txt', content: '永', mod_time: '' });
		const f = await client.readFile('/a.txt');
		expect(f.content).toBe('永');
		await expect(client.readFile('/missing.txt')).rejects.toBeInstanceOf(ApiError);
		expect(await client.listRecent()).toEqual(['/a.txt']);
	});

	it('PDF 导出：上传每页 JPEG 并记录文件名与页数', async function () {
		const t = new MockTransport();
		const client = createClient(t);
		const path = await client.buildPDF('字帖.pdf', 210, 297, [new Blob(['p1']), new Blob(['p2'])]);
		expect(path).toContain('字帖.pdf');
		expect(t.pdfs).toEqual(['字帖.pdf']);
		expect(t.pdfPages).toBe(2);
	});
});

describe('ipc/client：fonts / presets / kindle（mock）', function () {
	it('字体库：导入 → 列表 → 改名 → 删除；不存在报 404', async function () {
		const t = new MockTransport();
		const client = createClient(t);
		const lib0 = await client.listFonts();
		expect(lib0.system).toEqual([]);
		expect(lib0.user).toEqual([]);

		const entry = await client.addFont(new Blob(['fake-bytes']), '我的楷体.ttf', '我的楷体');
		expect(entry.id).toBeTruthy();
		expect(entry.name).toBe('我的楷体');
		expect(entry.source).toBe('user');
		const lib1 = await client.listFonts();
		expect(lib1.user.length).toBe(1);
		expect(lib1.user[0].id).toBe(entry.id);
		expect(t.userFonts[0].blob.byteLength).toBe(10);

		await client.renameFont(entry.id, '新名');
		expect((await client.listFonts()).user[0].name).toBe('新名');

		await client.removeFont(entry.id);
		expect((await client.listFonts()).user).toEqual([]);
		await expect(client.removeFont(entry.id)).rejects.toBeInstanceOf(ApiError);
		/* mock 模式字体文件地址为空串（无服务可加载） */
		expect(client.fontFileURL(entry.id)).toBe('');
	});

	it('预设：保存 / 列表 / 改名 / 删除，重复删除与改名冲突报错', async function () {
		const t = new MockTransport();
		const client = createClient(t);
		expect(await client.listPresets()).toEqual({});
		await client.savePreset('硬笔', { Cols: 8, Template: 'trace' });
		const all = await client.listPresets();
		expect(all['硬笔'].Cols).toBe(8);

		await client.renamePreset('硬笔', '钢笔');
		const after = await client.listPresets();
		expect(after['钢笔']).toBeTruthy();
		expect(after['硬笔']).toBeUndefined();
		await client.savePreset('A', {});
		await client.savePreset('B', {});
		await expect(client.renamePreset('A', 'B')).rejects.toMatchObject({ status: 409 });

		await client.deletePreset('钢笔');
		expect((await client.listPresets())['钢笔']).toBeUndefined();
		await expect(client.deletePreset('钢笔')).rejects.toBeInstanceOf(ApiError);
	});

	it('导出 Kindle 版返回落盘路径', async function () {
		const client = createClient(new MockTransport());
		const path = await client.exportKindle();
		expect(path).toContain('墨帖-lite.html');
	});

	it('createClient 默认选 mock（无桌面标记）', function () {
		const client = createClient();
		expect(client.transport.kind).toBe('mock');
		expect(isDesktopEnv()).toBe(false);
	});
});

describe('ipc/client：HTTP 传输（Go 内核）', function () {
	it('GET/PUT/DELETE 走 REST + JSON，非 2xx 抛 ApiError', async function () {
		const calls = [];
		globalThis.fetch = vi.fn(async function (url, init) {
			calls.push([url, init]);
			if (String(url).endsWith('/api/config') && (!init || init.method === undefined)) {
				return { ok: true, json: async () => ({ app: 'motie', port: 39130, config: { Theme: 'light' } }) };
			}
			if (String(url).endsWith('/api/config')) {
				return { ok: true, json: async () => ({ ok: 'true' }) };
			}
			if (String(url).endsWith('/api/fonts/f-x') && init.method === 'DELETE') {
				return { ok: true, json: async () => ({ ok: 'true' }) };
			}
			return { ok: false, status: 500, text: async () => 'boom' };
		});
		const t = new HTTPTransport('http://127.0.0.1:39130');
		const resp = await t.get('/api/config');
		expect(resp.config.Theme).toBe('light');
		expect(calls[0][0]).toBe('http://127.0.0.1:39130/api/config');
		await t.put('/api/config', { Theme: 'dark' });
		expect(calls[1][1].method).toBe('PUT');
		expect(JSON.parse(calls[1][1].body)).toEqual({ Theme: 'dark' });
		await t.del('/api/fonts/f-x');
		expect(calls[2][1].method).toBe('DELETE');
		await expect(t.get('/api/nope')).rejects.toBeInstanceOf(ApiError);
	});

	it('POST 原始二进制携带自定义头，resolve 拼绝对地址', async function () {
		const calls = [];
		globalThis.fetch = vi.fn(async function (url, init) {
			calls.push([url, init]);
			return { ok: true, json: async () => ({ id: 'f-1', name: '我的楷体' }) };
		});
		const t = new HTTPTransport('http://127.0.0.1:39130/');
		const blob = new Blob(['bytes']);
		const entry = await t.postRaw('/api/fonts', blob, { 'X-Filename': encodeURIComponent('我的楷体.ttf') });
		expect(entry.name).toBe('我的楷体');
		expect(calls[0][1].method).toBe('POST');
		expect(calls[0][1].body).toBe(blob);
		expect(calls[0][1].headers['X-Filename']).toBe(encodeURIComponent('我的楷体.ttf'));
		expect(calls[0][0]).toBe('http://127.0.0.1:39130/api/fonts');
		expect(t.resolve('/api/fonts/file/f-1')).toBe('http://127.0.0.1:39130/api/fonts/file/f-1');
	});

	it('SSE 订阅：按 EVENTS 注册监听，收到帧回调，取消即关闭', function () {
		const listeners = {};
		let closed = 0;
		class FakeEventSource {
			constructor(url) {
				this.url = url;
			}
			addEventListener(name, cb) {
				listeners[name] = cb;
			}
			close() {
				closed++;
			}
		}
		globalThis.EventSource = FakeEventSource;
		const t = new HTTPTransport('');
		const got = [];
		const off = t.subscribe(function (p) {
			got.push(p);
		});
		expect(Object.keys(listeners).sort()).toEqual(
			['config.changed', 'file.saved', 'font.added', 'pdf.saved'].sort()
		);
		listeners['font.added']({ data: JSON.stringify({ name: '我的楷体' }) });
		expect(got[0].event).toBe('font.added');
		expect(got[0].data.name).toBe('我的楷体');
		off();
		expect(closed).toBe(1);
	});
});
