import React, { useEffect, useMemo, useRef, useState } from 'react';
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
function mmPx(value) { return Math.round((Number(value) || 0) * PX_PER_MM) + 'px'; }

/**
 * 预览：直接消费版式真源 Z.SheetLayout.compute()，与原生版 / PDF / 打印同源。
 * 颜色 / 字距行距 / 格子大小内联，避免依赖 CSS 变量在 React 外的副作用。
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
	/* 按需渲染（T2.4）：仅渲染进入视口的页，屏外页保留占位；打印前全量展开 */
	const [rendered, setRendered] = useState({ 0: true });

	const layout = useMemo(function () {
		return Z.SheetLayout.compute({
			content: config.Content,
			title: config.Title,
			template: config.Template,
			traceCount: config.TraceCount,
			cols: config.Cols,
			rowGap: config.RowGap,
			cellGap: config.CellGap,
			gridPx: config.GridSize,
			config: config
		});
	}, [config.Content, config.Title, config.Template, config.TraceCount, config.Cols, config.RowGap, config.CellGap, config.GridSize]);
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

	/* 打印（含 Ctrl+P / 打印按钮）前全量展开，避免占位页缺失 */
	useEffect(function () {
		function expand() { setRendered(allRendered(pageCount)); }
		window.addEventListener('beforeprint', expand);
		return function () { window.removeEventListener('beforeprint', expand); };
	}, [pageCount]);

	/* 每个格子的全局汉字序号（与 ContentModel.replaceHanAt 的编号一致） */
	const cellKeys = useMemo(function () {
		var keys = [];
		var n = 0;
		layout.pages.forEach(function (page, p) {
			page.lines.forEach(function (line, r) {
				line.forEach(function (cell, c) {
					/* 只有可编辑格（非空临格）参与汉字序号编号，与 replaceHanAt 对齐 */
					var index = n;
					if (cell.role !== 'blank') n++;
					keys.push({ key: p + '-' + r + '-' + c, index: index, char: cell.char, role: cell.role });
				});
			});
		});
		return keys;
	}, [layout]);

	const rgb = Z.INK_RGB[config.InkColor] || Z.INK_RGB.cinnabar;
	const modelColor = 'rgba(' + rgb + ', ' + config.InkAlpha + ')';
	const traceColor = 'rgba(' + rgb + ', ' + (config.InkAlpha * 0.5) + ')';
	const zg = Z.getZgBackground(config.ZgType, config.ZgColor);
	const charCount = Z.ContentModel.parse(config.Content).total;

	/* 进入编辑：输入框自动聚焦并全选 */
	useEffect(function () {
		if (editing && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [editing]);

	function findCell(key) {
		for (var i = 0; i < cellKeys.length; i++) {
			if (cellKeys[i].key === key) return cellKeys[i];
		}
		return null;
	}

	function focusCell(key) {
		var el = document.querySelector('.hz-line[data-key="' + key + '"]');
		if (el && typeof el.focus === 'function') el.focus();
	}

	function openEditor(cell) {
		if (!cell) return;
		var next = { key: cell.key, index: cell.index, char: cell.char };
		editingRef.current = next;
		setEditing(next);
		setDraft(cell.char);
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
			var idx = -1;
			for (var i = 0; i < cellKeys.length; i++) {
				if (cellKeys[i].key === editing.key) { idx = i; break; }
			}
			/* 跳到下一个可编辑格（跳过空格占位 / 补满空临格） */
			var nextKey = null;
			for (var j = idx + 1; j < cellKeys.length; j++) {
				if (cellKeys[j].role !== 'blank') { nextKey = cellKeys[j].key; break; }
			}
			commitEdit(nextKey);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		}
	}

	function onContentClick(e) {
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
					'--grid-size': config.GridSize + 'px',
					'--row-gap': String(config.RowGap),
					'--cell-gap': String(config.CellGap),
					'--ink-rgb': rgb,
					'--ink-alpha': String(config.InkAlpha)
				}}
				onClick={onContentClick}
				onDoubleClick={onContentDoubleClick}
			>
				{layout.pages.map(function (page, pageIndex) {
					return (
						<div className="rp-page" data-page={pageIndex} key={pageIndex}>
							{/* 预览按 96dpi 真实像素显示纸张（与打印 / PDF 尺寸同源），窄区横向滚动 */}
							<div
								className="rp-page-sheet"
								style={{
									aspectRatio: config.Page.width + ' / ' + config.Page.height,
									width: mmPx(config.Page.width),
									/* 屏幕预览页边距与配置 / 打印同值（mm → px），保证三端一致 */
									padding: mmPx(config.Margin.top) + ' ' + mmPx(config.Margin.right) + ' ' + mmPx(config.Margin.bottom) + ' ' + mmPx(config.Margin.left)
								}}
							>
								{rendered[pageIndex] ? (
									<div className="page-block">
										{page.title && <p className="sheet-title">{page.title}</p>}
										{page.lines.map(function (line, r) {
											return (
												<div className="row" key={r}>
													{line.map(function (cell, c) {
														var key = pageIndex + '-' + r + '-' + c;
														var isEditing = editing && editing.key === key;
														return (
															<span className="cell" key={c}>
																{config.ShowPinyin && (
																	<span className="cell-pinyin">{pinyinReady ? Z.getPinyin(cell.char) : ''}</span>
																)}
																<span
																	className={'hz-line is-' + cell.role}
																	data-key={key}
																	data-char={cell.char}
																	role={cell.role === 'blank' ? undefined : 'button'}
																	tabIndex={cell.role === 'blank' ? undefined : 0}
																	aria-label={cell.role === 'blank' ? undefined : '放大查看 ' + cell.char}
																	onKeyDown={function (e) { onCellKeyDown(e, { key: key, char: cell.char }); }}
																	style={{
																		backgroundImage: zg,
																		color: cell.role === 'blank' ? undefined : (cell.role === 'trace' ? traceColor : modelColor)
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
								) : null}
							</div>
							<p className="rp-page-no">
								{config.ShowMeta && (
									<span className="rp-meta">姓名：{config.Name || '＿＿＿＿'}　日期：{dateStamp(new Date())}</span>
								)}
								{config.ShowPageNo ? '第 ' + (pageIndex + 1) + ' / ' + layout.pages.length + ' 页' : ''}
							</p>
						</div>
					);
				})}
			</div>
			<p className="rp-count">{charCount} 个汉字 · 共 {layout.pages.length} 页</p>
			<BigPreview char={bigChar} strokeAnim={config.StrokeAnim} onClose={function () { setBigChar(''); }} />
		</main>
	);
}
