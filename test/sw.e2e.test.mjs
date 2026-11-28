/**
 * PWA Service Worker 注册端到端（roadmap E1 / A5）：真起 HTTP 服务托管整个 dist +
 * headless Chrome（CDP），断言「谁该注册、谁不该注册」的页面自动行为。
 *
 * 为什么必须托管整个 dist：sw.js install 会 cache.addAll(["index.html","icon.png"])，
 * 缺任一资源即安装失败，浏览器会把这条注册回收——此前用只托管 index.html/sw.js 的
 * 探针观察到的「自动注册消失」正是这个原因（见 doc/desktop-architecture.md §9.4）。
 *
 * 为什么每个场景用独立 Chrome：串行复用同一 headless 实例开多个 target 时，
 * 第二个 target 的创建 / Runtime.evaluate 会偶发挂起（实测单场景被拖到 2 分钟以上）；
 * 独立实例 + 独立 profile 隔离后稳定（约 5~15s 一个场景）。
 *
 * 场景：
 *  A. mock 模式（同源无 /api/config）+ http(s) → 自动注册、安装成功、稳定存活且已激活；
 *  B. http 模式（同源提供 app=motie 的 /api/config）→ 不注册（内核在线由服务端负责，
 *     且避免把 API 流量卷进 SW 缓存）；
 *  C. file:// 直开 → 不注册（SW 本身不支持 file:）。
 *
 * 运行：node test/sw.e2e.test.mjs（需在 npm run build 之后）。
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
var T0 = Date.now();
function mark(s) { if (process.env.MOTIE_SW_DEBUG) console.error('  [' + (Date.now() - T0) + 'ms] ' + s); }

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
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.png': 'image/png',
	'.webmanifest': 'application/manifest+json',
	'.json': 'application/json',
	'.woff2': 'font/woff2'
};

/** 静态托管整个 dist；backend=true 时额外用 /api/config 冒充 Go 内核 */
function serveDist(backend, cb) {
	var server = http.createServer(function (req, res) {
		var pathname;
		try { pathname = decodeURIComponent(req.url.split('?')[0]); } catch (e) { pathname = '/'; }
		if (backend && pathname === '/api/config') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ app: 'motie', version: 'e2e', port: server.address().port }));
			return;
		}
		if (pathname === '/') pathname = '/index.html';
		var file = path.join(DIST, pathname);
		/* 防目录穿越：解析后必须仍在 DIST 内 */
		if (file.indexOf(DIST + path.sep) !== 0 && file !== DIST) {
			res.writeHead(403); res.end('forbidden'); return;
		}
		try {
			var stat = fs.statSync(file);
			if (!stat.isFile()) throw new Error('not file');
			res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
			res.end(fs.readFileSync(file));
			return;
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
		probe.listen(0, '127.0.0.1', function () {
			var port = probe.address().port;
			probe.close(function () { resolve(port); });
		});
		probe.on('error', reject);
	});
}

/** CDP 的 HTTP 接口在偶发时序下可能不回包；必须带超时，否则整个套件挂死 */
function cdpFetch(url, options, timeoutMs) {
	var ctrl = new AbortController();
	var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 15000);
	return fetch(url, Object.assign({ signal: ctrl.signal }, options || {})).finally(function () { clearTimeout(timer); });
}

/** 启动 headless Chrome 并等待 DevTools 端口就绪；返回 { cp, port } */
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
			var timer = setTimeout(function () {
				if (done) return;
				done = true;
				cp.kill('SIGKILL');
				reject(new Error('DevTools 端口超时'));
			}, 20000);
			(function poll() {
				if (done) return;
				cdpFetch('http://127.0.0.1:' + port + '/json/version', {}, 3000).then(function (r) {
					if (!r.ok) throw new Error('bad status');
					if (done) return;
					done = true;
					clearTimeout(timer);
					resolve({ cp: cp, port: port });
				}).catch(function () {
					setTimeout(poll, 200);
				});
			})();
		}, reject);
	});
}

function openTarget(port, url) {
	/* 偶发创建失败时重试一次；仍失败则抛出，由 runScenario 记为 FAIL 而非挂起 */
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
			var timer = setTimeout(function () {
				reject(new Error('WebSocket 连接超时'));
				try { ws.close(); } catch (e) { /* 已关闭 */ }
			}, 10000);
			ws.onopen = function () {
				clearTimeout(timer);
				resolve({ ws: ws, targetId: target.id, port: port });
			};
			ws.onerror = function () { clearTimeout(timer); reject(new Error('WebSocket 连接失败')); };
		});
	});
}

