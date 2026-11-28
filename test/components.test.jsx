/**
 * 组件层测试（T2.6）：ToastHost / Preview / Panel（模板、预设、字体链路）。
 * 运行：npx vitest run（由 npm test 串联）。
 * 断言只针对「可观察行为」：DOM 结构 / 文本 / store 状态，不重复实现版式算法。
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import * as Z from '../web/src/core/index.js';
import { store, resetConfig, pushToast, dismissToast, setField, setContent, importConfig, setFontSource, replaceHan, resetHistory, undoContent, redoContent, switchMode, applyFields, setBackendMode } from '../web/src/store.js';
import { ToastHost } from '../web/src/ToastHost.jsx';
import { Preview } from '../web/src/Preview.jsx';
import { BigPreview } from '../web/src/BigPreview.jsx';
import { Panel } from '../web/src/Panel.jsx';
import { sharedClient } from '../web/src/ipc/client.ts';
import { usePrint } from '../web/src/usePrint.js';

function renderWithStore(ui) {
	return render(React.createElement(Provider, { store }, ui));
}

/* 组件已改用 core ESM（P4）：assets / pinyin / stroke-order 通过 vi.mock 注入测试替身，
 * 避免 jsdom 真实网络加载与 HanziWriter 依赖。*/
var mockState = vi.hoisted(function () {
	return { playCalls: 0, playResult: false, statusText: 'CDN 模式（测试）。', pinyinFails: false };
});

vi.mock('../web/src/core/assets.js', function () {
	return {
		CDN_URLS: {},
		LOCAL_PATHS: {},
		setResourceMode: function () {},
		resetHanziWriter: function () {},
		loadHanziWriter: function () { return Promise.resolve(); },
		loadPinyinLib: function () { return Promise.resolve(); },
		renderStatus: function () {
			var el = document.getElementById('assetStatus');
			if (el) el.textContent = mockState.statusText;
		},
		applyAssets: function () {
			var el = document.getElementById('assetStatus');
			if (el) el.textContent = mockState.statusText;
		},
		describeAssets: function () { return { mode: 'cdn', failed: [] }; }
	};
});

vi.mock('../web/src/core/pinyin.js', function () {
	return {
		loadPinyin: function () { return mockState.pinyinFails ? Promise.reject(new Error('offline')) : Promise.resolve(); },
		getPinyin: function (c) { return c === '永' ? 'yǒng' : ''; },
		/* 行级语境取音替身：单字路径不认识的「长」在词中读 zhǎng */
		getLinePinyins: function (cells) {
			return (cells || []).map(function (c) {
				if (!c || !c.char) return '';
				if (c.char === '长') return 'zhǎng';
				if (c.char === '大') return 'dà';
				if (c.char === '永') return 'yǒng';
				return '';
			});
		},
		getPinyinArray: function () { return []; },
		resetPinyin: function () {},
		isPinyinReady: function () { return true; }
	};
});

vi.mock('../web/src/core/stroke-order.js', function () {
	return {
		Stroke: {
			play: function () { mockState.playCalls++; return mockState.playResult; },
			destroy: function () {}
		}
	};
});

/* 本地字体仓库与字体 Face mock（jsdom 无 IndexedDB / FontFace） */
var fontMem = {};
var fontMeta = [];
Z.FontStore.available = function () { return true; };
Z.FontStore.put = function (entry) { fontMem[entry.id] = entry; return Promise.resolve(); };
Z.FontStore.get = function (id) { return Promise.resolve(fontMem[id] || null); };
Z.FontStore.remove = function (id) { delete fontMem[id]; return Promise.resolve(); };
Z.FontStore.loadMeta = function () { return fontMeta.slice(); };
Z.FontStore.saveMeta = function (list) { fontMeta = list.slice(); };

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
	mockState.playCalls = 0;
	mockState.playResult = false;
	mockState.pinyinFails = false;
	mqState.matches = false;
	mqState.listeners = [];
	/* 共享 MockTransport 的内存态按用例清空，避免文档条目跨用例残留 */
	var sc = sharedClient();
	if (sc.transport.kind === 'mock') {
		sc.transport.documents.length = 0;
		sc.transport.recent.length = 0;
		sc.transport.files.clear();
	}
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

/* jsdom 无 ResizeObserver：模拟为「不触发」，屏幕预览缩放逻辑不依赖它也能渲染 */
if (typeof globalThis.ResizeObserver === 'undefined') {
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}

/* jsdom 无 matchMedia：可配置 matches，驱动窄屏抽屉测试（P1-4） */
var mqState = { matches: false, listeners: [] };
window.matchMedia = function (q) {
	return {
		matches: mqState.matches,
		media: q,
		addEventListener: function (type, fn) { if (type === 'change') mqState.listeners.push(fn); },
		removeEventListener: function (type, fn) {
			mqState.listeners = mqState.listeners.filter(function (f) { return f !== fn; });
		},
		addListener: function (fn) { mqState.listeners.push(fn); },
		removeListener: function (fn) {
			mqState.listeners = mqState.listeners.filter(function (f) { return f !== fn; });
		}
	};
};

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

describe('BigPreview', function () {
	it('打开后显示拼音：未预载时也会加载并补显', async function () {
		var rendered = null;
		try {
			rendered = render(<BigPreview
				char="永"
				strokeAnim={true}
				zg="url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2280%22%20height%3D%2280%22%3E%3C%2Fsvg%3E')"
				onClose={function () {}} />);
			await waitFor(function () {
				expect(document.querySelector('.overlay-pinyin').textContent).toBe('yǒng');
			});
			/* 字格背景铺到画布下层 */
			expect(document.querySelector('.overlay-stage').style.backgroundImage).toContain('url(');
			/* 默认不播笔顺（HanziWriter 字形是标准字形，与字帖字体不一致），显示当前字体静态字 */
			expect(mockState.playCalls).toBe(0);
			expect(document.querySelector('.overlay-stage-char').textContent).toBe('永');
		} finally {
			/* 先卸载，避免 React effect cleanup 读到已恢复的 mock */
			if (rendered) rendered.unmount();
		}
	});

	it('拼音格（isPy）：画布加高到 1.4×，降级单字对齐下区田字格', async function () {
		var rendered = null;
		try {
			rendered = render(<BigPreview
				char="永"
				strokeAnim={false}
				isPy={true}
				zg="url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2280%22%20height%3D%22112%22%3E%3C%2Fsvg%3E')"
				onClose={function () {}} />);
			await waitFor(function () {
				expect(document.querySelector('.overlay-pinyin').textContent).toBe('yǒng');
			});
			var stage = document.querySelector('.overlay-stage');
			expect(stage.classList.contains('is-py')).toBe(true);
			/* 降级（无笔顺）时静态字包一层，便于 CSS 定位到下区田字格 */
			expect(document.querySelector('.overlay-stage-char').textContent).toBe('永');
		} finally {
			if (rendered) rendered.unmount();
		}
	});

	it('字体位置：dx / dy 注入画布 CSS 变量（与字帖格子同源）', async function () {
		var rendered = null;
		try {
			rendered = render(<BigPreview
				char="永"
				strokeAnim={false}
				dx={0.2}
				dy={-0.1}
				zg="url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2280%22%20height%3D%2280%22%3E%3C%2Fsvg%3E')"
				onClose={function () {}} />);
			var stage = document.querySelector('.overlay-stage');
			expect(stage.style.getPropertyValue('--char-dx')).toBe('0.2');
			expect(stage.style.getPropertyValue('--char-dy')).toBe('-0.1');
		} finally {
			if (rendered) rendered.unmount();
		}
	});

	it('无笔顺数据时播放按钮禁用并提示原因（U4）', function () {
		var rendered = null;
		try {
			rendered = render(<BigPreview char="永" strokeAnim={false} zg="" onClose={function () {}} />);
			var btn = document.querySelector('.overlay-actions button');
			expect(btn.disabled).toBe(true);
			expect(btn.getAttribute('title')).toContain('暂无笔顺数据');
			fireEvent.click(btn);
			expect(mockState.playCalls).toBe(0);
		} finally {
			if (rendered) rendered.unmount();
		}
	});

	it('Esc 关闭并返还焦点到触发元素（统一 useFocusTrap · U4）', async function () {
		var trigger = document.createElement('button');
		trigger.textContent = '触发';
		document.body.appendChild(trigger);
		trigger.focus();
		var closed = 0;
		var rendered = null;
		try {
			rendered = render(<BigPreview char="永" strokeAnim={true} zg="" onClose={function () { closed++; }} />);
			await waitFor(function () { expect(document.querySelector('.overlay.is-open')).toBeTruthy(); });
			fireEvent.keyDown(document, { key: 'Escape' });
			expect(closed).toBe(1);
			expect(document.activeElement).toBe(trigger);
		} finally {
			if (rendered) rendered.unmount();
			trigger.remove();
		}
	});

	it('播放中显示 spinner 文案（忙碌态与导出链一致 · U4）', async function () {
		mockState.playResult = true;
		var rendered = null;
		try {
			rendered = render(<BigPreview char="永" strokeAnim={true} zg="" onClose={function () {}} />);
			var btn = document.querySelector('.overlay-actions button');
			fireEvent.click(btn);
			await waitFor(function () { expect(btn.querySelector('.rp-spinner')).toBeTruthy(); });
			expect(btn.textContent).toContain('播放中…');
		} finally {
			if (rendered) rendered.unmount();
		}
	});
});

