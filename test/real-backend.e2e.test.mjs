/**
 * 真内核端到端冒烟（桌面验收 §11）：用 Go 源码构建真实二进制，以
 * MOTIE_NO_WINDOW=1 -port=<空闲端口> 只起服务不拉窗口，再用 headless Chrome（CDP）
 * 打开该服务托管的 dist/index.html，验证完整应用在内核同源下进入 http 模式、
 * 预览与字体面板走真实 API——弥补 detect-backend.e2e 用「冒充 /api/config」的空白。
 *
 * 运行：node test/real-backend.e2e.test.mjs（需先 npm run build 生成 dist）。
 * 缺 Go 工具链时跳过并明确说明（不伪装通过）；缺 dist 直接失败（与其它 e2e 一致）。
 */
'use strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
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

/* ---- Go 内核进程 ---- */

var goBin = null;
var goProc = null;
var goLog = [];
var tmpDir = null;

function buildBackend(dir) {
	var bin = path.join(dir, 'motie-real');
	execFileSync('go', ['build', '-o', bin, '.'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
	return bin;
}

function startBackend(bin, port) {
	return new Promise(function (resolve, reject) {
		goProc = spawn(bin, ['-port=' + port], {
			env: Object.assign({}, process.env, { MOTIE_NO_WINDOW: '1' }),
			stdio: ['ignore', 'pipe', 'pipe']
		});
		goProc.stdout.on('data', function (d) { goLog.push(String(d)); });
		goProc.stderr.on('data', function (d) { goLog.push(String(d)); });
		goProc.on('error', function (err) {
			reject(new Error('内核进程启动失败：' + err.message));
		});
		goProc.on('exit', function (code) {
			goLog.push('[内核退出] code=' + code);
			/* 若尚未 resolve（就绪轮询中退出），立刻失败 */
			reject(new Error('内核进程提前退出（可能已有实例占用，或服务启动失败）；日志：\n' + goLog.join('')));
		});
		resolve();
	});
}

function stopBackend() {
	if (!goProc) return Promise.resolve();
	return new Promise(function (resolve) {
		var done = false;
		function finish() { if (done) return; done = true; resolve(); }
		goProc.once('exit', finish);
		goProc.kill('SIGTERM');
		setTimeout(function () { try { goProc.kill('SIGKILL'); } catch (e) {} finish(); }, 5000);
	});
}

/* 轮询 /api/config 直到 app=motie 且 port 相符 */
function waitReady(port, timeoutMs) {
	var deadline = Date.now() + timeoutMs;
	return (function poll() {
		if (Date.now() > deadline) return Promise.reject(new Error('等待 /api/config 超时；日志：\n' + goLog.join('')));
		return cdpFetch('http://127.0.0.1:' + port + '/api/config', {}, 2000).then(function (r) {
			if (!r.ok) throw new Error('HTTP ' + r.status);
			return r.json();
		}).then(function (data) {
			/* ListenAvailable 可能换用邻近空闲端口，故以响应内实际端口为准 */
			if (data && data.app === 'motie') return data;
			throw new Error('响应异常：' + JSON.stringify(data).slice(0, 200));
		}).catch(function (e) {
			if (String(e.message || e).indexOf('响应异常') !== -1) throw e;
			return sleep(250).then(poll);
		});
	})();
}

/* ---- CDP ---- */

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
	return cdpFetch(endpoint, { method: 'PUT' }, 15000).then(function (r) { return r.json(); }).then(function (target) {
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

/* ---------------- 主流程 ---------------- */

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
	console.error('缺少 dist/index.html：请先 npm run build');
	process.exit(1);
}

var goVersion = null;
try {
	goVersion = execFileSync('go', ['version'], { encoding: 'utf8', timeout: 10000 }).trim();
} catch (e) {
	goVersion = null;
}

var chrome = findChrome();
if (!goVersion) {
	warnings.push('未检测到 Go 工具链，跳过真内核冒烟（CI 无 Go 属预期）');
	console.log('  skip 真内核冒烟（无 Go 工具链）');
} else if (!chrome) {
	warnings.push('未找到 Chrome / Chromium / Edge，跳过真内核冒烟');
	console.log('  skip 真内核冒烟（未找到浏览器）');
} else {
	console.log('  ' + goVersion);
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zitie-real-'));
	try {
		goBin = buildBackend(tmpDir);
		console.log('  ok  go build 构建真实内核');
	} catch (e) {
		failures.push('go build 失败：' + (e.message || e));
		console.log('  FAIL go build：' + (e.message || e));
	}

	if (goBin) {
		await (async function () {
			var port = await getFreePort();
			await startBackend(goBin, port);
			var cfg = null;
			try {
				cfg = await waitReady(port, 30000);
				check('/api/config 返回 app=motie', !!cfg && cfg.app === 'motie', JSON.stringify(cfg).slice(0, 200));
			} catch (e) {
				failures.push('内核就绪失败：' + (e.message || e));
				console.log('  FAIL 内核就绪：' + (e.message || e));
				return;
			}

			var realPort = cfg && Number(cfg.port) ? Number(cfg.port) : port;
			var fontsResp = await cdpFetch('http://127.0.0.1:' + realPort + '/api/fonts', {}, 10000);
			check('/api/fonts HTTP 200', fontsResp.ok, 'HTTP ' + fontsResp.status);
			var fontsData = await fontsResp.json();
			check('/api/fonts 返回 system / user 清单', !!fontsData && Array.isArray(fontsData.system) && Array.isArray(fontsData.user),
				JSON.stringify(fontsData).slice(0, 200));

			var origin = 'http://127.0.0.1:' + realPort;
			var profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zitie-real-ui-'));
			var launched = null;
			var page = null;
			function cleanup() {
				if (page) { try { page.ws.close(); } catch (e) {} closeTarget(page.port, page.targetId); }
				if (launched) launched.cp.kill('SIGKILL');
				try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
			}
			try {
				launched = await launchChrome(profile);
				page = await openTarget(launched.port, origin + '/index.html');
				var send = makeSend(page.ws);
				await send('Runtime.enable', {});
				await sleep(2500);

				var brand = await evaluate(send, '(function(){var b=document.querySelector(".rp-brand-name");'
					+ 'return b?b.textContent.trim():null})()');
				check('真实服务下产物渲染（品牌节点）', !brand.error && brand.value === '墨帖', brand.error || String(brand.value));

				var chip = await evaluate(send, '(function(){return document.querySelector(".rp-backend-chip")!==null})()');
				check('同源内核：无「本地模式」徽标（进入 http 模式）', !chip.error && chip.value === false, chip.error || String(chip.value));

				var panel = await evaluate(send, '(function(){return !!document.querySelector(".rp-panel, .rp-preview")})()');
				check('预览 / 面板渲染完成', !panel.error && panel.value === true, panel.error || String(panel.value));

				/* 字体面板走真实 /api/fonts：切到「文字」页，等系统字体选项出现。
				 * 标准版系统字体渲染为 #systemFont 的 option（用户导入字体才是 .rp-font-item）。 */
				var picked = await evaluate(send, '(function(){var bs=document.querySelectorAll(".rp-rail-item");'
					+ 'for(var i=0;i<bs.length;i++){if(bs[i].getAttribute("data-page")==="text"){bs[i].click();return true}}return false})()');
				check('切换到「文字」页', !picked.error && picked.value === true, picked.error || String(picked.value));
				var sysCount = 0;
				for (var i = 0; i < 20; i++) {
					await sleep(400);
					var r = await evaluate(send, '(function(){var s=document.getElementById("systemFont");'
						+ 'if(!s)return -1;var n=0;for(var j=0;j<s.options.length;j++){if(s.options[j].value)n++;}return n})()');
					if (!r.error && Number(r.value) >= 0) sysCount = Number(r.value) || 0;
					if (sysCount > 0) break;
				}
				check('字体面板出现真实系统字体（/api/fonts → UI）', sysCount > 0, '系统字体数 ' + sysCount);

				cleanup();
			} catch (e) {
				cleanup();
				failures.push('页面断言异常：' + (e && e.message || e));
				console.log('  FAIL 页面断言异常：' + (e && e.message || e));
			}
		})().catch(function (e) {
			failures.push('真内核场景异常：' + (e && e.message || e));
			console.log('  FAIL 真内核场景异常：' + (e && e.message || e));
		});
	}
	await stopBackend();
}

function finish() {
	console.log('');
	warnings.forEach(function (w) { console.log('  warn ' + w); });
	if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {} }
	if (failures.length) {
		console.error('真内核冒烟失败 ' + failures.length + ' 项');
		process.exit(1);
	}
	console.log('真内核冒烟通过（' + goVersion + '，Chrome ' + (chrome ? '已执行' : '跳过') + '）');
}

finish();