function closeTarget(port, targetId) {
	return cdpFetch('http://127.0.0.1:' + port + '/json/close/' + targetId, {}, 5000).catch(function () {});
}

/** CDP Runtime.evaluate 等指令无内建超时；统一兜底，避免单点挂起拖死 npm test */
function makeSend(ws) {
	var nextId = 0;
	return function send(method, params, timeoutMs) {
		return new Promise(function (resolve, reject) {
			var id = ++nextId;
			var timer = setTimeout(function () { reject(new Error('CDP ' + method + ' 超时')); }, timeoutMs || 20000);
			function onMessage(ev) {
				var msg = JSON.parse(ev.data);
				if (msg.id !== id) return;
				ws.removeEventListener('message', onMessage);
				clearTimeout(timer);
				resolve(msg);
			}
			ws.addEventListener('message', onMessage);
			ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
		});
	};
}

function evaluate(send, expression) {
	return send('Runtime.evaluate', { expression: expression, awaitPromise: true, returnByValue: true })
		.then(function (msg) {
			var inner = msg.result && msg.result.result;
			if (!inner) return { error: (msg.result && msg.result.exceptionDetails && msg.result.exceptionDetails.text) || 'no result' };
			if (inner.subtype === 'error' || (msg.result.exceptionDetails)) {
				return { error: (msg.result.exceptionDetails.exception && msg.result.exceptionDetails.exception.description) || inner.description };
			}
			return { value: inner.value };
		});
}

/**
 * 在页面里轮询 SW 注册状态，直到满足 predicate 或超时。
 * 注意 CDP 返回结构是 msg.result.result.value（少一层就会拿到 undefined）。
 */
