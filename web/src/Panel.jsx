import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { applyFields, importConfig, pushToast, redoContent, setContent, setField, switchMode as switchModeAction, undoContent } from './store.js';
import { FontManager } from './FontManager.jsx';
import { SchemaRange, SchemaPercentRange } from './controls.jsx';
import {
	ConfigSchema,
	ContentModel,
	Layout,
	buildZgSvg,
	INK_COLORS,
	INK_COLOR_KEYS,
	TRACE_COLOR_KEYS,
	TRACE_COLOR_NAMES,
	SAMPLE_TEXT,
	SAMPLES,
	TEMPLATES,
	ZG_COLOR_VALUES,
	ZG_COLORS,
	ZG_TYPES,
	ZG_LINE_MODES,
	ZG_LINE_MODE_NAMES,
	ZG_DASH_STYLES,
	ZG_DASH_STYLE_NAMES,
	ZG_LINE_CAPS,
	ZG_LINE_CAP_NAMES,
	ZG_TYPE_HINTS,
	ZG_SCHEMES,
	sanitizeHexColor,
	resolveZgOptions,
	DEFAULTS,
	VERTICAL_ALIGNS,
	FONT_WEIGHTS,
	FONT_WEIGHT_NAMES,
	MODES,
	MODE_NAMES,
	MODE_ZG,
	CONTENT_FORMS,
	STROKE_LIBRARY,
	STROKE_NAMES,
	strokePath,
	PRESET_KEYS,
	CONTROL_PATTERNS,
	CONTROL_PATHS,
	loadPresets,
	savePreset,
	deletePreset,
	renamePreset,
	snapshotConfig,
	renderAssetStatus
} from './core/index.js';
import { useSheetLayout } from './hooks/useSheetLayout.js';
import { sharedClient, isDesktopEnv } from './ipc/client.ts';

