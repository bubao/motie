import React, { useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { importConfig, pushToast, setContent, setField } from './store.js';
import { FontManager } from './FontManager.jsx';
import { SchemaRange, SchemaPercentRange } from './controls.jsx';
import { usePdfExport } from './usePdfExport.js';
import {
	ConfigSchema,
	INK_COLORS,
	INK_COLOR_KEYS,
	SAMPLE_TEXT,
	SAMPLES,
	TEMPLATES,
	Zitie as Z,
	ZG_COLOR_VALUES,
	ZG_COLORS,
	ZG_TYPES
} from '../../js/core.js';

/* 模板缩略图：按「当前生效列数 + traceCount」用与预览同一套 Z.Layout.cellRole 生成角色，
   保证缩略图与行内规律一致（T1.12）。列数过多时截断，避免缩略图过宽。 */
const TPL_MAX_CELLS = 8;

function tplCells(template, cols, traceCount) {
	var out = [];
	for (var i = 0; i < cols; i++) {
		var role = Z.Layout.cellRole(i, template, traceCount);
		out.push(role === 'model' ? 'on' : role === 'trace' ? 'soft' : 'empty');
	}
	return out;
}

const ZG_TYPE_NAMES = { '1': '田字格', '2': '米字格', '3': '米字回字', '4': '回字格', '5': '拼音格', '6': '作文格', '7': '数字格' };
const INK_NAMES = { cinnabar: '朱砂', ink: '墨色', ochre: '赭石' };

/* 常用纸张预设（mm）；自定义尺寸不匹配任何预设时 select 回退到 custom */
const PAGE_PRESETS = [
	{ key: 'A4', name: 'A4', width: 210, height: 297 },
	{ key: 'A5', name: 'A5', width: 148, height: 210 },
	{ key: 'B5', name: 'B5', width: 176, height: 250 },
	{ key: '16K', name: '16 开', width: 184, height: 260 },
	{ key: 'Letter', name: 'Letter', width: 215.9, height: 279.4 }
];
const MARGIN_KEYS = [['top', '上'], ['bottom', '下'], ['left', '左'], ['right', '右']];

/* rail 图标：24×24 线性图标，stroke 跟随 currentColor */
function RailIcon({ d }) {
	return (
		<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor"
			strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			{d}
		</svg>
	);
}

const ICONS = {
	content: <RailIcon d={<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>} />,
	layout: <RailIcon d={<><rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="M12 4v16M4 12h16" /></>} />,
	grid: <RailIcon d={<><rect x="4" y="4" width="16" height="16" rx="1.5" /><rect x="9" y="9" width="6" height="6" /></>} />,
	text: <RailIcon d={<><path d="M4 20l1-4L16 5l3 3L8 19l-4 1z" /><path d="M14 7l3 3" /></>} />,
	output: <RailIcon d={<><path d="M7 8V4h10v4" /><rect x="4" y="8" width="16" height="8" rx="1.5" /><path d="M7 16h10v4H7z" /></>} />,
	about: <RailIcon d={<><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></>} />
};

const RAIL_MAIN = [
	{ key: 'content', name: '内容' },
	{ key: 'layout', name: '版式' },
	{ key: 'grid', name: '字格' },
	{ key: 'text', name: '文字' },
	{ key: 'output', name: '输出' }
];

function Group({ title, children }) {
	return (
		<section className="rp-group">
			<h3 className="rp-group-title">{title}</h3>
			{children}
		</section>
	);
}

/* 纸张 / 边距：写入 Redux（Page / Margin 已在 ConfigSchema，normalizeField 逐键校验） */
function PageGroup() {
	const config = useSelector(function (s) { return s.config; });
	const dispatch = useDispatch();
	const preset = PAGE_PRESETS.filter(function (p) {
		return Math.abs(p.width - config.Page.width) < 0.05 && Math.abs(p.height - config.Page.height) < 0.05;
	})[0];

	function setPage(patch) {
		dispatch(setField({ key: 'Page', value: Object.assign({}, config.Page, patch) }));
	}
	function setMargin(patch) {
		dispatch(setField({ key: 'Margin', value: Object.assign({}, config.Margin, patch) }));
	}
	function num(value, fallback) {
		var n = Number(value);
		return isFinite(n) ? n : fallback;
	}

	return (
		<Group title="纸张">
			<div className="rp-field">
				<label htmlFor="pagePreset">纸张</label>
				<select
					id="pagePreset"
					className="rp-input"
					value={preset ? preset.key : 'custom'}
					onChange={function (e) {
						var hit = PAGE_PRESETS.filter(function (p) { return p.key === e.target.value; })[0];
						if (hit) setPage({ width: hit.width, height: hit.height });
					}}
				>
					{PAGE_PRESETS.map(function (p) {
						return <option key={p.key} value={p.key}>{p.name}（{p.width} × {p.height}）</option>;
					})}
					<option value="custom">自定义</option>
				</select>
			</div>
			<div className="rp-field">
				<label htmlFor="pageWidth">宽（mm）</label>
				<input
					id="pageWidth"
					className="rp-input"
					type="number"
					min="50"
					max="600"
					step="0.1"
					value={config.Page.width}
					onChange={function (e) { setPage({ width: num(e.target.value, config.Page.width) }); }}
				/>
			</div>
			<div className="rp-field">
				<label htmlFor="pageHeight">高（mm）</label>
				<input
					id="pageHeight"
					className="rp-input"
					type="number"
					min="50"
					max="600"
					step="0.1"
					value={config.Page.height}
					onChange={function (e) { setPage({ height: num(e.target.value, config.Page.height) }); }}
				/>
			</div>
			<div className="rp-field">
				<label>边距（mm）</label>
				<div className="rp-margin-grid">
					{MARGIN_KEYS.map(function (entry) {
						var key = entry[0];
						return (
							<label key={key} htmlFor={'margin-' + key}>{entry[1]}
								<input
									id={'margin-' + key}
									className="rp-input"
									type="number"
									min="0"
									max="60"
									step="0.5"
									value={config.Margin[key]}
									onChange={function (e) { setMargin({ key: num(e.target.value, config.Margin[key]) }); }}
								/>
							</label>
						);
					})}
				</div>
			</div>
		</Group>
	);
}

/* 元信息（T2.2）：姓名 / 日期 / 页码。屏幕、打印与 PDF 共用同一份配置。 */
function MetaGroup() {
	const config = useSelector(function (s) { return s.config; });
	const dispatch = useDispatch();
	function field(key, value) {
		dispatch(setField({ key: key, value: value }));
	}
	return (
		<Group title="元信息">
			<div className="rp-field">
				<label htmlFor="metaName">姓名（可选）</label>
				<input
					id="metaName"
					className="rp-input"
					maxLength={12}
					placeholder="打印 / PDF 每页底部显示"
					value={config.Name}
					onChange={function (e) { field('Name', e.target.value); }}
				/>
			</div>
			<div className="rp-field rp-check">
				<input
					id="showMeta"
					type="checkbox"
					checked={config.ShowMeta}
					onChange={function (e) { field('ShowMeta', e.target.checked); }}
				/>
				<label htmlFor="showMeta">每页底部显示姓名 / 日期</label>
			</div>
			<div className="rp-field rp-check">
				<input
					id="showPageNo"
					type="checkbox"
					checked={config.ShowPageNo}
					onChange={function (e) { field('ShowPageNo', e.target.checked); }}
				/>
				<label htmlFor="showPageNo">显示页码（屏幕 / 打印 / PDF）</label>
			</div>
		</Group>
	);
}

/* 内容工具（T1.3）：示例库 / 导入导出 txt / 重复字统计。
   导入只做纯文本读取，导出用 Blob 下载；重复字由共享核心 ContentModel.hanStats 统计。 */
function ContentTools({ textareaRef }) {
	const dispatch = useDispatch();
	const config = useSelector(function (s) { return s.config; });
	const fileRef = useRef(null);
	const stats = Z.ContentModel.hanStats(config.Content);

	/* 在内容框光标处插入一个空格 = 一个空临格（有格无字） */
	function insertSpace() {
		var el = textareaRef && textareaRef.current;
		var text = config.Content;
		var start = el && el.selectionStart != null ? el.selectionStart : text.length;
		var end = el && el.selectionEnd != null ? el.selectionEnd : start;
		dispatch(setContent(text.slice(0, start) + ' ' + text.slice(end)));
		window.setTimeout(function () {
			var node = textareaRef && textareaRef.current;
			if (!node) return;
			node.focus();
			var pos = start + 1;
			if (node.setSelectionRange) node.setSelectionRange(pos, pos);
		}, 0);
	}

	function onFileChange(e) {
		var file = e.target.files && e.target.files[0];
		if (!file) return;
		var reader = new FileReader();
		reader.onload = function () {
			dispatch(setContent(String(reader.result || '')));
			e.target.value = ''; /* 允许再次选择同一文件 */
			dispatch(pushToast({ type: 'success', text: '已导入文本。' }));
		};
		reader.onerror = function () {
			dispatch(pushToast({ type: 'error', text: '导入失败：无法读取文件。' }));
		};
		reader.readAsText(file, 'utf-8');
	}

	function onExport() {
		var blob = new Blob([config.Content], { type: 'text/plain;charset=utf-8' });
		var url = URL.createObjectURL(blob);
		var a = document.createElement('a');
		a.href = url;
		a.download = (config.Title || '墨帖内容') + '.txt';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		dispatch(pushToast({ type: 'success', text: '已导出文本。' }));
	}

	return (
		<div className="rp-field">
			<label htmlFor="sampleSelect">示例库</label>
			<select
				id="sampleSelect"
				className="rp-input"
				value=""
				onChange={function (e) {
					var sample = SAMPLES.filter(function (s) { return s.name === e.target.value; })[0];
					if (sample) dispatch(setContent(sample.text));
				}}
			>
				<option value="">选择示例…</option>
				{SAMPLES.map(function (s) { return <option key={s.name} value={s.name}>{s.name}</option>; })}
			</select>
			<div className="rp-actions">
				<button type="button" className="rp-btn" onClick={insertSpace}>插入空格</button>
				<button type="button" className="rp-btn" onClick={function () { dispatch(setContent(SAMPLE_TEXT)); }}>示例</button>
				<button type="button" className="rp-btn" onClick={onExport}>导出 txt</button>
				<button type="button" className="rp-btn" onClick={function () { if (fileRef.current) fileRef.current.click(); }}>导入 txt</button>
				<button type="button" className="rp-btn" onClick={function () { dispatch(setContent('')); }}>清空</button>
			</div>
			<input
				ref={fileRef}
				type="file"
				accept=".txt,text/plain"
				style={{ display: 'none' }}
				onChange={onFileChange}
			/>
			<div className="rp-stats">
				{stats.length === 0
					? <span className="rp-stats-empty">无重复字</span>
					: stats.slice(0, 12).map(function (item) {
						return <span key={item.char} className="rp-stats-item">{item.char}×{item.count}</span>;
					})}
				{stats.length > 12 && <span className="rp-stats-item">…</span>}
			</div>
		</div>
	);
}

/* 设置导出 / 导入 / 预设（T1.4）。预设只承载偏好（不含 Content / Title），加载时保留当前内容与标题。 */
function SettingsGroup() {
	const dispatch = useDispatch();
	const config = useSelector(function (s) { return s.config; });
	const fileRef = useRef(null);
	const [presetName, setPresetName] = useState('');
	const [presets, setPresets] = useState(function () { return Z.Config.loadPresets(); });
	const [hint, setHint] = useState('');

	function presetSnapshot() {
		var data = {};
		Object.keys(ConfigSchema).forEach(function (k) {
			if (k === 'Content' || k === 'Title') return;
			data[k] = config[k];
		});
		return data;
	}

	function onExport() {
		var blob = new Blob([JSON.stringify(Z.Config.snapshot(), null, 2)], { type: 'application/json;charset=utf-8' });
		var url = URL.createObjectURL(blob);
		var a = document.createElement('a');
		a.href = url;
		a.download = '墨帖设置.json';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		dispatch(pushToast({ type: 'success', text: '已导出设置 JSON。' }));
	}

	function onImportFile(e) {
		var file = e.target.files && e.target.files[0];
		if (!file) return;
		var reader = new FileReader();
		reader.onload = function () {
			try {
				var data = JSON.parse(String(reader.result || '{}'));
				/* 未提供的字段（如只导出偏好）保留当前值，避免内容被重置 */
				dispatch(importConfig(Object.assign({ Content: config.Content, Title: config.Title }, data)));
				dispatch(pushToast({ type: 'success', text: '已导入设置。' }));
			} catch (err) {
				dispatch(pushToast({
					type: 'error',
					text: '导入失败：文件不是有效的 JSON。',
					action: { label: '重试', onClick: function () { if (fileRef.current) fileRef.current.click(); } }
				}));
			}
			e.target.value = '';
		};
		reader.readAsText(file, 'utf-8');
	}

	function onSavePreset() {
		var name = presetName.trim();
		if (!name) {
			setHint('请先输入预设名称。');
			return;
		}
		setPresets(Z.Config.savePreset(name, presetSnapshot()));
		setPresetName('');
		dispatch(pushToast({ type: 'success', text: '已保存预设「' + name + '」。' }));
	}

	function onLoadPreset(name) {
		var data = Z.Config.loadPresets()[name];
		if (!data) return;
		dispatch(importConfig(Object.assign({ Content: config.Content, Title: config.Title }, data)));
		dispatch(pushToast({ type: 'success', text: '已加载预设「' + name + '」。' }));
	}

	function onDeletePreset(name) {
		setPresets(Z.Config.deletePreset(name));
		dispatch(pushToast({ type: 'success', text: '已删除预设「' + name + '」。' }));
	}

	var names = Object.keys(presets);

	return (
		<Group title="设置">
			<div className="rp-field">
				<label>导出 / 导入</label>
				<div className="rp-actions">
					<button type="button" className="rp-btn" onClick={onExport}>导出 JSON</button>
					<button type="button" className="rp-btn" onClick={function () { if (fileRef.current) fileRef.current.click(); }}>导入 JSON</button>
				</div>
				<input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onImportFile} />
			</div>
			<div className="rp-field">
				<label htmlFor="presetName">保存为预设</label>
				<div className="rp-row">
					<input
						id="presetName"
						className="rp-input"
						value={presetName}
						placeholder="如：硬笔 / 软笔"
						onChange={function (e) { setPresetName(e.target.value); }}
					/>
					<button type="button" className="rp-btn" onClick={onSavePreset}>保存</button>
				</div>
				{names.length > 0 && (
					<ul className="rp-presets">
						{names.map(function (name) {
							return (
								<li key={name} className="rp-presets-item">
									<span className="rp-presets-name">{name}</span>
									<button type="button" className="rp-link" onClick={function () { onLoadPreset(name); }}>加载</button>
									<button type="button" className="rp-link" onClick={function () { onDeletePreset(name); }}>删除</button>
								</li>
							);
						})}
					</ul>
				)}
				{hint && <p className="rp-hint-note">{hint}</p>}
			</div>
		</Group>
	);
}