describe('Preview', function () {
	it('按版式真源渲染页数 / 页码 / 计数与模板角色', function () {
		var config = store.getState().config;
		var layout = Z.SheetLayout.compute({
			content: config.Content, title: config.Title, template: config.Template,
			traceCount: config.TraceCount, cols: config.Cols, rowGap: config.RowGap,
			gridPx: config.GridSize, config: config
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

	it('预览缩放条：默认「适应」，手动 +/− 接管，点「适应」恢复', function () {
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		var container = rendered.container;
		var pctEl = container.querySelector('.rp-zoom-pct');
		var fitBtn = container.querySelector('.rp-zoom-fit');
		var num = function () { return parseInt(pctEl.textContent, 10); };
		var fitPct = num();
		expect(fitBtn.classList.contains('is-active')).toBe(true);

		/* 放大一档：百分比 +10，纸张 transform 同步，退出「适应」高亮 */
		fireEvent.click(container.querySelector('.rp-zoom-btn[aria-label="放大"]'));
		expect(num()).toBe(fitPct + 10);
		expect(fitBtn.classList.contains('is-active')).toBe(false);
		expect(container.querySelector('.rp-page-sheet').style.transform).toBe('scale(' + (num() / 100) + ')');

		/* 缩小一档回到原比例（仍为 manual） */
		fireEvent.click(container.querySelector('.rp-zoom-btn[aria-label="缩小"]'));
		expect(num()).toBe(fitPct);
		expect(fitBtn.classList.contains('is-active')).toBe(false);

		/* 适应：重新高亮，比例按当前视口重算 */
		fireEvent.click(fitBtn);
		expect(fitBtn.classList.contains('is-active')).toBe(true);
		expect(num()).toBe(fitPct);

		/* 边界：连续缩小到 30% 后按钮禁用 */
		for (var i = 0; i < 10; i++) {
			var minus = container.querySelector('.rp-zoom-btn[aria-label="缩小"]');
			if (minus.disabled) break;
			fireEvent.click(minus);
		}
		expect(num()).toBe(30);
		expect(container.querySelector('.rp-zoom-btn[aria-label="缩小"]').disabled).toBe(true);
	});

	it('控笔序列：逐行不同图案，背景按 cell.char 取 key', function () {
		act(function () {
			store.dispatch(switchMode('control'));
			store.dispatch(setContent('1\n2'));
			store.dispatch(setField({ key: 'ControlRows', value: 0 }));
		});
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		var rows = rendered.container.querySelectorAll('.row');
		expect(rows.length).toBeGreaterThanOrEqual(2);
		var first = rows[0].querySelector('.hz-line');
		var second = rows[1].querySelector('.hz-line');
		/* 前两行分别为横线 / 竖线剪影（逐行不同） */
		expect(first.getAttribute('aria-label')).toContain('控笔图案 横线');
		expect(second.getAttribute('aria-label')).toContain('控笔图案 竖线');
		expect(first.style.backgroundImage).toContain('url(');
		expect(first.style.backgroundImage).not.toBe(second.style.backgroundImage);
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

	it('多音字按行语境取音：预览使用 getLinePinyins 而非单字查询', function () {
		act(function () {
			store.dispatch(setContent('长大'));
			store.dispatch(setField({ key: 'ZgType', value: '5' }));
		});
		var rendered = renderWithStore(<Preview pinyinReady={true} />);
		var pys = Array.prototype.map.call(
			rendered.container.querySelectorAll('.cell-pinyin'),
			function (el) { return el.textContent; }
		);
		expect(pys).toContain('zhǎng');
		expect(pys).toContain('dà');
	});

	it('得分栏：ShowScore 开启后页脚出现「得分」，默认不渲染', function () {
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		var container = rendered.container;
		expect(container.querySelector('.rp-page-no').textContent).not.toContain('得分');
		act(function () {
			store.dispatch(setField({ key: 'ShowScore', value: true }));
		});
		expect(container.querySelector('.rp-page-no').textContent).toContain('得分：＿＿＿＿');
		act(function () {
			store.dispatch(setField({ key: 'ShowScore', value: false }));
		});
		expect(container.querySelector('.rp-page-no').textContent).not.toContain('得分');
	});

	it('输出页提供「显示得分栏」开关，联动配置', function () {
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('[data-page="output"]'));
		var box = rendered.container.querySelector('#showScore');
		expect(box).not.toBeNull();
		fireEvent.click(box);
		expect(store.getState().config.ShowScore).toBe(true);
	});

	it('落款（B4）：输出页开关 + 文本输入联动配置；留空不显示输入框', function () {
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('[data-page="output"]'));
		var box = rendered.container.querySelector('#showSignature');
		expect(box).not.toBeNull();
		expect(rendered.container.querySelector('#signatureText')).toBeNull(); /* 未开启不显示输入 */
		fireEvent.click(box);
		expect(store.getState().config.ShowSignature).toBe(true);
		var input = rendered.container.querySelector('#signatureText');
		expect(input).not.toBeNull();
		fireEvent.change(input, { target: { value: '甲辰年冬月书于灯下' } });
		expect(store.getState().config.SignatureText).toBe('甲辰年冬月书于灯下');
		fireEvent.click(box); /* 关闭后输入框消失，文本保留待再开 */
		expect(rendered.container.querySelector('#signatureText')).toBeNull();
		expect(store.getState().config.SignatureText).toBe('甲辰年冬月书于灯下');
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

	it('拼音格：字格 1×1.4（上四线占位 / 下田字格），预览显示拼音、字帖不显示', function () {
		act(function () {
			store.dispatch(setField({ key: 'ShowPinyin', value: true }));
			store.dispatch(setField({ key: 'ZgType', value: '5' }));
			store.dispatch(setContent('永'));
		});
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		var container = rendered.container;
		var cell = container.querySelector('.cell');
		expect(cell.className).toContain('has-pinyin');
		/* 预览显示拼音文字 */
		var py = container.querySelector('.cell-pinyin');
		expect(py).not.toBeNull();
		expect(py.style.backgroundImage || '').toBe('');
		/* 字格背景两侧一致：上区四线三格（顶线=外框、两虚线、末线实线与田字格顶边共用）+ 下区田字格（底/左右由外框充当） */
		var hz = container.querySelector('.hz-line');
		expect(hz.style.backgroundImage).toContain('M1%2010.67%20L79%2010.67');
		expect(hz.style.backgroundImage).toContain('M1%2021.33%20L79%2021.33');
		expect(hz.style.backgroundImage).toContain('M1%2032%20L79%2032');
		expect(hz.style.backgroundImage).toContain('M40%2032%20L40%20112');
		expect(hz.style.backgroundImage).toContain('M0%2072%20L80%2072');
		/* 顶 / 底不再各画一条线（避免与外框重叠出双线） */
		expect(hz.style.backgroundImage).not.toContain('M1%204%20L79%204');
		expect(hz.style.backgroundImage).not.toContain('M0%20108%20L80%20108');
		/* 关闭显示拼音：格子仍为拼音格（1.4 + 四线占位），仅不显示拼音文字 */
		act(function () {
			store.dispatch(setField({ key: 'ShowPinyin', value: false }));
		});
		expect(container.querySelector('.cell-pinyin')).toBeNull();
		expect(container.querySelector('.cell').className).toContain('has-pinyin');
		expect(container.querySelector('.hz-line').style.backgroundImage).toContain('M1%2032%20L79%2032');
	});

	it('非拼音格不显示拼音（ShowPinyin 仅拼音格生效）', function () {
		act(function () {
			store.dispatch(setField({ key: 'ShowPinyin', value: true }));
			store.dispatch(setField({ key: 'ZgType', value: '1' }));
			store.dispatch(setContent('永'));
		});
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		expect(rendered.container.querySelector('.cell-pinyin')).toBeNull();
		expect(rendered.container.querySelector('.cell').className).not.toContain('has-pinyin');
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

	it('beforeprint 同步展开：不包 act 也能断言第二页（P1-6）', function () {
		act(function () {
			store.dispatch(setContent('永\n\n永'));
		});
		var container = renderWithStore(<Preview pinyinReady={false} />).container;
		/* flushSync：打印引擎不等异步 setState，DOM 必须同步就绪 */
		window.dispatchEvent(new Event('beforeprint'));
		expect(container.querySelectorAll('.rp-page[data-page="1"] .hz-line').length).toBeGreaterThan(0);
	});

	it('afterprint 恢复按需渲染（P1-6）', function () {
		act(function () {
			store.dispatch(setContent('永\n\n永'));
		});
		var container = renderWithStore(<Preview pinyinReady={false} />).container;
		act(function () {
			window.dispatchEvent(new Event('beforeprint'));
		});
		expect(container.querySelectorAll('.rp-page[data-page="1"] .hz-line').length).toBeGreaterThan(0);
		act(function () {
			window.dispatchEvent(new Event('afterprint'));
		});
		/* 打印后不再常驻全部页（长文档滚动性能） */
		expect(container.querySelectorAll('.rp-page[data-page="1"] .hz-line').length).toBe(0);
	});

	it('单击字格进入编辑后，点击输入框不重置草稿（P0-1）', function () {
		vi.useFakeTimers();
		act(function () {
			store.dispatch(setContent('永'));
		});
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		var cell = rendered.container.querySelector('.hz-line[data-key="0-0-0"]');
		expect(cell).toBeTruthy();
		/* 单击字格 → 220ms 后进入编辑 */
		fireEvent.click(cell);
		act(function () { vi.advanceTimersByTime(220); });
		var input = document.querySelector('.hz-edit');
		expect(input).toBeTruthy();
		/* 输入新字（onDraftChange 取最后汉字） */
		fireEvent.change(input, { target: { value: '永红' } });
		expect(input.value).toBe('红');
		/* 点击输入框：不得冒泡成「重新打开编辑」把草稿重置为原字 */
		fireEvent.click(input);
		act(function () { vi.advanceTimersByTime(250); });
		expect(document.querySelector('.hz-edit').value).toBe('红');
		/* 字格无障碍语义：单击编辑 / 双击或按空格放大（文案与 onCellKeyDown 的 Space 行为一致） */
		expect(cell.getAttribute('aria-label')).toBe('编辑 永，双击或按空格放大查看');
	});

	it('双击字格打开放大预览，并取消待定单击编辑（P3-18）', function () {
		vi.useFakeTimers();
		var rendered = null;
		try {
			act(function () {
				store.dispatch(setContent('永'));
			});
			rendered = renderWithStore(<Preview pinyinReady={false} />);
			var cell = rendered.container.querySelector('.hz-line[data-key="0-0-0"]');
			expect(cell).toBeTruthy();
			/* 双击 = 两次 click + dblclick：第一击启动 220ms 单击计时，第二击取消待定编辑 */
			fireEvent.click(cell);
			fireEvent.click(cell);
			fireEvent.doubleClick(cell);
			act(function () { vi.advanceTimersByTime(250); });
			expect(document.querySelector('.hz-edit')).toBeNull();
			expect(document.querySelector('.overlay.is-open')).toBeTruthy();
			expect(document.querySelector('.overlay-stage')).toBeTruthy();
		} finally {
			if (rendered) rendered.unmount();
		}
	});

	it('多页分页：页码连续，打印前按需 / 打印全量（P3-18）', function () {
		act(function () {
			store.dispatch(setContent('永\n\n永')); /* 空行强制分页 → 2 页 */
		});
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		var container = rendered.container;
		expect(container.querySelectorAll('.rp-page')).toHaveLength(2);
		expect(container.querySelectorAll('.rp-page-no')).toHaveLength(2);
		expect(container.querySelectorAll('.rp-page-no')[0].textContent).toContain('第 1 / 2 页');
		expect(container.querySelectorAll('.rp-page-no')[1].textContent).toContain('第 2 / 2 页');
		/* 按需渲染：第二页占位无字格；beforeprint 全量展开 */
		expect(container.querySelectorAll('.rp-page[data-page="1"] .hz-line').length).toBe(0);
		act(function () {
			window.dispatchEvent(new Event('beforeprint'));
		});
		expect(container.querySelectorAll('.rp-page[data-page="1"] .hz-line').length).toBeGreaterThan(0);
	});

	it('行区结构：.rows 包裹行，行距 = 配置格倍数（P3-19）', function () {
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		var content = document.getElementById('printContent');
		var rows = rendered.container.querySelector('.page-block .rows');
		expect(rows).toBeTruthy();
		/* .rows 的直接子元素全部是 .row（标题在 .rows 外，不参与行距） */
		expect(rows.children.length).toBeGreaterThan(0);
		Array.prototype.forEach.call(rows.children, function (c) {
			expect(c.classList.contains('row')).toBe(true);
		});
		/* 行距 = 配置格倍数 × 格宽：--row-gap 由版式真源 gapMm/gridMm 注入 */
		var ratio = Number(content.style.getPropertyValue('--row-gap'));
		expect(Math.abs(ratio - 0.12) < 1e-9).toBe(true);
		/* 改行距后 --row-gap 精确跟随（旧实现把行距均分到整页高度，存在死区） */
		act(function () { store.dispatch(setField({ key: 'RowGap', value: 0.4 })); });
		var content2 = document.getElementById('printContent');
		expect(Math.abs(Number(content2.style.getPropertyValue('--row-gap')) - 0.4) < 1e-9).toBe(true);
		/* 有标题时标题不计入行区 */
		act(function () { store.dispatch(setField({ key: 'Title', value: '基本笔画练习' })); });
		var rows2 = rendered.container.querySelector('.page-block .rows');
		expect(rows2.querySelectorAll('.row').length).toBe(rows2.children.length);
		expect(rendered.container.querySelector('.page-block .sheet-title')).toBeTruthy();
	});

	it('宽高比：GridRatio 0=自动（非拼音 1.0），用户值改变 --cell-ratio 与行距', function () {
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		var content = document.getElementById('printContent');
		expect(Number(content.style.getPropertyValue('--cell-ratio'))).toBe(1);
		act(function () { store.dispatch(setField({ key: 'GridRatio', value: 120 })); });
		var content2 = document.getElementById('printContent');
		expect(Number(content2.style.getPropertyValue('--cell-ratio'))).toBeCloseTo(1.2, 9);
		/* 行距 = 行盒高（格宽 × 宽高比）× 配置倍率 → --row-gap 随宽高比放大 */
		expect(Number(content2.style.getPropertyValue('--row-gap'))).toBeCloseTo(0.144, 9);
	});

	it('节奏描红：Template=rhythm 按范字/描红/临写分布，且逐行递减', function () {
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		act(function () {
			store.dispatch(setContent('永永不不是是\n永永不不是是'));
			store.dispatch(setField({ key: 'Template', value: 'rhythm' }));
			store.dispatch(setField({ key: 'TraceModel', value: 1 }));
			store.dispatch(setField({ key: 'TraceTrace', value: 2 }));
			store.dispatch(setField({ key: 'TraceDecay', value: 1 }));
		});
		var rows = rendered.container.querySelectorAll('.rows .row');
		function roles(row) {
			return Array.prototype.map.call(row.querySelectorAll('.hz-line'), function (el) {
				var m = el.className.match(/is-(model|trace|blank)/);
				return m ? m[1] : '';
			});
		}
		/* 第 1 行：1 范 + 2 描 + 其余临写 */
		expect(roles(rows[0]).slice(0, 4)).toEqual(['model', 'trace', 'trace', 'blank']);
		/* 第 2 行：描红递减 1 → 1 范 + 1 描 + 临写 */
		expect(roles(rows[1]).slice(0, 3)).toEqual(['model', 'trace', 'blank']);
	});

	it('字格页：格线粗细 / 样式控件存在并生效', function () {
		var rendered = renderWithStore(<Panel />);
		act(function () { rendered.container.querySelector('button[data-page="grid"]').click(); });
		expect(document.getElementById('zgLineScale')).toBeTruthy();
		var modes = Array.prototype.map.call(rendered.container.querySelectorAll('.rp-field .rp-tpl button'), function (b) { return b.textContent; });
		expect(modes).toEqual(expect.arrayContaining(['实线', '虚线', '无框']));
		/* 切换虚线外框 → 字格缩略图背景含 stroke-dasharray（与预览 / PDF 同源） */
		act(function () {
			var btn = Array.prototype.find.call(rendered.container.querySelectorAll('.rp-field .rp-tpl button'), function (b) { return b.textContent === '虚线'; });
			btn.click();
		});
		expect(store.getState().config.ZgLineMode).toBe('dashed');
		var icon = rendered.container.querySelector('.rp-zg-icon');
		expect(icon.style.backgroundImage).toContain('stroke-dasharray');
	});

	it('字格页：推荐搭配一键套用外观', function () {
		var rendered = renderWithStore(<Panel />);
		act(function () { rendered.container.querySelector('button[data-page="grid"]').click(); });
		var chips = Array.prototype.map.call(rendered.container.querySelectorAll('.rp-scheme-btn'), function (b) { return b.textContent; });
		expect(chips).toEqual(['低年级', '英语本', '毛笔隶书']);
		act(function () { rendered.container.querySelectorAll('.rp-scheme-btn')[1].click(); });
		var cfg = store.getState().config;
		expect(cfg.ZgType).toBe('9');           /* 英语本 → 四线格 */
		expect(cfg.ZgInnerLineMode).toBe('dashed');
		expect(cfg.ZgOpacity).toBe(100);        /* 不覆盖用户已有颜色类字段之外的配色 */
	});

	it('字格页：条件参数滑杆随格型出现并生效', function () {
		var rendered = renderWithStore(<Panel />);
		act(function () { rendered.container.querySelector('button[data-page="grid"]').click(); });
		/* 默认「米字回字」→ 内框边距可见 */
		expect(document.getElementById('zgInnerRatio')).toBeTruthy();
		fireEvent.change(document.getElementById('zgInnerRatio'), { target: { value: '40' } });
		expect(store.getState().config.ZgInnerRatio).toBe(40);
		/* 切到英文四线格 → 中间区高度可见、内框边距隐藏 */
		fireEvent.click(screen.getByRole('button', { name: '英文四线格' }));
		expect(store.getState().config.ZgType).toBe('9');
		expect(document.getElementById('zgEngMid')).toBeTruthy();
		expect(document.getElementById('zgInnerRatio')).toBeFalsy();
		/* 切回田字格 → 起笔点标记可见且可勾选 */
		fireEvent.click(screen.getByRole('button', { name: '田字格' }));
		var dot = document.getElementById('zgStartDot');
		expect(dot).toBeTruthy();
		fireEvent.click(dot);
		expect(store.getState().config.ZgStartDot).toBe(true);
		/* 拼音格不显示起笔点 */
		fireEvent.click(screen.getByRole('button', { name: '拼音格' }));
		expect(document.getElementById('zgStartDot')).toBeFalsy();
	});

	it('字格页：线端样式 / 点划线 / 细线锐利控件生效', function () {
		var rendered = renderWithStore(<Panel />);
		act(function () { rendered.container.querySelector('button[data-page="grid"]').click(); });
		var tplTexts = Array.prototype.map.call(rendered.container.querySelectorAll('.rp-field .rp-tpl button'), function (b) { return b.textContent; });
		expect(tplTexts).toEqual(expect.arrayContaining(['划线', '圆点', '点划线']));
		expect(tplTexts).toEqual(expect.arrayContaining(['平头', '圆头', '方头']));
		fireEvent.click(screen.getByRole('button', { name: '方头' }));
		expect(store.getState().config.ZgLineCap).toBe('square');
		fireEvent.click(screen.getByRole('button', { name: '点划线' }));
		expect(store.getState().config.ZgDashStyle).toBe('dashdot');
		fireEvent.click(document.getElementById('zgCrisp'));
		expect(store.getState().config.ZgCrisp).toBe(true);
	});

	it('字格页：恢复默认外观重置 grid 组', function () {
		var rendered = renderWithStore(<Panel />);
		act(function () { rendered.container.querySelector('button[data-page="grid"]').click(); });
		act(function () {
			store.dispatch(setField({ key: 'ZgType', value: '9' }));
			store.dispatch(setField({ key: 'ZgColor', value: '3' }));
			store.dispatch(setField({ key: 'ZgLineScale', value: 200 }));
		});
		fireEvent.click(screen.getByRole('button', { name: '恢复默认外观' }));
		var cfg = store.getState().config;
		expect(cfg.ZgType).toBe('3');
		expect(cfg.ZgColor).toBe('1');
		expect(cfg.ZgLineScale).toBe(100);
		expect(cfg.ZgStartDot).toBe(false);
	});

	it('垂直对齐：.rows 按配置切换 is-top / is-bottom（默认居中无修饰 class）', function () {
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		var rows = rendered.container.querySelector('.page-block .rows');
		expect(rows.classList.contains('is-top')).toBe(false);
		expect(rows.classList.contains('is-bottom')).toBe(false);
		act(function () { store.dispatch(setField({ key: 'VerticalAlign', value: 'top' })); });
		var rowsTop = rendered.container.querySelector('.page-block .rows');
		expect(rowsTop.classList.contains('is-top')).toBe(true);
		expect(rowsTop.classList.contains('is-bottom')).toBe(false);
		act(function () { store.dispatch(setField({ key: 'VerticalAlign', value: 'bottom' })); });
		var rowsBottom = rendered.container.querySelector('.page-block .rows');
		expect(rowsBottom.classList.contains('is-bottom')).toBe(true);
		expect(rowsBottom.classList.contains('is-top')).toBe(false);
	});

	it('字格切换：行数 / 行距随字格类型重算（拼音格行盒 1.4×，普通格 1.0×）', function () {
		/* 回归：layout useMemo 依赖漏 ZgType 时，切换字格命中旧缓存——
		 * 行数 / 行距仍是旧字格，格子却已按新字格渲染，内容把纸张撑高。 */
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		function rowCount() { return rendered.container.querySelectorAll('.rows .row').length; }
		function rowGap() { return Number(document.getElementById('printContent').style.getPropertyValue('--row-gap')); }
		var normalRows = rowCount();
		var normalGap = rowGap();
		expect(normalRows).toBeGreaterThan(1);
		act(function () { store.dispatch(setField({ key: 'ZgType', value: '5' })); });
		/* 行盒 1.4× → 每页行数减少；行距 = 行盒 × 0.12 等比放大 */
		expect(rowCount()).toBeLessThan(normalRows);
		expect(rowGap()).toBeGreaterThan(normalGap);
		act(function () { store.dispatch(setField({ key: 'ZgType', value: '1' })); });
		expect(rowCount()).toBe(normalRows);
		expect(rowGap()).toBe(normalGap);
	});

	it('空内容：显示开始引导而非空页，统计文案切换', function () {
		act(function () { store.dispatch(setContent('')); });
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		expect(rendered.container.querySelector('.rp-empty')).toBeTruthy();
		expect(rendered.container.querySelectorAll('.rp-page').length).toBe(0);
		expect(rendered.container.querySelector('.rp-count').textContent).toContain('未开始');
		/* 载入内容后恢复字帖页 */
		act(function () { store.dispatch(setContent('永')); });
		expect(rendered.container.querySelector('.rp-empty')).toBeNull();
		expect(rendered.container.querySelectorAll('.rp-page').length).toBeGreaterThan(0);
	});

	it('字体位置：--char-dx / --char-dy 随配置注入（供 .hz-line translate 消费）', function () {
		renderWithStore(<Preview pinyinReady={false} />);
		var content = document.getElementById('printContent');
		expect(content.style.getPropertyValue('--char-dx')).toBe('0');
		expect(content.style.getPropertyValue('--char-dy')).toBe('0');
		act(function () {
			store.dispatch(setField({ key: 'CharOffsetX', value: 0.2 }));
			store.dispatch(setField({ key: 'CharOffsetY', value: -0.15 }));
		});
		var content2 = document.getElementById('printContent');
		expect(content2.style.getPropertyValue('--char-dx')).toBe('0.2');
		expect(content2.style.getPropertyValue('--char-dy')).toBe('-0.15');
	});

	it('打印 @page 按配置注入 size/margin（P3-20）', function () {
		renderWithStore(<Preview pinyinReady={false} />);
		var el = document.getElementById('zitie-page-rule');
		expect(el).toBeTruthy();
		expect(el.textContent).toContain('@page');
		expect(el.textContent).toContain('size: 210mm 297mm');
		expect(el.textContent).toContain('margin: 5mm 16mm 5mm 16mm');
		/* 改配置后规则随之更新，并把下边距（px）暴露给页码定位 */
		act(function () { store.dispatch(setField({ key: 'Page', value: { width: 148, height: 210 } })); });
		expect(el.textContent).toContain('size: 148mm 210mm');
		act(function () { store.dispatch(setField({ key: 'Margin', value: { top: 20, right: 20, bottom: 20, left: 20 } })); });
		expect(el.textContent).toContain('margin: 20mm 20mm 20mm 20mm');
		expect(el.textContent).toContain('--print-mb-px: 75.59');
	});

	it('落款行（B4）：开启 + 有文本 → 每页渲染；关闭或留空 → 不渲染', function () {
		act(function () {
			store.dispatch(setField({ key: 'ShowSignature', value: true }));
			store.dispatch(setField({ key: 'SignatureText', value: '甲辰年冬月书于灯下' }));
		});
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		var pages = rendered.container.querySelectorAll('.rp-page');
		expect(pages.length).toBeGreaterThan(0);
		var sigs = rendered.container.querySelectorAll('.sheet-signature');
		expect(sigs).toHaveLength(pages.length); /* 每页一条 */
		expect(sigs[0].textContent).toBe('甲辰年冬月书于灯下');

		/* 留空按未开启处理 */
		act(function () { store.dispatch(setField({ key: 'SignatureText', value: '' })); });
		expect(rendered.container.querySelector('.sheet-signature')).toBeNull();

		/* 关闭开关同样不渲染 */
		act(function () {
			store.dispatch(setField({ key: 'SignatureText', value: '乙巳年春月' }));
			store.dispatch(setField({ key: 'ShowSignature', value: false }));
		});
		expect(rendered.container.querySelector('.sheet-signature')).toBeNull();
	});
});

	describe('store：undo/redo 与多标签页同步（P3-14）', function () {
		beforeEach(function () {
			act(function () { store.dispatch(setContent('永')); });
			act(function () { store.dispatch(resetHistory()); });
		});

		it('undo/redo：入栈 / 新分支清空 redo / 边界', function () {
			act(function () { store.dispatch(setContent('甲')); });
			act(function () { store.dispatch(setContent('乙')); });
			expect(store.getState().config.history.past.map(function (s) { return s.Content; })).toEqual(['永', '甲']);
			expect(store.getState().config.history.future).toEqual([]);
			expect(undoContent()).toBe(true);
			expect(store.getState().config.Content).toBe('甲');
			expect(store.getState().config.history.future.map(function (s) { return s.Content; })).toEqual(['乙']);
			expect(redoContent()).toBe(true);
			expect(store.getState().config.Content).toBe('乙');
			/* 新变更清空 redo 栈 */
			act(function () { store.dispatch(setContent('丙')); });
			expect(store.getState().config.history.future).toEqual([]);
			expect(redoContent()).toBe(false);
			expect(store.getState().config.Content).toBe('丙');
			/* 连续 undo 到空后返回 false（'丙'→'乙'→'甲'→'永' 共 3 步） */
			expect(undoContent()).toBe(true);
			expect(undoContent()).toBe(true);
			expect(undoContent()).toBe(true);
			expect(store.getState().config.Content).toBe('永');
			expect(undoContent()).toBe(false);
		});

		it('undo/redo：历史上限 100', function () {
			for (var i = 0; i < 150; i++) {
				var v = '字' + i;
				act(function () { store.dispatch(setContent(v)); });
			}
			expect(store.getState().config.history.past.length).toBe(100);
		});

		it('undo/redo：切换类型后 Ctrl+Z 整体回退 Mode / 版式 / 内容（P0-2）', function () {
			act(function () { store.dispatch(setContent('甲乙')); });
			act(function () { store.dispatch(setField({ key: 'Template', value: 'trace' })); });
			act(function () { store.dispatch(switchMode('number')); });
			expect(store.getState().config.Mode).toBe('number');
			expect(store.getState().config.ZgType).toBe('7'); /* 推荐数字格 */
			act(function () { store.dispatch(setContent('0123')); });
			/* 第一次撤销：回到切类型时的 number 初始态（内容为空、模式仍 number） */
			expect(undoContent()).toBe(true);
			expect(store.getState().config.Content).toBe('');
			expect(store.getState().config.Mode).toBe('number');
			/* 第二次撤销：跨类型整体回退到汉字 + 描红模板 + 内容甲乙 */
			expect(undoContent()).toBe(true);
			expect(store.getState().config.Mode).toBe('hanzi');
			expect(store.getState().config.Template).toBe('trace');
			expect(store.getState().config.Content).toBe('甲乙');
			/* redo 可重放到 number 输入态 */
			expect(redoContent()).toBe(true);
			expect(redoContent()).toBe(true);
			expect(store.getState().config.Mode).toBe('number');
			expect(store.getState().config.Content).toBe('0123');
		});

		it('undo/redo：导入 / 单字编辑 / 重置均可撤销', function () {
			act(function () { store.dispatch(setContent('永永')); });
			act(function () { store.dispatch(importConfig({ Content: '导入' })); });
			expect(store.getState().config.Content).toBe('导入');
			expect(undoContent()).toBe(true);
			expect(store.getState().config.Content).toBe('永永');
			act(function () { store.dispatch(replaceHan({ index: 0, char: '甲' })); });
			/* index 为汉字序号（从 0 起）：第 0 个字「永」→「甲」 */
			expect(store.getState().config.Content).toBe('甲永');
			expect(undoContent()).toBe(true);
			expect(store.getState().config.Content).toBe('永永');
			act(function () { store.dispatch(resetConfig()); });
			expect(store.getState().config.Content).toBe('永');
			expect(undoContent()).toBe(true);
			expect(store.getState().config.Content).toBe('永永');
		});

		it('多标签页：storage 事件同步另一标签页写盘', function () {
			var other = Object.assign({}, store.getState().config);
			other.Content = '另一标签页';
			var raw = JSON.stringify(other);
			try { window.localStorage.setItem('zitie.config', raw); } catch (e) { /* 忽略 */ }
			act(function () {
				var ev = new Event('storage');
				ev.key = 'zitie.config';
				ev.newValue = raw;
				window.dispatchEvent(ev);
			});
			expect(store.getState().config.Content).toBe('另一标签页');
			/* 其他存储键不同步 */
			act(function () { store.dispatch(setContent('本地')); });
			act(function () {
				var ev = new Event('storage');
				ev.key = 'zitie-lite.config';
				ev.newValue = raw;
				window.dispatchEvent(ev);
			});
			expect(store.getState().config.Content).toBe('本地');
	});
});

describe('字帖类型 tab（P0-1 / P1-3 / P2-6 / P2-7）', function () {
	it('切换类型：各类型独立记忆内容与版式，首次进入用推荐默认', function () {
		vi.useFakeTimers();
		act(function () {
			store.dispatch(setContent('甲乙'));
			store.dispatch(setField({ key: 'Template', value: 'trace' }));
			store.dispatch(setField({ key: 'ZgType', value: '3' }));
		});
		/* 首次切到英文：推荐默认（田字格、空内容、normal），不继承汉字侧 */
		act(function () { store.dispatch(switchMode('english')); });
		expect(store.getState().config.Mode).toBe('english');
		expect(store.getState().config.ZgType).toBe('1');
		expect(store.getState().config.Content).toBe('');
		expect(store.getState().config.Template).toBe('normal');
		act(function () {
			store.dispatch(setContent('Hello World'));
			store.dispatch(setField({ key: 'Template', value: 'trace3' }));
		});
		/* 切回汉字：恢复切换前的内容 + 描红 + 米回格 */
		act(function () { store.dispatch(switchMode('hanzi')); });
		expect(store.getState().config.Content).toBe('甲乙');
		expect(store.getState().config.Template).toBe('trace');
		expect(store.getState().config.ZgType).toBe('3');
		/* 再切回英文：恢复英文侧记忆 */
		act(function () { store.dispatch(switchMode('english')); });
		expect(store.getState().config.Content).toBe('Hello World');
		expect(store.getState().config.Template).toBe('trace3');
		/* 入库快照随 zitie.config 主链（防抖落盘） */
		expect(store.getState().config.ModeStates.hanzi.Content).toBe('甲乙');
		expect(store.getState().config.ModeStates.english.Content).toBe('Hello World');
		act(function () { vi.advanceTimersByTime(200); });
		var saved = JSON.parse(window.localStorage.getItem('zitie.config') || '{}');
		expect(saved.Mode).toBe('english');
		expect(saved.ModeStates.hanzi.Content).toBe('甲乙');
		expect(saved.ModeStates.english.Content).toBe('Hello World');
	});

	it('控笔练习行数可撤销（ControlRows 纳入类型快照，P1-3）', function () {
		act(function () { store.dispatch(switchMode('control')); });
		act(function () { store.dispatch(setField({ key: 'ControlRows', value: 3 })); });
		act(function () { store.dispatch(setField({ key: 'ControlRows', value: 5 })); });
		expect(store.getState().config.ControlRows).toBe(5);
		/* Ctrl+Z 逐步回退：5 行 → 3 行 → 0 行（仍为控笔）→ 切换前的汉字 */
		expect(undoContent()).toBe(true);
		expect(store.getState().config.Mode).toBe('control');
		expect(store.getState().config.ControlRows).toBe(3);
		expect(undoContent()).toBe(true);
		expect(store.getState().config.Mode).toBe('control');
		expect(store.getState().config.ControlRows).toBe(0);
		expect(undoContent()).toBe(true);
		expect(store.getState().config.Mode).toBe('hanzi');
		expect(store.getState().config.ControlRows).toBe(0);
		/* redo 重放：控笔 0 行 → 3 行 */
		expect(redoContent()).toBe(true);
		expect(store.getState().config.Mode).toBe('control');
		expect(store.getState().config.ControlRows).toBe(0);
		expect(redoContent()).toBe(true);
		expect(store.getState().config.ControlRows).toBe(3);
	});

	it('tab 无障碍：aria 关联 + roving tabindex；左右方向键切换并聚焦（P2-6）', function () {
		var rendered = renderWithStore(<Panel />);
		var tabs = Array.prototype.slice.call(rendered.container.querySelectorAll('[role="tab"]'));
		expect(tabs.length).toBe(Z.MODES.length);
		var current = tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0];
		expect(current.tabIndex).toBe(0);
		tabs.filter(function (t) { return t !== current; }).forEach(function (t) { expect(t.tabIndex).toBe(-1); });
		/* tabpanel 与当前 tab 互相关联 */
		var panel = rendered.container.querySelector('[role="tabpanel"]');
		expect(panel.id).toBe('zitie-tabpanel-' + store.getState().config.Mode);
		expect(current.getAttribute('aria-controls')).toBe(panel.id);
		expect(panel.getAttribute('aria-labelledby')).toBe(current.id);
		/* ArrowRight：切换到笔画并聚焦目标 tab（roving tabindex 跟随） */
		fireEvent.keyDown(rendered.container.querySelector('[role="tablist"]'), { key: 'ArrowRight' });
		expect(store.getState().config.Mode).toBe('stroke');
		var strokeTab = document.getElementById('zitie-tab-stroke');
		expect(strokeTab.getAttribute('aria-selected')).toBe('true');
		expect(document.activeElement).toBe(strokeTab);
		/* End / Home：跳到末个 / 首个 */
		fireEvent.keyDown(rendered.container.querySelector('[role="tablist"]'), { key: 'End' });
		expect(store.getState().config.Mode).toBe('control');
		fireEvent.keyDown(rendered.container.querySelector('[role="tablist"]'), { key: 'Home' });
		expect(store.getState().config.Mode).toBe('hanzi');
	});

	it('英文模式统计标题为「字母统计」（P2-7）', function () {
		act(function () { store.dispatch(switchMode('english')); });
		renderWithStore(<Panel />);
		expect(screen.getByText(/字母统计/)).toBeTruthy();
		expect(screen.queryByText(/重复字统计/)).toBeNull();
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
		/* 内容工具默认折叠，展开后才可见 */
		fireEvent.click(screen.getByText('内容工具'));
		expect(screen.getByRole('button', { name: '插入空格' })).toBeTruthy();
		openPanelPage('版式');
		expect(screen.getAllByText(/每行 \d+ 格/).length).toBeGreaterThan(0);
		openPanelPage('字格');
		expect(screen.getByText('田字格')).toBeTruthy();
		openPanelPage('更多');
		expect(screen.getAllByText(/墨帖 v/).length).toBeGreaterThan(0);
	});

	it('模板按钮写入 store（配置真源）', function () {
		renderWithStore(<Panel />);
		openPanelPage('版式');
		fireEvent.click(screen.getByRole('button', { name: '整页描红' }));
		expect(store.getState().config.Template).toBe('trace');
		expect(screen.getAllByText(/每行 \d+ 格/).length).toBeGreaterThan(0);
	});

	it('边距输入写入 store（patch 必须用计算属性名）', function () {
		renderWithStore(<Panel />);
		openPanelPage('版式');
		fireEvent.change(document.getElementById('margin-top'), { target: { value: '20' } });
		expect(store.getState().config.Margin.top).toBe(20);
		/* 只改被操作的那一项，其余键不受影响 */
		expect(store.getState().config.Margin.left).toBe(16);
		fireEvent.change(document.getElementById('margin-left'), { target: { value: '8' } });
		expect(store.getState().config.Margin.left).toBe(8);
		expect(store.getState().config.Margin.top).toBe(20);
	});

	it('预设保存写入 localStorage', function () {
		renderWithStore(<div><Panel /><ToastHost /></div>);
		openPanelPage('版式');
		var input = document.getElementById('presetName');
		fireEvent.change(input, { target: { value: '硬笔' } });
		fireEvent.click(screen.getByRole('button', { name: '保存' }));
		var presets = JSON.parse(window.localStorage.getItem('zitie.presets') || '{}');
		expect(presets['硬笔']).toBeTruthy();
		expect(screen.getByText('已保存预设「硬笔」。')).toBeTruthy();
	});

	it('清空需二次确认，确认后可用 Ctrl+Z 撤销', function () {
		renderWithStore(<div><Panel /><ToastHost /></div>);
		fireEvent.click(screen.getByText('内容工具'));
		fireEvent.change(document.getElementById('content'), { target: { value: '永红' } });
		expect(store.getState().config.Content).toBe('永红');
		/* 第一次点击仅进入确认态，内容不变 */
		fireEvent.click(screen.getByRole('button', { name: '清空' }));
		expect(store.getState().config.Content).toBe('永红');
		fireEvent.click(screen.getByRole('button', { name: '确认清空' }));
		expect(store.getState().config.Content).toBe('');
		expect(screen.getByText(/已清空/)).toBeTruthy();
		/* 撤销恢复清空前内容 */
		fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
		expect(store.getState().config.Content).toBe('永红');
	});

	it('插入空白页：按版式行数追加独立一整页空临格，可撤销', function () {
		renderWithStore(<div><Panel /><ToastHost /></div>);
		fireEvent.click(screen.getByText('内容工具'));
		function layoutOf() {
			var c = store.getState().config;
			return Z.SheetLayout.compute({
				content: c.Content, title: c.Title, template: c.Template, traceCount: c.TraceCount,
				cols: c.Cols, rowGap: c.RowGap, gridPx: c.GridSize, config: c
			});
		}
		/* 非空内容：原内容页保留，末尾新增一整页空临格（行数 = 版式每页行数） */
		var before = layoutOf();
		fireEvent.click(screen.getByRole('button', { name: '插入空白页' }));
		var after = layoutOf();
		expect(after.pages.length).toBe(before.pages.length + 1);
		expect(after.pages[after.pages.length - 1].lines.length).toBe(after.rows);
		expect(screen.getByText(/已新增一整页空临格/)).toBeTruthy();
		/* 撤销恢复 */
		fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
		expect(store.getState().config.Content).toBe('永');
		/* 空内容：直接生成一整页 */
		fireEvent.change(document.getElementById('content'), { target: { value: '' } });
		fireEvent.click(screen.getByRole('button', { name: '插入空白页' }));
		after = layoutOf();
		expect(after.pages.length).toBe(1);
		expect(after.pages[0].lines.length).toBe(after.rows);
	});

	it('预览字样：输入即预览（大字样式），不再重复只读预览', function () {
		renderWithStore(<Panel />);
		openPanelPage('文字');
		var input = document.getElementById('previewText');
		expect(input).toBeTruthy();
		expect(input.placeholder).toBe('天地玄黄，宇宙洪荒');
		expect(input.className).toContain('rp-font-preview-input');
		/* 旧的空态只读预览（.rp-font-preview-default）已移除，避免同内容两处展示 */
		expect(document.querySelector('.rp-font-preview-default')).toBeNull();
		/* 输入即更新配置，供字体列表同步预览 */
		fireEvent.change(input, { target: { value: '天地玄黄' } });
		expect(store.getState().config.PreviewText).toBe('天地玄黄');
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
		var orig = Z.FontStore.available;
		Z.FontStore.available = function () { return false; };
		try {
			renderWithStore(<Panel />);
			openPanelPage('文字');
			expect(screen.getByText(/不支持本地字体存储/)).toBeTruthy();
			expect(document.querySelector('input[type="file"][accept*="ttf"]')).toBeNull();
		} finally {
			Z.FontStore.available = orig;
		}
	});

	it('打印：空内容提示且不输出，非空才打印（P3-15）', function () {
		var origPrint = window.print;
		var calls = 0;
		window.print = function () { calls++; };
		function Probe() {
			var print = usePrint();
			return <button type="button" onClick={print}>打印</button>;
		}
		try {
			/* 默认内容为「永」，先清空以构造空内容场景 */
			act(function () { store.dispatch(setContent('')); });
			renderWithStore(<div><Probe /><ToastHost /></div>);
			/* 空内容：提示 + 不调用 window.print（与导出 PDF 一致） */
			fireEvent.click(screen.getByRole('button', { name: '打印' }));
			expect(calls).toBe(0);
			expect(screen.getByText('请先输入字帖内容')).toBeTruthy();
			/* 非空：正常打印 */
			act(function () { store.dispatch(setContent('永')); });
			fireEvent.click(screen.getByRole('button', { name: '打印' }));
			expect(calls).toBe(1);
		} finally {
			window.print = origPrint;
		}
	});

	it('输出页打印按钮调用 onPrint（P3-15）', function () {
		var fn = vi.fn();
		renderWithStore(<Panel onPrint={fn} />);
		openPanelPage('输出');
		fireEvent.click(screen.getByRole('button', { name: '打印' }));
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('输出页：PDF 生成中导出按钮显示 spinner、打印同步禁用', function () {
		renderWithStore(<Panel pdfBusy={true} onExportPdf={vi.fn()} onPrint={vi.fn()} />);
		openPanelPage('输出');
		expect(screen.getByRole('button', { name: /正在生成 PDF/ }).disabled).toBe(true);
		expect(document.querySelector('.rp-spinner')).toBeTruthy();
		expect(screen.getByRole('button', { name: '打印' }).disabled).toBe(true);
	});

	it('内容输入框带开始指引 placeholder', function () {
		renderWithStore(<Panel />);
		expect(document.getElementById('content').getAttribute('placeholder')).toContain('空行分页');
	});

	it('滑杆 label 与 id 关联：点击文字可聚焦（P0-3）', function () {
		renderWithStore(<Panel />);
		openPanelPage('版式');
		var rowGap = screen.getByLabelText('行距（相对格子高）');
		var traceCount = screen.getByLabelText('描红范字数（一字三描红）');
		openPanelPage('字格');
		var gridSize = screen.getByLabelText('格子大小');
		openPanelPage('文字');
		var inkAlpha = screen.getByLabelText('深浅');
		[rowGap, traceCount, gridSize, inkAlpha].forEach(function (el) {
			expect(el.tagName).toBe('INPUT');
			expect(el.type).toBe('range');
		});
	});

	it('控笔面板：全部纯图形图案按钮 + 练习行数上限 200（P：控笔扩充）', function () {
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('tab', { name: '控笔' }));
		var btns = document.querySelectorAll('.rp-pattern-btn');
		expect(btns.length).toBe(Z.CONTROL_PATTERN_KEYS.length);
		var names = [];
		btns.forEach(function (btn) {
			/* 纯图形：图形字符以 aria-hidden 角标呈现（不参与朗读） */
			expect(btn.querySelector('svg path')).toBeTruthy();
			var alias = btn.querySelector('.rp-pattern-alias');
			expect(alias).toBeTruthy();
			expect(alias.getAttribute('aria-hidden')).toBe('true');
			expect(btn.getAttribute('aria-label')).toBeTruthy();
			names.push(btn.getAttribute('aria-label'));
		});
		/* 名称齐全且不重复 */
		expect(new Set(names).size).toBe(Z.CONTROL_PATTERN_KEYS.length);
		/* 默认选中横线；点击「方框」写入 store 并切换选中态 */
		expect(store.getState().config.ControlPattern).toBe('line-h');
		var square = Array.prototype.filter.call(btns, function (b) { return b.getAttribute('aria-label') === '方框'; })[0];
		fireEvent.click(square);
		expect(store.getState().config.ControlPattern).toBe('square');
		expect(square.className).toContain('is-active');
		/* 练习行数输入 max=200，超限夹取到 200 */
		var rows = document.getElementById('controlRows');
		expect(rows.max).toBe('200');
		fireEvent.change(rows, { target: { value: '999' } });
		expect(store.getState().config.ControlRows).toBe(200);
		fireEvent.change(rows, { target: { value: '25' } });
		expect(store.getState().config.ControlRows).toBe(25);
		/* 图形序列：写入 Content（供 content.js 逐行解析为图案） */
		var seq = document.getElementById('controlSeq');
		expect(seq).toBeTruthy();
		fireEvent.change(seq, { target: { value: '123' } });
		expect(store.getState().config.Content).toBe('123');
	});
});

describe('importConfig', function () {
	it('部分字段导入：未提供的字段保留当前值（P0-2）', function () {
		act(function () {
			store.dispatch(setField({ key: 'Template', value: 'trace' }));
			store.dispatch(setField({ key: 'ZgType', value: '2' }));
		});
		act(function () {
			store.dispatch(importConfig({ Content: '天地' }));
		});
		var c = store.getState().config;
		expect(c.Content).toBe('天地');
		expect(c.Template).toBe('trace');
		expect(c.ZgType).toBe('2');
	});

	it('完整快照导入：各字段与快照一致（P0-2）', function () {
		var before = store.getState().config;
		act(function () {
			store.dispatch(importConfig(Object.assign({}, before, { Content: '天地玄黄', ZgColor: '3' })));
		});
		var c = store.getState().config;
		expect(c.Content).toBe('天地玄黄');
		expect(c.ZgColor).toBe('3');
		expect(c.Template).toBe(before.Template);
		expect(c.ZgType).toBe(before.ZgType);
	});
});

describe('窄屏抽屉（P1-4）', function () {
	beforeEach(function () { mqState.matches = true; });
	afterEach(function () { mqState.matches = false; });

	it('默认收起，点 rail 分类打开', function () {
		var rendered = renderWithStore(<Panel />);
		var panel = rendered.container.querySelector('.rp-panel');
		expect(panel.className).not.toContain('is-open');
		fireEvent.click(rendered.container.querySelector('[data-page="layout"]'));
		expect(rendered.container.querySelector('.rp-panel').className).toContain('is-open');
		/* 抽屉打开时旧面板对读屏隐藏由 aria-hidden 控制 */
		expect(panel.getAttribute('aria-hidden')).toBeNull();
	});

	it('点遮罩关闭抽屉（U2：遮罩只盖预览区，不拦 rail / 顶栏）', function () {
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('[data-page="layout"]'));
		expect(rendered.container.querySelector('.rp-panel').className).toContain('is-open');
		fireEvent.click(rendered.container.querySelector('.rp-panel-scrim'));
		expect(rendered.container.querySelector('.rp-panel').className).not.toContain('is-open');
	});

	it('抽屉打开时切换分类保持展开（U2：rail 常驻可点）', function () {
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('[data-page="layout"]'));
		fireEvent.click(rendered.container.querySelector('[data-page="grid"]'));
		var panel = rendered.container.querySelector('.rp-panel');
		expect(panel.className).toContain('is-open');
		expect(panel.querySelector('.rp-page-head h2').textContent).toBe('字格');
	});

	it('Esc 关闭抽屉并返还焦点到触发按钮', function () {
		var rendered = renderWithStore(<Panel />);
		var btn = rendered.container.querySelector('[data-page="grid"]');
		fireEvent.click(btn);
		expect(rendered.container.querySelector('.rp-panel').className).toContain('is-open');
		fireEvent.keyDown(document, { key: 'Escape' });
		expect(rendered.container.querySelector('.rp-panel').className).not.toContain('is-open');
		expect(document.activeElement).toBe(btn);
		expect(rendered.container.querySelector('.rp-panel').getAttribute('aria-hidden')).toBe('true');
	});

	it('宽屏（matchMedia=false）不受抽屉状态影响', function () {
		mqState.matches = false;
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('[data-page="layout"]'));
		expect(rendered.container.querySelector('.rp-panel').className).not.toContain('is-open');
		expect(rendered.container.querySelector('.rp-panel').getAttribute('aria-hidden')).toBeNull();
	});

	it('断点由窄变宽时自动收起抽屉（P3-18）', function () {
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('[data-page="layout"]'));
		expect(rendered.container.querySelector('.rp-panel').className).toContain('is-open');
		act(function () {
			mqState.matches = false;
			mqState.listeners.forEach(function (fn) { fn({ matches: false }); });
		});
		expect(rendered.container.querySelector('.rp-panel').className).not.toContain('is-open');
	});
});

describe('资源来源（P2-9）', function () {
	it('更多页：状态行存在且有文本；可切换 CDN / 本地 vendor', function () {
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('.rp-rail-more'));
		var status = document.getElementById('assetStatus');
		expect(status).toBeTruthy();
		expect(status.textContent.length).toBeGreaterThan(0);
		var localBtn = screen.getByRole('button', { name: '本地 vendor' });
		fireEvent.click(localBtn);
		expect(store.getState().config.ResourceMode).toBe('local');
		var cdnBtn = screen.getByRole('button', { name: 'CDN' });
		expect(cdnBtn.getAttribute('aria-pressed')).toBe('false');
		fireEvent.click(cdnBtn);
		expect(store.getState().config.ResourceMode).toBe('cdn');
		expect(cdnBtn.getAttribute('aria-pressed')).toBe('true');
	});
});

describe('预设范围（P2-8）', function () {
	it('保存预设只含版式白名单：不含字体 / 主题 / 资源 / 内容 / 标题', function () {
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('button', { name: '版式' }));
		fireEvent.change(document.getElementById('presetName'), { target: { value: '硬笔' } });
		fireEvent.click(screen.getByRole('button', { name: '保存' }));
		var snap = JSON.parse(window.localStorage.getItem('zitie.presets'))['硬笔'];
		['FontSource', 'Theme', 'ResourceMode', 'Content', 'Title'].forEach(function (k) {
			expect(snap).not.toHaveProperty(k);
		});
		['Template', 'Cols', 'Page', 'Margin', 'ZgType', 'GridSize'].forEach(function (k) {
			expect(snap).toHaveProperty(k);
		});
	});

	it('加载预设不改动字体来源与主题', function () {
		store.dispatch(setField({ key: 'Theme', value: 'dark' }));
		store.dispatch(setFontSource({ type: 'url', url: 'https://example.com/x.ttf' }));
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('button', { name: '版式' }));
		fireEvent.change(document.getElementById('presetName'), { target: { value: '硬笔' } });
		fireEvent.click(screen.getByRole('button', { name: '保存' }));
		/* 保存后改模板，再加载预设应回到快照值，但字体 / 主题不受影响 */
		store.dispatch(setField({ key: 'Template', value: 'trace' }));
		fireEvent.click(screen.getAllByRole('button', { name: '加载' })[0]);
		expect(store.getState().config.Template).toBe('normal');
		expect(store.getState().config.Theme).toBe('dark');
		expect(store.getState().config.FontSource.type).toBe('url');
	});

	it('改名：重命名预设并保持键顺序；重名不覆盖', function () {
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('button', { name: '版式' }));
		function save(name) {
			fireEvent.change(document.getElementById('presetName'), { target: { value: name } });
			fireEvent.click(screen.getByRole('button', { name: '保存' }));
		}
		save('甲');
		save('乙');
		expect(Object.keys(JSON.parse(window.localStorage.getItem('zitie.presets')))).toEqual(['甲', '乙']);
		fireEvent.click(screen.getAllByRole('button', { name: '改名' })[0]);
		var input = document.getElementById('preset-rename-甲');
		expect(input).toBeTruthy();
		fireEvent.change(input, { target: { value: '丙' } });
		fireEvent.click(screen.getByRole('button', { name: '确定' }));
		var after = JSON.parse(window.localStorage.getItem('zitie.presets'));
		expect(Object.keys(after)).toEqual(['丙', '乙']);
		/* 改成已存在的名字：不覆盖，键保持原样 */
		fireEvent.click(screen.getAllByRole('button', { name: '改名' })[0]);
		fireEvent.change(document.getElementById('preset-rename-丙'), { target: { value: '乙' } });
		fireEvent.click(screen.getByRole('button', { name: '确定' }));
		var again = JSON.parse(window.localStorage.getItem('zitie.presets'));
		expect(Object.keys(again)).toEqual(['丙', '乙']);
		expect(again['乙']).toBeTruthy();
	});
});

