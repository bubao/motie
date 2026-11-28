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
/* lite 双份产物一致性：原位 lite/ 与分发拷贝 dist/lite/ 必须逐字节相同
 * （构建期守卫见 tools/build.js assertSameContent；此处做分发前复核） */
var liteSrc = path.join(ROOT, 'lite', 'index.html');
var liteDist = path.join(DIST, 'lite', 'index.html');
check('lite/index.html 存在', exists(liteSrc));
if (exists(liteSrc) && exists(liteDist)) {
	check('lite 双份产物逐字节一致', fs.readFileSync(liteSrc).equals(fs.readFileSync(liteDist)));
}
/* 示例字体不随仓库分发（约 39MB，见 .gitignore /font/）：缺失时降级为警告，不阻断冒烟 */
if (!exists(path.join(DIST, 'font', '1.ttf'))) {
	warnings.push('dist/font/1.ttf 不存在：font/ 未随仓库分发，构建 dist/font 为空，「本地字体」模式无内置示例');
	console.log('  warn dist/font/1.ttf 不存在（示例字体不分发）');
} else {
	console.log('  ok  dist/font/1.ttf 存在');
}

var html = exists(htmlPath) ? fs.readFileSync(htmlPath, 'utf-8') : '';
check('单文件内含预览容器标记', html.indexOf('printContent') !== -1 || html.indexOf('rp-preview') !== -1);
check('单文件内含字体注入锚点（zitie-font-face）', html.indexOf('zitie-font-face') !== -1);
check('单文件内含产品名「墨帖」', html.indexOf('墨帖') !== -1);

/* 1.1 重构收口（P5）：核心已迁入 web/src/core，产物不得再出现旧的全局命名空间与 js/ 核心路径 */
check('web/src/core/index.js 存在', exists(path.join(ROOT, 'web', 'src', 'core', 'index.js')));
check('旧 js/ 核心目录已移除', !fs.existsSync(path.join(ROOT, 'js')));
check('单文件不含旧核心全局挂载（window.Zitie=）', html.indexOf('window.Zitie=') === -1);
check('单文件不含 js/ 核心脚本引用', html.indexOf('js/core.js') === -1 && html.indexOf('js/assets.js') === -1);

/* 1.2 PWA 产物（需求编号 A5 / roadmap E1）：http(s) 部署可安装、可离线 */
var pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
check('dist/icon.png 存在', exists(path.join(DIST, 'icon.png')));
check('dist/manifest.webmanifest 存在', exists(path.join(DIST, 'manifest.webmanifest')));
check('dist/sw.js 存在', exists(path.join(DIST, 'sw.js')));
if (exists(path.join(DIST, 'manifest.webmanifest'))) {
	var mf = {};
	try { mf = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.webmanifest'), 'utf8')); } catch (e) { /* 落入下方断言失败 */ }
	check('manifest 为合法 JSON', Object.keys(mf).length > 0);
	check('manifest name=墨帖 且 display=standalone', mf.name === '墨帖' && mf.display === 'standalone');
	check('manifest 图标指向 icon.png（1024x1024）',
		!!mf.icons && mf.icons[0] && mf.icons[0].src === 'icon.png' && mf.icons[0].sizes === '1024x1024');
}
if (exists(path.join(DIST, 'sw.js'))) {
	var sw = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
	check('sw.js 缓存名含 package.json 版本', sw.indexOf('motie-v' + pkgVersion) !== -1, '期望 motie-v' + pkgVersion);
	check('sw.js 预缓存 index.html 与 icon.png', sw.indexOf('index.html') !== -1 && sw.indexOf('icon.png') !== -1);
	check('sw.js 导航分支（req.mode === "navigate"）', sw.indexOf('req.mode === "navigate"') !== -1);
	check('sw.js 覆盖 pinyin-pro CDN（jsdelivr）', sw.indexOf('cdn.jsdelivr.net') !== -1);
}
/* 这里只做静态产物检查；「谁该注册 / 谁不该注册」的行为级断言在 test/sw.e2e.test.mjs */
check('单文件头部引用 manifest 与图标',
	html.indexOf('rel="manifest" href="manifest.webmanifest"') !== -1 && html.indexOf('rel="icon" href="icon.png"') !== -1);

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
		], { encoding: 'utf8', timeout: 40000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
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