function pollRegistrations(send, timeoutMs, predicate) {
	var deadline = Date.now() + timeoutMs;
	function once() {
		var expr = '(async function(){var regs=await navigator.serviceWorker.getRegistrations();'
			+ 'return {count:regs.length,scope:regs[0]?regs[0].scope:null,'
			+ 'state:regs[0]?(regs[0].active?"active":(regs[0].installing?"installing":(regs[0].waiting?"waiting":"other"))):null,'
			+ 'controlled:!!navigator.serviceWorker.controller};})()';
		return evaluate(send, expr).then(function (r) {
			if (r.error) throw new Error(r.error);
			if (predicate(r.value)) return r.value;
			if (Date.now() >= deadline) return r.value;
			return new Promise(function (res) { setTimeout(res, 400); }).then(once);
		});
	}
	return once();
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/** 每个场景独立 Chrome 实例 + 独立 profile；异常计为场景失败，不影响其它场景 */
async function runScenario(name, fn) {
	var profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zitie-sw-e2e-'));
	var launched = null;
	mark(name + ' start');
	try {
		launched = await launchChrome(profileRoot);
		await sleep(300);
		await fn(launched.port);
	} catch (e) {
		failures.push(name + ' 场景异常：' + (e && e.message || e));
		console.log('  FAIL ' + name + ' 场景异常：' + (e && e.message || e));
	} finally {
		if (launched) launched.cp.kill('SIGKILL');
		try { fs.rmSync(profileRoot, { recursive: true, force: true }); } catch (e) { /* 清理失败不影响结论 */ }
	}
	mark(name + ' done');
}

/* ---------------- 主流程 ---------------- */

if (!fs.existsSync(path.join(DIST, 'index.html')) || !fs.existsSync(path.join(DIST, 'sw.js'))) {
	console.error('缺少 dist/index.html 或 dist/sw.js：请先 npm run build');
	process.exit(1);
}

var chromePath = findChrome();
if (!chromePath) {
	warnings.push('未找到 Chrome / Chromium / Edge，跳过 PWA Service Worker 冒烟');
	console.log('  skip PWA 注册（未找到浏览器）');
} else {
	/* 场景 A：mock 模式 + http(s) → 应自动注册且安装成功 */
	await runScenario('A mock+http', async function (cdpPort) {
		await new Promise(function (resolve) {
			serveDist(false, function (server) {
				var origin = 'http://127.0.0.1:' + server.address().port;
				openTarget(cdpPort, origin + '/index.html?nodetect=1').then(function (page) {
					var send = makeSend(page.ws);
					return send('Runtime.enable', {}).then(function () {
						return pollRegistrations(send, 20000, function (s) { return s.count >= 1 && s.state === 'active'; });
					}).then(function (state) {
						check('A mock+http：页面自动注册 sw.js', state.count >= 1,
							'getRegistrations 为空（自动注册未发生或安装失败被回收）');
						check('A mock+http：注册 scope 为站点根', state.scope === origin + '/',
							'实际 scope=' + state.scope);
						check('A mock+http：SW 已激活', state.state === 'active',
							'最终状态=' + state.state);
						/* 稳定性：激活后再静置 3s，注册仍应存在（安装失败会被浏览器回收） */
						return sleep(3000).then(function () { return pollRegistrations(send, 3000, function () { return true; }); });
					}).then(function (later) {
						check('A mock+http：注册稳定存活 3s 以上', later.count >= 1,
							'静置后注册消失（install 失败被回收，检查预缓存资源是否齐全）');
						check('A mock+http：页面已被 SW 接管（clients.claim 生效）', later.controlled === true,
							'controller 未接管页面');
						return closeTarget(cdpPort, page.targetId);
					}).catch(function (e) {
						failures.push('A mock+http 场景异常：' + (e && e.message || e));
						console.log('  FAIL A mock+http 场景异常：' + (e && e.message || e));
					}).then(function () {
						page.ws.close();
						server.close(function () { resolve(); });
					});
				});
			});
		});
	});

	/* 场景 B：同源提供内核（http 模式）→ 不应注册 */
	await runScenario('B http', async function (cdpPort) {
		await new Promise(function (resolve) {
			serveDist(true, function (server) {
				var origin = 'http://127.0.0.1:' + server.address().port;
				openTarget(cdpPort, origin + '/index.html?nodetect=1').then(function (page) {
					var send = makeSend(page.ws);
					return send('Runtime.enable', {}).then(function () {
						return sleep(6000).then(function () { return pollRegistrations(send, 2000, function () { return true; }); });
					}).then(function (state) {
						/* 先证明真的进了 http 模式（顶栏无本地模式徽标），否则 count=0 毫无意义 */
						return evaluate(send, '(function(){return {chip: !!document.querySelector(".rp-backend-chip")};})()')
							.then(function (ui) {
								check('B 内核在线：进入 http 模式（无本地模式徽标）', ui.value && ui.value.chip === false,
									'页面未进入 http 模式，本场景结论无效');
								check('B 内核在线：不注册 Service Worker', state.count === 0,
									'http 模式下出现 ' + state.count + ' 条 SW 注册');
							});
					}).catch(function (e) {
						failures.push('B http 场景异常：' + (e && e.message || e));
						console.log('  FAIL B http 场景异常：' + (e && e.message || e));
					}).then(function () {
						page.ws.close();
						server.close(function () { resolve(); });
					});
				});
			});
		});
	});

	/* 场景 C：file:// 直开 → SW 不受支持，不应注册 */
	await runScenario('C file://', async function (cdpPort) {
		await new Promise(function (resolve) {
			var fileUrl = 'file://' + path.join(DIST, 'index.html') + '?nodetect=1';
			openTarget(cdpPort, fileUrl).then(function (page) {
				var send = makeSend(page.ws);
				return send('Runtime.enable', {}).then(function () {
					return sleep(5000);
				}).then(function () {
					/* file:// 直开时 origin 为 'null'，getRegistrations 会抛 SecurityError——按「不可用」处理 */
					return evaluate(send, '(async function(){'
						+ 'var supported = "serviceWorker" in navigator;'
						+ 'var count = -1;'
						+ 'try { count = (await navigator.serviceWorker.getRegistrations()).length; }'
						+ 'catch (e) { count = -1; }'
						+ 'return {readyState: document.readyState, supported: supported, count: count,'
						+ 'rendered: !!(document.getElementById("root") && document.getElementById("root").childElementCount > 0)};})()');
				}).then(function (r) {
					if (r.error) { check('C file://：页面可启动', false, r.error); return; }
					check('C file://：页面正常渲染', r.value.readyState === 'complete' && r.value.rendered,
						JSON.stringify(r.value));
					check('C file://：不注册 Service Worker（协议不支持或未注册）',
						r.value.count === 0 || r.value.count === -1,
						JSON.stringify(r.value));
				}).catch(function (e) {
					failures.push('C file:// 场景异常：' + (e && e.message || e));
					console.log('  FAIL C file:// 场景异常：' + (e && e.message || e));
				}).then(function () {
					page.ws.close();
					resolve();
				});
			});
		});
	});
}

console.log('');
warnings.forEach(function (w) { console.log('  warn ' + w); });
if (failures.length) {
	console.error('PWA Service Worker 冒烟失败 ' + failures.length + ' 项');
	process.exit(1);
}
console.log('PWA Service Worker 冒烟通过（Chrome ' + (chromePath ? '已执行' : '跳过') + '）');
