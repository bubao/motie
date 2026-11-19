/**
 * 组件层测试（T2.6）：ToastHost / Preview / Panel（模板、预设、字体链路）。
 * 运行：npx vitest run（由 npm test 串联）。
 * 断言只针对「可观察行为」：DOM 结构 / 文本 / store 状态，不重复实现版式算法。
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { Zitie as Z, FontStore } from '../js/core.js';
import { store, resetConfig, pushToast, dismissToast, setField, setContent } from '../web/src/store.js';
import { ToastHost } from '../web/src/ToastHost.jsx';
import { Preview } from '../web/src/Preview.jsx';
import { Panel } from '../web/src/Panel.jsx';

function renderWithStore(ui) {
	return render(React.createElement(Provider, { store }, ui));
}

/* 本地字体仓库与字体 Face mock（jsdom 无 IndexedDB / FontFace） */
var fontMem = {};
var fontMeta = [];
FontStore.available = function () { return true; };
FontStore.put = function (entry) { fontMem[entry.id] = entry; return Promise.resolve(); };
FontStore.get = function (id) { return Promise.resolve(fontMem[id] || null); };
FontStore.remove = function (id) { delete fontMem[id]; return Promise.resolve(); };
FontStore.loadMeta = function () { return fontMeta.slice(); };
FontStore.saveMeta = function (list) { fontMeta = list.slice(); };

/* jsdom Blob 可能无 arrayBuffer：补一个（FileReader 实现） */
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
	Blob.prototype.arrayBuffer = function () {
		var self = this;
		return new Promise(function (resolve, reject) {
			var reader = new FileReader();
			reader.onload = function () { resolve(reader.result); };
			reader.onerror = function () { reject(reader.error); };
			reader.readAsArrayBuffer(self);
		});
	};
}

global.FontFace = function (family, blob) {
	this.family = family;
	this.blob = blob;
};
global.FontFace.prototype.load = function () { return Promise.resolve(this); };
Object.defineProperty(document, 'fonts', {
	value: { add: function () {}, delete: function () {}, load: function () { return Promise.resolve([{}]); } },
	configurable: true
});

beforeEach(function () {
	fontMem = {};
	fontMeta = [];
	try { window.localStorage.removeItem('zitie.fonts'); } catch (e) { /* 忽略 */ }
	try { window.localStorage.removeItem('zitie.presets'); } catch (e) { /* 忽略 */ }
	store.dispatch(resetConfig());
});

afterEach(function () {
	cleanup();
	vi.useRealTimers();
});

/* jsdom 无 IntersectionObserver：模拟为「不触发」，用于验证按需渲染（T2.4） */
if (typeof globalThis.IntersectionObserver === 'undefined') {
	globalThis.IntersectionObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}

describe('ToastHost', function () {
	it('成功提示在 3.5s 后自动消失', function () {
		vi.useFakeTimers();
		renderWithStore(<ToastHost />);
		act(function () {
			store.dispatch(pushToast({ type: 'success', text: '已应用自定义字体。' }));
		});
		expect(screen.getByText('已应用自定义字体。')).toBeTruthy();
		act(function () {
			vi.advanceTimersByTime(3500);
		});
		expect(screen.queryByText('已应用自定义字体。')).toBeNull();
	});

	it('失败提示常驻，点「重试」先关闭再执行动作', function () {
		vi.useFakeTimers();
		var retried = 0;
		renderWithStore(<ToastHost />);
		act(function () {
			store.dispatch(pushToast({
				type: 'error',
				text: '字体加载失败：地址无效或文件不可达。',
				action: { label: '重试', onClick: function () { retried++; } }
			}));
		});
		act(function () {
			vi.advanceTimersByTime(10000);
		});
		expect(screen.getByText('字体加载失败：地址无效或文件不可达。')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: '重试' }));
		expect(retried).toBe(1);
		expect(screen.queryByText('字体加载失败：地址无效或文件不可达。')).toBeNull();
	});
});

