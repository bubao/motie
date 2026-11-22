import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { importConfig, pushToast, redoContent, setContent, setField, undoContent } from './store.js';
import { FontManager } from './FontManager.jsx';
import { SchemaRange, SchemaPercentRange } from './controls.jsx';
import {
	ConfigSchema,
	ContentModel,
	Layout,
	buildZgSvg,
	INK_COLORS,
	INK_COLOR_KEYS,
	SAMPLE_TEXT,
	SAMPLES,
	TEMPLATES,
	ZG_COLOR_VALUES,
	ZG_COLORS,
	ZG_TYPES,
	ZG_LINE_MODES,
	ZG_LINE_MODE_NAMES,
	VERTICAL_ALIGNS,
	loadPresets,
	savePreset,
	deletePreset,
	renamePreset,
	snapshotConfig,
	renderAssetStatus
} from './core/index.js';
import { useSheetLayout } from './hooks/useSheetLayout.js';

/* 模板缩略图：按「当前生效列数 + traceCount」用与预览同一套 Z.Layout.cellRole 生成角色，
   保证缩略图与行内规律一致（T1.12）。列数过多时截断，避免缩略图过宽。 */
const TPL_MAX_CELLS = 8;

function tplCells(template, cols, traceCount, rhythm) {
	var out = [];
	for (var i = 0; i < cols; i++) {
		var role = Layout.cellRole(i, template, traceCount, 0, rhythm);
		out.push(role === 'model' ? 'on' : role === 'trace' ? 'soft' : 'empty');
	}
	return out;
}

