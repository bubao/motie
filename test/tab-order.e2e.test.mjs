/**
 * Tab 键序端到端（axe / 单测之外的人工走查替代）：
 * 真托管 dist + headless Chrome（CDP）派发真实 Tab 键，逐次记录 document.activeElement，
 * 断言：
 *   1. 首个 Tab 落在跳转链接 .rp-skip-link（键盘用户第一站直达预览区）
 *   2. 整轮中没有任何隐藏元素（offsetParent=null 且非 fixed）获得焦点
 *   3. 关键锚点顺序符合阅读顺序：skip-link < rail「内容」< 「汉字」页签
 *      < 预览区字格 .hz-line < 缩放条 .rp-zoombar（画布先于浮动工具）
 *   4. 80 次 Tab 之内焦点循环回 skip-link（首尾闭合，不丢焦点）
 *
 * 背景见 doc/web-features.md §8：axe 与 vitest 均不覆盖真实 Tab 遍历，本测试补齐。
 * 运行：node test/tab-order.e2e.test.mjs（需在 npm run build 之后）。
 * Chrome / Chromium / Edge 均不存在时跳过并明确说明（不伪装通过）。
 */
'use strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

var ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
var DIST = path.join(ROOT, 'dist');
var failures = [];
var warnings = [];

function check(name, cond, detail) {
	if (cond) console.log('  ok  ' + name);
	else {
		failures.push(name + (detail ? '：' + detail : ''));
		console.log('  FAIL ' + name + (detail ? '：' + detail : ''));
	}
}

var CHROME_CANDIDATES = [
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Chromium.app/Contents/MacOS/Chromium',
	'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
];
function findChrome() {
	return CHROME_CANDIDATES.find(function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }) || null;
}

var MIME = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8', '.png': 'image/png',
	'.webmanifest': 'application/manifest+json', '.json': 'application/json', '.woff2': 'font/woff2'
};

function serveDist(cb) {
	var server = http.createServer(function (req, res) {
		var pathname;
		try { pathname = decodeURIComponent(req.url.split('?')[0]); } catch (e) { pathname = '/'; }
		if (pathname === '/') pathname = '/index.html';
		var file = path.join(DIST, pathname);
		if (file.indexOf(DIST + path.sep) !== 0 && file !== DIST) { res.writeHead(403); res.end('forbidden'); return; }
		try {
			var stat = fs.statSync(file);
			if (!stat.isFile()) throw new Error('not file');
			res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
			res.end(fs.readFileSync(file));
		} catch (e) {
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end('{"error":"not found"}');
		}
	});
	server.listen(0, '127.0.0.1', function () { cb(server); });
}

function getFreePort() {
	return new Promise(function (resolve, reject) {
		var probe = net.createServer();
		probe.listen(0, '127.0.0.1', function () { var p = probe.address().port; probe.close(function () { resolve(p); }); });
		probe.on('error', reject);
	});
}