describe('Preview', function () {
	it('按版式真源渲染页数 / 页码 / 计数与模板角色', function () {
		var config = store.getState().config;
		var layout = Z.SheetLayout.compute({
			content: config.Content, title: config.Title, template: config.Template,
			traceCount: config.TraceCount, cols: config.Cols, rowGap: config.RowGap,
			cellGap: config.CellGap, gridPx: config.GridSize, config: config
		});
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		var container = rendered.container;
		expect(container.querySelectorAll('.rp-page')).toHaveLength(layout.pages.length);
		expect(container.querySelector('.rp-page-no').textContent).toBe('第 1 / ' + layout.pages.length + ' 页');
		expect(container.querySelector('.rp-count').textContent).toContain('个汉字');
		/* normal：范字为 model */
		expect(container.querySelectorAll('.hz-line.is-model').length).toBeGreaterThan(0);

		/* 切到整页描红：范字变 trace */
		act(function () {
			store.dispatch(setField({ key: 'Template', value: 'trace' }));
		});
		expect(container.querySelectorAll('.hz-line.is-trace').length).toBeGreaterThan(0);
		expect(container.querySelectorAll('.hz-line.is-model').length).toBe(0);
	});

	it('元信息：姓名 / 日期 / 页码按配置渲染', function () {
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		var container = rendered.container;
		/* 默认 ShowMeta=false：只有页码 */
		expect(container.querySelector('.rp-page-no').textContent).toContain('第 1 /');
		expect(container.querySelector('.rp-page-no').textContent).not.toContain('姓名');
		act(function () {
			store.dispatch(setField({ key: 'Name', value: '张三' }));
			store.dispatch(setField({ key: 'ShowMeta', value: true }));
		});
		var pageNo = container.querySelector('.rp-page-no');
		expect(pageNo.querySelector('.rp-meta').textContent).toContain('张三');
		expect(pageNo.querySelector('.rp-meta').textContent).toMatch(/日期：\d{4}-\d{2}-\d{2}/);
		act(function () {
			store.dispatch(setField({ key: 'ShowPageNo', value: false }));
		});
		expect(container.querySelector('.rp-page-no').textContent).not.toContain('第 1 /');
		expect(container.querySelector('.rp-meta')).not.toBeNull();
	});

	it('标点不占格：跟随前字渲染 .hz-mark', function () {
		act(function () {
			store.dispatch(setContent('天地玄黄，宇宙洪荒'));
		});
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		var marks = rendered.container.querySelectorAll('.hz-mark');
		expect(marks.length).toBeGreaterThan(0);
		expect(Array.prototype.map.call(marks, function (m) { return m.textContent; }).join('')).toContain('，');
	});

	it('按需渲染：多页时仅渲染可见页，打印前全量展开（T2.4）', function () {
		act(function () {
			store.dispatch(setContent('永'.repeat(500)));
		});
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		var container = rendered.container;
		var pages = container.querySelectorAll('.rp-page');
		expect(pages.length).toBeGreaterThan(1);
		/* IntersectionObserver mock 不触发：仅首页（data-page=0）有字格 */
		expect(container.querySelectorAll('.hz-line').length).toBeGreaterThan(0);
		expect(container.querySelectorAll('.rp-page[data-page="1"] .hz-line').length).toBe(0);
		/* beforeprint：全量展开，第二页出现字格 */
		act(function () {
			window.dispatchEvent(new Event('beforeprint'));
		});
		expect(container.querySelectorAll('.rp-page[data-page="1"] .hz-line').length).toBeGreaterThan(0);
	});
});