describe('无障碍（P2-10）', function () {
	it('字格色板有可访问名与按下态，取色器可单独调色', function () {
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('button', { name: '字格' }));
		/* 内部线 / 外框两行色板：aria-label 带行前缀 */
		var green = screen.getByRole('button', { name: '内部线预设色 绿色' });
		expect(green.getAttribute('aria-pressed')).toBe('true');
		var red = screen.getByRole('button', { name: '内部线预设色 红色' });
		fireEvent.click(red);
		expect(store.getState().config.ZgColor).toBe('3');
		expect(store.getState().config.ZgLineColor).toBe('#bb3442');
		expect(screen.getByRole('button', { name: '内部线预设色 红色' }).getAttribute('aria-pressed')).toBe('true');
		expect(screen.getByRole('button', { name: '内部线预设色 绿色' }).getAttribute('aria-pressed')).toBe('false');
		/* 原生取色器：单独改外框色不影响内部线 */
		var picker = screen.getByLabelText('外框自定义颜色');
		fireEvent.change(picker, { target: { value: '#0000ff' } });
		expect(store.getState().config.ZgBorderColor).toBe('#0000ff');
		expect(store.getState().config.ZgLineColor).toBe('#bb3442');
	});

	it('字格页：格线组控件（内外线型 / 粗细 / 虚线）存在并生效', function () {
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('button', { name: '字格' }));
		/* 内部线样式切换 → 田字格缩略图不再含 dasharray */
		var innerSolid = screen.getAllByRole('button', { name: '实线' })[1]; /* 第 1 个 = 外框样式 */
		fireEvent.click(innerSolid);
		expect(store.getState().config.ZgInnerLineMode).toBe('solid');
		/* 外框粗细滑杆与虚线密度滑杆存在 */
		expect(document.getElementById('zgBorderScale')).toBeTruthy();
		expect(document.getElementById('zgDashDensity')).toBeTruthy();
		/* 虚线形态切换 */
		fireEvent.click(screen.getByRole('button', { name: '圆点' }));
		expect(store.getState().config.ZgDashStyle).toBe('dot');
	});
});

