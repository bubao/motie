/**
 * 标准版核心（纯逻辑 ESM）统一出口。
 * 组件与 hooks 一律通过本模块显式 import，不再依赖全局命名空间。
 */
export {
	STORAGE_KEY, PRESETS_KEY, FONTS_KEY,
	ConfigSchema, DEFAULTS, TEMPLATES, TEMPLATE_KEYS,
	SAMPLE_TEXT, SAMPLES, INK_COLORS, INK_COLOR_KEYS, INK_RGB, TRACE_COLOR_KEYS, TRACE_COLOR_NAMES,
	ZG_TYPES, ZG_COLORS, ZG_LINE_MODES, ZG_LINE_MODE_NAMES, ZG_COLOR_VALUES,
	ZG_DASH_STYLES, ZG_DASH_STYLE_NAMES, ZG_LINE_CAPS, ZG_LINE_CAP_NAMES,
	ZG_TYPE_HINTS, ZG_SCHEMES,
	MIN_ZG_BORDER_SCALE, MAX_ZG_BORDER_SCALE, MIN_ZG_OPACITY, MAX_ZG_OPACITY,
	MIN_ZG_DASH_DENSITY, MAX_ZG_DASH_DENSITY,
	MIN_ZG_INNER_RATIO, MAX_ZG_INNER_RATIO, MIN_ZG_ENG_MID, MAX_ZG_ENG_MID,
	MIN_ZG_PINYIN_TOP, MAX_ZG_PINYIN_TOP, MIN_ZG_BASELINE_POS, MAX_ZG_BASELINE_POS,
	VERTICAL_ALIGNS, FONT_FORMATS, FONT_WEIGHTS, FONT_WEIGHT_NAMES, FONT_WEIGHT_NUM,
	MODES, MODE_NAMES, MODE_ZG, CONTENT_FORMS, PRESET_KEYS, MODE_SNAPSHOT_FIELDS,
	pickModeSnapshot, defaultModeState, PREFS_KEYS, pickPrefs,
	CONTROL_PATTERNS, CONTROL_PATTERN_KEYS, CONTROL_PATTERN_NAMES,
	CONTROL_PATTERN_ALIASES, CONTROL_ALIAS_TO_KEY,
	MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH,
	MIN_GRID_SIZE, MAX_GRID_SIZE, MIN_GRID_RATIO, MAX_GRID_RATIO,
	MIN_TRACE_MODEL, MAX_TRACE_MODEL, MIN_TRACE_TRACE, MAX_TRACE_TRACE,
	MIN_TRACE_ROUNDS, MAX_TRACE_ROUNDS,
	MIN_TRACE_DECAY, MAX_TRACE_DECAY, MIN_ZG_LINE_SCALE, MAX_ZG_LINE_SCALE,
	MIN_TRACE_COUNT, MAX_TRACE_COUNT, MIN_COLS, MAX_COLS, MIN_GAP, MAX_GAP,
	MIN_INK_ALPHA, MAX_INK_ALPHA, MIN_CHAR_OFFSET, MAX_CHAR_OFFSET,
	MIN_CHAR_SCALE, MAX_CHAR_SCALE,
	normalize, normalizeInt, normalizeFloat, normalizeSize, normalizeField,
	sanitizeFontURL, sanitizeHexColor, resolveZgOptions, guessFontFormat, normalizeFontSource,
	loadConfig, saveConfig, snapshotConfig, loadPresets, savePreset, deletePreset, renamePreset
} from './config.js';

export { ContentModel, Layout } from './content.js';
export { buildZgSvg, getZgBackground } from './zg-bg.js';
export { buildControlSvg, getControlBackground, CONTROL_PATHS } from './control.js';
export {
	STROKE_LIBRARY, STROKE_KEYS, STROKE_NAMES, strokePath,
	buildStrokeSvg, getStrokeBackground, strokeDataUri, strokeKeyFor, matchStrokeToken
} from './stroke-library.js';
export { SheetLayout } from './sheet-layout.js';
export { FontStore } from './font-store.js';
export { Font, setLocalResolver, loadLocalBuffer } from './font.js';
export {
	CDN_URLS as ASSET_CDN_URLS,
	setResourceMode, loadHanziWriter, resetHanziWriter,
	loadPinyinLib, renderStatus as renderAssetStatus, applyAssets, describeAssets
} from './assets.js';
export { loadPinyin, resetPinyin, getPinyin, isPinyinReady } from './pinyin.js';
export { Stroke, extractMedians, loadCharData, getStrokeMedians, resetStrokeData } from './stroke-order.js';
export { renderPages, pdfFilename } from './pdf.js';
