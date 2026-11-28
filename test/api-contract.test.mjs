/**
 * API 契约对照（node test/api-contract.test.mjs · U6）。
 * 目标：Go 内核路由（internal/api/api.go）与前端本地后端（ipc/client.ts 的 MockTransport）
 * 是同一份契约的两端，任何一端新增 / 改名都要在另一端有对应实现或显式豁免。
 * 做法：静态解析两端的路由字面量做双向对照（与 responsive / contrast 同风格），
 * 行为级形状由 vitest 的 transport.test.jsx 补充。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiSrc = readFileSync(join(root, 'internal/api/api.go'), 'utf8');
const clientSrc = readFileSync(join(root, 'web/src/ipc/client.ts'), 'utf8');

/* ---------- Go 路由 ---------- */
const goRoutes = [];
const routeRe = /s\.mux\.HandleFunc\("([A-Z]+) (\/[^"]+)"/g;
let m;
while ((m = routeRe.exec(apiSrc))) goRoutes.push({ method: m[1], path: m[2] });
/* 兜底路由不参与对照 */
const business = goRoutes.filter(function (r) {
	return r.path !== '/api/' && r.path !== '/' && r.path !== '/lite/';
});
assert.ok(business.length >= 20, '路由解析异常偏少：' + business.length);

/* ---------- mock 分支（只解析 MockTransport 类体，避开 HTTPTransport 同名方法） ---------- */
const mockStart = clientSrc.indexOf('export class MockTransport');
assert.ok(mockStart >= 0, '未找到 MockTransport');
function blockOf(name) {
	const start = clientSrc.indexOf('async ' + name + '<T>(path: string', mockStart);
	assert.ok(start >= 0, '未找到 MockTransport.' + name);
	const nextNames = ['async put<', 'async del<', 'async postMultipart<', 'async postRaw<', 'subscribe('];
	let end = clientSrc.length;
	for (const n of nextNames) {
		const i = clientSrc.indexOf(n, start + 10);
		if (i >= 0 && i < end) end = i;
	}
	return clientSrc.slice(start, end);
}
function pathsIn(block) {
	const out = new Set();
	/* 匹配 `path === '...'` 或 `path.startsWith('...')`（两种写法括号位置不同） */
	const re = /path\s*===\s*'([^']+)'|path\s*\.\s*startsWith\(\s*'([^']+)'/g;
	let mm;
	while ((mm = re.exec(block))) out.add(mm[1] || mm[2]);
	return out;
}
const mockByMethod = {
	GET: pathsIn(blockOf('get'), []),
	PUT: pathsIn(blockOf('put'), []),
	DELETE: pathsIn(blockOf('del'), []),
	/* POST 分散在 postRaw（JSON / 二进制）与 postMultipart（表单） */
	POST: new Set([...pathsIn(blockOf('postRaw'), []), ...pathsIn(blockOf('postMultipart'), [])]),
};

/* 显式豁免：非 transport 通道（SSE / 二进制直取），需注明原因 */
const EXEMPT = {
	'GET /api/events': 'SSE 由 EventSource 直连，不经 transport',
	'GET /api/fonts/file/{id}': '字体二进制经 resolve() 拼绝对地址直取，不走 transport.get',
};
function wildcardKey(path) {
	return path.replace(/\/\{[^}]+\}$/, '/*');
}

function mockHas(method, path) {
	const set = mockByMethod[method];
	if (!set) return false;
	if (set.has(path)) return true;
	/* 前缀型分支（/api/files?、/api/fonts/、/api/presets/） */
	for (const p of set) {
		if (p.endsWith('/') && path.startsWith(p)) return true;
		/* 查询型分支：mock 写 `/api/files?`，Go 路由登记为 `/api/files` */
		if (p.endsWith('?') && (path + '?').startsWith(p)) return true;
		if (wildcardKey(path) !== path && path.startsWith(p)) return true;
	}
	return false;
}

const uncovered = [];
for (const r of business) {
	const key = r.method + ' ' + r.path;
	if (EXEMPT[key]) continue;
	if (!mockHas(r.method, r.path)) uncovered.push(key);
}
assert.deepEqual(uncovered, [], '以下 Go 路由在 MockTransport 无对应分支：\n' + uncovered.join('\n'));

/* 反向：mock 分支必须能落回某条 Go 路由（防止出现 Go 侧已删、mock 仍在的影子接口） */
const goKeys = new Set(business.map(function (r) { return r.method + ' ' + r.path; }));
const orphans = [];
for (const method of Object.keys(mockByMethod)) {
	for (const p of mockByMethod[method]) {
		const hit = [...goKeys].some(function (k) {
			const rp = k.slice(k.indexOf(' ') + 1);
			if (p.endsWith('/')) return rp.startsWith(p) || wildcardKey(rp).startsWith(p);
			if (p.endsWith('?')) return (rp + '?').startsWith(p);
			return rp === p || rp.startsWith(p + '?') || wildcardKey(rp) === wildcardKey(p);
		});
		if (!hit) orphans.push(method + ' ' + p);
	}
}
assert.deepEqual(orphans, [], '以下 mock 分支在 Go 路由表中不存在：\n' + orphans.join('\n'));

console.log('  Go 路由 ' + business.length + ' 条 ↔ MockTransport 分支（' +
	Object.keys(mockByMethod).map(function (k) { return k + ':' + mockByMethod[k].size; }).join(' ') + '）双向对齐');
console.log('API 契约对照通过（U6）');
