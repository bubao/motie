import React, { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { ContentModel, INK_RGB, getPinyin, FONT_WEIGHT_NUM, getStrokeMedians, getControlBackground, getStrokeBackground, STROKE_NAMES, CONTROL_PATTERN_NAMES } from './core/index.js';
import { useSheetLayout } from './hooks/useSheetLayout.js';
import { useZgBackground } from './hooks/useZgBackground.js';
import { replaceHan } from './store.js';
import { BigPreview } from './BigPreview.jsx';

/* 元信息日期（T2.2）：YYYY-MM-DD，屏幕 / 打印 / PDF 一致 */
function dateStamp(d) {
	function pad(n) { return (n < 10 ? '0' : '') + n; }
	return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/* 按需渲染（T2.4）：构造「全部页已渲染」标记 */
function allRendered(n) {
	var out = {};
	for (var i = 0; i < n; i++) out[i] = true;
	return out;
}

/* 静态笔顺（B4）：字形数据 1024 参考框 → 格内位置。
 * 字形区域按 CharScale 居中（与字体渲染口径一致），medians 中点落入其中。
 * 注意：hanzi-writer 的 medians 是 y 向上坐标系，屏幕 / 打印 y 向下，需翻转。 */
function strokePos(m, scale) {
	var s = Number(scale) || 0.725;
	return { x: (1 - s) / 2 + m.x * s, y: (1 - s) / 2 + (1 - m.y) * s };
}

var PX_PER_MM = 96 / 25.4; /* 预览按 96dpi 真实像素：毫米 → px */
function mmNum(value) { return (Number(value) || 0) * PX_PER_MM; }
function mmPx(value) { return Math.round(mmNum(value)) + 'px'; }
/* 格宽向下取整：保证 cols × 格宽 ≤ 容器宽，避免末格被挤折行 */
function mmFloorPx(value) { return Math.floor(mmNum(value)) + 'px'; }
/* 缩放条 / Ctrl+滚轮：手动缩放范围与步长（只影响屏幕预览；打印 / PDF 始终真实纸张尺寸） */
var ZOOM_MIN = 0.3;
var ZOOM_MAX = 2.5;
var ZOOM_STEP = 0.1;
function clampZoom(v) { return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v)); }

/**
 * 预览：直接消费版式真源 useSheetLayout()（SheetLayout.compute），与原生版 / PDF / 打印同源。
 * 颜色 / 行距 / 格子大小内联，避免依赖 CSS 变量在 React 外的副作用。
 * 交互：单击字格进入单字编辑（T1.10），双击 / Space 打开放大预览（T1.9）。
 */
