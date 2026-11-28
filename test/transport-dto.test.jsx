/**
 * MockTransport DTO 形状抽样（vitest · U6）。
 * 目标：本地后端返回的对象字段必须覆盖 typegen 生成的 samples.json（Go DTO 的契约真源），
 * 防止 mock 少字段 / 多字段悄悄漂移；路由级对照见 test/api-contract.test.mjs。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockTransport, createClient } from '../web/src/ipc/client.ts';
import samples from '../web/src/generated/samples.json';

function keysOf(obj) {
	return Object.keys(obj).sort();
}

/** 返回 actual 是否含 expected 的全部字段（允许额外字段） */
function covers(actual, expected) {
	const missing = Object.keys(expected).filter(function (k) { return !(k in actual); });
	expect(missing).toEqual([]);
}

beforeEach(() => {
	window.localStorage.clear();
	delete window.__MOTIE_DESKTOP__;
});

describe('ipc/client：mock DTO 与 Go 契约样本对齐', function () {
	it('GET /api/config：ServerMeta 外层 + 白名单 Config', async function () {
		const t = new MockTransport();
		const resp = await t.get('/api/config');
		covers(resp, samples.ServerMeta);
		expect(resp.app).toBe('motie');

		const sampleKeys = keysOf(samples.Config).filter(function (k) {
			return k !== 'DefaultPort' && k !== 'BindAddr'; /* 端口/绑定属服务端运行时，不下发前端 */
		});
		expect(keysOf(resp.config)).toEqual(sampleKeys);
		expect('Content' in resp.config).toBe(false);
	});

	it('POST /api/fonts：FontEntry 全字段', async function () {
		const t = new MockTransport();
		const entry = await t.postRaw('/api/fonts', new Blob(['x']), { 'X-Filename': encodeURIComponent('楷体.ttf') });
		covers(entry, samples.FontEntry);
		expect(typeof entry.size).toBe('number');
		expect(Array.isArray(entry.tags)).toBe(true);
	});

	it('PUT /api/files 后 library 条目为 DocumentEntry 全字段', async function () {
		const client = createClient(new MockTransport());
		await client.writeFile({ path: '/帖/春晓.txt', content: '春眠不觉晓', mod_time: '' });
		const docs = await client.listDocuments();
		expect(docs.length).toBe(1);
		covers(docs[0], samples.DocumentEntry);
		expect(docs[0].title).toBe('春晓');
	});

	it('GET /api/files?path=：WorkspaceFile 全字段', async function () {
		const t = new MockTransport();
		await t.put('/api/files', { path: '/a.txt', content: '永', mod_time: '' });
		const f = await t.get('/api/files?path=' + encodeURIComponent('/a.txt'));
		covers(f, samples.WorkspaceFile);
	});

	it('领域客户端 getConfig 亦满足白名单（HTTP 与 mock 同一形状）', async function () {
		const client = createClient(new MockTransport());
		const cfg = await client.getConfig();
		const sampleKeys = keysOf(samples.Config).filter(function (k) {
			return k !== 'DefaultPort' && k !== 'BindAddr';
		});
		expect(keysOf(cfg)).toEqual(sampleKeys);
	});
});
