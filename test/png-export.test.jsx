/**
 * PNG 导出测试（doc/next-features-todo.md · A2）：直接驱动 useImageExport hook。
 * core/index.js 的 renderPages 被替身替换（jsdom 无 canvas 2D），断言聚焦：
 * ① 以 image/png 格式渲染；② 逐张触发下载且文件名含标题 / 页码；③ 成功提示。
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { Provider } from 'react-redux';
import { store, resetConfig, setContent, setField } from '../web/src/store.js';
import { useImageExport } from '../web/src/useImageExport.js';

/* assets / pinyin / stroke-order 替身（与 components.test.jsx 同因：避免真实网络与 HanziWriter） */
vi.mock('../web/src/core/assets.js', function () {
	return {
		CDN_URLS: {},
		LOCAL_PATHS: {},
		setResourceMode: function () {},
		resetHanziWriter: function () {},
		loadHanziWriter: function () { return Promise.resolve(); },
		loadPinyinLib: function () { return Promise.resolve(); },
		renderStatus: function () {},
		applyAssets: function () {},
		describeAssets: function () { return { mode: 'cdn', failed: [] }; }
	};
});

vi.mock('../web/src/core/pinyin.js', function () {
	return {
		loadPinyin: function () { return Promise.resolve(); },
		getPinyin: function () { return ''; },
		getPinyinArray: function () { return []; },
		getLinePinyins: function (cells) { return (cells || []).map(function () { return ''; }); },
		resetPinyin: function () {},
		isPinyinReady: function () { return true; }
	};
});

vi.mock('../web/src/core/stroke-order.js', function () {
	return {
		Stroke: { play: function () { return false; }, destroy: function () {} },
		extractMedians: function () { return []; },
		loadCharData: function () { return Promise.resolve(); },
		getStrokeMedians: function () { return Promise.resolve(null); },
		resetStrokeData: function () {}
	};
});

/* 仅替换 renderPages：其余核心真实加载（hook 依赖 store / 纯函数） */
vi.mock('../web/src/core/index.js', async function (importOriginal) {
	const actual = await importOriginal();
	return Object.assign({}, actual, {
		/* 与真实 renderPages 同契约：内容为空即拒绝 */
		renderPages: vi.fn(function (cfg) {
			if (!String((cfg || {}).Content || '').trim()) {
				return Promise.reject(new Error('请先输入字帖内容'));
			}
			return Promise.resolve({
				pages: [new Blob(['a'], { type: 'image/png' }), new Blob(['b'], { type: 'image/png' })],
				widthMM: 210,
				heightMM: 297
			});
		})
	});
});

describe('PNG 导出（A2 / D2）', function () {
	var clicks = [];

	beforeEach(function () {
		clicks = [];
		store.dispatch(resetConfig());
		HTMLAnchorElement.prototype.click = function () {
			clicks.push({ href: this.getAttribute('href'), download: this.download });
		};
		URL.createObjectURL = vi.fn(function () { return 'blob:mock'; });
		URL.revokeObjectURL = vi.fn();
	});

	afterEach(function () {
		cleanup();
		vi.useRealTimers();
	});

	it('以 image/png 渲染，逐张下载，文件名含标题与页码', async function () {
		act(function () {
			store.dispatch(setContent('天地玄黄'));
			store.dispatch(setField({ key: 'Title', value: '早读' }));
		});
		var wrapper = function (props) { return React.createElement(Provider, { store: store }, props.children); };
		var { result } = renderHook(function () { return useImageExport(); }, { wrapper: wrapper });
		await act(async function () { result.current.exportPng(); });
		await waitFor(function () { expect(clicks.length).toBe(2); });

		var core = await import('../web/src/core/index.js');
		expect(core.renderPages).toHaveBeenCalledTimes(1);
		expect(core.renderPages.mock.calls[0][1].format).toBe('image/png');
		expect(clicks[0].download).toMatch(/^墨帖-早读-\d{8}-\d{4}-p1\.png$/);
		expect(clicks[1].download).toMatch(/-p2\.png$/);
		expect(store.getState().ui.toasts.some(function (t) { return t.type === 'success'; })).toBe(true);
	});

	it('内容为空时前置提示（U3），不渲染、不触发下载、不给无意义的重试', async function () {
		act(function () { store.dispatch(setContent('')); });
		var wrapper = function (props) { return React.createElement(Provider, { store: store }, props.children); };
		var { result } = renderHook(function () { return useImageExport(); }, { wrapper: wrapper });
		var core = await import('../web/src/core/index.js');
		var callsBefore = core.renderPages.mock.calls.length;
		await act(async function () { result.current.exportPng(); });
		await waitFor(function () {
			expect(store.getState().ui.toasts.some(function (t) { return t.type === 'info' && t.text.indexOf('内容为空') >= 0; })).toBe(true);
		});
		expect(clicks.length).toBe(0);
		expect(core.renderPages.mock.calls.length).toBe(callsBefore);
		var infoToast = store.getState().ui.toasts.filter(function (t) { return t.type === 'info' && t.text.indexOf('内容为空') >= 0; })[0];
		expect(infoToast.action).toBeFalsy();
	});
});