describe('信息架构（P2-7）', function () {
	it('输出页含导出 PDF / 打印，导出回调生效', function () {
		/* 接入模式读 ui.backend（U6）：在线时导出可用；本地模式入口置灰 */
		act(function () { store.dispatch(setBackendMode('http')); });
		try {
			var onExport = vi.fn();
			renderWithStore(<Panel onExportPdf={onExport} pdfBusy={false} />);
			fireEvent.click(screen.getByRole('button', { name: '输出' }));
			fireEvent.click(screen.getByRole('button', { name: '导出 PDF' }));
			expect(onExport).toHaveBeenCalledTimes(1);
			expect(screen.getByRole('button', { name: '打印' })).toBeTruthy();
		} finally {
			act(function () { store.dispatch(setBackendMode('mock')); });
		}
	});

	it('非桌面环境导出 PDF 入口置灰并有提示', function () {
		act(function () { store.dispatch(setBackendMode('mock')); });
		renderWithStore(<Panel onExportPdf={vi.fn()} pdfBusy={false} />);
		fireEvent.click(screen.getByRole('button', { name: '输出' }));
		var btn = screen.getByRole('button', { name: '导出 PDF' });
		expect(btn.disabled).toBe(true);
		expect(btn.getAttribute('title')).toContain('需连接桌面内核');
	});

	it('生成中导出按钮禁用', function () {
		renderWithStore(<Panel onExportPdf={vi.fn()} pdfBusy={true} />);
		fireEvent.click(screen.getByRole('button', { name: '输出' }));
		expect(screen.getByRole('button', { name: '正在生成 PDF…' }).disabled).toBe(true);
	});

	it('示例库（A1）：搜索 / 分类筛选 / 点击套用 / 空态', function () {
		try { window.localStorage.removeItem(Z.SAMPLE_FAVS_KEY); } catch (e) { /* 忽略 */ }
		renderWithStore(<Panel />);
		var foldOf = function () {
			return Array.prototype.filter.call(
				document.querySelectorAll('.rp-fold'),
				function (f) { return f.querySelector('summary').textContent.indexOf('示例库') !== -1; }
			)[0];
		};
		var fold = foldOf();
		expect(fold).toBeTruthy();
		var search = document.getElementById('sampleSearch');
		var list = fold.querySelector('.rp-sample-list');
		var total = list.querySelectorAll('.rp-sample-item').length;
		expect(total).toBeGreaterThan(0);

		/* 搜索：按名称或内容关键词过滤 */
		fireEvent.change(search, { target: { value: '春' } });
		var hits = list.querySelectorAll('.rp-sample-item');
		expect(hits.length).toBeGreaterThan(0);
		expect(hits.length).toBeLessThan(total);
		Array.prototype.forEach.call(hits, function (item) {
			expect(item.textContent).toContain('春');
		});
		fireEvent.change(search, { target: { value: '' } });
		expect(list.querySelectorAll('.rp-sample-item').length).toBe(total);

		/* 分类 chips：选「词语」后只剩词语类，切回「全部」恢复 */
		var catBtn = Array.prototype.filter.call(fold.querySelectorAll('.rp-sample-cat'), function (b) {
			return b.textContent === '词语';
		})[0];
		expect(catBtn).toBeTruthy();
		fireEvent.click(catBtn);
		var words = list.querySelectorAll('.rp-sample-item');
		expect(words.length).toBeGreaterThan(0);
		expect(words.length).toBeLessThan(total);
		Array.prototype.forEach.call(words, function (item) {
			expect(item.querySelector('.rp-sample-name').textContent).toMatch(/词语/);
		});
		fireEvent.click(Array.prototype.filter.call(fold.querySelectorAll('.rp-sample-cat'), function (b) {
			return b.textContent === '全部';
		})[0]);
		expect(list.querySelectorAll('.rp-sample-item').length).toBe(total);

		/* 点击主体套用内容 */
		var main = list.querySelector('.rp-sample-main');
		fireEvent.click(main);
		expect(store.getState().config.Content).toBe(main.getAttribute('title'));

		/* 空态提示 */
		fireEvent.change(search, { target: { value: '不存在的关键词xyz' } });
		expect(fold.textContent).toContain('无匹配示例');
	});

	it('示例库（A1）：收藏写入本地并置顶，可取消', function () {
		try { window.localStorage.removeItem(Z.SAMPLE_FAVS_KEY); } catch (e) { /* 忽略 */ }
		var rendered = renderWithStore(<Panel />);
		var foldOf = function () {
			return Array.prototype.filter.call(
				document.querySelectorAll('.rp-fold'),
				function (f) { return f.querySelector('summary').textContent.indexOf('示例库') !== -1; }
			)[0];
		};
		var list = foldOf().querySelector('.rp-sample-list');
		var secondName = list.querySelectorAll('.rp-sample-name')[1].textContent;
		fireEvent.click(list.querySelectorAll('.rp-sample-star')[1]);
		expect(JSON.parse(window.localStorage.getItem(Z.SAMPLE_FAVS_KEY))).toEqual([secondName]);

		/* 重新挂载读回本地收藏，收藏项置顶 */
		rendered.unmount();
		renderWithStore(<Panel />);
		var list2 = foldOf().querySelector('.rp-sample-list');
		expect(list2.querySelector('.rp-sample-name').textContent).toBe(secondName);
		expect(list2.querySelector('.rp-sample-star').getAttribute('aria-pressed')).toBe('true');

		/* 再点取消收藏，本地同步移除 */
		fireEvent.click(list2.querySelector('.rp-sample-star'));
		expect(JSON.parse(window.localStorage.getItem(Z.SAMPLE_FAVS_KEY))).toEqual([]);
		try { window.localStorage.removeItem(Z.SAMPLE_FAVS_KEY); } catch (e) { /* 忽略 */ }
	});

	it('更多页首屏为设置导入导出', function () {
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('button', { name: '更多' }));
		var page = document.querySelector('.rp-panel-page');
		expect(page.firstElementChild.textContent).toContain('设置');
	});
});

