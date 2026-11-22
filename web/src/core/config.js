/**
 * 常量与配置（localStorage 持久化）。
 * 标准版核心模块；lite 使用独立副本（lite-src/vendor/，逻辑同源、语法风格有意不同步）。
 * 各模块通过显式 import 复用，不再挂全局命名空间。
 *
 * 配置没有全局单例：调用方（Redux store / 测试）通过 loadConfig() 取一份
 * 全新配置对象，saveConfig(cfg) 落盘；预设读写为独立函数。
 */
export const STORAGE_KEY = 'zitie.config';
export const PRESETS_KEY = 'zitie.presets'; /* 具名预设（设置偏好，不含内容） */
export const FONTS_KEY = 'zitie.fonts';     /* 已导入本地字体的元数据（二进制在 IndexedDB） */
export const LEGACY_STORAGE_KEY = 'zitie-lite.config'; /* 精简版旧配置键，读取时迁移一次 */
/* 「示例」按钮填充的文本（完整版与练字版共用） */
export const SAMPLE_TEXT = '天地玄黄 宇宙洪荒 日月盈昃 辰宿列张 寒来暑往 秋收冬藏';
/* 示例库（Panel 下拉选择；标点按 T0.8 规则不占格） */
export const SAMPLES = [
	{ name: '千字文·节选', text: '天地玄黄 宇宙洪荒 日月盈昃 辰宿列张 寒来暑往 秋收冬藏' },
	{ name: '三字经·节选', text: '人之初，性本善。性相近，习相远。苟不教，性乃迁。教之道，贵以专。' },
	{ name: '静夜思', text: '床前明月光，疑是地上霜。举头望明月，低头思故乡。' },
	{ name: '登鹳雀楼', text: '白日依山尽，黄河入海流。欲穷千里目，更上一层楼。' },
	{ name: '春晓', text: '春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。' },
	{ name: '论语·学而', text: '学而时习之，不亦说乎？有朋自远方来，不亦乐乎？' }
];
export const MAX_CONTENT_LENGTH = 5000;
export const MAX_TITLE_LENGTH = 40;
export const MIN_GRID_SIZE = 40;
export const MAX_GRID_SIZE = 160;
export const MIN_GRID_RATIO = 60;   /* 宽高比下限（×0.60）；0 = 自动（随字格类型） */
export const MAX_GRID_RATIO = 160;  /* 宽高比上限（×1.60） */
export const MIN_TRACE_MODEL = 1;   /* 节奏描红：每行最少范字格 */
export const MAX_TRACE_MODEL = 10;
export const MIN_TRACE_TRACE = 0;   /* 每行描红格（其余为临写 blank） */
export const MAX_TRACE_TRACE = 10;
export const MIN_TRACE_DECAY = 0;   /* 每行递减描红格：0 = 不变 */
export const MAX_TRACE_DECAY = 5;
export const MIN_ZG_LINE_SCALE = 50;   /* 格线宽倍率 ×100：×0.50 */
export const MAX_ZG_LINE_SCALE = 200;  /* ×2.00 */
export const MIN_TRACE_COUNT = 1;
export const MAX_TRACE_COUNT = 6;
export const MIN_COLS = 1;
export const MAX_COLS = 20;
export const MIN_GAP = 0;
export const MAX_GAP = 1;
export const MIN_INK_ALPHA = 0.15;
export const MAX_INK_ALPHA = 1;
export const MIN_CHAR_OFFSET = -0.25; /* 字体在格内的水平 / 垂直偏移区间（格倍数） */
export const MAX_CHAR_OFFSET = 0.25;

/* 构建时可注入 window.ZITIE_BOOT.ResourceMode 指定默认资源来源（见 tools/build.js） */
const boot = (typeof window !== 'undefined' && window.ZITIE_BOOT) || {};

