/**
 * 共享核心的 ESM 入口（供 React 完整版 import）。
 *
 * 共享核心仍是「IIFE 挂 window.Zitie」的普通脚本（保证 index.html 普通 <script>
 * 与 lite 的 esbuild 打包在 file:// 下可用）；本文件以副作用 import 依次加载，
 * 再把公开 API 命名导出，供 web/（Vite + React）使用。
 *
 * 加载顺序即依赖顺序：config → content → zg-bg → sheet-layout → font → font-store。
 */
import './config.js';
import './content.js';
import './zg-bg.js';
import './sheet-layout.js';
import './font.js';
import './font-store.js';

var Z = window.Zitie;

export default Z;
export var Zitie = Z;

/* 配置 */
export var Config = Z.Config;
export var ConfigSchema = Z.ConfigSchema;
export var DEFAULTS = Z.DEFAULTS;
export var TEMPLATES = Z.TEMPLATES;
export var TEMPLATE_KEYS = Z.TEMPLATE_KEYS;
export var SAMPLE_TEXT = Z.SAMPLE_TEXT;
export var SAMPLES = Z.SAMPLES;
export var INK_COLORS = Z.INK_COLORS;
export var INK_COLOR_KEYS = Z.INK_COLOR_KEYS;
export var INK_RGB = Z.INK_RGB;
export var ZG_TYPES = Z.ZG_TYPES;
export var ZG_COLORS = Z.ZG_COLORS;
export var ZG_COLOR_VALUES = Z.ZG_COLOR_VALUES;

/* 归一化 */
export var normalize = Z.normalize;
export var normalizeInt = Z.normalizeInt;
export var normalizeFloat = Z.normalizeFloat;
export var normalizeSize = Z.normalizeSize;
export var normalizeField = Z.normalizeField;

/* 内容模型与版式 */
export var ContentModel = Z.ContentModel;
export var Layout = Z.Layout;
export var SheetLayout = Z.SheetLayout;

/* 字格背景 */
export var buildZgSvg = Z.buildZgSvg;
export var getZgBackground = Z.getZgBackground;

/* 自定义字体 */
export var Font = Z.Font;

/* 本地字体仓库（IndexedDB 二进制 + localStorage 元数据） */
export var FontStore = Z.FontStore;