describe('笔画模式', function () {
	it('切到笔画 tab：笔画库 17 个按钮，点击把笔画名插入内容', function () {
		act(function () { store.dispatch(switchMode('stroke')); });
		var rendered = renderWithStore(<Panel />);
		var btns = rendered.container.querySelectorAll('.rp-pattern-btn.has-name');
		expect(btns.length).toBe(Z.STROKE_LIBRARY.length);
		act(function () { store.dispatch(setContent('竖')); });
		fireEvent.click(btns[0]); /* 第一个是「横」 */
		expect(store.getState().config.Content).toContain('竖');
		expect(store.getState().config.Content).toContain('横');
	});

	it('快捷形态 chips 全局常驻（含跨模式项），当前形态高亮', function () {
		act(function () { store.dispatch(switchMode('hanzi')); });
		var rendered = renderWithStore(<Panel />);
		var chips = rendered.container.querySelectorAll('.rp-scheme-btn');
		expect(chips.length).toBe(Z.CONTENT_FORMS.length);
		expect(Array.prototype.some.call(chips, function (c) { return c.textContent === '笔画入门'; })).toBe(true);
	});

	it('套用「笔画入门」一次切换 Mode + 版式，单步撤销', function () {
		act(function () { store.dispatch(switchMode('hanzi')); });
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('button', { name: '笔画入门' }));
		expect(store.getState().config.Mode).toBe('stroke');
		expect(store.getState().config.Template).toBe('lead');
		expect(store.getState().config.ZgType).toBe('3');
		var onScreen = document.querySelector('.rp-scheme-btn.is-active');
		expect(onScreen && onScreen.textContent).toBe('笔画入门');
		/* 单步撤销：回到套用前（汉字） */
		expect(undoContent()).toBe(true);
		expect(store.getState().config.Mode).toBe('hanzi');
	});

	it('applyFields：未知字段丢弃，白名单字段批量生效', function () {
		act(function () {
			store.dispatch(applyFields({ fields: { Template: 'rhythm', Nope: 1 } }));
		});
		expect(store.getState().config.Template).toBe('rhythm');
		expect(store.getState().config.Nope).toBeUndefined();
	});

	it('笔画格不显示文字、不可编辑', function () {
		act(function () {
			store.dispatch(switchMode('stroke'));
			store.dispatch(setContent('横竖'));
		});
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		var cell = rendered.container.querySelector('.hz-line.is-model');
		expect(cell).toBeTruthy();
		expect(cell.textContent).toBe('');
		fireEvent.click(cell);
		expect(rendered.container.querySelector('.hz-edit')).toBeNull();
	});
});