export const DEFAULTS = {
	Content: '永',
	Title: '',            /* 内容标题（可选，居中显示在字帖开头） */
	Template: 'normal',   /* 排版模板：normal / trace / trace3 / lead / rhythm / blank */
	TraceCount: 3,        /* 一字三描红：每行前 N 格为深色范字 */
	Cols: 0,              /* 每行格数：0 = 按纸张自适应 */
	RowGap: 0.12,         /* 行距（相对行盒高倍数：拼音格随 1.4×格等比放大） */
	VerticalAlign: 'center', /* 行区垂直对齐：center 居中 / top 靠顶 / bottom 靠底（行距不变） */
	InkColor: 'cinnabar', /* 文字颜色：cinnabar / ink / ochre */
	InkAlpha: 0.62,       /* 文字深浅 0.15–1 */
	CharOffsetX: 0,       /* 字体在格内的水平偏移（格倍数，-0.25–0.25） */
	CharOffsetY: 0,       /* 字体在格内的垂直偏移（格倍数） */
	ZgType: '3',     /* 字格样式：1 田 / 2 米 / 3 米回 / 4 回 / 5 拼音 / 6 作文 / 7 数字（5–7 仅完整版） */
	ZgColor: '1',    /* 字格颜色：1 绿 / 2 灰 / 3 红 */
	GridSize: 80,    /* 格子宽（px，理想值 → 决定列数，实际格宽均分铺满） */
	GridRatio: 0,    /* 格子宽高比 ×100：0 = 自动（拼音格 1.4，其余 1.0）；60–160 = 用户值 */
	TraceModel: 1,   /* 节奏描红：每行前 N 格范字（深） */
	TraceTrace: 3,   /* 节奏描红：每行接着 M 格描红（浅），其余临写（空临格） */
	TraceDecay: 0,   /* 节奏描红：每行递减的描红格数（逐行变少） */
	ZgLineScale: 100, /* 格线宽倍率 ×100（50–200，步进 25） */
	ZgLineMode: 'solid', /* 格外框样式：solid 实线 / dashed 虚线 / none 无框 */
	ShowPinyin: true,  /* 预览在拼音格内上区显示拼音（仅 ZgType=5；字帖不显示） */
	StrokeAnim: true,  /* 点击字格播放笔顺动画 */
	Page: { width: 210, height: 297 },                 /* 纸张尺寸（mm），与 sheet-layout 内置默认一致 */
	Margin: { top: 5, right: 16, bottom: 5, left: 16 }, /* 页边距（mm），与 @page / sheet-layout 一致 */
	Name: '',            /* 姓名（元信息，可打印 / 导出 PDF） */
	ShowMeta: false,     /* 每页底部显示「姓名 / 日期」 */
	ShowPageNo: true,    /* 屏幕 / 打印 / PDF 显示页码 */
	fontURL: '',
	FontSource: { type: 'default' },           /* 字体来源：default 系统默认 / url 网络地址 / local 本地字体（id） */
	PreviewText: '天地玄黄，宇宙洪荒',           /* 字体管理器的预览字样 */
	Theme: 'system',    /* 外观：light / dark / system（跟随系统） */
	ResourceMode: boot.ResourceMode === 'local' ? 'local' : 'cdn' /* 第三方资源来源：cdn（默认）/ local（本地 vendor，需 http 托管） */
};

/* 排版模板（顺序即界面顺序） */
export const TEMPLATES = [
	{ key: 'normal', name: '正常' },
	{ key: 'trace', name: '整页描红' },
	{ key: 'trace3', name: '一字三描红' },
	{ key: 'lead', name: '首字范字' },
	{ key: 'rhythm', name: '节奏描红' },
	{ key: 'blank', name: '空临格' }
];
export const TEMPLATE_KEYS = TEMPLATES.map((t) => t.key);

/* 格线（外框）样式：实线 / 虚线 / 无框 */
export const ZG_LINE_MODES = ['solid', 'dashed', 'none'];
export const ZG_LINE_MODE_NAMES = { solid: '实线', dashed: '虚线', none: '无框' };

/* 文字颜色 */
export const INK_COLORS = {
	cinnabar: '#B03A2C', /* 朱砂 */
	ink: '#23262B',      /* 墨色 */
	ochre: '#A9713A'     /* 赭石 */
};
export const INK_COLOR_KEYS = ['cinnabar', 'ink', 'ochre'];

/* 文字颜色对应的 RGB 分量（供 CSS rgba(var(--ink-rgb), var(--ink-alpha)) 使用） */
export const INK_RGB = {
	cinnabar: '176, 58, 44',
	ink: '35, 38, 43',
	ochre: '169, 113, 58'
};

export const ZG_TYPES = ['1', '2', '3', '4', '5', '6', '7'];
export const ZG_COLORS = ['1', '2', '3'];

/* 行区垂直对齐（行距不变，只改空白分布） */
export const VERTICAL_ALIGNS = ['center', 'top', 'bottom'];

/* 字格配色：虚线颜色 + 边框颜色 */
export const ZG_COLOR_VALUES = {
	'1': { line: '#70d39d', border: '#00b050' }, /* 绿色 */
	'2': { line: '#666666', border: '#111111' }, /* 灰色 */
	'3': { line: '#bb3442', border: '#980f29' }  /* 红色 */
};

export const FONT_FORMATS = {
	woff2: 'woff2',
	woff: 'woff',
	ttf: 'truetype',
	otf: 'opentype',
	eot: 'embedded-opentype'
};

export const normalize = (value, allowed, fallback) => {
	const v = String(value);
	return allowed.includes(v) ? v : fallback;
};

export const normalizeSize = (value, fallback) => {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, Math.round(n)));
};

