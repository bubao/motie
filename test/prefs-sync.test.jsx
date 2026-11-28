import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setField, applyRemotePrefs, store, setBackendMode } from '../web/src/store.js';
import { initSharedClient } from '../web/src/ipc/client.ts';

/* 偏好同步（U6：接入模式读 ui.backend，transport 由探测结果决定）：
 * 本地变更防抖 PUT 且只带偏好键；SSE 远端导入不回推（防环）。 */

beforeEach(() => {
	window.localStorage.clear();
	vi.restoreAllMocks();
});

/** 模拟 boot：探测到本机内核（GET /api/config 返回 app=motie），并置 ui.backend=http */
async function bootBackend(puts) {
	globalThis.fetch = vi.fn(async function (url, init) {
		if (String(url).indexOf('/api/config') !== -1) {
			if (init && init.method === 'PUT') puts.push(JSON.parse(init.body));
			return { ok: true, json: async function () { return { app: 'motie', version: '0', port: 0, config: {} }; } };
		}
		return { ok: true, json: async function () { return {}; } };
	});
	await initSharedClient(200);
	store.dispatch(setBackendMode('http'));
}

describe('在线模式偏好同步', function () {
	it('本地变更防抖 PUT 偏好子集（不含内容字段）', async function () {
		const puts = [];
		await bootBackend(puts);

		store.dispatch(setField({ key: 'Theme', value: 'dark' }));
		expect(puts.length).toBe(0); /* 防抖窗口内不发 */
		await new Promise(function (r) { setTimeout(r, 300); });

		expect(puts.length).toBeGreaterThan(0);
		const last = puts[puts.length - 1];
		expect(last.Theme).toBe('dark');
		expect(last.ZgType).toBe(store.getState().config.ZgType);
		expect(last.Content).toBeUndefined(); /* 内容字段不走 Go */
		expect(last.DefaultPort).toBeUndefined(); /* 内核管理字段不在前端 Schema */
	});

	it('SSE 远端偏好导入：更新状态且不回推 PUT', async function () {
		const puts = [];
		await bootBackend(puts);

		applyRemotePrefs({ Theme: 'light', ZgType: '2' });
		expect(store.getState().config.Theme).toBe('light');
		expect(store.getState().config.ZgType).toBe('2');
		await new Promise(function (r) { setTimeout(r, 300); });
		expect(puts.length).toBe(0); /* 防环：远端事件不得触发本地 PUT */
	});

	it('本地模式：配置只落 localStorage，不回推内核', async function () {
		const puts = [];
		globalThis.fetch = vi.fn(async function (url, init) {
			if (String(url).indexOf('/api/config') !== -1 && init && init.method === 'PUT') puts.push(JSON.parse(init.body));
			return { ok: false, status: 503, json: async function () { return {}; } }; /* 探测不可达 */
		});
		await initSharedClient(100);
		store.dispatch(setBackendMode('mock'));

		store.dispatch(setField({ key: 'Theme', value: 'dark' }));
		await new Promise(function (r) { setTimeout(r, 300); });
		expect(puts.length).toBe(0);
		expect(window.localStorage.getItem('zitie.config')).toContain('dark'); /* 本地仍持久化 */
	});
});