describe('分享链接（doc/next-features-todo.md · A1 / D4）', function () {
	beforeEach(function () {
		store.dispatch(resetHistory());
	});

	it('输出页「分享链接」：复制含 #s= 的链接并弹成功提示', async function () {
		var writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(window.navigator, 'clipboard', {
			value: { writeText: writeText }, configurable: true
		});
		act(function () { store.dispatch(setContent('天地玄黄')); });
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('[data-page="output"]'));
		fireEvent.click(screen.getByRole('button', { name: '分享链接' }));
		await waitFor(function () { expect(writeText).toHaveBeenCalled(); });
		var url = String(writeText.mock.calls[0][0]);
		expect(url).toContain('#s=');
		/* 链接自洽：解回来的内容与当前输入一致 */
		var fields = Z.decodeShare(url.slice(url.indexOf('#')));
		expect(fields.Content).toBe('天地玄黄');
		expect(store.getState().ui.toasts.some(function (t) { return t.type === 'success'; })).toBe(true);
	});

	it('超长内容：不写剪贴板，提示改用导出 JSON', async function () {
		var writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(window.navigator, 'clipboard', {
			value: { writeText: writeText }, configurable: true
		});
		act(function () { store.dispatch(setContent('永'.repeat(5000))); });
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('[data-page="output"]'));
		fireEvent.click(screen.getByRole('button', { name: '分享链接' }));
		await waitFor(function () { expect(store.getState().ui.toasts.length).toBeGreaterThan(0); });
		expect(writeText).not.toHaveBeenCalled();
		expect(store.getState().ui.toasts.some(function (t) { return t.text.indexOf('导出 JSON') >= 0; })).toBe(true);
	});
});

describe('字体授权提示（web-features.md · C2）', function () {
	it('本地字体区展示固定合规提醒', function () {
		fontMeta = [{ id: 'f1', name: '楷体', size: 2048, createdAt: 1 }];
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('button', { name: '文字' }));
		expect(document.body.textContent).toContain('请仅导入您有权使用的字体');
	});
});


describe('打印范围（web-features.md · D3）', function () {
	it('输出页提供范围输入；修改触发回调，留空为全部', function () {
		var spy = vi.fn();
		var rendered = renderWithStore(<Panel printRangeValue="" onPrintRangeChange={spy} />);
		fireEvent.click(rendered.container.querySelector('[data-page="output"]'));
		var input = document.getElementById('printRange');
		expect(input).toBeTruthy();
		expect(input.getAttribute('placeholder')).toContain('1,3-5');
		fireEvent.change(input, { target: { value: '2' } });
		expect(spy).toHaveBeenCalledWith('2');
	});
});


describe('分享二维码（web-features.md · D4）', function () {
	it('输出页生成并展示浮层；关闭可退出', function () {
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('[data-page="output"]'));
		fireEvent.click(screen.getByRole('button', { name: '分享二维码' }));
		expect(screen.getByRole('dialog', { name: '分享二维码' })).toBeTruthy();
		expect(document.querySelector('.rp-shareqr-canvas')).toBeTruthy();
		expect(document.body.textContent).toContain('扫码打开字帖');
		fireEvent.click(screen.getByRole('button', { name: '关闭' }));
		expect(screen.queryByRole('dialog', { name: '分享二维码' })).toBeNull();
	});
});


describe('无障碍（U1）', function () {
	it('跳转链接：首 Tab 可达字帖预览区（skip link → #rp-main）', async function () {
		var mod = await import('../web/src/App.jsx');
		var rendered = renderWithStore(React.createElement(mod.default));
		var link = document.querySelector('.rp-skip-link');
		expect(link).toBeTruthy();
		expect(link.getAttribute('href')).toBe('#rp-main');
		var main = document.getElementById('rp-main');
		expect(main).toBeTruthy();
		expect(main.getAttribute('tabindex')).toBe('-1');
		rendered.unmount();
	});

	it('分享二维码浮层：aria-modal + 初始聚焦关闭按钮，Esc 关闭并返还焦点', function () {
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('[data-page="output"]'));
		var trigger = screen.getByRole('button', { name: '分享二维码' });
		fireEvent.click(trigger);
		var dialog = screen.getByRole('dialog', { name: '分享二维码' });
		expect(dialog.getAttribute('aria-modal')).toBe('true');
		expect(document.activeElement && document.activeElement.className.indexOf('rp-shareqr-close') >= 0).toBe(true);
		fireEvent.keyDown(document, { key: 'Escape' });
		expect(screen.queryByRole('dialog', { name: '分享二维码' })).toBeNull();
		/* 焦点返还触发按钮 */
		expect(document.activeElement === trigger || document.activeElement === document.body).toBe(true);
	});

	it('预设导入浮层：打开聚焦文本域，Esc 关闭', function () {
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('button', { name: '版式' }));
		fireEvent.click(screen.getByRole('button', { name: '导入…' }));
		var dialog = screen.getByRole('dialog', { name: '导入预设' });
		expect(dialog.getAttribute('aria-modal')).toBe('true');
		expect(document.activeElement === document.getElementById('presetImportText')).toBe(true);
		fireEvent.keyDown(document, { key: 'Escape' });
		expect(screen.queryByRole('dialog', { name: '导入预设' })).toBeNull();
	});
});

describe('按字数截取（web-features.md · A3）', function () {
	it('内容工具中输入 N 字并截取，覆盖 Content 并入历史', function () {
		var rendered = renderWithStore(<Panel />);
		act(function () { store.dispatch(setField({ key: 'Content', value: '天地玄黄宇宙洪荒' })); });
		fireEvent.click(rendered.container.querySelector('[data-page="content"]'));
		fireEvent.click(screen.getByText('内容工具'));
		fireEvent.change(document.getElementById('truncateCount'), { target: { value: '5' } });
		fireEvent.click(screen.getByRole('button', { name: '截取' }));
		expect(store.getState().config.Content.length).toBe(5);
		expect(store.getState().ui.toasts.some(function (t) { return t.text.indexOf('已截取前 5 字') >= 0; })).toBe(true);
	});
});


describe('字体增强（F-a~c）', function () {
	function fontNames() {
		return Array.prototype.map.call(
			document.querySelectorAll('.rp-font-list .rp-font-name'),
			function (el) { return el.textContent; },
		);
	}

	it('F-b 搜索按名称过滤、排序切换生效', function () {
		fontMeta = [
			{ id: 'f1', name: '楷体', size: 2048, createdAt: 1 },
			{ id: 'f2', name: '宋体', size: 4096, createdAt: 2 },
		];
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('button', { name: '文字' }));
		expect(fontNames()).toEqual(['楷体', '宋体']);
		fireEvent.change(document.getElementById('fontSearch'), { target: { value: '楷' } });
		expect(fontNames()).toEqual(['楷体']);
		/* 清空搜索后恢复；切「按大小」大的在前 */
		fireEvent.change(document.getElementById('fontSearch'), { target: { value: '' } });
		fireEvent.change(document.getElementById('fontSort'), { target: { value: 'size' } });
		expect(fontNames()).toEqual(['宋体', '楷体']);
		/* 「没有匹配的字体」空态提示 */
		fireEvent.change(document.getElementById('fontSearch'), { target: { value: '不存在的字体' } });
		expect(document.body.textContent).toContain('没有匹配的字体');
		/* 无障碍：搜索框与排序下拉都有可访问名（axe select-name / label 回归） */
		expect(document.getElementById('fontSearch').getAttribute('aria-label')).toBe('搜索字体名');
		expect(document.getElementById('fontSort').getAttribute('aria-label')).toBe('排序方式');
	});

	it('F-a 行内编辑标签并保存；标签 chips 可筛选', async function () {
		fontMeta = [
			{ id: 'f1', name: '楷体', size: 2048, createdAt: 1, tags: ['楷书'] },
			{ id: 'f2', name: '宋体', size: 1024, createdAt: 2, tags: [] },
		];
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('button', { name: '文字' }));
		/* 已有标签以 chip 展示 */
		expect(document.querySelector('.rp-font-tags-line .rp-font-tag').textContent).toBe('楷书');
		/* 筛选 chips 中「全部」高亮，「楷书」可点 */
		var filterChips = document.querySelectorAll('.rp-font-tags:not(.rp-font-tags-line) .rp-font-tag');
		expect(filterChips.length).toBe(2);
		fireEvent.click(filterChips[1]);
		expect(fontNames()).toEqual(['楷体']);
		fireEvent.click(filterChips[0]); /* 回到全部 */
		expect(fontNames().length).toBe(2);
		/* 行内编辑 */
		fireEvent.click(screen.getAllByRole('button', { name: '标签' })[0]);
		var input = document.getElementById('font-tags-f1');
		fireEvent.change(input, { target: { value: '楷书，行草' } });
		fireEvent.click(screen.getByRole('button', { name: '确定' }));
		await waitFor(function () {
			expect(fontMeta[0].tags).toEqual(['楷书', '行草']);
		});
	});

	it('F-c 批量导入：成功汇总 + 失败清单均可见', async function () {
		renderWithStore(<div><Panel /><ToastHost /></div>);
		fireEvent.click(screen.getByRole('button', { name: '文字' }));
		var fileInput = document.querySelector('input[type="file"][accept*=".ttf"]');
		var good = new File([new Uint8Array([1, 2, 3])], '新字体.ttf', { type: 'font/ttf' });
		var bad = new File([new Uint8Array([1])], '说明.txt', { type: 'text/plain' });
		fireEvent.change(fileInput, { target: { files: [good, bad] } });
		await waitFor(function () {
			expect(document.body.textContent).toContain('已导入 1 个字体');
		});
		expect(document.body.textContent).toContain('格式不支持');
		expect(fontMeta.length).toBe(1);
		expect(fontMeta[0].name).toBe('新字体');
	});
});

