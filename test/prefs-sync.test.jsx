import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setField, applyRemotePrefs, store } from '../web/src/store.js';

/* 桌面端偏好同步（阶段 1）：
 * 本地变更防抖 PUT 且只带偏好键；SSE 远端导入不回推（防环）。 */

beforeEach(() => {
	window.localStorage.clear();
	delete window.__MOTIE_DESKTOP__;
	vi.restoreAllMocks();
});

describe('桌面端偏好同步', function () {
	it('本地变更防抖 PUT 偏好子集（不含内容字段）', async function () {
		window.__MOTIE_DESKTOP__ = true;
		const puts = [];
		globalThis.fetch = vi.fn(async function (url, init) {
			if (String(url).endsWith('/api/config') && init && init.method === 'PUT') {
				puts.push(JSON.parse(init.body));
			}
			return { ok: true, json: async () => ({ ok: 'true' }) };
		});

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
		window.__MOTIE_DESKTOP__ = true;
		const puts = [];
		globalThis.fetch = vi.fn(async function (url, init) {
			if (String(url).endsWith('/api/config') && init && init.method === 'PUT') {
				puts.push(JSON.parse(init.body));
			}
			return { ok: true, json: async () => ({ ok: 'true' }) };
		});

		applyRemotePrefs({ Theme: 'light', ZgType: '2' });
		expect(store.getState().config.Theme).toBe('light');
		expect(store.getState().config.ZgType).toBe('2');
		await new Promise(function (r) { setTimeout(r, 300); });
		expect(puts.length).toBe(0); /* 防环：远端事件不得触发本地 PUT */
	});
});