describe('Panel', function () {
	/* rail 分类切换：默认「内容」页，其余控件需先切到对应分类页 */
	function openPanelPage(name) {
		fireEvent.click(screen.getByRole('button', { name: name }));
	}

	it('rail 点击切换分类面板', function () {
		renderWithStore(<Panel />);
		expect(screen.getByText(/换行分段，空行分页/)).toBeTruthy();
		expect(screen.getByRole('button', { name: '插入空格' })).toBeTruthy();
		openPanelPage('版式');
		expect(screen.getAllByText(/每行 \d+ 格/).length).toBeGreaterThan(0);
		openPanelPage('字格');
		expect(screen.getByText('田字格')).toBeTruthy();
		openPanelPage('关于');
		expect(screen.getAllByText(/墨帖 v/).length).toBeGreaterThan(0);
	});

	it('模板按钮写入 store（配置真源）', function () {
		renderWithStore(<Panel />);
		openPanelPage('版式');
		fireEvent.click(screen.getByRole('button', { name: '整页描红' }));
		expect(store.getState().config.Template).toBe('trace');
		expect(screen.getAllByText(/每行 \d+ 格/).length).toBeGreaterThan(0);
	});

	it('预设保存写入 localStorage', function () {
		renderWithStore(<div><Panel /><ToastHost /></div>);
		openPanelPage('输出');
		var input = document.getElementById('presetName');
		fireEvent.change(input, { target: { value: '硬笔' } });
		fireEvent.click(screen.getByRole('button', { name: '保存' }));
		var presets = JSON.parse(window.localStorage.getItem('zitie.presets') || '{}');
		expect(presets['硬笔']).toBeTruthy();
		expect(screen.getByText('已保存预设「硬笔」。')).toBeTruthy();
	});

	it('本地字体：导入 → 列表渲染 → 应用写 FontSource', async function () {
		renderWithStore(<div><Panel /><ToastHost /></div>);
		openPanelPage('文字');
		var input = document.querySelector('input[type="file"][accept*="ttf"]');
		expect(input).toBeTruthy();
		fireEvent.change(input, {
			target: { files: [new File([new Uint8Array([1, 2, 3])], 'kaiti.ttf', { type: 'font/ttf' })] }
		});
		await waitFor(function () { expect(screen.getByText('kaiti')).toBeTruthy(); });
		expect(screen.getByText('已导入 1 个字体。')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: '应用' }));
		await waitFor(function () {
			expect(store.getState().config.FontSource.type).toBe('local');
		});
		expect(screen.getByText('使用中')).toBeTruthy();
		expect(screen.getByText('已应用字体「kaiti」。')).toBeTruthy();
	});

	it('本地字体：重命名 / 停用恢复默认 / 删除', async function () {
		renderWithStore(<div><Panel /><ToastHost /></div>);
		openPanelPage('文字');
		var input = document.querySelector('input[type="file"][accept*="ttf"]');
		fireEvent.change(input, {
			target: { files: [new File([new Uint8Array([1])], 'kaiti.ttf', { type: 'font/ttf' })] }
		});
		await waitFor(function () { expect(screen.getByText('kaiti')).toBeTruthy(); });
		/* 改名 */
		fireEvent.click(screen.getByRole('button', { name: '改名' }));
		fireEvent.change(document.querySelector('.rp-font-item input'), { target: { value: '楷书' } });
		fireEvent.click(screen.getByRole('button', { name: '确定' }));
		await waitFor(function () { expect(screen.getByText('楷书')).toBeTruthy(); });
		expect(fontMeta[0].name).toBe('楷书');
		/* 应用后停用：正被应用的字体停用时恢复默认 */
		fireEvent.click(screen.getByRole('button', { name: '应用' }));
		await waitFor(function () { expect(store.getState().config.FontSource.type).toBe('local'); });
		fireEvent.click(screen.getByRole('button', { name: '停用' }));
		await waitFor(function () { expect(store.getState().config.FontSource.type).toBe('default'); });
		expect(screen.getByRole('button', { name: '启用' })).toBeTruthy();
		/* 删除（设置组预设也有「删除」，此处取字体项内按钮） */
		var delBtn = screen.getAllByRole('button', { name: '删除' }).filter(function (b) {
			return !!b.closest('.rp-font-item');
		})[0];
		fireEvent.click(delBtn);
		await waitFor(function () { expect(screen.queryByText('楷书')).toBeNull(); });
		expect(screen.getByText(/尚未导入本地字体/)).toBeTruthy();
	});

	it('网络字体：地址有效则应用并提示成功', async function () {
		var loadMock = vi.fn(function () { return Promise.resolve([{}]); });
		Object.defineProperty(document, 'fonts', { value: { load: loadMock, add: function () {}, delete: function () {} }, configurable: true });
		renderWithStore(<div><Panel /><ToastHost /></div>);
		openPanelPage('文字');
		fireEvent.change(document.getElementById('fontURL'), { target: { value: 'font/1.ttf' } });
		fireEvent.click(screen.getByRole('button', { name: '应用字体' }));
		await waitFor(function () { expect(loadMock).toHaveBeenCalled(); });
		await waitFor(function () {
			expect(store.getState().config.FontSource).toEqual({ type: 'url', url: 'font/1.ttf' });
		});
		expect(store.getState().config.fontURL).toBe('font/1.ttf');
		expect(screen.getByText('已应用网络字体。')).toBeTruthy();
	});

	it('网络字体：加载失败则回退并提示失败', async function () {
		var loadMock = vi.fn(function () { return Promise.reject(new Error('NetworkError')); });
		Object.defineProperty(document, 'fonts', { value: { load: loadMock, add: function () {}, delete: function () {} }, configurable: true });
		renderWithStore(<div><Panel /><ToastHost /></div>);
		openPanelPage('文字');
		fireEvent.change(document.getElementById('fontURL'), { target: { value: 'font/1.ttf' } });
		fireEvent.click(screen.getByRole('button', { name: '应用字体' }));
		await waitFor(function () { expect(loadMock).toHaveBeenCalled(); });
		await waitFor(function () { expect(store.getState().config.fontURL).toBe(''); });
		/* 内联说明与 toast 都会出现，故用 getAll */
		expect(screen.getAllByText(/字体加载失败/).length).toBeGreaterThan(0);
	});

	it('本地字体：http 服务下可发布到 font/（fetch）', async function () {
		var fetchMock = vi.fn(function () {
			return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ font: {} }); } });
		});
		vi.stubGlobal('fetch', fetchMock);
		try {
			renderWithStore(<div><Panel /><ToastHost /></div>);
			openPanelPage('文字');
			var input = document.querySelector('input[type="file"][accept*="ttf"]');
			fireEvent.change(input, {
				target: { files: [new File([new Uint8Array([1, 2, 3])], 'kaiti.ttf', { type: 'font/ttf' })] }
			});
			await waitFor(function () { expect(screen.getByText('kaiti')).toBeTruthy(); });
			var pubBtn = screen.getAllByRole('button', { name: '发布' }).filter(function (b) {
				return !!b.closest('.rp-font-item');
			})[0];
			expect(pubBtn).toBeTruthy();
			fireEvent.click(pubBtn);
			await waitFor(function () { expect(fetchMock).toHaveBeenCalled(); });
			expect(String(fetchMock.mock.calls[0][0])).toBe('/api/fonts');
			expect(fetchMock.mock.calls[0][1].method).toBe('POST');
			expect(decodeURIComponent(fetchMock.mock.calls[0][1].headers['X-Filename'])).toBe('kaiti.ttf');
			expect(decodeURIComponent(fetchMock.mock.calls[0][1].headers['X-Label'])).toBe('kaiti');
			expect(screen.getByText(/已发布/)).toBeTruthy();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('本地字体：发布失败提示原因', async function () {
		var fetchMock = vi.fn(function () { return Promise.resolve({ ok: false, status: 413 }); });
		vi.stubGlobal('fetch', fetchMock);
		try {
			renderWithStore(<div><Panel /><ToastHost /></div>);
			openPanelPage('文字');
			var input = document.querySelector('input[type="file"][accept*="ttf"]');
			fireEvent.change(input, {
				target: { files: [new File([new Uint8Array([1])], 'kaiti.ttf', { type: 'font/ttf' })] }
			});
			await waitFor(function () { expect(screen.getByText('kaiti')).toBeTruthy(); });
			var pubBtn = screen.getAllByRole('button', { name: '发布' }).filter(function (b) {
				return !!b.closest('.rp-font-item');
			})[0];
			fireEvent.click(pubBtn);
			await waitFor(function () { expect(screen.getByText(/发布失败/)).toBeTruthy(); });
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('本地字体：存储不可用时降级提示', function () {
		var orig = FontStore.available;
		FontStore.available = function () { return false; };
		try {
			renderWithStore(<Panel />);
			openPanelPage('文字');
			expect(screen.getByText(/不支持本地字体存储/)).toBeTruthy();
			expect(document.querySelector('input[type="file"][accept*="ttf"]')).toBeNull();
		} finally {
			FontStore.available = orig;
		}
	});
});