describe('字帖页（M1）', function () {
	it('无内容源时空态引导', async function () {
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('[data-page="docs"]'));
		await waitFor(function () {
			expect(document.body.textContent).toContain('还没有字帖');
		});
	});

	it('另存为：把当前内容写为工作区字帖并立即出现在列表', async function () {
		act(function () { store.dispatch(setContent('天地玄黄，宇宙洪荒。')); });
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('[data-page="docs"]'));
		await waitFor(function () {
			expect(screen.getByRole('button', { name: '另存为…' })).toBeTruthy();
		});
		fireEvent.click(screen.getByRole('button', { name: '另存为…' }));
		fireEvent.change(document.getElementById('docSaveName'), { target: { value: '测试字帖' } });
		fireEvent.click(screen.getByRole('button', { name: '保存' }));
		await waitFor(function () {
			expect(sharedClient().transport.files.get('workspace/测试字帖.txt').content).toBe('天地玄黄，宇宙洪荒。');
		});
		expect(store.getState().config.Title).toBe('测试字帖');
		await waitFor(function () {
			expect(document.body.textContent).toContain('测试字帖');
		});
	});

	it('另存为同名：先出现覆盖确认，确认后才替换内容', async function () {
		await sharedClient().writeFile({ path: 'workspace/测试.txt', content: '旧内容' });
		act(function () { store.dispatch(setContent('新内容')); });
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('[data-page="docs"]'));
		await waitFor(function () {
			expect(screen.getByRole('button', { name: '另存为…' })).toBeTruthy();
		});
		fireEvent.click(screen.getByRole('button', { name: '另存为…' }));
		fireEvent.change(document.getElementById('docSaveName'), { target: { value: '测试.txt' } });
		fireEvent.click(screen.getByRole('button', { name: '保存' }));
		/* 第一次点保存只是要求确认，不应写入 */
		expect(sharedClient().transport.files.get('workspace/测试.txt').content).toBe('旧内容');
		await waitFor(function () {
			expect(screen.getByRole('button', { name: '确认覆盖' })).toBeTruthy();
		});
		fireEvent.click(screen.getByRole('button', { name: '确认覆盖' }));
		await waitFor(function () {
			expect(sharedClient().transport.files.get('workspace/测试.txt').content).toBe('新内容');
		});
	});

	it('打开…：选择本机 txt/md 后载入内容并落盘入库', async function () {
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('[data-page="docs"]'));
		await waitFor(function () {
			expect(screen.getByRole('button', { name: '打开…' })).toBeTruthy();
		});
		var fileInput = document.querySelector('input[type="file"][accept*="text/plain"]');
		expect(fileInput).toBeTruthy();
		var file = new File(['春眠不觉晓，处处闻啼鸟。'], '春晓.md', { type: 'text/markdown' });
		fireEvent.change(fileInput, { target: { files: [file] } });
		await waitFor(function () {
			expect(store.getState().config.Content).toBe('春眠不觉晓，处处闻啼鸟。');
		});
		expect(store.getState().config.Title).toBe('春晓');
		await waitFor(function () {
			expect(sharedClient().transport.files.get('workspace/春晓.md').content).toBe('春眠不觉晓，处处闻啼鸟。');
		});
	});

	it('搜索：按标题过滤列表', async function () {
		await sharedClient().writeFile({ path: 'workspace/春晓.txt', content: '春眠不觉晓' });
		await sharedClient().writeFile({ path: 'workspace/登鹳雀楼.md', content: '白日依山尽' });
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('[data-page="docs"]'));
		await waitFor(function () {
			expect(document.body.textContent).toContain('春晓');
			expect(document.body.textContent).toContain('登鹳雀楼');
		});
		fireEvent.change(document.getElementById('docsSearch'), { target: { value: '春晓' } });
		await waitFor(function () {
			expect(document.body.textContent).toContain('春晓');
			expect(document.body.textContent.indexOf('登鹳雀楼')).toBe(-1);
		});
		fireEvent.change(document.getElementById('docsSearch'), { target: { value: '' } });
		await waitFor(function () {
			expect(document.body.textContent).toContain('登鹳雀楼');
		});
	});

	it('重命名：仅改列表标题，文件名不变', async function () {
		await sharedClient().writeFile({ path: 'workspace/春晓.txt', content: '春眠不觉晓' });
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('[data-page="docs"]'));
		await waitFor(function () {
			expect(document.body.textContent).toContain('春晓');
		});
		fireEvent.click(screen.getByRole('button', { name: '改名' }));
		var input = document.querySelector('.rp-docs-row .rp-input');
		fireEvent.change(input, { target: { value: '晨读·春晓' } });
		fireEvent.click(screen.getByRole('button', { name: '保存' }));
		await waitFor(function () {
			expect(document.body.textContent).toContain('晨读·春晓');
		});
		/* 文件本体路径不变 */
		expect(sharedClient().transport.files.has('workspace/春晓.txt')).toBe(true);
	});

	it('删除：二次确认后文件与索引一并移除', async function () {
		await sharedClient().writeFile({ path: 'workspace/春晓.txt', content: '春眠不觉晓' });
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('[data-page="docs"]'));
		await waitFor(function () {
			expect(document.body.textContent).toContain('春晓');
		});
		fireEvent.click(screen.getByRole('button', { name: '删除' }));
		await waitFor(function () {
			expect(screen.getByRole('button', { name: '确认删除' })).toBeTruthy();
		});
		/* 确认前文件仍在 */
		expect(sharedClient().transport.files.has('workspace/春晓.txt')).toBe(true);
		fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
		await waitFor(function () {
			expect(sharedClient().transport.files.has('workspace/春晓.txt')).toBe(false);
		});
		expect(sharedClient().transport.recent.indexOf('workspace/春晓.txt')).toBe(-1);
		await waitFor(function () {
			expect(document.body.textContent).toContain('还没有字帖');
		});
	});

	it('收藏：星标切换后该条置顶，再点取消回落', async function () {
		await sharedClient().writeFile({ path: 'workspace/甲.txt', content: '甲内容' });
		await new Promise(function (r) { setTimeout(r, 5); }); /* 保证乙的 updated_at 更新 */
		await sharedClient().writeFile({ path: 'workspace/乙.txt', content: '乙内容' });
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('[data-page="docs"]'));
		await waitFor(function () {
			expect(document.body.textContent).toContain('乙');
		});
		/* 默认顺序乙在前，收藏第二条（甲） */
		var starButtons = document.querySelectorAll('.rp-star');
		expect(starButtons.length).toBe(2);
		fireEvent.click(starButtons[1]);
		await waitFor(function () {
			var first = document.querySelector('.rp-docs-list .rp-docs-title');
			expect(first.textContent).toBe('甲');
		});
		/* 取消收藏：乙重新置顶 */
		starButtons = document.querySelectorAll('.rp-star');
		fireEvent.click(starButtons[0]); /* 此时第一个仍是甲 */
		await waitFor(function () {
			var first = document.querySelector('.rp-docs-list .rp-docs-title');
			expect(first.textContent).toBe('乙');
		});
	});

	it('内容源入库后列表展示条目，点击打开写入 Content', async function () {
		await sharedClient().writeFile({ path: 'workspace/春晓.txt', content: '春眠不觉晓，处处闻啼鸟。' });
		act(function () { store.dispatch(setContent('')); });
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('[data-page="docs"]'));
		await waitFor(function () {
			expect(document.body.textContent).toContain('春晓');
		});
		fireEvent.click(screen.getByText('春晓'));
		await waitFor(function () {
			expect(store.getState().config.Content).toBe('春眠不觉晓，处处闻啼鸟。');
		});
	});
});

describe('预设导入导出（P-a）', function () {
	function presetData(over) {
		var d = {};
		Z.PRESET_KEYS.forEach(function (k) { d[k] = Z.DEFAULTS[k]; });
		return Object.assign(d, over || {});
	}

	function gotoLayout() {
		renderWithStore(<div><Panel /><ToastHost /></div>);
		fireEvent.click(screen.getByRole('button', { name: '版式' }));
	}

	function stubClipboard() {
		var writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(window.navigator, 'clipboard', {
			value: { writeText: writeText }, configurable: true
		});
		return writeText;
	}

	it('复制分享链接：编码全部具名预设为 #p= URL', async function () {
		Z.savePreset('硬笔', presetData({ Cols: 6 }));
		Z.savePreset('软笔', presetData({ Cols: 8 }));
		var writeText = stubClipboard();
		gotoLayout();
		fireEvent.click(screen.getByRole('button', { name: '复制分享链接' }));
		await waitFor(function () { expect(writeText).toHaveBeenCalled(); });
		var url = String(writeText.mock.calls[0][0]);
		expect(url).toContain('#p=');
		var decoded = Z.decodePresetShare(url);
		expect(decoded.count).toBe(2);
		expect(decoded.presets['硬笔'].Cols).toBe(6);
		expect(decoded.presets['软笔'].Cols).toBe(8);
		expect(document.body.textContent).toContain('预设链接已复制（含 2 个预设）');
	});

	it('导出 JSON：下载内容含版本标记与全部预设', async function () {
		Z.savePreset('硬笔', presetData({ Cols: 6 }));
		var created = [];
		var realCreate = URL.createObjectURL;
		URL.createObjectURL = function (blob) { created.push(blob); return 'blob:mock'; };
		URL.revokeObjectURL = function () {};
		gotoLayout();
		fireEvent.click(screen.getByRole('button', { name: '导出 JSON' }));
		await waitFor(function () { expect(created.length).toBe(1); });
		var text = await created[0].text();
		var data = JSON.parse(text);
		expect(data.kind).toBe('zitie.presets');
		expect(data.presets['硬笔'].Cols).toBe(6);
		expect(document.body.textContent).toContain('已导出预设 JSON（1 个）');
		URL.createObjectURL = realCreate;
	});

	it('导入链接：识别数量后合并，写入本机预设库', async function () {
		var payload = Z.encodePresetShare({ 颜体: presetData({ Cols: 5 }), 柳体: presetData({ Cols: 7 }) });
		gotoLayout();
		fireEvent.click(screen.getByRole('button', { name: '导入…' }));
		fireEvent.change(document.getElementById('presetImportText'), { target: { value: payload.url } });
		await waitFor(function () { expect(document.body.textContent).toContain('识别到 2 个预设'); });
		fireEvent.click(screen.getByRole('button', { name: '导入' }));
		await waitFor(function () {
			expect(Object.keys(Z.loadPresets()).sort()).toEqual(['柳体', '颜体']);
		});
		expect(Z.loadPresets()['颜体'].Cols).toBe(5);
		expect(document.body.textContent).toContain('已导入 2 个预设');
	});

	it('同名跳过：不覆盖本机已有预设并如实汇报', async function () {
		Z.savePreset('颜体', presetData({ Cols: 1 }));
		var payload = Z.encodePresetShare({ 颜体: presetData({ Cols: 9 }), 欧体: presetData({ Cols: 4 }) });
		gotoLayout();
		fireEvent.click(screen.getByRole('button', { name: '导入…' }));
		fireEvent.change(document.getElementById('presetImportText'), { target: { value: payload.url } });
		await waitFor(function () { expect(document.body.textContent).toContain('其中 1 个与现有同名'); });
		fireEvent.click(screen.getByRole('button', { name: '导入' }));
		await waitFor(function () { expect(document.body.textContent).toContain('已导入 1 个预设（跳过同名 1 个）'); });
		expect(Z.loadPresets()['颜体'].Cols).toBe(1);
		expect(Z.loadPresets()['欧体'].Cols).toBe(4);
	});

	it('选择 JSON 文件导入：FileReader 路径同样可用', async function () {
		var text = Z.presetsToJson({ 赵体: presetData({ Cols: 3 }) });
		gotoLayout();
		fireEvent.click(screen.getByRole('button', { name: '导入…' }));
		var file = new File([text], 'presets.json', { type: 'application/json' });
		var input = document.querySelector('.rp-presetio-modal input[type="file"]');
		fireEvent.change(input, { target: { files: [file] } });
		await waitFor(function () { expect(document.body.textContent).toContain('识别到 1 个预设'); });
		fireEvent.click(screen.getByRole('button', { name: '导入' }));
		await waitFor(function () { expect(Z.loadPresets()['赵体'].Cols).toBe(3); });
	});
});

describe('描红浓度与页首标题（Z1=C-a / Z2=C-b）', function () {
	it('Z1 描红浓度：滑块实时改配置，预览描红透明度同步', function () {
		act(function () { store.dispatch(setField({ key: 'Template', value: 'trace' })); });
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('button', { name: '文字' }));
		var slider = document.getElementById('traceRatio');
		expect(slider).toBeTruthy();
		fireEvent.change(slider, { target: { value: '10' } });
		expect(store.getState().config.TraceRatio).toBe(10);
		/* 预览描红格透明度 = InkAlpha × TraceRatio% */
		var rendered = renderWithStore(<Preview pinyinReady={false} />);
		var line = rendered.container.querySelector('.hz-line.is-trace');
		expect(line).toBeTruthy();
		/* jsdom 会把 alpha 归一化到 3 位小数，容差放宽到 0.005（精确值由 shared 用例保证） */
		var m = /rgba\([^)]*,\s*([\d.]+)\)/.exec(line.style.color || '');
		expect(m).toBeTruthy();
		expect(Math.abs(parseFloat(m[1]) - store.getState().config.InkAlpha * 0.1)).toBeLessThan(0.005);
	});

	it('Z2 页首标题：开关切换每页显示，字号随缩放', function () {
		act(function () {
			store.dispatch(setField({ key: 'Title', value: '每日练习' }));
		});
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('button', { name: '版式' }));
		var toggle = document.getElementById('showPageTitle');
		expect(toggle).toBeTruthy();
		expect(toggle.textContent).toBe('仅首页');
		fireEvent.click(toggle);
		expect(store.getState().config.ShowPageTitle).toBe(true);
		expect(document.getElementById('pageTitleScale')).toBeTruthy();

		function titleFont() {
			var el = document.querySelector('.sheet-title');
			return el ? parseFloat(el.style.fontSize) : 0;
		}
		var small = renderWithStore(<Preview pinyinReady={false} />);
		var before = titleFont();
		expect(small.container.querySelector('.sheet-title').textContent).toBe('每日练习');
		act(function () { store.dispatch(setField({ key: 'PageTitleScale', value: 100 })); });
		var big = renderWithStore(<Preview pinyinReady={false} />);
		var after = titleFont();
		expect(after).toBeGreaterThan(before);
		expect(Math.abs(after / before - 100 / 42)).toBeLessThan(0.02);
	});
});

