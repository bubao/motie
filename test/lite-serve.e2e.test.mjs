/**
 * lite 服务模式端到端：真起 HTTP 服务托管构建产物 dist/lite/index.html + headless Chrome，
 * 断言 Go server 托管 lite 时的字体面板行为——
 * - 有字体服务：拉取 /api/fonts 成功 → 渲染 .font-item 按钮（data-url 指向 /api/fonts/file/<id>）；
 * - 无服务（同源 404）：面板隐藏（display:none），不渲染按钮；
 * - 空清单（200 但 user 为空）：同样隐藏。
 * 运行：node test/lite-serve.e2e.test.mjs（需在 npm run build 之后）。
 * Chrome 不存在时跳过并明确说明（不伪装通过）。
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

var ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
var DIST_LITE = path.join(ROOT, 'dist', 'lite', 'index.html');
var failures = [];
var warnings = [];

function check(name, cond, detail) {
	if (cond) console.log('  ok  ' + name);
	else {
		failures.push(name + (detail ? '：' + detail : ''));
		console.log('  FAIL ' + name + (detail ? '：' + detail : ''));
	}
}

var FONT_LIST_HTML = '<div id="fontList" class="font-list" style="display:none"></div>';
var DEMO_FONTS = { user: [{ id: 'demo', name: '演示字体', size: 12345 }] };

/** 托管 lite 单文件；mode: fonts=提供字体列表 / notfound=/api/fonts 404 / empty=200 空清单 */
function serve(mode, cb) {
	var html = fs.readFileSync(DIST_LITE);
	var server = http.createServer(function (req, res) {
		var p = req.url.split('?')[0];
		if (p === '/api/fonts') {
			if (mode === 'notfound') {
				res.writeHead(404, { 'Content-Type': 'application/json' });
				res.end('{"error":"not found"}');
				return;
			}
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(mode === 'empty' ? { user: [] } : DEMO_FONTS));
			return;
		}
		if (p === '/api/fonts/file/demo') {
			/* 假字体二进制：列表渲染不请求，仅保证点击注入不会 404 */
			res.writeHead(200, { 'Content-Type': 'font/ttf' });
			res.end(Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00]));
			return;
		}
		if (p === '/' || p === '/lite/' || p === '/lite/index.html') {
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(html);
			return;
		}
		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end('{"error":"not found"}');
	});
	server.listen(0, '127.0.0.1', function () { cb(server); });
}

/** fontList 容器节点序列化（含其 style，用于判断是否隐藏） */
function fontListNode(dump) {
	var m = /<div id="fontList"[^>]*>/.exec(dump);
	return m ? m[0] : '';
}

function isHidden(node) {
	return node !== '' && /display\s*:\s*none/i.test(node);
}

/**
 * headless dump-dom。必须异步执行：同步 execFileSync 会阻塞 node 事件循环，
 * 静态服务无法响应页面请求，Chrome 会一直等到超时。
 */
function dump(port) {
	var chrome = [
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Chromium.app/Contents/MacOS/Chromium',
		'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
	].find(function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
	if (!chrome) return Promise.resolve(null);
	return new Promise(function (resolve) {
		execFile(chrome, [
			'--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
			'--user-data-dir=/tmp/zitie-lite-e2e-' + process.pid,
			'--virtual-time-budget=9000', '--dump-dom',
			'http://127.0.0.1:' + port + '/lite/index.html'
		], { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
		function (err, stdout) {
			if (err) {
				failures.push('Chrome dump-dom 失败：' + (err.message || err));
				resolve(null);
				return;
			}
			resolve(stdout || '');
		});
	});
}

if (!fs.existsSync(DIST_LITE)) {
	console.error('缺少 dist/lite/index.html：请先 npm run build');
	process.exit(1);
}
check('dist/lite/index.html 含字体列表面板锚点', fs.readFileSync(DIST_LITE, 'utf8').indexOf('id="fontList"') !== -1);

var chromeFound = [
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Chromium.app/Contents/MacOS/Chromium',
	'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
].some(function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });

if (!chromeFound) {
	warnings.push('未找到 Chrome / Chromium / Edge，跳过 lite 服务模式冒烟');
	console.log('  skip lite 服务模式（未找到浏览器）');
} else {
	/* 场景 A：有字体服务 → 渲染网络字体按钮（class 属性必须匹配渲染后 DOM，
	 * 单文件内联 JS 使 'font-item' 字面量恒存在） */
	await new Promise(function (resolve) {
		serve('fonts', function (server) {
			Promise.resolve(dump(server.address().port)).then(function (out) {
				server.close(function () {
					check('有字体服务：渲染出字体按钮', out.indexOf('class="font-item"') !== -1,
						'dump-dom 未含 font-item 节点');
					check('有字体服务：按钮 data-url 指向 /api/fonts/file/',
						out.indexOf('data-url="/api/fonts/file/demo"') !== -1, 'dump-dom 未含预期 data-url');
					check('有字体服务：显示字体名称', out.indexOf('演示字体') !== -1);
					check('有字体服务：面板不再隐藏', !isHidden(fontListNode(out)));
					resolve();
				});
			});
		});
	});

	/* 场景 B：/api/fonts 404（无桌面内核）→ 面板保持 display:none */
	await new Promise(function (resolve) {
		serve('notfound', function (server) {
			Promise.resolve(dump(server.address().port)).then(function (out) {
				server.close(function () {
					check('无字体服务：面板隐藏', isHidden(fontListNode(out)), 'fontList 仍可见');
					check('无字体服务：不渲染字体按钮', out.indexOf('class="font-item"') === -1);
					resolve();
				});
			});
		});
	});

	/* 场景 C：200 但清单为空 → 同样隐藏（empty 分支） */
	await new Promise(function (resolve) {
		serve('empty', function (server) {
			Promise.resolve(dump(server.address().port)).then(function (out) {
				server.close(function () {
					check('空字体清单：面板隐藏', isHidden(fontListNode(out)), 'fontList 仍可见');
					check('空字体清单：不渲染字体按钮', out.indexOf('class="font-item"') === -1);
					resolve();
				});
			});
		});
	});
}

console.log('');
warnings.forEach(function (w) { console.log('  warn ' + w); });
if (failures.length) {
	console.error('lite 服务模式冒烟失败 ' + failures.length + ' 项');
	process.exit(1);
}
console.log('lite 服务模式冒烟通过（Chrome ' + (chromeFound ? '已执行' : '跳过') + '）');
