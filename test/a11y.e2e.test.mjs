/**
 * 无障碍端到端（WCAG 2.1 AA）：真起 HTTP 服务托管 dist + headless Chrome（CDP），
 * 注入 axe-core 按 wcag2a / wcag2aa / wcag21a / wcag21aa 标签扫描真实页面。
 *
 * 目标等级决策见 doc/web-features.md §7 第 5 条：AA 为验收线；critical / serious 必须清零，
 * 且本测试进一步要求 A/AA 违规总数为 0（出现即失败，鼓励修复而非累积白名单）。
 *
 * 覆盖状态：浅色 / 深色主题 × 全部面板页（内容 / 字帖 / 版式 / 字格 / 文字 / 输出 / 更多），
 * 以及三个浮层（预设导入 / 分享二维码 / 单字放大）。
 * 为什么每场景独立 Chrome：与 sw.e2e 同源教训——串行复用实例开多 target 偶发挂起。
 *
 * 运行：node test/a11y.e2e.test.mjs（需在 npm run build 之后）。
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
var AXE_SRC = fs.readFileSync(path.join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8');
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
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.png': 'image/png',
	'.webmanifest': 'application/manifest+json',
	'.json': 'application/json',
	'.woff2': 'font/woff2'
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

function closeTarget(port, targetId) {
	return cdpFetch('http://127.0.0.1:' + port + '/json/close/' + targetId, {}, 5000).catch(function () {});
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

/* 扫描表达式：仅 WCAG 2.x A / AA（含 2.1）标签；返回违规摘要 */
var SCAN_EXPR = '(async function(){'
	+ 'var out = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a","wcag2aa","wcag21a","wcag21aa"] } });'
	+ 'return out.violations.map(function(v){return {id:v.id, impact:v.impact, help:v.help,'
	+ 'nodes:v.nodes.map(function(n){return n.target.join(" ")}).slice(0,5)};});})()';

function clickByText(send, text) {
	return evaluate(send, '(function(){var t=' + JSON.stringify(text) + ';'
		+ 'var bs=document.querySelectorAll("button");'
		+ 'for(var i=0;i<bs.length;i++){if(bs[i].textContent.trim()===t){bs[i].click();return true}}return false})()');
}

function pressEsc(send) {
	return send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
		.then(function () { return send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); });
}

/** 打开页面 + 注入 axe；返回 { send, close } */
function openPage(origin) {
	var profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zitie-a11y-'));
	var launched = null;
	var page = null;
	var closed = false;
	function cleanup() {
		if (closed) return;
		closed = true;
		if (page) { try { page.ws.close(); } catch (e) {} closeTarget(page.port, page.targetId); }
		if (launched) launched.cp.kill('SIGKILL');
		try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
	}
	return launchChrome(profile).then(function (l) {
		launched = l;
		return openTarget(l.port, origin + '/index.html?nodetect=1');
	}).then(function (p) {
		page = p;
		var send = makeSend(p.ws);
		return send('Runtime.enable', {}).then(function () { return send; });
	}).then(function (send) {
		return sleep(1500).then(function () {
			return evaluate(send, AXE_SRC);
		}).then(function (inj) {
			if (inj.error) throw new Error('axe 注入失败：' + inj.error);
			return { send: send, close: cleanup };
		});
	}).catch(function (e) {
		cleanup();
		throw e;
	});
}

function scan(send, label) {
	return evaluate(send, SCAN_EXPR).then(function (r) {
		if (r.error) return { error: r.error, items: [] };
		return { error: null, items: r.value || [] };
	}).then(function (res) {
		var bad = res.items.filter(function (v) { return v.impact === 'critical' || v.impact === 'serious'; });
		check('[' + label + '] 无 critical / serious 违规', res.error ? false : bad.length === 0,
			res.error || bad.map(function (v) { return v.id + '(' + v.impact + ') ' + v.help + ' @ ' + v.nodes.join('; '); }).join(' | '));
		check('[' + label + '] A / AA 违规总数为 0', res.error ? false : res.items.length === 0,
			res.error || res.items.map(function (v) { return v.id + '/' + v.impact; }).join(' | '));
		res.items.forEach(function (v) {
			console.log('      ' + label + ' [' + v.impact + '] ' + v.id + ' — ' + v.help + ' @ ' + v.nodes.join('; '));
		});
		return res;
	});
}