describe('笔画粗细（C-c）', function () {
	it('C-c 滑杆改配置：默认「默认」，0–80 步进 5', function () {
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('button', { name: '文字' }));
		var slider = document.getElementById('inkWidth');
		expect(slider).toBeTruthy();
		expect(slider.min).toBe('0');
		expect(slider.max).toBe('80');
		expect(slider.step).toBe('5');
		expect(store.getState().config.InkWidth).toBe(0);
		fireEvent.change(slider, { target: { value: '40' } });
		expect(store.getState().config.InkWidth).toBe(40);
	});

	it('C-c 预览注入 --char-stroke：字形描边 = 字号 × InkWidth/1000', function () {
		act(function () { store.dispatch(setField({ key: 'InkWidth', value: 40 })); });
		renderWithStore(<Preview pinyinReady={false} />);
		var host = document.getElementById('printContent');
		expect(host).toBeTruthy();
		expect(host.style.getPropertyValue('--char-stroke')).toBe('0.04em');
		act(function () { store.dispatch(setField({ key: 'InkWidth', value: 0 })); });
		renderWithStore(<Preview pinyinReady={false} />);
		expect(document.getElementById('printContent').style.getPropertyValue('--char-stroke')).toBe('0em');
	});
});

describe('纸张底色与纹理（C-d）', function () {
	it('C-d 底色 / 纹理控件改配置，自定义色覆盖预设', function () {
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('button', { name: '版式' }));
		var swatch = screen.getByRole('button', { name: '纸张底色预设 米黄' });
		expect(swatch).toBeTruthy();
		fireEvent.click(swatch);
		expect(store.getState().config.PaperColor).toBe('cream');
		expect(store.getState().config.PaperTint).toBe('');
		/* 自定义色写入 PaperTint */
		var picker = document.querySelector('.rp-color-input[aria-label="自定义纸张颜色"]');
		expect(picker).toBeTruthy();
		fireEvent.change(picker, { target: { value: '#E8DCC0' } });
		expect(store.getState().config.PaperTint).toBe('#e8dcc0');
		/* 纹理三选一 */
		fireEvent.click(screen.getByRole('button', { name: '洒金' }));
		expect(store.getState().config.PaperTexture).toBe('speckle');
		fireEvent.click(screen.getByRole('button', { name: '无' }));
		expect(store.getState().config.PaperTexture).toBe('none');
	});

	it('C-d 预览注入 --paper-bg / --paper-texture，导出同源', function () {
		act(function () {
			store.dispatch(setField({ key: 'PaperColor', value: 'rice' }));
			store.dispatch(setField({ key: 'PaperTexture', value: 'fiber' }));
		});
		renderWithStore(<Preview pinyinReady={false} />);
		var host = document.getElementById('printContent');
		expect(host.style.getPropertyValue('--paper-bg')).toBe('#F4EBDA');
		var tex = host.style.getPropertyValue('--paper-texture');
		expect(tex.indexOf('data:image/svg+xml') !== -1).toBe(true);
		act(function () { store.dispatch(setField({ key: 'PaperTexture', value: 'none' })); });
		renderWithStore(<Preview pinyinReady={false} />);
		expect(document.getElementById('printContent').style.getPropertyValue('--paper-texture')).toBe('none');
	});
});

describe('PNG 导出分辨率（C-e）', function () {
	it('C-e 输出页分辨率滑杆：默认 144dpi，96–384 步进 48', function () {
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('button', { name: '输出' }));
		var slider = document.getElementById('pngDpi');
		expect(slider).toBeTruthy();
		expect(slider.min).toBe('96');
		expect(slider.max).toBe('384');
		expect(slider.step).toBe('48');
		expect(store.getState().config.PngDpi).toBe(144);
		fireEvent.change(slider, { target: { value: '288' } });
		expect(store.getState().config.PngDpi).toBe(288);
	});
});

describe('打印缩放（C-f）', function () {
	it('C-f 输出页滑杆：自动档按安全宽度计算', function () {
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('button', { name: '输出' }));
		var slider = document.getElementById('printScale');
		expect(slider).toBeTruthy();
		expect(slider.min).toBe('0');
		expect(slider.max).toBe('100');
		expect(slider.step).toBe('5');
		expect(store.getState().config.PrintScale).toBe(0);
		fireEvent.change(slider, { target: { value: '60' } });
		expect(store.getState().config.PrintScale).toBe(60);
	});

	it('C-f 预览注入 --print-zoom：默认 A4 自动缩小，手动档按百分比', function () {
		renderWithStore(<Preview pinyinReady={false} />);
		var zoom = document.getElementById('printContent').style.getPropertyValue('--print-zoom');
		expect(Math.abs(parseFloat(zoom) - 200 / 210)).toBeLessThan(1e-6);
		act(function () { store.dispatch(setField({ key: 'PrintScale', value: 60 })); });
		renderWithStore(<Preview pinyinReady={false} />);
		expect(document.getElementById('printContent').style.getPropertyValue('--print-zoom')).toBe('0.6');
	});
});

describe('页级微调（Z3）', function () {
	function pageTools(pageIndex) {
		var page = document.querySelector('.rp-page[data-page="' + pageIndex + '"]');
		return page ? page.querySelectorAll('.rp-page-tools .rp-link') : [];
	}

	it('删去本页：移除该页内容并提示可撤销', function () {
		act(function () { store.dispatch(setField({ key: 'Content', value: '天地玄黄\n\n宇宙洪荒' })); });
		renderWithStore(<div><Preview pinyinReady={false} /><ToastHost /></div>);
		var tools = pageTools(0);
		expect(tools.length).toBe(2);
		fireEvent.click(tools[0]);
		expect(store.getState().config.Content).toBe('宇宙洪荒');
		expect(document.body.textContent).toContain('已删除第 1 页内容');
	});

	it('与下页合并：显式空行边界成功合并', function () {
		act(function () { store.dispatch(setField({ key: 'Cols', value: 8 })); });
		act(function () { store.dispatch(setField({ key: 'Content', value: '天地玄黄\n\n宇宙洪荒' })); });
		renderWithStore(<div><Preview pinyinReady={false} /><ToastHost /></div>);
		fireEvent.click(pageTools(0)[1]);
		expect(store.getState().config.Content).toBe('天地玄黄\n宇宙洪荒');
		expect(document.body.textContent).toContain('已合并第 1 / 2 页');
	});

	it('自动分页边界：合并不适用时如实提示', function () {
		act(function () { store.dispatch(setField({ key: 'Cols', value: 8 })); });
		act(function () { store.dispatch(setField({ key: 'Content', value: '永'.repeat(96) })); });
		renderWithStore(<div><Preview pinyinReady={false} /><ToastHost /></div>);
		fireEvent.click(pageTools(0)[1]);
		expect(document.body.textContent).toContain('自动分页');
		expect(document.body.textContent).toContain('不能直接合并');
		/* 最后一页的合并按钮禁用 */
		var last = pageTools(1)[1];
		expect(last.disabled).toBe(true);
	});
});

describe('导入自动化清洗（Z4）', function () {
	it('内容工具「清洗排版…」：折叠空行 + 统一标点并汇报', function () {
		act(function () { store.dispatch(setContent('  天地玄黄  \n\n\n宇宙洪荒,你好! ')); });
		renderWithStore(<div><Panel /><ToastHost /></div>);
		fireEvent.click(screen.getByRole('button', { name: '内容' }));
		fireEvent.click(screen.getByRole('button', { name: /清洗排版/ }));
		expect(store.getState().config.Content).toBe('天地玄黄\n\n宇宙洪荒，你好！');
		expect(document.body.textContent).toContain('已清洗排版');
		expect(document.body.textContent).toContain('统一标点 2 处');
	});

	it('干净内容：提示无需清洗且不产生改动', function () {
		act(function () { store.dispatch(setContent('天地\n\n玄黄')); });
		renderWithStore(<div><Panel /><ToastHost /></div>);
		fireEvent.click(screen.getByRole('button', { name: '内容' }));
		fireEvent.click(screen.getByRole('button', { name: /清洗排版/ }));
		expect(store.getState().config.Content).toBe('天地\n\n玄黄');
		expect(document.body.textContent).toContain('已是干净状态');
	});
});

describe('状态完备性（U3）', function () {
	function toastEl(text) {
		return Array.prototype.filter.call(
			document.querySelectorAll('.rp-toast'),
			function (el) { return el.textContent.indexOf(text) >= 0; }
		)[0] || null;
	}

	it('空内容导出 PNG：前置提示，不进入生成、不给无意义的「重试」', async function () {
		var mod = await import('../web/src/App.jsx');
		act(function () { store.dispatch(setContent('')); });
		var rendered = renderWithStore(React.createElement(mod.default));
		fireEvent.click(document.querySelector('[data-page="output"]'));
		fireEvent.click(screen.getByRole('button', { name: '导出 PNG' }));
		await waitFor(function () {
			expect(toastEl('内容为空')).toBeTruthy();
		});
		expect(toastEl('内容为空').className).toContain('rp-toast-info');
		expect(toastEl('内容为空').querySelector('.rp-toast-action')).toBeNull();
		/* 未落到 renderPages 抛错，因此不应出现「导出失败」错误态 */
		expect(store.getState().ui.toasts.some(function (t) { return t.type === 'error' && t.text.indexOf('导出失败') >= 0; })).toBe(false);
		expect(rendered.container.querySelector('[data-page="output"]')).toBeTruthy();
		rendered.unmount();
	});

	it('拼音库加载失败（离线降级）：明确提示且预览照常渲染', async function () {
		mockState.pinyinFails = true;
		var mod = await import('../web/src/App.jsx');
		var rendered = renderWithStore(React.createElement(mod.default));
		await waitFor(function () {
			expect(toastEl('拼音库加载失败')).toBeTruthy();
		});
		expect(toastEl('拼音库加载失败').className).toContain('rp-toast-info');
		expect(document.getElementById('rp-main')).toBeTruthy();
		rendered.unmount();
	});
});

describe('接入设置（更多页 · U6 端口固定）', function () {
	var PORT_KEY = 'zitie.backend.port';

	function openMore() {
		var rendered = renderWithStore(<Panel />);
		/* 「更多」是独立 rail 按钮（.rp-rail-more），非 RAIL_MAIN 项 */
		fireEvent.click(rendered.container.querySelector('.rp-rail-more'));
		return rendered;
	}

	it('保存合法端口写入 localStorage，非法端口被拒绝', function () {
		window.localStorage.removeItem(PORT_KEY);
		var rendered = openMore();
		var input = rendered.container.querySelector('input[type="number"]');
		expect(input).toBeTruthy();
		/* 「更多」页现有两处本地模式文案（接入设置 / 数据备份），断言至少一处即可 */
		expect(screen.getAllByText(/本地模式/).length).toBeGreaterThan(0);

		fireEvent.change(input, { target: { value: '46079' } });
		fireEvent.click(screen.getByRole('button', { name: '保存' }));
		expect(window.localStorage.getItem(PORT_KEY)).toBe('46079');
		expect(document.body.textContent).toContain('已固定端口 46079');

		fireEvent.change(input, { target: { value: '0' } });
		fireEvent.click(screen.getByRole('button', { name: '保存' }));
		expect(window.localStorage.getItem(PORT_KEY)).toBe('46079'); /* 非法值不得覆盖已存 */
		expect(document.body.textContent).toContain('请输入 1–65535');
		rendered.unmount();
	});

	it('清除按钮移除固定端口并提示恢复默认探测', function () {
		window.localStorage.setItem(PORT_KEY, '46080');
		var rendered = openMore();
		expect(rendered.container.querySelector('input[type="number"]').value).toBe('46080');
		fireEvent.click(screen.getByRole('button', { name: '清除' }));
		expect(window.localStorage.getItem(PORT_KEY)).toBeNull();
		expect(document.body.textContent).toContain('已清除固定端口');
		rendered.unmount();
	});

	it('测试连接：按输入端口探测 /api/config 并给出可达性结论', async function () {
		window.localStorage.removeItem(PORT_KEY);
		vi.stubGlobal('fetch', vi.fn(async function (url) {
			expect(String(url)).toBe('http://127.0.0.1:46081/api/config');
			return { ok: true, json: async function () { return { app: 'motie' }; } };
		}));
		var rendered = openMore();
		fireEvent.change(rendered.container.querySelector('input[type="number"]'), { target: { value: '46081' } });
		fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
		await waitFor(function () {
			expect(document.body.textContent).toContain('端口 46081 可达墨帖内核');
		});
		rendered.unmount();
		vi.unstubAllGlobals();
	});

	it('数据备份（E3）：仅本地模式显示；http 模式隐藏', function () {
		var rendered = renderWithStore(<Panel />);
		fireEvent.click(rendered.container.querySelector('.rp-rail-more'));
		function findExportBtn() {
			return Array.prototype.find.call(
				rendered.container.querySelectorAll('button'),
				function (b) { return b.textContent.indexOf('导出完整备份') !== -1; }
			) || null;
		}
		expect(findExportBtn()).toBeTruthy(); /* 默认 mock（本地模式）可见 */
		act(function () { store.dispatch(setBackendMode('http')); });
		expect(findExportBtn()).toBeNull();
		act(function () { store.dispatch(setBackendMode('mock')); }); /* 还原，避免影响后续用例 */
		rendered.unmount();
	});
});
