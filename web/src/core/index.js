/**
 * 标准版核心（纯逻辑 ESM）统一出口。
 * 组件与 hooks 一律通过本模块显式 import，不再依赖全局命名空间。
 */
export {
	STORAGE_KEY, PRESETS_KEY, FONTS_KEY,
	ConfigSchema, DEFAULTS, TEMPLATES, TEMPLATE_KEYS,
	SAMPLE_TEXT, SAMPLES, INK_COLORS, INK_COLOR_KEYS, INK_RGB,
	ZG_TYPES, ZG_COLORS, ZG_LINE_MODES, ZG_LINE_MODE_NAMES, ZG_COLOR_VALUES,
	VERTICAL_ALIGNS, FONT_FORMATS,
	MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH,
	MIN_GRID_SIZE, MAX_GRID_SIZE, MIN_GRID_RATIO, MAX_GRID_RATIO,
	MIN_TRACE_MODEL, MAX_TRACE_MODEL, MIN_TRACE_TRACE, MAX_TRACE_TRACE,
	MIN_TRACE_DECAY, MAX_TRACE_DECAY, MIN_ZG_LINE_SCALE, MAX_ZG_LINE_SCALE,
	MIN_TRACE_COUNT, MAX_TRACE_COUNT, MIN_COLS, MAX_COLS, MIN_GAP, MAX_GAP,
	MIN_INK_ALPHA, MAX_INK_ALPHA, MIN_CHAR_OFFSET, MAX_CHAR_OFFSET,
	normalize, normalizeInt, normalizeFloat, normalizeSize, normalizeField,
	sanitizeFontURL, guessFontFormat, normalizeFontSource,
	loadConfig, saveConfig, snapshotConfig, loadPresets, savePreset, deletePreset, renamePreset
} from './config.js';

export { ContentModel, Layout } from './content.js';
export { buildZgSvg, getZgBackground } from './zg-bg.js';
export { SheetLayout } from './sheet-layout.js';
export { FontStore } from './font-store.js';
export { Font } from './font.js';
export {
	CDN_URLS as ASSET_CDN_URLS,
	setResourceMode, loadHanziWriter, resetHanziWriter,
	loadPinyinLib, renderStatus as renderAssetStatus, applyAssets, describeAssets
} from './assets.js';
export { loadPinyin, resetPinyin, getPinyin, isPinyinReady } from './pinyin.js';
export { Stroke } from './stroke.js';
export { initPdf, exportPdf } from './pdf.js';