function cdpFetch(url, options, timeoutMs) {
	var ctrl = new AbortController();
	var t = setTimeout(function () { ctrl.abort(); }, timeoutMs || 15000);
	return fetch(url, Object.assign({ signal: ctrl.signal }, options || {})).finally(function () { clearTimeout(t); });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function launchChrome(profileDir) {
	return new Promise(function (resolve, reject) {
		var chrome = findChrome();
		if (!chrome) { reject(new Error('no chrome')); return; }
		getFreePort().then(function (port) {
			var cp = spawn(chrome, [
				'--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
				'--remote-debugging-port=' + port,
				'--user-data-dir=' + profileDir,
				'about:blank'
			], { stdio: ['ignore', 'ignore', 'ignore'] });
			var done = false;
			var timer = setTimeout(function () { if (done) return; done = true; cp.kill('SIGKILL'); reject(new Error('DevTools 端口超时')); }, 20000);
			(function poll() {
				if (done) return;
				cdpFetch('http://127.0.0.1:' + port + '/json/version', {}, 3000).then(function (r) {
					if (!r.ok) throw new Error('bad status');
					if (done) return; done = true; clearTimeout(timer); resolve({ cp: cp, port: port });
				}).catch(function () { setTimeout(poll, 200); });
			})();
		}, reject);
	});
}

function openTarget(port, url) {
	var endpoint = 'http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(url);
	var attempt = function (n) {
		return cdpFetch(endpoint, { method: 'PUT' }, 15000).then(function (r) { return r.json(); }).catch(function (e) {
			if (n > 0) return sleep(300).then(function () { return attempt(n - 1); });
			throw e;
		});
	};
	return attempt(1).then(function (target) {
		return new Promise(function (resolve, reject) {
			var ws = new WebSocket(target.webSocketDebuggerUrl);
			var t = setTimeout(function () { reject(new Error('WebSocket 连接超时')); try { ws.close(); } catch (e) {} }, 10000);
			ws.onopen = function () { clearTimeout(t); resolve({ ws: ws, targetId: target.id }); };
			ws.onerror = function () { clearTimeout(t); reject(new Error('WebSocket 连接失败')); };
		});
	});
}

function makeSend(ws) {
	var nextId = 0;
	return function send(method, params, timeoutMs) {
		return new Promise(function (resolve, reject) {
			var id = ++nextId;
			var t = setTimeout(function () { reject(new Error('CDP ' + method + ' 超时')); }, timeoutMs || 30000);
			function onMessage(ev) {
				var msg = JSON.parse(ev.data);
				if (msg.id !== id) return;
				ws.removeEventListener('message', onMessage);
				clearTimeout(t);
				resolve(msg);
			}
			ws.addEventListener('message', onMessage);
			ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
		});
	};
}

function evaluate(send, expression) {
	return send('Runtime.evaluate', { expression: expression, awaitPromise: true, returnByValue: true }).then(function (msg) {
		var inner = msg.result && msg.result.result;
		if (!inner) return { error: 'no result' };
		if (inner.subtype === 'error' || msg.result.exceptionDetails) {
			return { error: (msg.result.exceptionDetails.exception && msg.result.exceptionDetails.exception.description) || inner.description };
		}
		return { value: inner.value };
	});
}

var SNAP = '(function(){var el=document.activeElement;'
	+ 'if(!el||el===document.body)return {none:true};'
	+ 'var st=getComputedStyle(el);'
	+ 'return {tag:el.tagName.toLowerCase(),id:el.id||"",cls:(typeof el.className==="string"?el.className:"").split(" ").filter(Boolean)[0]||"",'
	+ 'visible:el.offsetParent!==null||st.position==="fixed"};})()';

function key(send, k, shift) {
	return send('Input.dispatchKeyEvent', {
		type: 'rawKeyDown', key: k, code: k,
		windowsVirtualKeyCode: k === 'Tab' ? 9 : 0, nativeVirtualKeyCode: k === 'Tab' ? 9 : 0,
		modifiers: shift ? 8 : 0
	}).then(function () {
		return send('Input.dispatchKeyEvent', {
			type: 'keyUp', key: k, code: k,
			windowsVirtualKeyCode: k === 'Tab' ? 9 : 0, nativeVirtualKeyCode: k === 'Tab' ? 9 : 0,
			modifiers: shift ? 8 : 0
		});
	});
}

function idxOf(seq, pred, from) {
	for (var i = (from || 0); i < seq.length; i++) if (pred(seq[i])) return i;
	return -1;
}

(async function () {
	if (!fs.existsSync(path.join(DIST, 'index.html'))) {
		console.error('缺少构建产物 dist/index.html，请先运行 npm run build');
		process.exit(1);
	}
	if (!findChrome()) {
		warnings.push('未找到 Chrome / Chromium / Edge，Tab 键序 e2e 跳过（非通过）');
		console.log('SKIP: 未找到可用的 Chromium 系浏览器');
		process.exit(0);
	}
	var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'motie-tab-'));
	var server = await new Promise(function (res) { serveDist(res); });
	var port = server.address().port;
	var inst = await launchChrome(tmp);
	try {
		var t = await openTarget(inst.port, 'http://127.0.0.1:' + port + '/');
		var send = makeSend(t.ws);
		await sleep(1500);

		/* 首屏一轮完整 Tab 循环约 61 停（探索实测），取 80 留余量 */
		var seq = [];
		for (var i = 0; i < 80; i++) {
			await key(send, 'Tab');
			await sleep(40);
			var r = await evaluate(send, SNAP);
			seq.push(r.error ? { error: r.error } : r.value);
		}

		check('采集完成（80 次 Tab 全部取到快照）', seq.every(function (s) { return !s.error; }),
			seq.filter(function (s) { return s.error; }).map(function (s) { return s.error; }).join('; '));

		var isSkip = function (s) { return s.cls === 'rp-skip-link'; };
		var isRailContent = function (s) { return s.cls === 'rp-rail-item'; };
		var isFirstTab = function (s) { return s.id === 'zitie-tab-hanzi'; };
		var isCell = function (s) { return s.cls === 'hz-line'; };
		var isZoom = function (s) { return s.cls === 'rp-zoom-btn' || s.cls === 'rp-zoom-pct' || s.cls === 'rp-zoom-fit'; };

		var iSkip1 = idxOf(seq, isSkip);
		check('首个 Tab 落在跳转链接 .rp-skip-link', iSkip1 === 0, '实际序号 ' + iSkip1);

		var hidden = seq.filter(function (s) { return !s.none && !s.visible; });
		check('整轮无隐藏元素获得焦点', hidden.length === 0,
			hidden.slice(0, 3).map(function (s) { return s.tag + '.' + s.cls; }).join(', '));

		var iRail = idxOf(seq, isRailContent, iSkip1 + 1);
		var iTab = idxOf(seq, isFirstTab, iRail + 1);
		var iCell = idxOf(seq, isCell, iTab + 1);
		var iZoom = idxOf(seq, isZoom, iCell + 1);
		check('锚点顺序：rail「内容」→「汉字」页签 → 预览字格 → 缩放条',
			iRail > iSkip1 && iTab > iRail && iCell > iTab && iZoom > iCell,
			'skip=' + iSkip1 + ' rail=' + iRail + ' tab=' + iTab + ' cell=' + iCell + ' zoom=' + iZoom);

		check('80 次内焦点循环回跳转链接（首尾闭合，不丢焦点）', idxOf(seq, isSkip, 1) > 0);

		t.ws.close();
	} catch (e) {
		failures.push('运行异常：' + (e && e.message || e));
		console.log('  FAIL 运行异常：' + (e && e.stack || e));
	} finally {
		inst.cp.kill('SIGTERM');
		server.close();
		setTimeout(function () { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }, 800);
	}

	for (var w = 0; w < warnings.length; w++) console.log('WARN: ' + warnings[w]);
	if (failures.length) {
		console.error('\nTab 键序端到端失败：');
		for (var f = 0; f < failures.length; f++) console.error('  - ' + failures[f]);
		process.exit(1);
	}
	console.log('\nTab 键序端到端通过');
})();
