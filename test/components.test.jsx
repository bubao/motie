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
import { store, resetConfig, pushToast, dismissToast, setField, setContent, importConfig, setFontSource, replaceHan, resetHistory, undoContent, redoContent } from '../web/src/store.js';
import { ToastHost } from '../web/src/ToastHost.jsx';
import { Preview } from '../web/src/Preview.jsx';
import { BigPreview } from '../web/src/BigPreview.jsx';
import { Panel } from '../web/src/Panel.jsx';
import { usePrint } from '../web/src/usePrint.js';

function renderWithStore(ui) {
	return render(React.createElement(Provider, { store }, ui));
}

/* 组件已改用 core ESM（P4）：assets / pinyin / stroke 通过 vi.mock 注入测试替身，
 * 避免 jsdom 真实网络加载与 HanziWriter 依赖。*/
var mockState = vi.hoisted(function () {
	return { playCalls: 0, statusText: 'CDN 模式（测试）。' };
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
		loadPinyin: function () { return Promise.resolve(); },
		getPinyin: function (c) { return c === '永' ? 'yǒng' : ''; },
		resetPinyin: function () {},
		isPinyinReady: function () { return true; }
	};
});

vi.mock('../web/src/core/stroke.js', function () {
	return {
		Stroke: {
			play: function () { mockState.playCalls++; return false; },
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
	mqState.matches = false;
	mqState.listeners = [];
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
		/* 字格无障碍语义：单击编辑 / 双击放大 */
		expect(cell.getAttribute('aria-label')).toBe('编辑 永，双击放大查看');
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
});

	describe('store：undo/redo 与多标签页同步（P3-14）', function () {
		beforeEach(function () {
			act(function () { store.dispatch(setContent('永')); });
			act(function () { store.dispatch(resetHistory()); });
		});

		it('undo/redo：入栈 / 新分支清空 redo / 边界', function () {
			act(function () { store.dispatch(setContent('甲')); });
			act(function () { store.dispatch(setContent('乙')); });
			expect(store.getState().config.history.past).toEqual(['永', '甲']);
			expect(store.getState().config.history.future).toEqual([]);
			expect(undoContent()).toBe(true);
			expect(store.getState().config.Content).toBe('甲');
			expect(store.getState().config.history.future).toEqual(['乙']);
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
	it('字格色板有可访问名与按下态', function () {
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('button', { name: '字格' }));
		var green = screen.getByRole('button', { name: '绿色' });
		expect(green.getAttribute('aria-label')).toBe('绿色');
		expect(green.getAttribute('aria-pressed')).toBe('true');
		fireEvent.click(screen.getByRole('button', { name: '红色' }));
		expect(store.getState().config.ZgColor).toBe('3');
		expect(screen.getByRole('button', { name: '红色' }).getAttribute('aria-pressed')).toBe('true');
		expect(screen.getByRole('button', { name: '绿色' }).getAttribute('aria-pressed')).toBe('false');
	});
});

describe('信息架构（P2-7）', function () {
	it('输出页含导出 PDF / 打印，导出回调生效', function () {
		var onExport = vi.fn();
		renderWithStore(<Panel onExportPdf={onExport} pdfBusy={false} />);
		fireEvent.click(screen.getByRole('button', { name: '输出' }));
		fireEvent.click(screen.getByRole('button', { name: '导出 PDF' }));
		expect(onExport).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('button', { name: '打印' })).toBeTruthy();
	});

	it('生成中导出按钮禁用', function () {
		renderWithStore(<Panel onExportPdf={vi.fn()} pdfBusy={true} />);
		fireEvent.click(screen.getByRole('button', { name: '输出' }));
		expect(screen.getByRole('button', { name: '正在生成 PDF…' }).disabled).toBe(true);
	});

	it('示例库默认展开，无需二次点击', function () {
		renderWithStore(<Panel />);
		expect(document.getElementById('sampleSelect')).toBeTruthy();
	});

	it('更多页首屏为设置导入导出', function () {
		renderWithStore(<Panel />);
		fireEvent.click(screen.getByRole('button', { name: '更多' }));
		var page = document.querySelector('.rp-panel-page');
		expect(page.firstElementChild.textContent).toContain('设置');
	});
});