/* 文件名清洗：与 Go pdf.SafeFilename 同口径（/ \ : * ? " < > | → _），避免被当成路径分隔 */
var sanitizeFileName = function (name) {
	return String(name || '').replace(/[\/\\:*?"<>|]+/g, '_').trim() || '未命名';
};

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

const ZG_TYPE_NAMES = { '1': '田字格', '2': '米字格', '3': '米字回字', '4': '回字格', '5': '拼音格', '6': '方格', '7': '数字格', '8': '井字格', '9': '英文四线格', '10': '田字格+拼音条' };
const ZG_COLOR_NAMES = { '1': '绿色', '2': '灰色', '3': '红色', '4': '蓝色' };
/* 各字帖类型的内容页说明 / 输入占位符（随 tab 切换） */
const MODE_HINTS = {
	hanzi: '换行分段，空行分页；空格即空临格',
	number: '输入 0-9；换行分段，空行分页',
	pinyin: '支持带调字母 ā á ǎ à；空格分词',
	english: '按词折行，空格分词，词不拆断',
	stroke: '输入笔画名称（如「横竖撇捺」），或点下方笔画库插入',
	control: '设定练习行数生成图案；0 = 按内容行数（留空为满页）'
};
const MODE_PLACEHOLDERS = {
	hanzi: '输入汉字，换行分段，空行分页；空格即空临格',
	number: '输入数字（0-9），换行分段，空行分页',
	pinyin: '输入拼音，可含声调（ā á ǎ à）；空格分词',
	english: '输入英文，按词折行，空格分词',
	stroke: '输入笔画名称，如：横竖撇捺点提折钩（空格即空临格）'
};
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

/* 字格颜色行：预设色板（套用整体配色）+ 原生取色器（单独自定义）。
 * fieldKey = ZgLineColor / ZgBorderColor；colorKey 取预设色对的 line / border。 */
function ZgColorField({ label, fieldKey, colorKey, hint }) {
	const config = useSelector(function (s) { return s.config; });
	const dispatch = useDispatch();
	const current = sanitizeHexColor(config[fieldKey]) || '';
	const fallbackHex = (ZG_COLOR_VALUES[config.ZgColor] || {})[colorKey] || '#000000';
	function set(key, value) {
		dispatch(setField({ key: key, value: value }));
	}
	return (
		<div className="rp-field">
			<label>{label}颜色</label>
			<div className="rp-zg-colors">
				<div className="rp-swatches">
					{/* 未自定义时按当前整体配色高亮；自定义后以自定义值为准 */}
					{ZG_COLORS.map(function (key) {
						const hex = (ZG_COLOR_VALUES[key] || {})[colorKey] || '';
						const activeHex = current || fallbackHex;
						return (
							<button
								type="button"
								key={key}
								title={ZG_COLOR_NAMES[key] || key}
								aria-label={label + '预设色 ' + (ZG_COLOR_NAMES[key] || key)}
								aria-pressed={activeHex === hex}
								className={activeHex === hex ? 'is-active' : ''}
								style={{ background: hex }}
								onClick={function () { set('ZgColor', key); set(fieldKey, hex); }}
							/>
						);
					})}
				</div>
				<input
					type="color"
					className="rp-color-input"
					aria-label={label + '自定义颜色'}
					title="自定义颜色"
					value={current || fallbackHex}
					onChange={function (e) { set(fieldKey, e.target.value); }}
				/>
			</div>
			{hint ? <p className="rp-hint-note">{hint}</p> : null}
		</div>
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
		return ContentModel.charStats(config.Content, config.Mode);
	}, [config.Content, config.Mode]);

	/* 当前版式每页行数：用于「插入空白页」按版式生成一整页空临格（依赖收敛在 hook 内） */
	var layoutInfo = useSheetLayout(config);

	/* 在内容框光标处插入文本（默认一个空格 = 一个空临格），并把光标移到插入内容之后 */
	function insertAtCursor(text) {
		var el = textareaRef && textareaRef.current;
		var full = config.Content;
		var start = el && el.selectionStart != null ? el.selectionStart : full.length;
		var end = el && el.selectionEnd != null ? el.selectionEnd : start;
		dispatch(setContent(full.slice(0, start) + text + full.slice(end)));
		window.setTimeout(function () {
			var node = textareaRef && textareaRef.current;
			if (!node) return;
			node.focus();
			var pos = start + text.length;
			if (node.setSelectionRange) node.setSelectionRange(pos, pos);
		}, 0);
	}
	function insertSpace() { insertAtCursor(' '); }

	/* 快捷形态：一次套用一组字段（CONTENT_FORMS 的 apply；含 Mode 时内含类型快照迁移，单步撤销） */
	function applyForm(form) {
		var fields = Object.assign({}, form.apply || {});
		dispatch(applyFields({ fields: fields }));
		dispatch(pushToast({ type: 'success', text: '已套用「' + form.name + '」。' }));
	}

	/* 在内容框光标处插入一个空行（= 分页）：行首补单个换行，行中补两个换行 */
	function insertBlankLine() {
		var el = textareaRef && textareaRef.current;
		var text = config.Content;
		var start = el && el.selectionStart != null ? el.selectionStart : text.length;
		var end = el && el.selectionEnd != null ? el.selectionEnd : start;
		var atLineStart = start === 0 || text.charAt(start - 1) === '\n';
		var insert = atLineStart ? '\n' : '\n\n';
		dispatch(setContent(text.slice(0, start) + insert + text.slice(end)));
		window.setTimeout(function () {
			var node = textareaRef && textareaRef.current;
			if (!node) return;
			node.focus();
			var pos = start + insert.length;
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
			var text = String(reader.result || '');
			dispatch(setContent(text));
			e.target.value = ''; /* 允许再次选择同一文件 */
			/* 桌面端：同步落盘到受控 workspace/，加入最近文件（失败不阻断导入） */
			if (isDesktopEnv()) {
				var name = sanitizeFileName(file.name).replace(/\.(md|markdown)$/i, '.md');
				sharedClient().writeFile({ path: 'workspace/' + name.replace(/\.[^.]*$/, '') + (/\.md$/i.test(name) ? '.md' : '.txt'), content: text })
					.then(function () {
						dispatch(pushToast({ type: 'success', text: '已导入文本并加入最近文件。' }));
					})
					.catch(function () {
						dispatch(pushToast({ type: 'success', text: '已导入文本（未加入最近文件：文件名或类型不支持）。' }));
					});
				return;
			}
			dispatch(pushToast({ type: 'success', text: '已导入文本。' }));
		};
		reader.onerror = function () {
			dispatch(pushToast({ type: 'error', text: '导入失败：无法读取文件。' }));
		};
		reader.readAsText(file, 'utf-8');
	}

	function onExport() {
		var name = sanitizeFileName(config.Title || '墨帖内容');
		/* 桌面端：写受控 export/（Go 内核落盘），失败回退浏览器下载 */
		if (isDesktopEnv()) {
			sharedClient().writeFile({ path: 'export/' + name + '.txt', content: config.Content })
				.then(function () {
					dispatch(pushToast({ type: 'success', text: '已导出到「导出」目录：' + name + '.txt' }));
				})
				.catch(function () {
					downloadTxt(name);
					dispatch(pushToast({ type: 'success', text: '已导出文本（内核不可达，已下载到本地）。' }));
				});
			return;
		}
		downloadTxt(name);
		dispatch(pushToast({ type: 'success', text: '已导出文本。' }));
	}

	function downloadTxt(name) {
		var blob = new Blob([config.Content], { type: 'text/plain;charset=utf-8' });
		var url = URL.createObjectURL(blob);
		var a = document.createElement('a');
		a.href = url;
		a.download = name + '.txt';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	/* 清空：二次确认；确认后内容清空，可用 Ctrl/Cmd+Z 撤销 */
	function doClear() {
		dispatch(setContent(''));
		setConfirming(false);
		dispatch(pushToast({ type: 'success', text: '已清空，可按 Ctrl/Cmd+Z 撤销。' }));
	}

	/* 示例库按当前字帖类型过滤；快捷形态为全局形态表（含跨模式项，点击切换类型 + 版式） */
	var samples = SAMPLES.filter(function (s) { return s.mode === config.Mode; });
	var forms = CONTENT_FORMS;

	return (
		<>
			{/* 示例库高频，默认展开（P2-7），无需二次点击 */}
		{samples.length > 0 && (
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
								var sample = samples.filter(function (s) { return s.name === e.target.value; })[0];
								if (sample) dispatch(setContent(sample.text));
							}}
						>
							<option value="">选择示例…</option>
							{samples.map(function (s) { return <option key={s.name} value={s.name}>{s.name}</option>; })}
						</select>
					</div>
				</div>
			</details>
		)}
		{/* 快捷形态：内容形态预置（字段批量套用，见 CONTENT_FORMS） */}
		{forms.length > 0 && (
			<details className="rp-fold" open>
				<summary>快捷形态</summary>
				<div className="rp-fold-body">
					<div className="rp-field">
						<label>内容形态</label>
						<div className="rp-schemes">
							{forms.map(function (f) {
								var active = f.apply.Mode === config.Mode && (f.apply.Template || '') === (config.Template || '')
									&& (f.apply.Template !== 'repeat' || (f.apply.RepeatUnit || 'char') === config.RepeatUnit);
								return (
									<button
										type="button"
										key={f.key}
										className={'rp-scheme-btn' + (active ? ' is-active' : '')}
										aria-pressed={active}
										title={'套用：' + f.name}
										onClick={function () { applyForm(f); }}
									>
										{f.name}
									</button>
								);
							})}
						</div>
					</div>
				</div>
			</details>
		)}
		{/* 笔画模式：点击把笔画名插入内容光标处（名称均为可显示汉字） */}
		{config.Mode === 'stroke' && (
			<details className="rp-fold" open>
				<summary>笔画库</summary>
				<div className="rp-fold-body">
					<div className="rp-field">
						<label>点击插入笔画</label>
						<div className="rp-tpl">
							{STROKE_LIBRARY.map(function (s) {
								return (
									<button
										type="button"
										key={s.key}
										className="rp-pattern-btn has-name"
										aria-label={s.name}
										title={'插入笔画：' + s.name}
										onClick={function () { insertAtCursor(s.name); }}
									>
										<svg viewBox="0 0 80 80" className="rp-pattern-svg" aria-hidden="true">
											<path d={strokePath(s.key)} fill="currentColor" />
										</svg>
										<span className="rp-pattern-name">{s.name}</span>
									</button>
								);
							})}
						</div>
					</div>
				</div>
			</details>
		)}
			<details className="rp-fold">
				<summary>内容工具</summary>
				<div className="rp-fold-body">
					<div className="rp-field">
						<label>插入 / 导入导出</label>
						<div className="rp-actions">
							<button type="button" className="rp-btn" onClick={insertBlankLine} title="在光标处插入一个空行（分页）">插入空行</button>
							<button type="button" className="rp-btn" onClick={insertSpace} title="在光标处插入一个空临格（空列）">插入空格</button>
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
				<summary>{config.Mode === 'english' ? '字母统计' : config.Mode === 'stroke' ? '笔画统计' : '重复字统计'}{stats.length > 0 ? '（' + stats.length + '）' : ''}</summary>
				<div className="rp-fold-body">
					<div className="rp-stats">
						{stats.length === 0
							? <span className="rp-stats-empty">{config.Mode === 'english' ? '无重复字母' : config.Mode === 'stroke' ? '无重复笔画' : '无重复字'}</span>
							: stats.slice(0, 12).map(function (item) {
								/* 笔画模式的 char 是笔画 key，显示名称 */
								var label = STROKE_NAMES[item.char] || item.char;
								return <span key={item.char} className="rp-stats-item">{label}×{item.count}</span>;
							})}
						{stats.length > 12 && <span className="rp-stats-item">…</span>}
					</div>
				</div>
			</details>
		</>
	);
}

/* 预设（S1）：版式偏好快照，只承载版式偏好，加载时保留当前内容与标题。
 * 桌面端存 Go workspace 服务（应用数据目录）；浏览器保持 localStorage。 */
function PresetGroup() {
	const dispatch = useDispatch();
	const config = useSelector(function (s) { return s.config; });
	const desktop = isDesktopEnv();
	const [presetName, setPresetName] = useState('');
	const [presets, setPresets] = useState({});
	const [hint, setHint] = useState('');
	const [renamingName, setRenamingName] = useState(null);
	const [renameValue, setRenameValue] = useState('');

	/* 初始列表：桌面从内核拉取；浏览器读 localStorage（与旧行为一致） */
	useEffect(function () {
		if (desktop) {
			sharedClient().listPresets().then(setPresets).catch(function () { /* 内核不可达时保持空列表 */ });
			return undefined;
		}
		setPresets(loadPresets());
		return undefined;
	}, [desktop]);

	function refresh(list) {
		setPresets(Object.assign({}, list || {}));
	}

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
		var data = presetSnapshot();
		if (desktop) {
			sharedClient().savePreset(name, data)
				.then(function () {
					setPresetName('');
					dispatch(pushToast({ type: 'success', text: '已保存预设「' + name + '」。' }));
					return sharedClient().listPresets();
				})
				.then(refresh)
				.catch(function () { setHint('保存失败：内核不可达或名称不合法。'); });
			return;
		}
		setPresets(savePreset(name, data));
		setPresetName('');
		dispatch(pushToast({ type: 'success', text: '已保存预设「' + name + '」。' }));
	}

	function onLoadPreset(name) {
		var data = desktop ? presets[name] : loadPresets()[name];
		if (!data) return;
		dispatch(importConfig(Object.assign({ Content: config.Content, Title: config.Title }, data)));
		dispatch(pushToast({ type: 'success', text: '已加载预设「' + name + '」。' }));
	}

	function onDeletePreset(name) {
		if (desktop) {
			sharedClient().deletePreset(name)
				.then(function () {
					dispatch(pushToast({ type: 'success', text: '已删除预设「' + name + '」。' }));
					return sharedClient().listPresets();
				})
				.then(refresh)
				.catch(function () { setHint('删除失败：内核不可达。'); });
			return;
		}
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
		if (desktop ? presets[next] : loadPresets()[next]) {
			setHint('已存在同名预设「' + next + '」。');
			return;
		}
		if (desktop) {
			sharedClient().renamePreset(name, next)
				.then(function () {
					dispatch(pushToast({ type: 'success', text: '已重命名预设「' + name + '」→「' + next + '」。' }));
					return sharedClient().listPresets();
				})
				.then(refresh)
				.catch(function () { setHint('重命名失败：内核不可达或名称不合法。'); });
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
				/* 旧版备份无 ModeStates：先清空本机类型记忆，避免切回旧类型时复活已丢弃的状态 */
				if (data.ModeStates == null) dispatch(setField({ key: 'ModeStates', value: {} }));
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

/* 检查更新（仅桌面端）：查 GitHub Releases latest，只提示 + 给下载地址，不自动安装。 */
function UpdateGroup() {
	const [busy, setBusy] = useState(false);
	const [info, setInfo] = useState(null);

	function onCheck() {
		setBusy(true);
		setInfo(null);
		sharedClient().checkUpdate()
			.then(function (data) { setInfo(data); })
			.catch(function () { setInfo({ error: true }); })
			.finally(function () { setBusy(false); });
	}

	if (!isDesktopEnv()) return null;

	return (
		<Group title="更新">
			<div className="rp-field">
				<label>版本</label>
				<div className="rp-actions">
					<button type="button" className="rp-btn" disabled={busy} onClick={onCheck}>
						{busy ? '正在检查…' : '检查更新'}
					</button>
				</div>
				{info && !info.error && (info.newer ? (
					<p className="rp-hint-note">
						发现新版本 v{info.latest}{info.published_at ? '（发布于 ' + info.published_at.slice(0, 10) + '）' : ''}，当前 v{info.current}。
						{info.url ? <a className="rp-hint-link" href={info.url}>前往下载</a> : null}
					</p>
				) : info.latest ? (
					<p className="rp-hint-note">已是最新版本（v{info.current}）。</p>
				) : (
					<p className="rp-hint-note">尚未发布正式版本（当前 v{info.current}）。</p>
				))}
				{info && info.error && <p className="rp-hint-note">无法获取更新信息，请稍后重试。</p>}
				<p className="rp-hint-note">仅提示新版本并给出下载地址，不会自动下载或安装。</p>
			</div>
		</Group>
	);
}

export function Panel({ pdfBusy, pdfProgress, onExportPdf, onPrint }) {
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
	/* 导出 Kindle 版（桌面端）进行中态，避免重复点击 */
	const [kindleBusy, setKindleBusy] = useState(false);

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
	/* 实际生效列数：单元重复（对齐 z2h 描红本）锁定为「描红数 + 1」，其余按 Cols / 自适应 */
	const isRepeat = config.Template === 'repeat';
	const activeCols = isRepeat ? config.RepeatCount + 1 : (config.Cols === 0 ? colsMax : colsValue);

	/* 内容页统计：行数（ContentModel 段落）与页数（与预览 / PDF 同一份版式真源） */
	const layoutForStats = useSheetLayout(config);
	const contentStats = useMemo(function () {
		var blocks = ContentModel.parse(config.Content, config.Mode).blocks;
		var rows = blocks.filter(function (b) { return b.type === 'row'; }).length;
		/* 控笔练习行数显式生效时，统计口径与版式真源一致 */
		if (config.Mode === 'control' && config.ControlRows > 0) rows = config.ControlRows;
		return { rows: rows, pages: layoutForStats.pages.length, gridMm: layoutForStats.gridMm };
	}, [config.Content, config.Mode, config.ControlRows, layoutForStats]);

	function field(key, value) {
		dispatch(setField({ key: key, value: value }));
	}

	/* tab 键盘导航（P2-6）：左右方向键循环、Home / End 跳转；roving tabindex + 切换后焦点跟随 */
	var tabRefs = useRef({});
	function onTabKeyDown(e) {
		var idx = MODES.indexOf(config.Mode);
		var next = -1;
		if (e.key === 'ArrowLeft') next = (idx - 1 + MODES.length) % MODES.length;
		else if (e.key === 'ArrowRight') next = (idx + 1) % MODES.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = MODES.length - 1;
		if (next < 0) return;
		e.preventDefault();
		var m = MODES[next];
		dispatch(switchModeAction(m));
		var el = tabRefs.current[m];
		if (el && el.focus) el.focus();
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

	/* 导出 Kindle 版（桌面端）：内核把内置 lite 单文件复制到 export/，返回绝对路径 */
	function onExportKindle() {
		if (kindleBusy) return;
		setKindleBusy(true);
		sharedClient().exportKindle()
			.then(function (path) {
				setKindleBusy(false);
				dispatch(pushToast({ type: 'success', text: path ? '已导出 Kindle 版：' + path : '已导出 Kindle 版。' }));
			})
			.catch(function (e) {
				setKindleBusy(false);
				dispatch(pushToast({ type: 'error', text: '导出 Kindle 版失败：' + ((e && e.message) || '内核不可达') }));
			});
	}

	var gridSizeLabel = contentStats.gridMm.toFixed(1) + ' mm';
	var rowGapMmLabel = layoutForStats.gapMm.toFixed(1) + ' mm';
	var ratioLabel = config.GridRatio > 0 ? '×' + (config.GridRatio / 100).toFixed(2) : '自动';
	var lineScaleLabel = '×' + (config.ZgLineScale / 100).toFixed(2);
	var borderScaleLabel = config.ZgBorderScale > 0 ? '×' + (config.ZgBorderScale / 100).toFixed(2) : '自动';
	var innerRatioLabel = config.ZgInnerRatio + '%';
	var engMidLabel = Math.round(config.ZgEngMid / 3) + '%';
	var pinyinTopLabel = config.ZgPinyinTop + '%';
	var baselineLabel = config.ZgBaselinePos + '%';
	/* 恢复字格外观：把 grid 组字段全部重置为默认（含颜色 / 格型 / 线条） */
	function resetGridAppearance() {
		Object.keys(ConfigSchema).forEach(function (k) {
			if (ConfigSchema[k].group === 'grid') field(k, DEFAULTS[k]);
		});
	}
	var rhythmCfg = { model: config.TraceModel, trace: config.TraceTrace, decay: config.TraceDecay };
	var pageHead = {
		content: { title: '字帖内容', sub: MODE_HINTS[config.Mode] },
		layout: {
			title: '版式',
			sub: '每行 ' + activeCols + ' 格 · ' + Math.round(config.Page.width) + ' × ' + Math.round(config.Page.height) + ' mm · 格 ' + gridSizeLabel
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
					<div className="rp-panel-page" role="tabpanel" id={'zitie-tabpanel-' + config.Mode} aria-labelledby={'zitie-tab-' + config.Mode}>
						<div className="rp-tabs" role="tablist" aria-label="字帖类型" onKeyDown={onTabKeyDown}>
							{MODES.map(function (m) {
								var selected = config.Mode === m;
								return (
									<button
										type="button"
										key={m}
										id={'zitie-tab-' + m}
										role="tab"
										aria-selected={selected}
										aria-controls={'zitie-tabpanel-' + m}
										tabIndex={selected ? 0 : -1}
										ref={function (el) { tabRefs.current[m] = el; }}
										className={'rp-tab' + (selected ? ' is-active' : '')}
										title={'切换到' + MODE_NAMES[m] + '（版式随之切换，各类型独立记忆）'}
										onClick={function () { dispatch(switchModeAction(m)); }}
									>
										{MODE_NAMES[m]}
									</button>
								);
							})}
						</div>
					{/* 按 tab（字帖类型）切换下方内容区 */}
					{config.Mode === 'control' ? (
						<>
						<div className="rp-field">
							<label>控笔图案（默认）</label>
							<div className="rp-tpl">
								{CONTROL_PATTERNS.map(function (p) {
									return (
										<button
											type="button"
											key={p.key}
											className={'rp-pattern-btn ' + (config.ControlPattern === p.key ? 'is-active' : '')}
											aria-pressed={config.ControlPattern === p.key}
										aria-label={p.name}
										title={'控笔图案：' + p.name + '（图形字符 ' + p.alias + '）'}
											onClick={function () { field('ControlPattern', p.key); }}
										>
										<svg viewBox="0 0 80 80" className="rp-pattern-svg" aria-hidden="true">
											<path d={CONTROL_PATHS[p.key]} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
										</svg>
										<span className="rp-pattern-alias" aria-hidden="true">{p.alias}</span>
									</button>
								);
							})}
							</div>
						</div>
						<div className="rp-field">
							<label htmlFor="controlSeq">图形序列（可选）</label>
							<textarea
								id="controlSeq"
								className="rp-textarea"
								maxLength={schema.Content.max}
								value={config.Content}
								placeholder="输入图形字符逐行编排，如 123 或 1A2B；留空＝整版用上方图案"
								onChange={function (e) { dispatch(setContent(e.target.value)); }}
							/>
							<p className="rp-page-note">可用字符：{CONTROL_PATTERNS.map(function (p) { return p.alias + '＝' + p.name; }).join('，')}（区分大小写）</p>
						</div>
						<div className="rp-field">
							<label htmlFor="controlRows">练习行数</label>
								<input
									id="controlRows"
									className="rp-input"
									type="number"
									min={0}
									max={200}
									step={1}
									value={config.ControlRows}
									onChange={function (e) { field('ControlRows', Number(e.target.value)); }}
								/>
								<p className="rp-page-note">总图案行数；0 = 按内容行数（留空为满页）；大于 0 时忽略图形序列</p>
							</div>
							<div className="rp-field">
								<label htmlFor="title">标题（可选）</label>
								<input
									id="title"
									className="rp-input"
									maxLength={schema.Title.max}
									value={config.Title}
									placeholder="如：基本笔画练习"
									onChange={function () { field('Title', e.target.value); }}
								/>
							</div>
							<p className="rp-page-note">已输入 {contentStats.rows} 行 · 约 {contentStats.pages} 页</p>
						</>
					) : (
						<>
							<div className="rp-field">
								<label htmlFor="content">内容</label>
								<textarea
									id="content"
									className="rp-textarea"
									maxLength={schema.Content.max}
									ref={contentRef}
									value={config.Content}
									placeholder={MODE_PLACEHOLDERS[config.Mode]}
									onChange={function (e) { dispatch(setContent(e.target.value)); }}
								/>
							</div>
							{config.Mode === 'english' && (
								<div className="rp-field rp-check">
									<input
										id="engPairCase"
										type="checkbox"
										checked={config.EngPairCase}
										onChange={function (e) { field('EngPairCase', e.target.checked); }}
									/>
									<label htmlFor="engPairCase">大小写成对（Aa Bb…），仅解析期展开，不改写内容</label>
								</div>
							)}
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
						</>
					)}
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
							<div className="rp-field rp-check">
								<input
									id="highlightFirst"
									type="checkbox"
									checked={config.HighlightFirst}
									onChange={function (e) { field('HighlightFirst', e.target.checked); }}
								/>
								<label htmlFor="highlightFirst">每行首字为范字（深色）</label>
							</div>
							<div className="rp-field">
								<label htmlFor="traceCount">描红范字数（一字三描红）</label>
								<SchemaRange schemaKey="TraceCount" aria-valuetext={config.TraceCount + ' 格'} display={String(config.TraceCount)} />
							</div>
							{config.Mode !== 'control' && (
								<div className="rp-field">
									<label htmlFor="traceRounds">描红数量（内容重复遍数）</label>
									<SchemaRange schemaKey="TraceRounds" aria-valuetext={config.TraceRounds + ' 遍'} display={config.TraceRounds <= 1 ? '不重复' : (config.TraceRounds + ' 遍')} />
									<p className="rp-hint-note">整段内容重复 N 遍：首遍按当前模板、其余为描红（对齐 z2h「描红数量」）；1 = 不重复。</p>
								</div>
							)}
						{config.Template === 'repeat' && (
							<React.Fragment>
								<div className="rp-field">
									<label htmlFor="repeatUnit">重复单元</label>
									<select
										id="repeatUnit"
										className="rp-input"
										value={config.RepeatUnit}
										onChange={function (e) { field('RepeatUnit', e.target.value); }}
									>
										<option value="char">单字（一字一行）</option>
										<option value="word">词组（一词一行，按空格分词）</option>
									</select>
								</div>
								<div className="rp-field">
									<label htmlFor="repeatCount">描红数量</label>
									<SchemaRange schemaKey="RepeatCount" aria-valuetext={config.RepeatCount + ' 格'} display={String(config.RepeatCount)} />
								</div>
								<p className="rp-hint-note">每个单元独占一行，行内重复该单元；每行格数 = 描红数量 + 1（列宽随之收缩）。</p>
							</React.Fragment>
						)}
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
								<p className="rp-page-note">≈ {rowGapMmLabel}（随格高缩放）</p>
							</div>
							<div className="rp-field">
								<label htmlFor="charGap">字间距（格宽的百分比）</label>
								<SchemaRange schemaKey="CharGap" aria-valuetext={config.CharGap + '%'} display={config.CharGap + '%'} />
								{isRepeat && <p className="rp-page-note">单元重复下列数已锁定，字间距由格宽收缩分摊。</p>}
							</div>
							<div className="rp-field">
								<label htmlFor="blankRowEvery">空行间隔</label>
								<input
									id="blankRowEvery"
									className="rp-input"
									type="number"
									min={schema.BlankRowEvery.min}
									max={schema.BlankRowEvery.max}
									step={1}
									value={config.BlankRowEvery}
									onChange={function (e) { field('BlankRowEvery', Number(e.target.value)); }}
								/>
								<p className="rp-page-note">每 N 行内容留 1 整行空临格；0 = 关闭（英文 / 控笔不适用）</p>
							</div>
							<div className="rp-field">
								<label htmlFor="blankColEvery">空列间隔</label>
								<input
									id="blankColEvery"
									className="rp-input"
									type="number"
									min={schema.BlankColEvery.min}
									max={schema.BlankColEvery.max}
									step={1}
									value={config.BlankColEvery}
									onChange={function (e) { field('BlankColEvery', Number(e.target.value)); }}
								/>
								<p className="rp-page-note">每 N 个字后留 1 个空临格；0 = 关闭（英文 / 控笔不适用）</p>
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
						<label>推荐搭配</label>
						<div className="rp-schemes">
							{ZG_SCHEMES.map(function (s) {
								return (
									<button
										type="button"
										key={s.key}
										className="rp-scheme-btn"
										title={'套用「' + s.name + '」的一组外观设置'}
										onClick={function () { Object.keys(s.apply).forEach(function (k) { field(k, s.apply[k]); }); }}
									>
										{s.name}
									</button>
								);
							})}
						</div>
					</div>
					<div className="rp-field">
						<label>样式</label>
						<div className="rp-zg-styles">
							{ZG_TYPES.map(function (type) {
								var name = ZG_TYPE_NAMES[type] || type;
								/* 用当前线条设置画缩略图，与预览 / PDF 同源（resolveZgOptions + buildZgSvg） */
								var icon = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
									buildZgSvg(resolveZgOptions(Object.assign({}, config, { ZgType: type })))
								);
								return (
									<button
										type="button"
										key={type}
										title={name}
										aria-pressed={config.ZgType === type}
										className={'rp-zg-btn' + (config.ZgType === type ? ' is-active' : '')}
										onClick={function () {
											/* 格上拼音条与格型双向联动：选 '10' 即开，离开 '10' 即关（单次快照，可撤销） */
											var fields = { ZgType: type };
											if (type === '10') fields.PinyinBar = true;
											else if (config.PinyinBar) fields.PinyinBar = false;
											dispatch(applyFields({ fields: fields }));
										}}
									>
										<span className="rp-zg-icon" style={{ backgroundImage: "url('" + icon + "')" }} />
										<span className="rp-zg-name">{name}</span>
									</button>
								);
							})}
						</div>
						<p className="rp-hint-note">{ZG_TYPE_HINTS[config.ZgType]}</p>
					</div>
					<div className="rp-field">
						<label htmlFor="gridSize">格子大小</label>
						<SchemaRange schemaKey="GridSize" disabled={isRepeat} aria-valuetext={gridSizeLabel} display={gridSizeLabel} />
						{isRepeat && <p className="rp-hint-note">单元重复下列数已锁定，格子大小由版式自动均分。</p>}
					</div>
					<div className="rp-field">
						<label htmlFor="gridRatio">宽高比</label>
						<SchemaRange schemaKey="GridRatio" aria-valuetext={ratioLabel} display={ratioLabel} />
					</div>
					{/* 格型内部参数：只对相关格型显示 */}
					{(config.ZgType === '3' || config.ZgType === '4') && (
						<div className="rp-field">
							<label htmlFor="zgInnerRatio">内框边距</label>
							<SchemaRange schemaKey="ZgInnerRatio" aria-valuetext={innerRatioLabel} display={innerRatioLabel} />
							<p className="rp-hint-note">回字内框的大小，数值越大框越小。</p>
						</div>
					)}
					{config.ZgType === '5' && (
						<div className="rp-field">
							<label htmlFor="zgPinyinTop">上区高度</label>
							<SchemaRange schemaKey="ZgPinyinTop" aria-valuetext={pinyinTopLabel} display={pinyinTopLabel} />
							<p className="rp-hint-note">拼音区（四线三格）占整格的高度。</p>
						</div>
					)}
					{config.ZgType === '7' && (
						<div className="rp-field">
							<label htmlFor="zgBaselinePos">基线位置</label>
							<SchemaRange schemaKey="ZgBaselinePos" aria-valuetext={baselineLabel} display={baselineLabel} />
							<p className="rp-hint-note">基线距格顶的距离，以上区域写字。</p>
						</div>
					)}
					{config.ZgType === '9' && (
						<div className="rp-field">
							<label htmlFor="zgEngMid">中间区高度</label>
							<SchemaRange schemaKey="ZgEngMid" aria-valuetext={engMidLabel} display={engMidLabel} />
							<p className="rp-hint-note">字母主体高度（x-height），上下两区对称。</p>
						</div>
					)}
					{(config.ZgType === '1' || config.ZgType === '2' || config.ZgType === '3' || config.ZgType === '4' || config.ZgType === '8') && (
						<div className="rp-field rp-check">
							<input
								id="zgStartDot"
								type="checkbox"
								checked={config.ZgStartDot}
								onChange={function (e) { field('ZgStartDot', e.target.checked); }}
							/>
							<label htmlFor="zgStartDot">起笔点标记</label>
						</div>
					)}
					<div className="rp-field">
						<button type="button" className="rp-reset-btn" onClick={resetGridAppearance}>恢复默认外观</button>
					</div>
				</Group>
					<Group title="颜色">
						<ZgColorField label="内部线" fieldKey="ZgLineColor" colorKey="line"
							hint="预设色板套用整体配色，取色器可单独自定义。" />
						<ZgColorField label="外框" fieldKey="ZgBorderColor" colorKey="border" />
						<div className="rp-field">
							<label htmlFor="zgOpacity">不透明度</label>
							<SchemaRange schemaKey="ZgOpacity" aria-valuetext={config.ZgOpacity + '%'} display={config.ZgOpacity + '%'} />
							<p className="rp-hint-note">调低可省墨，或让范字在格线上更突出。</p>
						</div>
					</Group>
					<Group title="格线">
						<div className="rp-field">
							<label>外框样式</label>
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
						<div className="rp-field">
							<label>内部线样式</label>
							<div className="rp-tpl">
								{ZG_LINE_MODES.map(function (m) {
									return (
										<button
											type="button"
											key={m}
											className={config.ZgInnerLineMode === m ? 'is-active' : ''}
											aria-pressed={config.ZgInnerLineMode === m}
											onClick={function () { field('ZgInnerLineMode', m); }}
										>
											{ZG_LINE_MODE_NAMES[m]}
										</button>
									);
								})}
							</div>
							<p className="rp-hint-note">米字 / 田字的辅助线；拼音格上区末线为骨架实线，不受影响。</p>
						</div>
						<div className="rp-field">
							<label htmlFor="zgLineScale">内部线粗细</label>
							<SchemaRange schemaKey="ZgLineScale" aria-valuetext={lineScaleLabel} display={lineScaleLabel} />
						</div>
						<div className="rp-field">
							<label htmlFor="zgBorderScale">外框粗细</label>
							<SchemaRange schemaKey="ZgBorderScale" aria-valuetext={borderScaleLabel} display={borderScaleLabel} />
							<p className="rp-hint-note">自动：拼音格与内部线同粗，其余为 2 倍。</p>
						</div>
						<div className="rp-field">
							<label>虚线样式</label>
							<div className="rp-tpl">
								{ZG_DASH_STYLES.map(function (s) {
									return (
										<button
											type="button"
											key={s}
											className={config.ZgDashStyle === s ? 'is-active' : ''}
											aria-pressed={config.ZgDashStyle === s}
											onClick={function () { field('ZgDashStyle', s); }}
										>
											{ZG_DASH_STYLE_NAMES[s]}
										</button>
									);
								})}
							</div>
						</div>
					<div className="rp-field">
						<label htmlFor="zgDashDensity">虚线密度</label>
						<SchemaRange schemaKey="ZgDashDensity" aria-valuetext={config.ZgDashDensity + '%'} display={config.ZgDashDensity + '%'} />
					</div>
					<div className="rp-field">
						<label>线端样式</label>
						<div className="rp-tpl">
							{ZG_LINE_CAPS.map(function (c) {
								return (
									<button
										type="button"
										key={c}
										className={config.ZgLineCap === c ? 'is-active' : ''}
										aria-pressed={config.ZgLineCap === c}
										onClick={function () { field('ZgLineCap', c); }}
									>
										{ZG_LINE_CAP_NAMES[c]}
									</button>
								);
							})}
						</div>
					</div>
					<div className="rp-field rp-check">
						<input
							id="zgCrisp"
							type="checkbox"
							checked={config.ZgCrisp}
							onChange={function (e) { field('ZgCrisp', e.target.checked); }}
						/>
						<label htmlFor="zgCrisp">细线锐利（不抗锯齿，斜线会有锯齿感）</label>
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
							<label>描红颜色</label>
							<div className="rp-swatches">
								{TRACE_COLOR_KEYS.map(function (key) {
									var isAuto = key === 'auto';
									/* auto = 跟随范字色并减半透明度：色块取当前 InkColor 并整体半透明 */
									var bg = isAuto ? (INK_COLORS[config.InkColor] || INK_COLORS.cinnabar) : INK_COLORS[key];
									return (
										<button
											type="button"
											key={key}
											title={TRACE_COLOR_NAMES[key]}
											aria-label={TRACE_COLOR_NAMES[key]}
											className={(config.TraceColor === key ? 'is-active ' : '') + (isAuto ? 'is-trace-auto' : '')}
											style={{ background: bg }}
											onClick={function () { field('TraceColor', key); }}
										/>
									);
								})}
							</div>
							<p className="rp-hint-note">自动：与范字同色并减半透明度。</p>
						</div>
						<div className="rp-field">
							<label htmlFor="inkAlpha">深浅</label>
							<SchemaPercentRange schemaKey="InkAlpha" aria-valuetext={Math.round(config.InkAlpha * 100) + '%'} />
							</div>
							<div className="rp-field">
								<label>字体粗细</label>
								<div className="rp-tpl">
									{FONT_WEIGHTS.map(function (w) {
										return (
											<button
												type="button"
												key={w}
												className={config.FontWeight === w ? 'is-active' : ''}
												aria-pressed={config.FontWeight === w}
												onClick={function () { field('FontWeight', w); }}
											>
												{FONT_WEIGHT_NAMES[w]}
											</button>
										);
									})}
								</div>
							</div>
							<div className="rp-field">
								<label htmlFor="charScale">字体大小</label>
								<SchemaPercentRange schemaKey="CharScale" aria-valuetext={Math.round(config.CharScale * 100) + '%'} />
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
								disabled={config.ZgType !== '5' && config.ZgType !== '10'}
								title={(config.ZgType !== '5' && config.ZgType !== '10') ? '拼音显示需「拼音格」或「格上拼音条」' : undefined}
								onChange={function (e) { field('ShowPinyin', e.target.checked); }}
							/>
							<label htmlFor="showPinyin">显示拼音{(config.ZgType !== '5' && config.ZgType !== '10') ? '（需拼音格 / 格上拼音条）' : ''}</label>
						</div>
						<div className="rp-field rp-check">
							<input
								id="pinyinBar"
								type="checkbox"
								checked={config.PinyinBar}
								title="田字格上方加一条窄拼音条（对齐 z2h「显示拼音」）"
								onChange={function (e) {
									/* 开关与格型双向联动：开则切到 '10'，关则从 '10' 退回田字格（单次快照，可撤销） */
									var on = e.target.checked;
									dispatch(applyFields({ fields: on
										? { PinyinBar: true, ZgType: '10' }
										: { PinyinBar: false, ZgType: config.ZgType === '10' ? '3' : config.ZgType } }));
								}}
							/>
							<label htmlFor="pinyinBar">格上拼音条（田字格上方窄条）</label>
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
						<div className="rp-field rp-check">
							<input
								id="strokeOrder"
								type="checkbox"
								checked={config.StrokeOrder}
								onChange={function (e) { field('StrokeOrder', e.target.checked); }}
							/>
							<label htmlFor="strokeOrder">静态笔顺（每格标 1..n 笔顺序号）</label>
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
									<button type="button" className="rp-btn" disabled={pdfBusy || !isDesktopEnv()} onClick={onExportPdf}
										title={isDesktopEnv() ? undefined : 'PDF 导出仅在桌面版可用（需连接桌面内核）'}>
										{pdfBusy
											? <><span className="rp-spinner" aria-hidden="true" />正在生成 PDF{pdfProgress && pdfProgress.total ? `… ${pdfProgress.done}/${pdfProgress.total}` : '…'}</>
											: '导出 PDF'}
									</button>
								{isDesktopEnv() && (
									<button type="button" className="rp-btn" disabled={kindleBusy} onClick={onExportKindle} title="复制内置单文件版到「导出」目录，Kindle 浏览器可直开">
										{kindleBusy ? <><span className="rp-spinner" aria-hidden="true" />正在导出…</> : '导出 Kindle 版'}
									</button>
								)}
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
						<UpdateGroup />
						<ResourceModeGroup />
					</div>
				)}
			</aside>
		</div>
	);
}
