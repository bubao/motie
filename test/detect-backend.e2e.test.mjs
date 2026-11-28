/**
 * 探测闭环端到端（U6）：真起 HTTP 服务托管构建产物 + headless Chrome，
 * 断言「可达内核 → 不显示本地模式徽标」「内核不可达 → 显示徽标」。
 * 运行：node test/detect-backend.e2e.test.mjs（需在 npm run build 之后）。
 * Chrome 不存在时跳过并明确说明（不伪装通过）。
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

var ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
var DIST = path.join(ROOT, 'dist');
var HTML = path.join(DIST, 'index.html');
var failures = [];
var warnings = [];

function check(name, cond, detail) {
	if (cond) console.log('  ok  ' + name);
	else {
		failures.push(name + (detail ? '：' + detail : ''));
		console.log('  FAIL ' + name + (detail ? '：' + detail : ''));
	}
}

/** 静态托管 dist；backend=true 时提供 /api/config 冒充 Go 内核（契约字段 app= motie） */
function serve(backend, cb) {
	var html = fs.readFileSync(HTML);
	var server = http.createServer(function (req, res) {
		if (backend && req.url.split('?')[0] === '/api/config') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ app: 'motie', version: 'e2e', port: server.address().port }));
			return;
		}
		if (req.url.split('?')[0] === '/' || req.url.split('?')[0] === '/index.html') {
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(html);
			return;
		}
		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end('{"error":"not found"}');
	});
	server.listen(0, '127.0.0.1', function () { cb(server); });
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
			'--user-data-dir=/tmp/zitie-detect-e2e-' + process.pid,
			'--virtual-time-budget=9000', '--dump-dom',
			'http://127.0.0.1:' + port + '/index.html?nodetect=1'
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

if (!fs.existsSync(HTML)) {
	console.error('缺少 dist/index.html：请先 npm run build');
	process.exit(1);
}

var chromeFound = [
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Chromium.app/Contents/MacOS/Chromium',
	'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
].some(function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });

if (!chromeFound) {
	warnings.push('未找到 Chrome / Chromium / Edge，跳过探测闭环冒烟');
	console.log('  skip 探测闭环（未找到浏览器）');
} else {
	/* 场景 A：origin 即内核（http 服务提供 /api/config）→ 不应出现「本地模式」 */
	await new Promise(function (resolve) {
		serve(true, function (server) {
			Promise.resolve(dump(server.address().port)).then(function (out) {
				server.close(function () {
					/* 注意：单文件产物内联了全部 JS，源码字面量 'rp-backend-chip' 必然出现；
					 * 必须匹配渲染后的 DOM 属性 class="..." 才能证明节点真实存在 */
					check('内核可达：产物渲染', out.indexOf('class="rp-panel') !== -1 || out.indexOf('class="rp-field') !== -1);
					check('内核可达：顶栏无「本地模式」徽标', out.indexOf('class="rp-backend-chip"') === -1,
						'dump-dom 仍含本地模式徽标节点');
					resolve();
				});
			});
		});
	});

	/* 场景 B：同源无 /api/config → 回落本地模式 → 必须出现「本地模式」 */
	await new Promise(function (resolve) {
		serve(false, function (server) {
			Promise.resolve(dump(server.address().port)).then(function (out) {
				server.close(function () {
					check('内核不可达：顶栏显示「本地模式」徽标', out.indexOf('class="rp-backend-chip"') !== -1,
						'dump-dom 未含本地模式徽标节点（本地模式标注缺失）');
					resolve();
				});
			});
		});
	});
}

console.log('');
warnings.forEach(function (w) { console.log('  warn ' + w); });
if (failures.length) {
	console.error('探测闭环冒烟失败 ' + failures.length + ' 项');
	process.exit(1);
}
console.log('探测闭环冒烟通过（Chrome ' + (chromeFound ? '已执行' : '跳过') + '）');