/* 归一化整数区间 */
export const normalizeInt = (value, min, max, fallback) => {
	const n = parseInt(value, 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
};

/* 归一化小数区间 */
export const normalizeFloat = (value, min, max, fallback) => {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
};

/*
 * 配置字段 Schema：字段元数据的唯一真源。
 * type：text / enum / int / percent / bool；group 供设置面板分组渲染。
 * 新增字段只需在此登记，load/save 与设置层同步均按它派发。
 */
export const ConfigSchema = {
	Content:    { type: 'text', max: MAX_CONTENT_LENGTH, group: 'content' },
	Title:      { type: 'text', max: MAX_TITLE_LENGTH, group: 'content' },
	Template:   { type: 'enum', values: TEMPLATE_KEYS, group: 'layout' },
	TraceCount: { type: 'int', min: MIN_TRACE_COUNT, max: MAX_TRACE_COUNT, group: 'layout' },
	TraceModel: { type: 'int', min: MIN_TRACE_MODEL, max: MAX_TRACE_MODEL, group: 'layout' },
	TraceTrace: { type: 'int', min: MIN_TRACE_TRACE, max: MAX_TRACE_TRACE, group: 'layout' },
	TraceDecay: { type: 'int', min: MIN_TRACE_DECAY, max: MAX_TRACE_DECAY, group: 'layout' },
	Cols:       { type: 'int', min: 0, max: MAX_COLS, group: 'layout', zeroLabel: '自适应' },
	RowGap:     { type: 'percent', min: MIN_GAP, max: MAX_GAP, group: 'layout' },
	VerticalAlign: { type: 'enum', values: VERTICAL_ALIGNS, group: 'layout' },
	InkColor:   { type: 'enum', values: INK_COLOR_KEYS, group: 'text' },
	InkAlpha:   { type: 'percent', min: MIN_INK_ALPHA, max: MAX_INK_ALPHA, group: 'text' },
	CharOffsetX: { type: 'percent', min: MIN_CHAR_OFFSET, max: MAX_CHAR_OFFSET, group: 'text' },
	CharOffsetY: { type: 'percent', min: MIN_CHAR_OFFSET, max: MAX_CHAR_OFFSET, group: 'text' },
	ZgType:     { type: 'enum', values: ZG_TYPES, group: 'grid' },
	ZgColor:    { type: 'enum', values: ZG_COLORS, group: 'grid' },
	ZgLineScale: { type: 'int', min: MIN_ZG_LINE_SCALE, max: MAX_ZG_LINE_SCALE, step: 25, group: 'grid' },
	ZgLineMode: { type: 'enum', values: ZG_LINE_MODES, group: 'grid' },
	GridSize:   { type: 'int', min: MIN_GRID_SIZE, max: MAX_GRID_SIZE, step: 1, group: 'grid' },
	GridRatio:  { type: 'int', min: 0, max: MAX_GRID_RATIO, step: 5, group: 'grid', zeroLabel: '自动' },
	ShowPinyin: { type: 'bool', group: 'text' },
	StrokeAnim: { type: 'bool', group: 'layout' },
	Page:          { type: 'object', group: 'layout' },
	Margin:        { type: 'object', group: 'layout' },
	Name:          { type: 'text', max: 12, group: 'meta' },
	ShowMeta:      { type: 'bool', group: 'meta' },
	ShowPageNo:    { type: 'bool', group: 'meta' },
	fontURL:       { type: 'text', max: 2000, group: 'font', sanitize: 'fontURL' },
	FontSource:    { type: 'object', shape: 'fontSource', group: 'font' },
	PreviewText:   { type: 'text', max: 40, group: 'font' },
	Theme:         { type: 'enum', values: ['light', 'dark', 'system'], group: 'appearance' },
	ResourceMode:  { type: 'enum', values: ['cdn', 'local'], group: 'resource' }
};

/* 按 Schema 归一化单个字段（load / 设置层共用） */
export const normalizeField = (key, value) => {
	const spec = ConfigSchema[key];
	if (!spec) return value;
	const fallback = DEFAULTS[key];
	switch (spec.type) {
		case 'text': {
			if (typeof value !== 'string') return fallback;
			const text = value.slice(0, spec.max || undefined);
			return spec.sanitize === 'fontURL' ? sanitizeFontURL(text) : text;
		}
		case 'enum':
			return normalize(value, spec.values, fallback);
		case 'int':
			return normalizeInt(value, spec.min, spec.max, fallback);
		case 'percent':
			return normalizeFloat(value, spec.min, spec.max, fallback);
		case 'bool':
			return typeof value === 'boolean' ? value : fallback;
		case 'object': {
			/* 字体来源有专属结构（default / url / local），单独归一化 */
			if (spec.shape === 'fontSource') return normalizeFontSource(value, fallback);
			/* 结构对象（Page/Margin）：按 fallback 的键逐一校验数字，避免脏结构 */
			if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
			const out = {};
			Object.keys(fallback || {}).forEach((k) => {
				const n = Number(value[k]);
				out[k] = Number.isFinite(n) ? n : fallback[k];
			});
			return out;
		}
		default:
			return fallback;
	}
};

/* 字体格式识别（完整版与精简版共用） */
export const guessFontFormat = (url) => {
	const match = String(url || '').match(/\.(woff2?|ttf|otf|eot)(?:[?#]|$)/i);
	return match ? (FONT_FORMATS[match[1].toLowerCase()] || 'truetype') : 'truetype';
};

/* 字体来源归一化：default（系统默认）/ url（网络地址，消毒）/ local（本地字体 id） */
export const normalizeFontSource = (value, fallback) => {
	const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
	if (v.type === 'url') {
		const url = sanitizeFontURL(v.url);
		return url ? { type: 'url', url } : fallback;
	}
	if (v.type === 'local' && /^[A-Za-z0-9._-]{1,64}$/.test(String(v.id))) {
		return { type: 'local', id: String(v.id) };
	}
	return fallback;
};

/* 仅接受 http(s) 地址或相对路径（同源），避免 CSS 注入；base64 data URL 不支持 */
export const sanitizeFontURL = (url) => {
	const trimmed = String(url || '').trim();
	if (!trimmed) return '';
	if (/^https?:\/\/[^\s"'()]+$/i.test(trimmed)) return trimmed;
	if (/^[a-zA-Z0-9._~/-]+$/.test(trimmed)) return trimmed; /* 相对路径，如 font/5.woff */
	return '';
};

/*
 * 读取配置：每次返回全新对象（默认值 + 盘上快照，按 Schema 归一化）。
 * 旧键 zitie-lite.config 迁移到统一键后删除旧键；localStorage 不可用时静默用默认。
 */
export const loadConfig = () => {
	const cfg = {};
	Object.keys(ConfigSchema).forEach((key) => { cfg[key] = DEFAULTS[key]; });
	try {
		let raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw && LEGACY_STORAGE_KEY) {
			const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
			if (legacy) {
				raw = legacy;
				try { window.localStorage.setItem(STORAGE_KEY, legacy); } catch { /* 忽略 */ }
				try { window.localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* 忽略 */ }
			}
		}
		const saved = raw ? JSON.parse(raw) : {};
		/* 统一按 Schema 归一化（Content/Title 超长会被截断） */
		Object.keys(ConfigSchema).forEach((key) => {
			cfg[key] = normalizeField(key, saved[key]);
		});
		/* 旧版「描红模式」映射为模板（仅当未显式保存过模板时） */
		if (saved.Template == null && saved.TraceMode === true) cfg.Template = 'trace';
		/* 旧版 fontURL 字段迁移为 FontSource（仅当未显式保存过来源时） */
		if (saved.FontSource == null && cfg.fontURL) {
			cfg.FontSource = { type: 'url', url: cfg.fontURL };
		}
	} catch {
		/* localStorage 不可用（隐私模式等）时静默降级为默认配置 */
	}
	return cfg;
};

/* 落盘：只写 Schema 白名单字段（写入失败时忽略） */
export const saveConfig = (cfg) => {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshotConfig(cfg)));
	} catch {
		/* 写入失败（配额/禁用）时忽略 */
	}
};

/* 白名单快照（导出 JSON / 保存预设共用） */
export const snapshotConfig = (cfg) => {
	const data = {};
	Object.keys(ConfigSchema).forEach((key) => { data[key] = cfg[key]; });
	return data;
};

/* 具名预设：只读写字首选项，不参与配置持久化 */
export const loadPresets = () => {
	try { return JSON.parse(window.localStorage.getItem(PRESETS_KEY)) || {}; }
	catch { return {}; }
};
export const savePreset = (name, data) => {
	const all = loadPresets();
	all[name] = data;
	try { window.localStorage.setItem(PRESETS_KEY, JSON.stringify(all)); } catch { /* 忽略 */ }
	return all;
};
export const deletePreset = (name) => {
	const all = loadPresets();
	delete all[name];
	try { window.localStorage.setItem(PRESETS_KEY, JSON.stringify(all)); } catch { /* 忽略 */ }
	return all;
};
/* 重命名：保持原键顺序；新名为空 / 重名时原样返回（不覆盖） */
export const renamePreset = (oldName, newName) => {
	const all = loadPresets();
	const next = String(newName == null ? '' : newName).trim();
	if (!next || next === oldName || !all[oldName] || all[next]) return all;
	const out = {};
	Object.keys(all).forEach((k) => { out[k === oldName ? next : k] = all[k]; });
	try { window.localStorage.setItem(PRESETS_KEY, JSON.stringify(out)); } catch { /* 忽略 */ }
	return out;
};
