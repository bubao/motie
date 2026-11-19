/**
 * ESM 入口验证（M1）：js/core.js 可被 esbuild 打包并无警告，命名导出可用。
 * 运行：node test/esm.test.js（由 npm test 串联）。
 */
'use strict';

var assert = require('assert');
var path = require('path');
var esbuild = require('esbuild');

var ROOT = path.resolve(__dirname, '..');

/* 共享核心 IIFE 依赖 window；打包产物在 node 中执行前预置最小全局。 */
global.window = global.window || {};
global.window.ZITIE_BOOT = global.window.ZITIE_BOOT || {};

var probe = [
	"import Z, { Config, ConfigSchema, SheetLayout, ContentModel, Layout, getZgBackground, normalizeField } from '../js/core.js';",
	"if (!Z || !Config || !ConfigSchema || !SheetLayout || !ContentModel || !Layout) throw new Error('缺少命名导出');",
	"if (typeof SheetLayout.compute !== 'function') throw new Error('SheetLayout.compute 缺失');",
	"if (typeof getZgBackground !== 'function') throw new Error('getZgBackground 缺失');",
	"var layout = SheetLayout.compute({ content: '永'.repeat(20), title: '练习', cols: 5 });",
	"if (!layout.pages.length || layout.pages[0].title !== '练习') throw new Error('compute 输出异常');",
	"if (ConfigSchema.Template.type !== 'enum') throw new Error('ConfigSchema 未导出');",
	"if (normalizeField('Cols', 999) !== 20) throw new Error('normalizeField 未导出');",
	"console.log('  ok  ESM 入口 core.js 可打包且命名导出可用');"
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
assert.deepStrictEqual(warnings, [], 'esbuild 打包 core.js 产生警告：' + warnings.join('; '));

/* 执行打包产物（IIFE 已在其中挂好 window.Zitie）。 */
eval(result.outputFiles[0].text);

console.log('ESM 入口验证通过（0 警告）');
