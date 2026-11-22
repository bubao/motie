/**
 * ESM 入口验证（M1）：web/src/core/index.js 可被 esbuild 打包并无警告，命名导出可用。
 * 运行：node test/esm.test.js（由 npm test 串联）。
 */
'use strict';

var assert = require('assert');
var path = require('path');
var esbuild = require('esbuild');

var ROOT = path.resolve(__dirname, '..');

/* 核心为 ESM，依赖 window（localStorage / ZITIE_BOOT）；执行前预置最小全局。 */
global.window = global.window || {};
global.window.localStorage = global.window.localStorage || { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
global.window.ZITIE_BOOT = global.window.ZITIE_BOOT || {};

var probe = [
	"import { loadConfig, saveConfig, snapshotConfig, loadPresets, savePreset, deletePreset, renamePreset, buildZgSvg, ConfigSchema, SheetLayout, ContentModel, Layout, getZgBackground, normalizeField } from '../web/src/core/index.js';",
	"if (typeof loadConfig !== 'function' || typeof saveConfig !== 'function' || typeof snapshotConfig !== 'function') throw new Error('配置函数缺失');",
	"if (typeof loadPresets !== 'function' || typeof savePreset !== 'function' || typeof deletePreset !== 'function' || typeof renamePreset !== 'function') throw new Error('预设函数缺失');",
	"if (typeof buildZgSvg !== 'function') throw new Error('buildZgSvg 缺失');",
	"if (!ConfigSchema || !SheetLayout || !ContentModel || !Layout) throw new Error('缺少命名导出');",
	"if (typeof SheetLayout.compute !== 'function') throw new Error('SheetLayout.compute 缺失');",
	"if (typeof getZgBackground !== 'function') throw new Error('getZgBackground 缺失');",
	"var layout = SheetLayout.compute({ content: '永'.repeat(20), title: '练习', cols: 5 });",
	"if (!layout.pages.length || layout.pages[0].title !== '练习') throw new Error('compute 输出异常');",
	"if (ConfigSchema.Template.type !== 'enum') throw new Error('ConfigSchema 未导出');",
	"if (normalizeField('Cols', 999) !== 20) throw new Error('normalizeField 未导出');",
	"var cfg = loadConfig();",
	"if (cfg.Template !== 'normal' || typeof snapshotConfig(cfg).Template !== 'string') throw new Error('loadConfig / snapshotConfig 异常');",
	"saveConfig(cfg);",
	"console.log('  ok  ESM 入口 core/index.js 可打包且命名导出可用');"
].join('\n');

var result = esbuild.buildSync({
	stdin: { contents: probe, resolveDir: path.join(ROOT, 'test'), loader: 'js' },
	bundle: true,
	write: false,
	format: 'cjs',
	target: 'es2017',
	platform: 'browser',
	logLevel: 'warning'
});

var warnings = (result.warnings || []).map(function (w) { return w.text; });
assert.deepStrictEqual(warnings, [], 'esbuild 打包 core/index.js 产生警告：' + warnings.join('; '));

/* 执行打包产物（ESM 命名导出已在其中）。 */
eval(result.outputFiles[0].text);

console.log('ESM 入口验证通过（0 警告）');
