/**
 * 本地模式持久化（U6-e）：MockTransport 的可持久状态跨实例存活。
 * 浏览器直开产物时「字帖管理 / 预设」刷新不丢，仅换设备 / 清浏览器数据才丢失。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockTransport, createClient } from '../web/src/ipc/client.ts';

beforeEach(() => {
	window.localStorage.clear();
	delete window.__MOTIE_DESKTOP__;
});

describe('ipc/client：mock 持久化', function () {
	it('文件与字帖索引跨实例保留', async function () {
		const a = createClient(new MockTransport());
		await a.writeFile({ path: '/workspace/春晓.txt', content: '春眠不觉晓', mod_time: '' });

		const b = createClient(new MockTransport());
		const f = await b.readFile('/workspace/春晓.txt');
		expect(f.content).toBe('春眠不觉晓');
		const docs = await b.listDocuments();
		expect(docs.map(function (d) { return d.title; })).toContain('春晓');
	});

	it('字帖重命名 / 收藏 / 删除跨实例生效', async function () {
		const a = createClient(new MockTransport());
		await a.writeFile({ path: '/workspace/a.txt', content: '永', mod_time: '' });
		const id = (await a.listDocuments())[0].id;
		await a.renameDocument(id, '改名后的帖');
		await a.setDocumentFavorite(id, true);

		const b = createClient(new MockTransport());
		let docs = await b.listDocuments();
		expect(docs[0].title).toBe('改名后的帖');
		expect(docs[0].favorite).toBe(true);

		await b.deleteDocument(id);
		const c = createClient(new MockTransport());
		expect((await c.listDocuments()).length).toBe(0);
		expect(await c.listRecent()).toEqual([]); /* recent 同步清理 */
	});

	it('预设保存 / 改名 / 删除跨实例生效', async function () {
		const a = createClient(new MockTransport());
		await a.savePreset('横版', { Page: { width: 210 } });
		await a.renamePreset('横版', '竖版');

		const b = createClient(new MockTransport());
		let all = await b.listPresets();
		expect(Object.keys(all)).toEqual(['竖版']);

		await b.deletePreset('竖版');
		const c = createClient(new MockTransport());
		expect(Object.keys(await c.listPresets())).toEqual([]);
	});

	it('配置写入持久，且只回偏好白名单', async function () {
		const a = createClient(new MockTransport());
		await a.setConfig({ Theme: 'dark', ZgType: '2' });

		const b = createClient(new MockTransport());
		const cfg = await b.getConfig();
		expect(cfg.Theme).toBe('dark');
		expect(cfg.ZgType).toBe('2');
	});

	it('兼容旧版本地键：zitie.config 中的配置被迁移读取', async function () {
		window.localStorage.setItem('zitie.config', JSON.stringify({ Theme: 'light', Content: '旧内容' }));
		const t = new MockTransport();
		const resp = await t.get('/api/config');
		expect(resp.config.Theme).toBe('light');
		expect('Content' in resp.config).toBe(false); /* 内容字段仍不入内核 shape */
	});
});
