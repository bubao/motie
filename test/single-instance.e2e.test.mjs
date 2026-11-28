/**
 * 单实例端到端（真实双进程，axe / 单测之外的行为兜底）：
 *   场景 = 默认端口被非 motie 程序占用，首实例顺延运行：
 *     1. 占用首选端口 P（返回 app=other 的伪装服务）；
 *     2. 启动实例 A（-port=P，MOTIE_NO_WINDOW=1）→ 应顺延到 P+1；
 *     3. 启动实例 B（-port=P）→ 必须**快速退出**，并报告「已在运行（端口 P+1）」；
 *        不得另起第二个服务（否则 P+2 会出现 motie）。
 *
 * 锁定的是 serve.FindRunning 区间扫描 + AlreadyRunningError 携带实际端口
 * （见 serve_test.go 与 doc/desktop-architecture.md §5.1 / §12）。
 * 运行：node test/single-instance.e2e.test.mjs（需先 go build）。
 * 缺 Go 工具链时跳过并明确说明（不伪装通过）。
 */
'use strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

var ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
var failures = [];
var warnings = [];

function check(name, cond, detail) {
	if (cond) console.log('  ok  ' + name);
	else {
		failures.push(name + (detail ? '：' + detail : ''));
		console.log('  FAIL ' + name + (detail ? '：' + detail : ''));
	}
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function freePort() {
	return new Promise(function (resolve, reject) {
		var probe = net.createServer();
		probe.listen(0, '127.0.0.1', function () {
			var p = probe.address().port;
			probe.close(function () { resolve(p); });
		});
		probe.on('error', reject);
	});
}

/* 找一对相邻可用端口（P、P+1 均空闲） */
async function freeAdjacentPorts() {
	for (var i = 0; i < 50; i++) {
		var p = await freePort();
		var ok = await new Promise(function (resolve) {
			var probe = net.createServer();
			probe.once('error', function () { resolve(false); });
			probe.listen(p + 1, '127.0.0.1', function () {
				probe.close(function () { resolve(true); });
			});
		});
		if (ok) return p;
	}
	throw new Error('找不到相邻可用端口');
}

/* 在指定端口起伪装服务（返回 app=other），模拟默认端口被非 motie 程序占用 */
function serveOther(port) {
	return new Promise(function (resolve, reject) {
		var srv = http.createServer(function (req, res) {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end('{"app":"other"}');
		});
		srv.on('error', reject);
		srv.listen(port, '127.0.0.1', function () { resolve(srv); });
	});
}

async function getJSON(url, timeoutMs) {
	var ctrl = new AbortController();
	var t = setTimeout(function () { ctrl.abort(); }, timeoutMs || 2000);
	try {
		var r = await fetch(url, { signal: ctrl.signal });
		if (!r.ok) return null;
		return await r.json();
	} catch (e) {
		return null;
	} finally {
		clearTimeout(t);
	}
}

async function waitMotie(port, timeoutMs) {
	var deadline = Date.now() + (timeoutMs || 30000);
	while (Date.now() < deadline) {
		var data = await getJSON('http://127.0.0.1:' + port + '/api/config', 1500);
		if (data && data.app === 'motie') return true;
		await sleep(250);
	}
	return false;
}

/* 启动内核子进程：收集 stdout/stderr，返回 { proc, stdout, stderr, exitCode, waitForExit } */
function startKernel(bin, port, env) {
	var proc = spawn(bin, ['-port=' + port], {
		env: Object.assign({}, process.env, { MOTIE_NO_WINDOW: '1' }, env || {}),
		stdio: ['ignore', 'pipe', 'pipe']
	});
	var stdout = '';
	var stderr = '';
	proc.stdout.on('data', function (d) { stdout += d.toString(); });
	proc.stderr.on('data', function (d) { stderr += d.toString(); });
	var exitCode = null;
	proc.on('exit', function (c) { exitCode = c; });
	var waitForExit = function (timeoutMs) {
		return new Promise(function (resolve) {
			if (exitCode !== null) { resolve(exitCode); return; }
			var t = setTimeout(function () { proc.kill('SIGKILL'); resolve('timeout'); }, timeoutMs || 20000);
			proc.once('exit', function (c) { clearTimeout(t); resolve(c); });
		});
	};
	return { proc: proc, stdout: stdout, stderr: stderr, getStdout: function () { return stdout; }, getStderr: function () { return stderr; }, exitCode: function () { return exitCode; }, waitForExit: waitForExit };
}

(async function () {
	/* 注意：execFileSync 在 stdio:'ignore' 下返回空值，不能以返回值判成败；
	 * 用「是否抛错」判定 Go 工具链存在与否 */
	var hasGo = true;
	try {
		execFileSync('go', ['version']);
	} catch (e) {
		hasGo = false;
	}
	if (!hasGo) {
		warnings.push('未找到 Go 工具链，单实例 e2e 跳过（非通过）');
		console.log('SKIP: 未找到 Go 工具链');
		process.exit(0);
	}

	var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'motie-single-'));
	var bin = path.join(tmp, 'motie');
	try {
		execFileSync('go', ['build', '-o', bin, '.'], { cwd: ROOT, timeout: 300000, stdio: 'ignore' });
	} catch (e) {
		console.error('go build 失败：' + (e && e.message || e));
		process.exit(1);
	}

	var base = await freeAdjacentPorts();
	var otherSrv = await serveOther(base);
	var instanceA = null;
	var instanceB = null;
	try {
		instanceA = startKernel(bin, base);
		var shifted = await waitMotie(base + 1, 30000);
		check('首实例在首选端口被占时顺延到邻端口（P+1）', shifted,
			'P=' + base + '，等待 P+1 提供 /api/config 超时；A stdout=' + JSON.stringify(instanceA.getStdout()));

		instanceB = startKernel(bin, base);
		var code = await instanceB.waitForExit(15000);
		check('第二进程快速退出（不另起服务）', code !== 'timeout' && code !== null, 'exit=' + code);

		var errText = instanceB.getStderr();
		check('第二进程报告既有实例的实际端口（P+1）',
			errText.indexOf('已有一个 motie 实例在运行（端口 ' + (base + 1) + '）') >= 0,
			'stderr=' + JSON.stringify(errText));

		check('MOTIE_NO_WINDOW 下不为既有实例拉窗口',
			instanceA.getStdout().indexOf('已跳过拉起窗口') >= 0
				&& instanceB.getStdout().indexOf('已跳过为既有实例拉起窗口') >= 0,
			'A stdout=' + JSON.stringify(instanceA.getStdout()) + ' B stdout=' + JSON.stringify(instanceB.getStdout()));

		var second = await getJSON('http://127.0.0.1:' + (base + 2) + '/api/config', 1500);
		check('P+2 未出现第二个 motie 服务', !(second && second.app === 'motie'),
			'P+2 响应=' + JSON.stringify(second));

		var still = await getJSON('http://127.0.0.1:' + (base + 1) + '/api/config', 1500);
		check('既有实例服务保持可用', !!(still && still.app === 'motie'), 'P+1 响应=' + JSON.stringify(still));
	} finally {
		if (instanceA && instanceA.exitCode() === null) instanceA.proc.kill('SIGTERM');
		if (instanceB && instanceB.exitCode() === null) instanceB.proc.kill('SIGKILL');
		otherSrv.close();
		setTimeout(function () { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }, 800);
	}

	for (var w = 0; w < warnings.length; w++) console.log('WARN: ' + warnings[w]);
	if (failures.length) {
		console.error('\n单实例端到端失败：');
		for (var f = 0; f < failures.length; f++) console.error('  - ' + failures[f]);
		process.exit(1);
	}
	console.log('\n单实例端到端通过');
})().catch(function (e) {
	console.error('FATAL: ' + (e && e.stack || e));
	process.exit(1);
});