export function Preview({ pinyinReady }) {
	const config = useSelector(function (s) { return s.config; });
	const dispatch = useDispatch();
	const [bigChar, setBigChar] = useState('');
	const [editing, setEditing] = useState(null); // { key, index, char }
	const [draft, setDraft] = useState('');
	const inputRef = useRef(null);
	const clickTimer = useRef(null);
	const timerKey = useRef(null);
	/* 与 editing state 同步的 ref：blur / Enter 竞态时避免重复提交 */
	const editingRef = useRef(null);
	const mainRef = useRef(null);
	const printingRef = useRef(false); /* 打印展开期间：observer 回调不得缩减 rendered（P1-6） */
	const scaleRef = useRef(1);
	/* 按需渲染（T2.4）：仅渲染进入视口的页，屏外页保留占位；打印前全量展开 */
	const [rendered, setRendered] = useState({ 0: true });
	/* 屏幕预览缩放：fit = 自动适应窗口（默认）；manual = 用户用缩放条 / Ctrl+滚轮接管 */
	const [scale, setScale] = useState(1);
	const [zoomMode, setZoomMode] = useState('fit');
	const modeRef = useRef(zoomMode);
	const fitUpdaterRef = useRef(null);
	modeRef.current = zoomMode;
	/* 静态笔顺（B4）：char -> 每笔中点（0..1）；异步加载，未就绪不显示、不阻塞渲染 */
	const [strokeMarks, setStrokeMarks] = useState({});

	/* 版式真源：依赖全量收敛在 hook 内（见 hooks/useSheetLayout.js），不再手写依赖列表 */
	const layout = useSheetLayout(config);
	const pageCount = layout.pages.length;

	/* 按需渲染（T2.4）：观察 .rp-page 进入视口（提前 120%），仅标记渲染；
	   占位与完整页复用同一 DOM 节点（key 稳定），observer 持续有效。 */
	useEffect(function () {
		var root = mainRef.current;
		if (!root) return undefined;
		if (typeof IntersectionObserver === 'undefined') {
			if (pageCount > 1) setRendered(allRendered(pageCount));
			return undefined;
		}
		var io = new IntersectionObserver(function (entries) {
			if (printingRef.current) return; /* 打印展开期间保持全部页（P1-6） */
			setRendered(function (prev) {
				var next = prev;
				entries.forEach(function (entry) {
					if (!entry.isIntersecting) return;
					var i = Number(entry.target.getAttribute('data-page'));
					if (!next[i]) {
						var add = {};
						add[i] = true;
						next = Object.assign({}, next, add);
					}
				});
				return next;
			});
		}, { root: null, rootMargin: '120% 0px' });
		var nodes = root.querySelectorAll('.rp-page');
		for (var i = 0; i < nodes.length; i++) io.observe(nodes[i]);
		return function () { io.disconnect(); };
	}, [pageCount]);

	/* 插入空白页后定位到末页：新页按需渲染需两次滚动（先滚入视口触发渲染，再滚到底） */
	useEffect(function () {
		function gotoLast() {
			var root = mainRef.current;
			if (!root) return;
			var scroll = function () { root.scrollTop = root.scrollHeight; };
			scroll();
			window.setTimeout(scroll, 120);
			window.setTimeout(scroll, 350);
		}
		window.addEventListener('zitie:goto-last-page', gotoLast);
		return function () { window.removeEventListener('zitie:goto-last-page', gotoLast); };
	}, []);

	/* 屏幕预览适应宽度：整页等比缩放铺满预览区（打印 / PDF 仍为真实纸张尺寸） */
	const sheetWNum = mmNum(config.Page.width);
	const sheetHNum = mmNum(config.Page.height);
	const sheetWpx = mmPx(config.Page.width);
	const sheetHpx = mmPx(config.Page.height);
	/* 打印内容区高度（mm）：页高 − 上下页边距，用于页底页码定位（P1-5） */
	const printContentMm = Math.max(1, config.Page.height - config.Margin.top - config.Margin.bottom);

	/* 打印页尺寸 / 页边距随配置（P3-20）：实测 Chrome 的 @page 不接受 var()，
	 * 改为按当前 Page / Margin 注入一条 @page 规则，打印与导出 PDF 时生效；
	 * 同时把下边距（px）暴露给页码定位，避免页码溢出纸张。 */
	useEffect(function () {
		var el = document.getElementById('zitie-page-rule');
		if (!el) {
			el = document.createElement('style');
			el.id = 'zitie-page-rule';
			document.head.appendChild(el);
		}
		var w = Number(config.Page.width) || 0;
		var h = Number(config.Page.height) || 0;
		var m = config.Margin;
		el.textContent = '@page { size: ' + w + 'mm ' + h + 'mm; margin: '
			+ m.top + 'mm ' + m.right + 'mm ' + m.bottom + 'mm ' + m.left + 'mm; }'
			+ ':root { --print-mb-px: ' + mmNum(m.bottom) + 'px; }';
		return function () { el.textContent = ''; };
	}, [config.Page, config.Margin]);

	/* 重算当前视口内的页（afterprint 恢复按需，P1-6） */
	function visiblePages() {
		var root = mainRef.current;
		if (!root) return { 0: true };
		var pageH = sheetHNum * scaleRef.current;
		if (!(pageH > 0)) return { 0: true };
		var view = root.clientHeight;
		var top = root.scrollTop;
		var bottom = root.scrollTop + (view > 0 ? view : pageH);
		var out = {};
		for (var i = 0; i < pageCount; i++) {
			var start = i * pageH;
			if (start + pageH > top && start < bottom) out[i] = true;
		}
		return out;
	}

	/* 打印（含 Ctrl+P / 打印按钮）前同步全量展开；打印后恢复按需（P1-6）。
	 * flushSync 保证程序化 window.print() 时打印引擎能同步读到完整 DOM。 */
	useEffect(function () {
		var onBefore = function () {
			printingRef.current = true;
			flushSync(function () { setRendered(allRendered(pageCount)); });
		};
		var onAfter = function () {
			printingRef.current = false;
			flushSync(function () { setRendered(visiblePages()); });
		};
		window.addEventListener('beforeprint', onBefore);
		window.addEventListener('afterprint', onAfter);
		return function () {
			window.removeEventListener('beforeprint', onBefore);
			window.removeEventListener('afterprint', onAfter);
		};
	}, [pageCount, sheetHNum]);

	/* 屏幕预览缩放：默认「适应」——同时适配预览区的宽与高（取较小比例），卡片尽量铺满可视区，
	 * 避免只按宽度缩放时底部留白；宽 / 高任一变小时等比缩小，超出则滚动。
	 * 用户一旦用缩放条 / Ctrl+滚轮手动缩放即进入 manual：窗口变化不再自动改比例；
	 * 点「适应」（或百分比）回到 fit 并按当前容器尺寸重算。打印 / PDF 不受影响。 */
	useEffect(function () {
		function apply(next) {
			scaleRef.current = next;
			setScale(next);
		}
		function update() {
			var root = mainRef.current;
			if (!root) return;
			var availW = Math.max(1, root.clientWidth); /* 滚动区内容宽（外层 .rp-preview 已减掉 20px×2 内边距） */
			var availH = Math.max(1, root.clientHeight);
			var s = Math.min(
				availW / Math.max(1, sheetWNum),
				availH / Math.max(1, sheetHNum)
			);
			var next = clampZoom(s);
			if (modeRef.current === 'fit') apply(next);
		}
		fitUpdaterRef.current = update;
		update();
		var ro = new ResizeObserver(update);
		if (mainRef.current) ro.observe(mainRef.current);
		return function () { ro.disconnect(); };
	}, [sheetWNum, sheetHNum]);

	/* 手动缩放：在当前比例上增减固定步长；到达边界不再变化 */
	function zoomBy(delta) {
		var next = clampZoom(Math.round((scaleRef.current + delta) * 100) / 100);
		if (next === scaleRef.current) return;
		modeRef.current = 'manual';
		setZoomMode('manual');
		scaleRef.current = next;
		setScale(next);
	}
	function zoomIn() { zoomBy(ZOOM_STEP); }
	function zoomOut() { zoomBy(-ZOOM_STEP); }

	/* 回到自动适应：先切模式，再按当前容器尺寸重算并应用 */
	function resetZoom() {
		modeRef.current = 'fit';
		setZoomMode('fit');
		if (fitUpdaterRef.current) fitUpdaterRef.current();
	}

	/* Ctrl/Cmd + 滚轮：在预览区就地缩放（阻止浏览器整页缩放）；触控板双指缩放同样生效。
	 * 用原生监听而非 React onWheel：React 根上的 wheel 是 passive，preventDefault 不生效。 */
	useEffect(function () {
		var root = mainRef.current;
		if (!root || typeof root.addEventListener !== 'function') return undefined;
		function onWheel(e) {
			if (!(e.ctrlKey || e.metaKey)) return;
			if (e.preventDefault) e.preventDefault();
			zoomBy(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
		}
		root.addEventListener('wheel', onWheel, { passive: false });
		return function () { root.removeEventListener('wheel', onWheel); };
	}, []);

	/* 动态 @page 边距：跟随配置，保证打印与屏幕一致 */
	useEffect(function () {
		var m = config.Margin;
		var el = document.getElementById('zitie-page-margin');
		if (!el) {
			el = document.createElement('style');
			el.id = 'zitie-page-margin';
			(document.head || document.documentElement).appendChild(el);
		}
		el.textContent = '@page{size:' + config.Page.width + 'mm ' + config.Page.height + 'mm;margin:' + m.top + 'mm ' + m.right + 'mm ' + m.bottom + 'mm ' + m.left + 'mm;}';
	}, [config.Page.width, config.Page.height, config.Margin.top, config.Margin.right, config.Margin.bottom, config.Margin.left]);

	const rgb = INK_RGB[config.InkColor] || INK_RGB.cinnabar;
	const modelColor = 'rgba(' + rgb + ', ' + config.InkAlpha + ')';
	/* 描红颜色（A3）：auto = 同主色 × 0.5 透明度；指定色 = 该色 × 主色不透明度 */
	const traceRGB = config.TraceColor === 'auto' ? rgb : (INK_RGB[config.TraceColor] || rgb);
	const traceAlpha = config.TraceColor === 'auto' ? config.InkAlpha * 0.5 : config.InkAlpha;
	const traceColor = 'rgba(' + traceRGB + ', ' + traceAlpha + ')';
	/* 字格背景：由完整配置派生（样式 / 颜色 / 线型 / 粗细 / 透明度），屏幕预览与字帖（打印 / PDF）一致 */
	const zg = useZgBackground(config);
	/* 控笔（C1）/ 笔画：剪影背景按角色生成（范字深色 / 描红浅色），叠加在字格背景之上。
	 * 二者均每格可不同（char = 图案 / 笔画 key，逐格取背景，缓存复用）。 */
	const isControl = config.Mode === 'control';
	const isStroke = config.Mode === 'stroke';
	/* 格子尺寸 / 背景由字格类型决定（关闭「显示拼音」不应改变格子）。
	 * 上区型格：type5 拼音格（格内四线三格）与 type10 格上拼音条（田字格 + 顶部窄条，对齐 z2h）；
	 * 二者屏幕都在上区叠加拼音文字，字帖（打印 / PDF）沿用各自策略。 */
	const isPyGrid = config.ZgType === '5' || config.ZgType === '10';
	const isPyBar = config.ZgType === '10';
	const showPy = config.ShowPinyin && isPyGrid && !isControl;
	/* 汉字总数：仅内容变化时重算（P3-13）；控笔（C1）按版面图案格数计 */
	const charCount = useMemo(function () {
		if (config.Mode === 'control') {
			var n = 0;
			layout.pages.forEach(function (page) {
				page.lines.forEach(function (line) {
					if (line.eng) return;
					line.cells.forEach(function (c) { if (c.role !== 'blank') n++; });
				});
			});
			return n;
		}
		return ContentModel.parse(config.Content, config.Mode).total;
	}, [config.Content, config.Mode, layout]);

	/* 进入编辑：输入框自动聚焦并全选 */
	useEffect(function () {
		if (editing && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [editing]);

	/* 静态笔顺（B4）：按需加载版面内唯一字的字形数据（stroke-order.js 内部按字缓存）。
	 * 关闭开关 / 内容变化时重算；加载失败的字不显示序号。 */
	useEffect(function () {
		if (config.Mode === 'control' || config.Mode === 'stroke' || !config.StrokeOrder) {
			setStrokeMarks({});
			return undefined;
		}
		var chars = [];
		var seen = {};
		layout.pages.forEach(function (page) {
			page.lines.forEach(function (line) {
				if (line.eng) {
					line.words.forEach(function (word) {
						if (word.role === 'blank') return;
						word.chars.forEach(function (ch) {
							if (!seen[ch]) { seen[ch] = 1; chars.push(ch); }
						});
					});
					return;
				}
				line.cells.forEach(function (c) {
					if (c.role === 'blank' || !c.char) return;
					if (!seen[c.char]) { seen[c.char] = 1; chars.push(c.char); }
				});
			});
		});
		var cancelled = false;
		Promise.all(chars.map(function (ch) {
			return getStrokeMedians(ch).then(function (m) { return [ch, m]; });
		})).then(function (pairs) {
			if (cancelled) return;
			var next = {};
			pairs.forEach(function (p) { if (p[1]) next[p[0]] = p[1]; });
			setStrokeMarks(next);
		});
		return function () { cancelled = true; };
	}, [config.StrokeOrder, config.Content, config.Mode, layout]);

	/* 按需查找格子（P3-13）：编辑交互时才遍历版式，避免每次内容变化全量重建索引。
	 * index 为全局汉字序号，与 ContentModel.replaceHanAt 的编号一致。 */
		function findCell(key) {
			var n = 0;
			for (var p = 0; p < layout.pages.length; p++) {
				var page = layout.pages[p];
				for (var r = 0; r < page.lines.length; r++) {
					var line = page.lines[r];
					/* english：词单元行——逐字母编号（与 replaceCharAt 的字母序号一致） */
					if (line.words && line.words.length) {
						for (var wi = 0; wi < line.words.length; wi++) {
							var eword = line.words[wi];
							if (eword.role === 'blank') continue;
							for (var ci = 0; ci < eword.chars.length; ci++) {
								var eindex = n;
								n++;
								var ekey = p + '-' + r + '-' + wi + '-' + ci;
								if (ekey === key) return { key: key, index: eindex, char: eword.chars[ci], role: eword.role };
							}
						}
						continue;
					}
					for (var c = 0; c < line.cells.length; c++) {
						var cell = line.cells[c];
						var index = n;
						if (cell.role !== 'blank') n++;
						if (p + '-' + r + '-' + c === key) {
							/* 单元重复：渲染副本与源内容一对多，用 src 回溯源字序号 */
							return { key: key, index: cell.src != null ? cell.src : index, char: cell.char, role: cell.role };
						}
					}
				}
			}
			return null;
		}

	/* 跳到下一个可编辑格（跳过空格占位 / 补满空临格）；找不到来源格时跳到首个可编辑格 */
		function nextEditableKey(fromKey) {
			var firstEditable = null;
			var seen = false;
			for (var p = 0; p < layout.pages.length; p++) {
				var page = layout.pages[p];
				for (var r = 0; r < page.lines.length; r++) {
					var line = page.lines[r];
					/* english：词单元行——逐字母取下一个可编辑位 */
					if (line.words && line.words.length) {
						for (var wi = 0; wi < line.words.length; wi++) {
							var eword = line.words[wi];
							if (eword.role === 'blank') continue;
							for (var ci = 0; ci < eword.chars.length; ci++) {
								var ekey = p + '-' + r + '-' + wi + '-' + ci;
								if (firstEditable === null) firstEditable = ekey;
								if (seen) return ekey;
								if (ekey === fromKey) seen = true;
							}
						}
						continue;
					}
					for (var c = 0; c < line.cells.length; c++) {
						var key = p + '-' + r + '-' + c;
						var role = line.cells[c].role;
						if (role !== 'blank') {
							if (firstEditable === null) firstEditable = key;
							if (seen) return key;
						}
						if (key === fromKey) seen = true;
					}
				}
			}
			return seen ? null : firstEditable;
		}

	function focusCell(key) {
		var el = document.querySelector('.hz-line[data-key="' + key + '"]');
		if (el && typeof el.focus === 'function') el.focus();
	}

	function openEditor(cell) {
		if (!cell) return;
		/* 正在编辑同格时忽略：输入框点击冒泡不得重置已输入草稿（P0-1） */
		if (editingRef.current && editingRef.current.key === cell.key) return;
		var next = { key: cell.key, index: cell.index, char: cell.char };
		editingRef.current = next;
		setEditing(next);
		setDraft(cell.char);
	}

	/* 空态引导：通知面板切到「内容」页并聚焦输入框（Panel 监听该事件） */
	function goContent() {
		window.dispatchEvent(new CustomEvent('zitie:go-content'));
	}

	function commitEdit(nextKey) {
		var ed = editingRef.current;
		if (!ed) return;
		editingRef.current = null;
		if (draft !== ed.char) dispatch(replaceHan({ index: ed.index, char: draft }));
		var key = nextKey || ed.key;
		setEditing(null);
		setDraft('');
		focusCell(key);
	}

	function cancelEdit() {
		var ed = editingRef.current;
		if (!ed) return;
		editingRef.current = null;
		setEditing(null);
		setDraft('');
		focusCell(ed.key);
	}

	function onDraftChange(e) {
		var parts = ContentModel.splitChars(String(e.target.value));
		var ch = parts.length ? parts[parts.length - 1] : '';
		setDraft(ch && ContentModel.isRenderable(ch, config.Mode) ? ch : '');
	}

	function onDraftKeyDown(e) {
		if (e.key === 'Enter') {
			e.preventDefault();
			/* 提交并聚焦下一格（最后一格则停留在本页） */
			commitEdit(nextEditableKey(editing.key));
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		}
	}

	function onContentClick(e) {
		/* 控笔 / 笔画：剪影格不可编辑单字 */
		if (isControl || isStroke) return;
		/* 编辑中的输入框：点击不冒泡成「重新打开编辑」，避免草稿被重置（P0-1） */
		if (e.target && e.target.closest && e.target.closest('.hz-edit')) return;
		var line = e.target && e.target.closest ? e.target.closest('.hz-line') : null;
		if (!line || line.classList.contains('is-blank')) return;
		var key = line.getAttribute('data-key');
		/* 双击的第二击：取消待定的单击编辑 */
		if (clickTimer.current && timerKey.current === key) {
			clearTimeout(clickTimer.current);
			clickTimer.current = null;
			timerKey.current = null;
			return;
		}
		if (clickTimer.current) {
			clearTimeout(clickTimer.current);
			clickTimer.current = null;
		}
		timerKey.current = key;
		clickTimer.current = setTimeout(function () {
			clickTimer.current = null;
			timerKey.current = null;
			openEditor(findCell(key));
		}, 220);
	}

	function onContentDoubleClick(e) {
		/* 控笔 / 笔画：剪影格不可放大预览 */
		if (isControl || isStroke) return;
		var line = e.target && e.target.closest ? e.target.closest('.hz-line') : null;
		if (!line || line.classList.contains('is-blank')) return;
		if (clickTimer.current) {
			clearTimeout(clickTimer.current);
			clickTimer.current = null;
			timerKey.current = null;
		}
		setBigChar(line.getAttribute('data-char'));
	}

	/* 字格键盘：Enter 编辑；Space 放大预览（T1.9 路径） */
	function onCellKeyDown(e, cell) {
		/* 控笔 / 笔画：剪影格不可编辑 */
		if (isControl || isStroke) return;
		if (editing && editing.key === cell.key) return; // 编辑中的 input 自行处理
		if (e.key === 'Enter') {
			e.preventDefault();
			openEditor(cell);
		} else if (e.key === ' ') {
			e.preventDefault();
			setBigChar(cell.char);
		}
	}

	return (
		<main className="rp-preview">
			<div className="rp-preview-scroll" ref={mainRef}>
				<div
					id="printContent"
					className={config.Cols > 0 ? 'is-fixed-cols' : ''}
					style={{
						'--grid-size': mmFloorPx(layout.gridMm),
						/* 宽高比：格子高 = 格宽 × --cell-ratio（版式真源 ratio，随字格类型 / 用户设置） */
						'--cell-ratio': String(layout.ratio),
						/* 行距 = 行盒高 × 配置倍率（版式真源 gapMm / gridMm），.rows 直接消费 */
						'--row-gap': String(layout.gapMm / layout.gridMm),
						/* 字间距 = 格宽 × 该比例（版式真源 cellGapMm / gridMm）；.row / .eng-grid 的间隙与英文偏移消费 */
						'--cell-gap': String(layout.cellGapMm / layout.gridMm),
						'--ink-rgb': rgb,
						'--ink-alpha': String(config.InkAlpha),
						/* 描红颜色（A3）：屏幕 / 打印 / PDF 同源 */
						'--trace-rgb': traceRGB,
						'--trace-alpha': String(traceAlpha),
						/* 字体粗细（A1）：normal 400 / bold 700，屏幕 / 打印 / PDF 同源 */
						'--char-weight': String(FONT_WEIGHT_NUM[config.FontWeight] || 400),
						/* 字占格比例（A2）：默认 0.725，屏幕 / 打印 / PDF 同源 */
						'--char-scale': String(config.CharScale),
						/* 字体在格内的水平 / 垂直偏移（格倍数）：.hz-line 用 translate 消费，打印 / PDF 同源 */
						'--char-dx': String(config.CharOffsetX || 0),
						'--char-dy': String(config.CharOffsetY || 0)
					}}
					onClick={onContentClick}
					onDoubleClick={onContentDoubleClick}
				>
					{charCount === 0 ? (
						/* 空态：不渲染空页，给出开始引导（打印时随 no-print 隐藏） */
						<div className="rp-empty no-print">
							<div className="rp-empty-icon" aria-hidden="true">帖</div>
							<p className="rp-empty-title">输入汉字，开始制作字帖</p>
							<p className="rp-empty-sub">在左侧「内容」页输入文字，或选择一个示例</p>
							<button type="button" className="rp-btn rp-btn-primary rp-empty-btn" onClick={goContent}>查看示例</button>
						</div>
					) : layout.pages.map(function (page, pageIndex) {
						return (
							<div className="rp-page" data-page={pageIndex} key={pageIndex}>
								{/* 缩放层：布局尺寸 = 纸张 × scale 并居中；sheet 用 transform 等比缩放 */}
									<div className="rp-page-zoom" style={{ width: sheetWNum * scale, height: sheetHNum * scale, '--print-h': String(Math.round(printContentMm * 100) / 100) }}>
								<div
									className="rp-page-sheet"
									style={{
										aspectRatio: config.Page.width + ' / ' + config.Page.height,
										width: sheetWpx,
										/* 屏幕预览页边距与配置 / 打印同值（mm → px），保证三端一致 */
										padding: mmPx(config.Margin.top) + ' ' + mmPx(config.Margin.right) + ' ' + mmPx(config.Margin.bottom) + ' ' + mmPx(config.Margin.left),
										transform: 'scale(' + scale + ')',
										transformOrigin: 'top left'
									}}
								>
									{rendered[pageIndex] ? (
									<div className="page-block">
									{page.title && <p className="sheet-title">{page.title}</p>}
									{/* 行距 = 行盒高 × 配置倍率（田字格 1.0×格，拼音格 1.4×格）；
									    行区垂直对齐按配置（居中 / 靠顶 / 靠底），行距不变 */}
									<div className={'rows' + (config.VerticalAlign === 'top' ? ' is-top' : config.VerticalAlign === 'bottom' ? ' is-bottom' : '')}>
										{page.lines.map(function (line, r) {
											/* english：词单元行——词内字母连续（步距 < 1 格）、词间空 1 格；
											    格子背景整行铺满，文字按词偏移叠加（与 PDF 同源）。 */
											if (line.eng) {
												return (
													<div className="row eng-row" key={r}>
														<span className="eng-grid" aria-hidden="true">
															{Array.from({ length: layout.cols }).map(function (_, i) {
																return <span key={i} className="eng-cell" style={{ backgroundImage: zg }} />;
															})}
														</span>
														{line.words.map(function (word, wi) {
															if (word.role === 'blank') return null; /* 空临词：只有格，无字 */
															var wordKey = pageIndex + '-' + r + '-' + wi;
															return (
																<span
																	className="eng-word"
																	key={wi}
																	style={{
																		left: 'calc(var(--grid-size) * (1 + var(--cell-gap, 0)) * ' + word.offset + ')',
																		width: 'calc(var(--grid-size) * ' + (word.chars.length * layout.letterStep) + ')'
																	}}
																>
																	{word.chars.map(function (ch, ci) {
																		var key = wordKey + '-' + ci;
																		var isEditing = editing && editing.key === key;
																		return (
																			<span
																				className={'hz-line is-' + word.role + ' eng-ch'}
																				data-key={key}
																				data-char={ch}
																				role="button"
																				tabIndex={0}
																				aria-label={'编辑 ' + ch + '，双击放大查看'}
																				onKeyDown={function (e) { onCellKeyDown(e, { key: key, char: ch }); }}
																				style={{
																					left: 'calc(var(--grid-size) * (1 + var(--cell-gap, 0)) * ' + layout.letterStep + ' * ' + ci + ')',
																					color: word.role === 'trace' ? traceColor : modelColor
																				}}
																			>
																				{isEditing ? (
																					<input
																						ref={inputRef}
																						className="hz-edit"
																						value={draft}
																						aria-label={'编辑 ' + ch}
																						onChange={onDraftChange}
																						onKeyDown={onDraftKeyDown}
																						onBlur={function () { commitEdit(null); }}
																					/>
																				) : (
																					<>
																						{ch}
																						{word.marks && word.marks[ci] ? <span className="hz-mark">{word.marks[ci]}</span> : null}
																					</>
																				)}
																			</span>
																		);
																	})}
																</span>
															);
														})}
													</div>
												);
											}
											return (
												<div className="row" key={r}>
													{line.cells.map(function (cell, c) {
															var key = pageIndex + '-' + r + '-' + c;
															var isEditing = editing && editing.key === key;
														/* 控笔 / 笔画：剪影背景按角色取色（范字深色 / 描红浅色），逐格按 char 取 key，缓存复用 */
														var controlBg = isControl && cell.role !== 'blank'
															? getControlBackground(cell.char, cell.role === 'trace' ? traceColor : modelColor, cell.role)
															: null;
														var strokeBg = isStroke && cell.role !== 'blank'
															? getStrokeBackground(cell.char, cell.role === 'trace' ? traceColor : modelColor, cell.role)
															: null;
														var lineLabel = cell.role === 'blank' ? undefined
															: (isControl ? '控笔图案 ' + (CONTROL_PATTERN_NAMES[cell.char] || cell.char)
																: isStroke ? '笔画' + (STROKE_NAMES[cell.char] || '') : '编辑 ' + cell.char + '，双击放大查看');
															return (
																<span className={'cell' + (isPyGrid ? ' has-pinyin' : '') + (isPyBar ? ' has-pinyin-bar' : '')} key={c}>
																	{showPy && (isPyBar ? (
																		<span className="cell-pinyin-bar">{pinyinReady ? getPinyin(cell.char) : ''}</span>
																	) : (
																		<span className="cell-pinyin">{pinyinReady ? getPinyin(cell.char) : ''}</span>
																	))}
																	<span
																		className={'hz-line is-' + cell.role}
																		data-key={key}
																		data-char={cell.char}
																		role={cell.role === 'blank' ? undefined : 'button'}
																		tabIndex={cell.role === 'blank' ? undefined : 0}
																		aria-label={lineLabel}
																		onKeyDown={function (e) { onCellKeyDown(e, { key: key, char: cell.char }); }}
																		style={{
																			/* 空临格与有字格同一套字格样式（仅无字），与打印 / PDF 一致；
																			   控笔 / 笔画剪影背景叠加在字格之上（多层背景，剪影层在前） */
															backgroundImage: (controlBg || strokeBg)
																? (controlBg || strokeBg) + ', ' + zg
																: zg,
																			color: cell.role === 'trace' ? traceColor : modelColor
																		}}
																	>
																	{isEditing ? (
																		<input
																			ref={inputRef}
																			className="hz-edit"
																			value={draft}
																			aria-label={'编辑 ' + cell.char}
																			onChange={onDraftChange}
																			onKeyDown={onDraftKeyDown}
																			onBlur={function () { commitEdit(null); }}
																		/>
																	) : (isControl || isStroke) ? null : (
																	<>
																		{cell.role !== 'blank' ? cell.char : ''}
																		{cell.mark ? <span className="hz-mark">{cell.mark}</span> : null}
																		{/* 静态笔顺（B4）：每笔中点标 1..n，未就绪不显示 */}
																		{config.StrokeOrder && strokeMarks[cell.char] ? (
																			<span className="stroke-marks" aria-hidden="true">
																				{strokeMarks[cell.char].map(function (m, i) {
																					var pos = strokePos(m, config.CharScale);
																					return <span className="stroke-mark" key={i} style={{ left: (pos.x * 100) + '%', top: (pos.y * 100) + '%' }}>{i + 1}</span>;
																				})}
																			</span>
																		) : null}
																	</>
																)}
																</span>
															</span>
														);
													})}
												</div>
											);
										})}
										</div>
									</div>
								) : null}
									<p className="rp-page-no">
										{config.ShowMeta && (
											<span className="rp-meta">姓名：{config.Name || '＿＿＿＿'}　日期：{dateStamp(new Date())}</span>
										)}
										{config.ShowPageNo ? '第 ' + (pageIndex + 1) + ' / ' + layout.pages.length + ' 页' : ''}
									</p>
								</div>
							</div>
						</div>
						);
					})}
				</div>
				<p className="rp-count">{charCount === 0
					? (isControl ? '0 个图案 · 未开始' : isStroke ? '0 个笔画 · 未开始' : '0 个汉字 · 未开始')
					: charCount + (isControl ? ' 个图案' : isStroke ? ' 个笔画' : ' 个汉字') + ' · 共 ' + layout.pages.length + ' 页'}</p>
			</div>
			{/* 缩放条：右下角浮层（绝对定位，不随纸张列表滚动）；手动缩放后点「适应」恢复自动 */}
			<div className="rp-zoombar no-print" role="group" aria-label="预览区缩放">
				<button type="button" className="rp-zoom-btn" onClick={zoomOut} disabled={scale <= ZOOM_MIN + 1e-6} aria-label="缩小" title="缩小（Ctrl + 滚轮）">−</button>
				<button type="button" className={'rp-zoom-pct' + (zoomMode === 'fit' ? ' is-auto' : '')} onClick={resetZoom} title="点击恢复「适应」">{Math.round(scale * 100)}%</button>
				<button type="button" className="rp-zoom-btn" onClick={zoomIn} disabled={scale >= ZOOM_MAX - 1e-6} aria-label="放大" title="放大（Ctrl + 滚轮）">+</button>
				<span className="rp-zoom-sep" aria-hidden="true"></span>
				<button type="button" className={'rp-zoom-fit' + (zoomMode === 'fit' ? ' is-active' : '')} onClick={resetZoom} aria-pressed={zoomMode === 'fit'} title="按窗口大小自动适应">适应</button>
			</div>
			<BigPreview char={bigChar} strokeAnim={config.StrokeAnim} zg={zg} isPy={isPyGrid} bar={isPyBar} dx={config.CharOffsetX || 0} dy={config.CharOffsetY || 0} ratio={layout.ratio} weight={config.FontWeight} scale={config.CharScale} onClose={function () { setBigChar(''); }} />
		</main>
	);
}
