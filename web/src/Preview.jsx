import React, { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Zitie as Z } from '../../js/core.js';
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

var PX_PER_MM = 96 / 25.4; /* 预览按 96dpi 真实像素：毫米 → px */
function mmNum(value) { return (Number(value) || 0) * PX_PER_MM; }
function mmPx(value) { return Math.round(mmNum(value)) + 'px'; }
/* 格宽向下取整：保证 cols × 格宽 ≤ 容器宽，避免末格被挤折行 */
function mmFloorPx(value) { return Math.floor(mmNum(value)) + 'px'; }

/**
 * 预览：直接消费版式真源 Z.SheetLayout.compute()，与原生版 / PDF / 打印同源。
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
	const [scale, setScale] = useState(1); /* 屏幕预览缩放：适应预览区宽度 */

	const layout = useMemo(function () {
		return Z.SheetLayout.compute({
			content: config.Content,
			title: config.Title,
			template: config.Template,
			traceCount: config.TraceCount,
			cols: config.Cols,
			rowGap: config.RowGap,
			gridPx: config.GridSize,
			gridRatio: config.GridRatio,
			config: config
		});
	/* 依赖必须覆盖 compute 实际读取的全部字段：ZgType / GridRatio 决定行盒高（拼音格 1.4×，
	 * 宽高比可调）→ 行数 / 行距，Page / Margin 未作为 options 传入（compute 回退读 config），
	 * 漏掉会导致切换字格 / 改页边距 / 改宽高比时命中旧缓存：行数、行距与格子实际尺寸不符，
	 * 内容把纸张撑高或行距错乱。 */
	}, [config.Content, config.Title, config.Template, config.TraceCount, config.Cols, config.RowGap, config.GridSize, config.GridRatio, config.ZgType, config.Page, config.Margin]);
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

	/* 屏幕预览缩放：同时适配预览区的宽与高（取较小比例），卡片尽量铺满可视区，
	 * 避免只按宽度缩放时底部留白；宽 / 高任一变小时等比缩小，超出则滚动。 */
	useEffect(function () {
		function update() {
			var root = mainRef.current;
			if (!root) return;
			var availW = root.clientWidth - 40; /* .rp-preview 左右各 20px */
			var availH = root.clientHeight - 40;
			var s = Math.min(
				availW / Math.max(1, sheetWNum),
				availH / Math.max(1, sheetHNum)
			);
			var next = Math.min(2.5, Math.max(0.3, s));
			scaleRef.current = next;
			setScale(next);
		}
		update();
		var ro = new ResizeObserver(update);
		if (mainRef.current) ro.observe(mainRef.current);
		return function () { ro.disconnect(); };
	}, [sheetWNum, sheetHNum]);

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

	const rgb = Z.INK_RGB[config.InkColor] || Z.INK_RGB.cinnabar;
	const modelColor = 'rgba(' + rgb + ', ' + config.InkAlpha + ')';
	const traceColor = 'rgba(' + rgb + ', ' + (config.InkAlpha * 0.5) + ')';
	/* 字格背景：拼音格上区四线三格 + 下区田字格，屏幕预览与字帖（打印 / PDF）一致 */
	const zg = Z.getZgBackground(config.ZgType, config.ZgColor);
	/* 格子尺寸 / 背景由字格类型决定（关闭「显示拼音」不应改变格子）；拼音仅「拼音格」在预览叠加显示（字帖不显示） */
	const isPyGrid = config.ZgType === '5';
	const showPy = config.ShowPinyin && isPyGrid;
	/* 汉字总数：仅内容变化时重算（P3-13） */
	const charCount = useMemo(function () {
		return Z.ContentModel.parse(config.Content).total;
	}, [config.Content]);

	/* 进入编辑：输入框自动聚焦并全选 */
	useEffect(function () {
		if (editing && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [editing]);

	/* 按需查找格子（P3-13）：编辑交互时才遍历版式，避免每次内容变化全量重建索引。
	 * index 为全局汉字序号，与 ContentModel.replaceHanAt 的编号一致。 */
	function findCell(key) {
		var n = 0;
		for (var p = 0; p < layout.pages.length; p++) {
			var page = layout.pages[p];
			for (var r = 0; r < page.lines.length; r++) {
				var line = page.lines[r];
				for (var c = 0; c < line.length; c++) {
					var index = n;
					if (line[c].role !== 'blank') n++;
					if (p + '-' + r + '-' + c === key) {
						return { key: key, index: index, char: line[c].char, role: line[c].role };
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
				for (var c = 0; c < line.length; c++) {
					var key = p + '-' + r + '-' + c;
					var role = line[c].role;
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
		var parts = Z.ContentModel.splitChars(String(e.target.value));
		var ch = parts.length ? parts[parts.length - 1] : '';
		setDraft(ch && Z.ContentModel.isHan(ch) ? ch : '');
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
		<main className="rp-preview" ref={mainRef}>
			<div
				id="printContent"
				className={config.Cols > 0 ? 'is-fixed-cols' : ''}
				style={{
					'--grid-size': mmFloorPx(layout.gridMm),
					/* 宽高比：格子高 = 格宽 × --cell-ratio（版式真源 ratio，随字格类型 / 用户设置） */
					'--cell-ratio': String(layout.ratio),
					/* 行距 = 行盒高 × 配置倍率（版式真源 gapMm / gridMm），.rows 直接消费 */
					'--row-gap': String(layout.gapMm / layout.gridMm),
					'--ink-rgb': rgb,
					'--ink-alpha': String(config.InkAlpha),
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
											return (
												<div className="row" key={r}>
													{line.map(function (cell, c) {
														var key = pageIndex + '-' + r + '-' + c;
														var isEditing = editing && editing.key === key;
														return (
															<span className={'cell' + (isPyGrid ? ' has-pinyin' : '')} key={c}>
																{showPy && (
																	<span className="cell-pinyin">{pinyinReady ? Z.getPinyin(cell.char) : ''}</span>
																)}
																<span
																	className={'hz-line is-' + cell.role}
																	data-key={key}
																	data-char={cell.char}
																	role={cell.role === 'blank' ? undefined : 'button'}
																	tabIndex={cell.role === 'blank' ? undefined : 0}
																	aria-label={cell.role === 'blank' ? undefined : '编辑 ' + cell.char + '，双击放大查看'}
																	onKeyDown={function (e) { onCellKeyDown(e, { key: key, char: cell.char }); }}
																	style={{
																		/* 空临格与有字格同一套字格样式（仅无字），与打印 / PDF 一致 */
																		backgroundImage: zg,
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
																	) : (
																		<>
																			{cell.role !== 'blank' ? cell.char : ''}
																			{cell.mark ? <span className="hz-mark">{cell.mark}</span> : null}
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
			<p className="rp-count">{charCount === 0 ? '0 个汉字 · 未开始' : charCount + ' 个汉字 · 共 ' + layout.pages.length + ' 页'}</p>
			<BigPreview char={bigChar} strokeAnim={config.StrokeAnim} zg={zg} isPy={isPyGrid} dx={config.CharOffsetX || 0} dy={config.CharOffsetY || 0} ratio={layout.ratio} onClose={function () { setBigChar(''); }} />
		</main>
	);
}