const ZG_TYPE_NAMES = { '1': '田字格', '2': '米字格', '3': '米字回字', '4': '回字格', '5': '拼音格', '6': '作文格', '7': '数字格' };
const ZG_COLOR_NAMES = { '1': '绿色', '2': '灰色', '3': '红色' };
const INK_NAMES = { cinnabar: '朱砂', ink: '墨色', ochre: '赭石' };
/* 行区垂直对齐（行距不变，只改空白分布） */
const VERTICAL_ALIGN_NAMES = { center: '居中', top: '靠顶', bottom: '靠底' };

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
	/* 更多：横向三点的实心圆（RailIcon 默认描边，这里覆盖为填充） */
	more: <RailIcon d={<><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" /></>} />
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
									onChange={function (e) { setMargin({ [key]: num(e.target.value, config.Margin[key]) }); }}
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

/* 内容工具（C1–C4）：示例库与导入导出收进「内容工具」折叠区，「清空」需二次确认；
   重复字统计独立折叠。导入只做纯文本读取，导出用 Blob 下载。 */
function ContentTools({ textareaRef }) {
	const dispatch = useDispatch();
	const config = useSelector(function (s) { return s.config; });
	const fileRef = useRef(null);
	const [confirming, setConfirming] = useState(false);
	/* 重复字统计：仅内容变化时重算（P3-13） */
	const stats = useMemo(function () {
		return ContentModel.hanStats(config.Content);
	}, [config.Content]);

	/* 当前版式每页行数：用于「插入空白页」按版式生成一整页空临格（依赖收敛在 hook 内） */
	var layoutInfo = useSheetLayout(config);

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

	/* 在内容末尾追加一个独立的一整页空临格（行数 = 当前版式每页行数）。
	 * 空行 = 分页，保证与已有内容分成两页；每行一个空格即可，行尾由补满逻辑填满整行格数。 */
	function insertBlankPage() {
		var text = String(config.Content == null ? '' : config.Content);
		var rows = Math.max(1, layoutInfo.rows || 1);
		var lines = [];
		for (var i = 0; i < rows; i++) lines.push(' ');
		var next = text.trim() === ''
			? lines.join('\n')
			: text.replace(/\s+$/, '') + '\n\n' + lines.join('\n');
		dispatch(setContent(next));
		dispatch(pushToast({ type: 'success', text: '已新增一整页空临格。' }));
		/* 定位到新增页：通知预览滚动到末页（仅该主动操作触发） */
		window.dispatchEvent(new CustomEvent('zitie:goto-last-page'));
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

	/* 清空：二次确认；确认后内容清空，可用 Ctrl/Cmd+Z 撤销 */
	function doClear() {
		dispatch(setContent(''));
		setConfirming(false);
		dispatch(pushToast({ type: 'success', text: '已清空，可按 Ctrl/Cmd+Z 撤销。' }));
	}

	return (
		<>
			{/* 示例库高频，默认展开（P2-7），无需二次点击 */}
			<details className="rp-fold" open>
				<summary>示例库</summary>
				<div className="rp-fold-body">
					<div className="rp-field">
						<label htmlFor="sampleSelect">选择示例</label>
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
					</div>
				</div>
			</details>
			<details className="rp-fold">
				<summary>内容工具</summary>
				<div className="rp-fold-body">
					<div className="rp-field">
						<label>插入 / 导入导出</label>
						<div className="rp-actions">
							<button type="button" className="rp-btn" onClick={insertSpace}>插入空格</button>
							<button type="button" className="rp-btn" onClick={insertBlankPage} title={'按当前版式每页 ' + layoutInfo.rows + ' 行追加一整页空临格'}>插入空白页</button>
							<button type="button" className="rp-btn" onClick={function () { if (fileRef.current) fileRef.current.click(); }}>导入 txt</button>
							<button type="button" className="rp-btn" onClick={onExport}>导出 txt</button>
							{confirming ? (
								<>
									<button type="button" className="rp-btn rp-btn-primary" onClick={doClear}>确认清空</button>
									<button type="button" className="rp-btn" onClick={function () { setConfirming(false); }}>取消</button>
								</>
							) : (
								<button type="button" className="rp-btn" onClick={function () { setConfirming(true); }}>清空</button>
							)}
						</div>
						<input
							ref={fileRef}
							type="file"
							accept=".txt,text/plain"
							style={{ display: 'none' }}
							onChange={onFileChange}
						/>
					</div>
				</div>
			</details>

			<details className="rp-fold">
				<summary>重复字统计{stats.length > 0 ? '（' + stats.length + '）' : ''}</summary>
				<div className="rp-fold-body">
					<div className="rp-stats">
						{stats.length === 0
							? <span className="rp-stats-empty">无重复字</span>
							: stats.slice(0, 12).map(function (item) {
								return <span key={item.char} className="rp-stats-item">{item.char}×{item.count}</span>;
							})}
						{stats.length > 12 && <span className="rp-stats-item">…</span>}
					</div>
				</div>
			</details>
		</>
	);
}

/* 版式偏好白名单（P2-8）：预设只覆盖版式字段，不含字体 / 主题 / 资源 / 内容 */
const PRESET_KEYS = ['Template', 'TraceCount', 'Cols', 'RowGap', 'VerticalAlign', 'Page', 'Margin', 'ZgType', 'ZgColor', 'GridSize', 'GridRatio', 'ShowPinyin'];

/* 预设（S1）：版式偏好快照，只承载版式偏好，加载时保留当前内容与标题。 */
function PresetGroup() {
	const dispatch = useDispatch();
	const config = useSelector(function (s) { return s.config; });
	const [presetName, setPresetName] = useState('');
	const [presets, setPresets] = useState(function () { return loadPresets(); });
	const [hint, setHint] = useState('');
	const [renamingName, setRenamingName] = useState(null);
	const [renameValue, setRenameValue] = useState('');

	function presetSnapshot() {
		var data = {};
		PRESET_KEYS.forEach(function (k) { data[k] = config[k]; });
		return data;
	}

	function onSavePreset() {
		var name = presetName.trim();
		if (!name) {
			setHint('请先输入预设名称。');
			return;
		}
		setPresets(savePreset(name, presetSnapshot()));
		setPresetName('');
		dispatch(pushToast({ type: 'success', text: '已保存预设「' + name + '」。' }));
	}

	function onLoadPreset(name) {
		var data = loadPresets()[name];
		if (!data) return;
		dispatch(importConfig(Object.assign({ Content: config.Content, Title: config.Title }, data)));
		dispatch(pushToast({ type: 'success', text: '已加载预设「' + name + '」。' }));
	}

	function onDeletePreset(name) {
		setPresets(deletePreset(name));
		dispatch(pushToast({ type: 'success', text: '已删除预设「' + name + '」。' }));
	}

	function startRename(name) {
		setRenamingName(name);
		setRenameValue(name);
	}

	function cancelRename() {
		setRenamingName(null);
		setRenameValue('');
	}

	function commitRename(name) {
		var next = renameValue.trim();
		cancelRename();
		if (!next || next === name) return;
		if (loadPresets()[next]) {
			setHint('已存在同名预设「' + next + '」。');
			return;
		}
		setPresets(renamePreset(name, next));
		dispatch(pushToast({ type: 'success', text: '已重命名预设「' + name + '」→「' + next + '」。' }));
	}

	var names = Object.keys(presets);

	return (
		<Group title="预设">
			<div className="rp-field">
				<label htmlFor="presetName">保存当前版式为预设</label>
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
								<li key={name} className={'rp-presets-item' + (renamingName === name ? ' is-renaming' : '')}>
									<span className="rp-presets-name">{name}</span>
									{renamingName === name ? (
										<span className="rp-presets-rename">
											<input
												id={'preset-rename-' + name}
												className="rp-input"
												maxLength={30}
												value={renameValue}
												onChange={function (e) { setRenameValue(e.target.value); }}
											/>
											<button type="button" className="rp-btn" onClick={function () { commitRename(name); }}>确定</button>
											<button type="button" className="rp-link" onClick={cancelRename}>取消</button>
										</span>
									) : (
										<span className="rp-presets-ops">
											<button type="button" className="rp-link" onClick={function () { onLoadPreset(name); }}>加载</button>
											<button type="button" className="rp-link" onClick={function () { startRename(name); }}>改名</button>
											<button type="button" className="rp-link" onClick={function () { onDeletePreset(name); }}>删除</button>
										</span>
									)}
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

/* 资源来源（P2-9）：CDN（file:// 直开）/ 本地 vendor（http 托管，需 npm run vendor）。 */
function ResourceModeGroup() {
	const dispatch = useDispatch();
	const config = useSelector(function (s) { return s.config; });

	/* 状态行按当前资源模式刷新（模式切换由 App 订阅统一处理） */
	useEffect(function () {
		renderAssetStatus();
	}, [config.ResourceMode]);

	function pick(value) {
		if (value === config.ResourceMode) return;
		/* 资源模式同步由 App 订阅 config.ResourceMode 统一处理（setResourceMode + applyAssets） */
		dispatch(setField({ key: 'ResourceMode', value: value }));
	}

	return (
		<Group title="资源来源">
			<div className="rp-field">
				<label id="resourceModeLabel">第三方资源来源</label>
				<div className="rp-seg" role="group" aria-labelledby="resourceModeLabel">
					<button type="button" className={config.ResourceMode === 'cdn' ? 'is-active' : ''} aria-pressed={config.ResourceMode === 'cdn'} onClick={function () { pick('cdn'); }}>CDN</button>
					<button type="button" className={config.ResourceMode === 'local' ? 'is-active' : ''} aria-pressed={config.ResourceMode === 'local'} onClick={function () { pick('local'); }}>本地 vendor</button>
				</div>
				<div id="assetStatus" className="field-hint" />
				<p className="rp-hint-note">CDN 走 jsDelivr，file:// 直开可用；本地 vendor 需先 npm run vendor 并由 http 托管，缺失时自动回退 CDN。</p>
			</div>
		</Group>
	);
}

/* 设置导入导出（S3）：白名单快照（含内容与标题），用于备份 / 换机。 */
function SettingsIO() {
	const dispatch = useDispatch();
	const config = useSelector(function (s) { return s.config; });
	const fileRef = useRef(null);

	function onExport() {
		var blob = new Blob([JSON.stringify(snapshotConfig(config), null, 2)], { type: 'application/json;charset=utf-8' });
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

	return (
		<Group title="设置">
			<div className="rp-field">
				<label>导出 / 导入</label>
				<div className="rp-actions">
					<button type="button" className="rp-btn" onClick={onExport}>导出 JSON</button>
					<button type="button" className="rp-btn" onClick={function () { if (fileRef.current) fileRef.current.click(); }}>导入 JSON</button>
				</div>
				<input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onImportFile} />
				<p className="rp-hint-note">导出包含内容与标题的全部设置；导入时未提供的字段保留当前值。</p>
			</div>
		</Group>
	);
}

export function Panel({ pdfBusy, onExportPdf, onPrint }) {
	const config = useSelector(function (s) { return s.config; });
	const dispatch = useDispatch();
	const schema = ConfigSchema;
	const [page, setPage] = useState('content');
	const contentRef = useRef(null);
	/* 窄屏抽屉（P1-4）：≤720px 时面板为覆盖式抽屉，rail 图标条常驻 */
	const [isNarrow, setIsNarrow] = useState(function () {
		return !!(window.matchMedia && window.matchMedia('(max-width: 720px)').matches);
	});
	const [drawerOpen, setDrawerOpen] = useState(false);
	const triggerRef = useRef(null);

	/* 空态引导：预览区「查看示例」→ 切到内容页并聚焦输入框 */
	useEffect(function () {
		function go() {
			setPage('content');
			setTimeout(function () {
				var ta = document.getElementById('content');
				if (ta) ta.focus();
			}, 0);
		}
		window.addEventListener('zitie:go-content', go);
		return function () { window.removeEventListener('zitie:go-content', go); };
	}, []);

	useEffect(function () {
		var mq = window.matchMedia ? window.matchMedia('(max-width: 720px)') : null;
		if (!mq) return undefined;
		var onChange = function (e) {
			setIsNarrow(e.matches);
			if (!e.matches) setDrawerOpen(false);
		};
		if (mq.addEventListener) mq.addEventListener('change', onChange);
		else if (mq.addListener) mq.addListener(onChange);
		return function () {
			if (mq.removeEventListener) mq.removeEventListener('change', onChange);
			else if (mq.removeListener) mq.removeListener(onChange);
		};
	}, []);

	/* Esc 关闭抽屉，焦点返还触发按钮（P1-4） */
	useEffect(function () {
		if (!drawerOpen || !isNarrow) return undefined;
		function onKey(e) {
			if (e.key !== 'Escape') return;
			closeDrawer();
		}
		document.addEventListener('keydown', onKey);
		return function () { document.removeEventListener('keydown', onKey); };
	}, [drawerOpen, isNarrow]);

	function closeDrawer() {
		setDrawerOpen(false);
		if (triggerRef.current) triggerRef.current.focus();
	}

	function pickPage(key, trigger) {
		triggerRef.current = trigger;
		setPage(key);
		if (isNarrow) setDrawerOpen(true);
	}

	/* 每行格数上限 = 当前纸张 / 格子大小可容纳的列数（与 pageLayout 联约束一致，T0.5）。
	 * 内容 / 模板不影响列数，仅纸张 / 边距 / 格子大小 / 宽高比相关（hook 内全量依赖 config）。 */
	const colsMax = Math.max(1, useSheetLayout(config, { content: '', cols: 0 }).cols);
	const colsValue = Math.min(config.Cols, colsMax);
	/* 实际生效列数（Cols=0 自适应时取上限），供模板缩略图画足一行 */
	const activeCols = config.Cols === 0 ? colsMax : colsValue;

	/* 内容页统计：行数（ContentModel 段落）与页数（与预览 / PDF 同一份版式真源） */
	const layoutForStats = useSheetLayout(config);
	const contentStats = useMemo(function () {
		var blocks = ContentModel.parse(config.Content).blocks;
		var rows = blocks.filter(function (b) { return b.type === 'row'; }).length;
		return { rows: rows, pages: layoutForStats.pages.length, gridMm: layoutForStats.gridMm };
	}, [config.Content, layoutForStats]);

	function field(key, value) {
		dispatch(setField({ key: key, value: value }));
	}

	/* 内容撤销 / 重做（M2）：Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 或 Ctrl+Y 重做。
	   其他输入框（标题 / 预设名 / 字体名等）不拦截，保留其原生撤销。 */
	useEffect(function () {
		function onKeyDown(e) {
			if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
			var key = String(e.key || '').toLowerCase();
			if (key !== 'z' && key !== 'y') return;
			var el = e.target;
			if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.id !== 'content') return;
			e.preventDefault();
			var redo = key === 'y' || (key === 'z' && e.shiftKey);
			var ok = redo ? redoContent() : undoContent();
			if (!ok) dispatch(pushToast({ type: 'info', text: redo ? '没有可重做的操作。' : '没有可撤销的操作。' }));
		}
		document.addEventListener('keydown', onKeyDown);
		return function () { document.removeEventListener('keydown', onKeyDown); };
	}, [dispatch]);

	var gridSizeLabel = contentStats.gridMm.toFixed(1) + ' mm';
	var ratioLabel = config.GridRatio > 0 ? '×' + (config.GridRatio / 100).toFixed(2) : '自动';
	var lineScaleLabel = '×' + (config.ZgLineScale / 100).toFixed(2);
	var rhythmCfg = { model: config.TraceModel, trace: config.TraceTrace, decay: config.TraceDecay };
	var pageHead = {
		content: { title: '字帖内容', sub: '换行分段，空行分页；空格即空临格' },
		layout: {
			title: '版式',
			sub: '每行 ' + activeCols + ' 格 · ' + Math.round(config.Page.width) + ' × ' + Math.round(config.Page.height) + ' mm · ' + config.GridSize + 'px'
		},
		grid: { title: '字格', sub: ZG_TYPES.length + ' 种样式 · ' + ZG_COLORS.length + ' 种颜色' },
		text: { title: '文字', sub: '字体 · 颜色 · 辅助' },
		output: { title: '输出', sub: '姓名 / 日期 / 页码 · 导出 / 打印' },
		more: { title: '更多', sub: '关于 · 设置导入导出' }
	}[page];

	function railItem(item) {
		return (
			<button
				type="button"
				key={item.key}
				data-page={item.key}
				title={item.name}
				className={'rp-rail-item' + (page === item.key ? ' is-current' : '')}
				aria-current={page === item.key ? 'page' : undefined}
				onClick={function (e) { pickPage(item.key, e.currentTarget); }}
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
				<button
					type="button"
					title="关于 · 设置导入导出"
					className={'rp-rail-item rp-rail-more' + (page === 'more' ? ' is-current' : '')}
					aria-current={page === 'more' ? 'page' : undefined}
					onClick={function (e) { pickPage('more', e.currentTarget); }}
				>
					{ICONS.more}
					<span className="rp-rail-name">更多</span>
				</button>
			</nav>
			<div className="rp-panel-scrim" onClick={closeDrawer} aria-hidden="true" />
			<aside className={'rp-panel' + (isNarrow && drawerOpen ? ' is-open' : '')} aria-hidden={isNarrow && !drawerOpen ? 'true' : undefined}>
				<div className="rp-page-head">
					<button type="button" className="rp-panel-close" aria-label="关闭面板" onClick={closeDrawer}>×</button>
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
							placeholder="输入汉字，换行分段，空行分页；空格即空临格"
							onChange={function (e) { dispatch(setContent(e.target.value)); }}
						/>
						</div>
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
						<ContentTools textareaRef={contentRef} />
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
										var cells = tplCells(t.key, Math.min(activeCols, TPL_MAX_CELLS), config.TraceCount, rhythmCfg);
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
							{config.Template === 'rhythm' && (
								<React.Fragment>
									<div className="rp-field">
										<label htmlFor="traceModel">每行范字（深色）</label>
										<SchemaRange schemaKey="TraceModel" aria-valuetext={config.TraceModel + ' 格'} display={String(config.TraceModel)} />
									</div>
									<div className="rp-field">
										<label htmlFor="traceTrace">每行描红（浅色）</label>
										<SchemaRange schemaKey="TraceTrace" aria-valuetext={config.TraceTrace + ' 格'} display={String(config.TraceTrace)} />
									</div>
									<div className="rp-field">
										<label htmlFor="traceDecay">逐行递减描红</label>
										<SchemaRange schemaKey="TraceDecay" aria-valuetext={config.TraceDecay === 0 ? '不递减' : ('每行减 ' + config.TraceDecay + ' 格')} display={config.TraceDecay === 0 ? '不递减' : ('-' + config.TraceDecay)} />
									</div>
								</React.Fragment>
							)}
							<div className="rp-field">
								<label htmlFor="cols">每行格数</label>
								<SchemaRange schemaKey="Cols" aria-valuetext={config.Cols === 0 ? '自适应' : colsValue + ' 列'} max={colsMax} display={config.Cols === 0 ? '自适应' : String(colsValue)} />
							</div>
							<div className="rp-field">
								<label htmlFor="rowGap">行距（相对格子高）</label>
								<SchemaPercentRange schemaKey="RowGap" aria-valuetext={Math.round(config.RowGap * 100) + '%'} />
							</div>
							<div className="rp-field">
								<label>垂直对齐</label>
								<div className="rp-tpl">
									{VERTICAL_ALIGNS.map(function (a) {
										return (
											<button
												type="button"
												key={a}
												className={config.VerticalAlign === a ? 'is-active' : ''}
												aria-pressed={config.VerticalAlign === a}
												onClick={function () { field('VerticalAlign', a); }}
											>
												{VERTICAL_ALIGN_NAMES[a]}
											</button>
										);
									})}
								</div>
							</div>
						</Group>
					<PageGroup />
					<PresetGroup />
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
										var icon = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildZgSvg(type, config.ZgColor, config.ZgLineScale, config.ZgLineMode));
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
												title={ZG_COLOR_NAMES[key] || key}
												aria-label={ZG_COLOR_NAMES[key] || key}
												aria-pressed={config.ZgColor === key}
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
							<SchemaRange schemaKey="GridSize" aria-valuetext={gridSizeLabel} display={gridSizeLabel} />
						</div>
						<div className="rp-field">
							<label htmlFor="gridRatio">宽高比</label>
							<SchemaRange schemaKey="GridRatio" aria-valuetext={ratioLabel} display={ratioLabel} />
						</div>
						<div className="rp-field">
							<label htmlFor="zgLineScale">格线粗细</label>
							<SchemaRange schemaKey="ZgLineScale" aria-valuetext={lineScaleLabel} display={lineScaleLabel} />
						</div>
						<div className="rp-field">
							<label>格线样式</label>
							<div className="rp-tpl">
								{ZG_LINE_MODES.map(function (m) {
									return (
										<button
											type="button"
											key={m}
											className={config.ZgLineMode === m ? 'is-active' : ''}
											aria-pressed={config.ZgLineMode === m}
											onClick={function () { field('ZgLineMode', m); }}
										>
											{ZG_LINE_MODE_NAMES[m]}
										</button>
									);
								})}
							</div>
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
							<div className="rp-field">
								<label htmlFor="charOffsetX">字体水平位置</label>
								<SchemaPercentRange schemaKey="CharOffsetX" aria-valuetext={Math.round(config.CharOffsetX * 100) + '%'} />
							</div>
							<div className="rp-field">
								<label htmlFor="charOffsetY">字体垂直位置</label>
								<SchemaPercentRange schemaKey="CharOffsetY" aria-valuetext={Math.round(config.CharOffsetY * 100) + '%'} />
							</div>
							<div className="rp-field rp-check">
								<input
									id="showPinyin"
									type="checkbox"
									checked={config.ShowPinyin}
									disabled={config.ZgType !== '5'}
									title={config.ZgType !== '5' ? '拼音显示仅「拼音格」支持' : undefined}
									onChange={function (e) { field('ShowPinyin', e.target.checked); }}
								/>
								<label htmlFor="showPinyin">显示拼音{config.ZgType !== '5' ? '（仅拼音格）' : ''}</label>
							</div>
							<div className="rp-field rp-check">
								<input
									id="strokeAnim"
									type="checkbox"
									checked={config.StrokeAnim}
									onChange={function (e) { field('StrokeAnim', e.target.checked); }}
								/>
								<label htmlFor="strokeAnim">笔顺动画（放大预览内点击「播放笔顺」）</label>
							</div>
						</Group>
						<FontManager />
					</div>
				)}

				{page === 'output' && (
					<div className="rp-panel-page">
						<MetaGroup />
						{/* 输出动作（P2-7）：导出 / 打印从顶栏移入「输出」页，名实相符 */}
						<Group title="输出动作">
							<div className="rp-actions">
								<button type="button" className="rp-btn" disabled={pdfBusy} onClick={onExportPdf}>
									{pdfBusy ? <><span className="rp-spinner" aria-hidden="true" />正在生成 PDF…</> : '导出 PDF'}
								</button>
								<button type="button" className="rp-btn rp-btn-primary" disabled={pdfBusy} onClick={onPrint || function () { window.print(); }}>打印</button>
							</div>
						</Group>
						</div>
				)}

				{page === 'more' && (
					<div className="rp-panel-page">
						{/* 设置导入导出提到「更多」首屏（P2-7） */}
						<SettingsIO />
						<p className="rp-about-text">墨帖是一套纯前端字帖工具：内容、版式、字格与字体均在本地处理，可导出 PDF 或直接打印。</p>
						<p className="rp-version">墨帖 v{__ZITIE_VERSION__}</p>
						<ResourceModeGroup />
					</div>
				)}
			</aside>
		</div>
	);
}
