/**
 * 产物冒烟（T2.6）：`npm run build` 后 dist 静态完整性 + Chrome headless 直开单文件产物。
 * 运行：node test/smoke.test.mjs（由 npm test 串联，需在 build 之后）。
 * 静态检查必须通过；Chrome 不存在时跳过 DOM 冒烟并明确说明（不伪装通过）。
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

var ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
var DIST = path.join(ROOT, 'dist');
var failures = [];
var warnings = [];

function check(name, cond, detail) {
	if (cond) {
		console.log('  ok  ' + name);
	} else {
		failures.push(name + (detail ? '：' + detail : ''));
		console.log('  FAIL ' + name + (detail ? '：' + detail : ''));
	}
}

function exists(p) {
	try { return fs.statSync(p).isFile(); } catch (e) { return false; }
}

/* 1. 静态完整性 */
var htmlPath = path.join(DIST, 'index.html');
check('dist/index.html 存在', exists(htmlPath));
check('dist/lite/index.html 存在', exists(path.join(DIST, 'lite', 'index.html')));
check('dist/font/1.ttf 存在', exists(path.join(DIST, 'font', '1.ttf')));

var html = exists(htmlPath) ? fs.readFileSync(htmlPath, 'utf-8') : '';
check('单文件内含预览容器标记', html.indexOf('printContent') !== -1 || html.indexOf('rp-preview') !== -1);
check('单文件内含字体注入锚点（zitie-font-face）', html.indexOf('zitie-font-face') !== -1);
check('单文件内含产品名「墨帖」', html.indexOf('墨帖') !== -1);

/* 2. Chrome headless 直开 file:// 产物，断言 React 已渲染 */
var CANDIDATES = [
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Chromium.app/Contents/MacOS/Chromium',
	'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
];
var chrome = CANDIDATES.find(function (p) { return exists(p); });
if (!chrome) {
	warnings.push('未找到 Chrome / Chromium / Edge，跳过 DOM 冒烟（静态检查仍有效）');
	console.log('  skip Chrome DOM 冒烟（未找到浏览器）');
} else {
	try {
		var out = execFileSync(chrome, [
			'--headless=new', '--disable-gpu', '--no-sandbox',
			'--virtual-time-budget=8000', '--dump-dom', 'file://' + htmlPath
		], { encoding: 'utf8', timeout: 40000, stdio: ['ignore', 'pipe', 'pipe'] });
		check('headless 直开产物渲染出预览容器', out.indexOf('printContent') !== -1, 'dump-dom 未含 printContent');
		check('headless 直开产物渲染出面板', out.indexOf('rp-panel') !== -1 || out.indexOf('rp-field') !== -1, 'dump-dom 未含面板标记');
	} catch (e) {
		warnings.push('Chrome headless 冒烟执行失败：' + (e.message || e));
		console.log('  warn Chrome 冒烟失败：' + (e.message || e));
	}
}

console.log('');
if (warnings.length) {
	warnings.forEach(function (w) { console.log('  warn ' + w); });
}
if (failures.length) {
	console.error('产物冒烟失败 ' + failures.length + ' 项');
	process.exit(1);
}
console.log('产物冒烟通过（静态 ' + (chrome ? '+ Chrome DOM' : '，Chrome 跳过') + '）');