function pickPage(send, key) {
	return evaluate(send, '(function(){var bs=document.querySelectorAll(".rp-rail-item");'
		+ 'for(var i=0;i<bs.length;i++){if(bs[i].getAttribute("data-page")===' + JSON.stringify(key) + '){bs[i].click();return true}}'
		+ 'var m=document.querySelector(".rp-rail-more");if(' + JSON.stringify(key) + '==="more"&&m){m.click();return true}return false})()');
}

var PAGES = ['content', 'docs', 'layout', 'grid', 'text', 'output', 'more'];

function themeScenario(name, themeName) {
	return function (origin) {
		return openPage(origin).then(function (h) {
			return evaluate(h.send, '(function(){var bs=document.querySelectorAll(".rp-theme button");'
				+ 'for(var i=0;i<bs.length;i++){if(bs[i].textContent===' + JSON.stringify(themeName) + '){bs[i].click();return true}}return false})()')
				.then(function () { return sleep(600); })
				.then(function () { return scan(h.send, name + '·初始'); })
				.then(function () {
					return PAGES.reduce(function (chain, key) {
						return chain.then(function () {
							return pickPage(h.send, key).then(function (c) {
								if (!c.value) throw new Error('未找到页面 ' + key);
								return sleep(500);
							}).then(function () { return scan(h.send, name + '·' + key); });
						});
					}, Promise.resolve());
				})
				.then(function () { h.close(); })
				.catch(function (e) { h.close(); throw e; });
		});
	};
}

function overlayScenario(origin) {
	return openPage(origin).then(function (h) {
		var step = function (fn) { return fn().then(function () { return sleep(600); }); };
		return step(function () { return pickPage(h.send, 'content'); })
			.then(function () { return step(function () {
				return evaluate(h.send, '(function(){var b=document.querySelector(".rp-sample-main");if(b){b.click();return true}return false})()');
			}); })
			.then(function () { return step(function () { return pickPage(h.send, 'layout'); }); })
			.then(function () { return step(function () { return clickByText(h.send, '导入…'); }); })
			.then(function () { return scan(h.send, '浮层·预设导入'); })
			.then(function () { return step(function () { return pressEsc(h.send); }); })
			.then(function () { return step(function () { return pickPage(h.send, 'output'); }); })
			.then(function () { return step(function () { return clickByText(h.send, '分享二维码'); }); })
			.then(function () { return scan(h.send, '浮层·分享二维码'); })
			.then(function () { return step(function () { return pressEsc(h.send); }); })
			.then(function () { return step(function () {
				return evaluate(h.send, '(function(){var l=document.querySelector(".hz-line");if(!l)return false;'
					+ 'l.dispatchEvent(new MouseEvent("click",{bubbles:true}));l.dispatchEvent(new MouseEvent("click",{bubbles:true}));return true})()');
			}); })
			.then(function () { return scan(h.send, '浮层·单字放大'); })
			.then(function () { h.close(); })
			.catch(function (e) { h.close(); throw e; });
	});
}

/* ---------------- 主流程 ---------------- */

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
	console.error('缺少 dist/index.html：请先 npm run build');
	process.exit(1);
}

var chrome = findChrome();
if (!chrome) {
	warnings.push('未找到 Chrome / Chromium / Edge，跳过无障碍扫描');
	console.log('  skip 无障碍扫描（未找到浏览器）');
} else {
	serveDist(function (server) {
		var origin = 'http://127.0.0.1:' + server.address().port;
		themeScenario('浅色', '浅色')(origin)
			.then(function () { return themeScenario('深色', '深色')(origin); })
			.then(function () { return overlayScenario(origin); })
			.then(function () {
				server.close(function () {
					finish();
				});
			})
			.catch(function (e) {
				failures.push('场景异常：' + (e && e.message || e));
				console.error('  FAIL 场景异常：' + (e && e.message || e));
				server.close(function () { finish(); });
			});
	});
}

function finish() {
	console.log('');
	warnings.forEach(function (w) { console.log('  warn ' + w); });
	if (failures.length) {
		console.error('无障碍扫描失败 ' + failures.length + ' 项');
		process.exit(1);
	}
	console.log('无障碍扫描通过（WCAG 2.1 AA，axe-core）');
}