/* 输出：PDF / 打印。与顶栏共用 usePdfExport（配置从 Redux store 显式传入 Z.Pdf.export） */
function OutputActions() {
	const { busy, exportPdf } = usePdfExport();
	return (
		<div className="rp-actions">
			<button type="button" className="rp-btn rp-btn-primary" disabled={busy} onClick={exportPdf}>
				{busy ? '正在生成 PDF…' : '导出 PDF'}
			</button>
			<button type="button" className="rp-btn" onClick={function () { window.print(); }}>
				打印
			</button>
		</div>
	);
}

export function Panel() {
	const config = useSelector(function (s) { return s.config; });
	const dispatch = useDispatch();
	const schema = ConfigSchema;
	const [page, setPage] = useState('content');
	const contentRef = useRef(null);

	/* 每行格数上限 = 当前纸张 / 格子大小可容纳的列数（与 pageLayout 联约束一致，T0.5） */
	const colsMax = Math.max(1, Z.SheetLayout.compute({ cols: 0, content: '', config: config }).cols);
	const colsValue = Math.min(config.Cols, colsMax);
	/* 实际生效列数（Cols=0 自适应时取上限），供模板缩略图画足一行 */
	const activeCols = config.Cols === 0 ? colsMax : colsValue;

	/* 内容页统计：行数（ContentModel 段落）与页数（与预览 / PDF 同一份版式真源） */
	const contentStats = useMemo(function () {
		var blocks = Z.ContentModel.parse(config.Content).blocks;
		var rows = blocks.filter(function (b) { return b.type === 'row'; }).length;
		var layout = Z.SheetLayout.compute({
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
		return { rows: rows, pages: layout.pages.length };
	}, [config]);

	function field(key, value) {
		dispatch(setField({ key: key, value: value }));
	}

	var pageHead = {
		content: { title: '字帖内容', sub: '换行分段，空行分页；空格即空临格' },
		layout: {
			title: '版式',
			sub: '每行 ' + activeCols + ' 格 · ' + Math.round(config.Page.width) + ' × ' + Math.round(config.Page.height) + ' mm · ' + config.GridSize + 'px'
		},
		grid: { title: '字格', sub: ZG_TYPES.length + ' 种样式 · ' + ZG_COLORS.length + ' 种颜色' },
		text: { title: '文字', sub: '字体 · 颜色 · 辅助' },
		output: { title: '输出', sub: '打印 · 导出 · 预设' },
		about: { title: '关于', sub: '墨帖 v' + __ZITIE_VERSION__ }
	}[page];

	function railItem(item, isAbout) {
		return (
			<button
				type="button"
				key={item.key}
				data-page={item.key}
				className={'rp-rail-item' + (page === item.key ? ' is-current' : '')}
				aria-current={page === item.key ? 'page' : undefined}
				onClick={function () { setPage(item.key); }}
			>
				{ICONS[item.key]}
				<span className="rp-rail-name">{item.name}</span>
			</button>
		);
	}

	return (
		<div className="rp-shell no-print">
			<nav className="rp-rail" aria-label="功能分类">
				{RAIL_MAIN.map(function (item) { return railItem(item); })}
				<div className="rp-rail-spacer" />
				{railItem({ key: 'about', name: '关于' })}
			</nav>
			<aside className="rp-panel">
				<div className="rp-page-head">
					<h2>{pageHead.title}</h2>
					<p>{pageHead.sub}</p>
				</div>

				{page === 'content' && (
					<div className="rp-panel-page">
						<div className="rp-field">
							<label htmlFor="content">内容</label>
							<textarea
								id="content"
								className="rp-textarea"
								maxLength={schema.Content.max}
								ref={contentRef}
								value={config.Content}
								onChange={function (e) { dispatch(setContent(e.target.value)); }}
							/>
						</div>
						<ContentTools textareaRef={contentRef} />
						<div className="rp-field">
							<label htmlFor="title">标题（可选）</label>
							<input
								id="title"
								className="rp-input"
								maxLength={schema.Title.max}
								value={config.Title}
								placeholder="如：基本笔画练习"
								onChange={function (e) { field('Title', e.target.value); }}
							/>
						</div>
						<p className="rp-page-note">已输入 {contentStats.rows} 行 · 约 {contentStats.pages} 页</p>
					</div>
				)}

				{page === 'layout' && (
					<div className="rp-panel-page">
						<Group title="排版">
							<div className="rp-field">
								<div className="rp-field-head">
									<label>排版模板</label>
									<span className="rp-tpl-note">每行 {activeCols} 格</span>
								</div>
								<div className="rp-tpl">
									{TEMPLATES.map(function (t) {
										var cells = tplCells(t.key, Math.min(activeCols, TPL_MAX_CELLS), config.TraceCount);
										return (
											<button
												type="button"
												key={t.key}
												className={config.Template === t.key ? 'is-active' : ''}
												aria-pressed={config.Template === t.key}
												onClick={function () { field('Template', t.key); }}
											>
												<span className="mini-grid">{cells.map(function (c, i) { return <i key={i} className={c}></i>; })}</span>
												{t.name}
											</button>
										);
									})}
								</div>
							</div>
							<div className="rp-field">
								<label htmlFor="traceCount">描红范字数（一字三描红）</label>
								<SchemaRange schemaKey="TraceCount" aria-valuetext={config.TraceCount + ' 格'} display={String(config.TraceCount)} />
							</div>
							<div className="rp-field">
								<label htmlFor="cols">每行格数</label>
								<SchemaRange schemaKey="Cols" aria-valuetext={config.Cols === 0 ? '自适应' : colsValue + ' 列'} max={colsMax} display={config.Cols === 0 ? '自适应' : String(colsValue)} />
							</div>
							<div className="rp-field">
								<label htmlFor="rowGap">行距</label>
								<SchemaPercentRange schemaKey="RowGap" aria-valuetext={Math.round(config.RowGap * 100) + '%'} />
							</div>
							<div className="rp-field">
								<label htmlFor="cellGap">字距</label>
								<SchemaPercentRange schemaKey="CellGap" aria-valuetext={Math.round(config.CellGap * 100) + '%'} />
							</div>
						</Group>
						<PageGroup />
						<MetaGroup />
					</div>
				)}

				{page === 'grid' && (
					<div className="rp-panel-page">
						<Group title="字格">
							<div className="rp-field">
								<label>样式</label>
								<div className="rp-zg-styles">
									{ZG_TYPES.map(function (type) {
										var name = ZG_TYPE_NAMES[type] || type;
										/* 用当前字格颜色画缩略图，与预览 / PDF 同源（Z.buildZgSvg） */
										var icon = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(Z.buildZgSvg(type, config.ZgColor));
										return (
											<button
												type="button"
												key={type}
												title={name}
												aria-pressed={config.ZgType === type}
												className={'rp-zg-btn' + (config.ZgType === type ? ' is-active' : '')}
												onClick={function () { field('ZgType', type); }}
											>
												<span className="rp-zg-icon" style={{ backgroundImage: "url('" + icon + "')" }} />
												<span className="rp-zg-name">{name}</span>
											</button>
										);
									})}
								</div>
							</div>
							<div className="rp-field">
								<label>颜色</label>
								<div className="rp-swatches">
									{ZG_COLORS.map(function (key) {
										return (
											<button
												type="button"
												key={key}
												className={config.ZgColor === key ? 'is-active' : ''}
												style={{ background: (ZG_COLOR_VALUES[key] || {}).border }}
												onClick={function () { field('ZgColor', key); }}
											/>
										);
									})}
								</div>
							</div>
							<div className="rp-field">
								<label htmlFor="gridSize">格子大小</label>
								<SchemaRange schemaKey="GridSize" aria-valuetext={config.GridSize + ' 像素'} display={config.GridSize + 'px'} />
							</div>
						</Group>
					</div>
				)}

				{page === 'text' && (
					<div className="rp-panel-page">
						<Group title="文字">
							<div className="rp-field">
								<label>颜色</label>
								<div className="rp-swatches">
									{INK_COLOR_KEYS.map(function (key) {
										return (
											<button
												type="button"
												key={key}
												title={INK_NAMES[key] || key}
												className={config.InkColor === key ? 'is-active' : ''}
												style={{ background: INK_COLORS[key] }}
												onClick={function () { field('InkColor', key); }}
											/>
										);
									})}
								</div>
							</div>
							<div className="rp-field">
								<label htmlFor="inkAlpha">深浅</label>
								<SchemaPercentRange schemaKey="InkAlpha" aria-valuetext={Math.round(config.InkAlpha * 100) + '%'} />
							</div>
							<div className="rp-field rp-check">
								<input
									id="showPinyin"
									type="checkbox"
									checked={config.ShowPinyin}
									onChange={function (e) { field('ShowPinyin', e.target.checked); }}
								/>
								<label htmlFor="showPinyin">显示拼音</label>
							</div>
							<div className="rp-field rp-check">
								<input
									id="strokeAnim"
									type="checkbox"
									checked={config.StrokeAnim}
									onChange={function (e) { field('StrokeAnim', e.target.checked); }}
								/>
								<label htmlFor="strokeAnim">笔顺动画（点击字格）</label>
							</div>
						</Group>
						<FontManager />
					</div>
				)}

				{page === 'output' && (
					<div className="rp-panel-page">
						<Group title="输出">
							<OutputActions />
						</Group>
						<SettingsGroup />
					</div>
				)}

				{page === 'about' && (
					<div className="rp-panel-page">
						<p className="rp-about-text">墨帖是一套纯前端字帖工具：内容、版式、字格与字体均在本地处理，可导出 PDF 或直接打印。</p>
						<p className="rp-version">墨帖 v{__ZITIE_VERSION__}</p>
					</div>
				)}
			</aside>
		</div>
	);
}
