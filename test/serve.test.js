/**
 * 本地服务回归测试（node test/serve.test.js）。
 * 覆盖：静态服务 / 字体 MIME / 404 / 路径穿越；/api/fonts 清单 / 上传 / 删除 / 安全边界。
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');
const { createServer, sanitizeFile } = require('../tools/serve.js');

let passed = 0;
let failed = 0;

async function test(name, fn) {
	try {
		await fn();
		passed++;
		console.log('  ok  ' + name);
	} catch (err) {
		failed++;
		console.error('  FAIL ' + name);
		console.error('       ' + (err && err.message ? err.message : err));
	}
}

async function main() {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zitie-serve-'));
	const root = path.join(tmp, 'dist');
	const fontDir = path.join(root, 'font');
	fs.mkdirSync(fontDir, { recursive: true });
	fs.writeFileSync(path.join(root, 'index.html'), '<html>index</html>');
	fs.writeFileSync(path.join(fontDir, '1.ttf'), 'TTFDATA');
	fs.writeFileSync(path.join(fontDir, '2.woff'), 'WOFFDATA');
	fs.writeFileSync(path.join(fontDir, 'notes.txt'), 'ignore');

	const app = createServer({ root, fontDir, maxFont: 100 });
	await app.listen(0, '127.0.0.1');
	const port = app.server.address().port;
	const base = 'http://127.0.0.1:' + port;

	console.log('本地服务测试');

	await test('sanitizeFile：合法名 / 去路径 / ASCII 限制 / 扩展名白名单', () => {
		assert.strictEqual(sanitizeFile('1.ttf'), '1.ttf');
		assert.strictEqual(sanitizeFile('/etc/evil.ttf'), 'evil.ttf');
		assert.strictEqual(sanitizeFile('楷书.ttf'), null);
		assert.strictEqual(sanitizeFile('a b.ttf'), null);
		assert.strictEqual(sanitizeFile('a.txt'), null);
		assert.strictEqual(sanitizeFile('noext'), null);
		assert.strictEqual(sanitizeFile('..'), null);
		assert.strictEqual(sanitizeFile('.ttf'), null);
	});

	await test('静态：根路径 → index.html；字体 MIME 正确', async () => {
		const res = await fetch(base + '/');
		assert.strictEqual(res.status, 200);
		assert.strictEqual(await res.text(), '<html>index</html>');
		const font = await fetch(base + '/font/1.ttf');
		assert.strictEqual(font.status, 200);
		assert.ok((font.headers.get('content-type') || '').includes('font/ttf'));
		assert.strictEqual(await font.text(), 'TTFDATA');
	});

	await test('静态：404 与路径穿越 403', async () => {
		const missing = await fetch(base + '/nope.js');
		assert.strictEqual(missing.status, 404);
		const traversal = await fetch(base + '/..%2F..%2Fpackage.json');
		assert.strictEqual(traversal.status, 403);
	});

	await test('GET /api/fonts：仅字体扩展名，含 name/file/size/url', async () => {
		const res = await fetch(base + '/api/fonts');
		assert.strictEqual(res.status, 200);
		const data = await res.json();
		assert.strictEqual(data.fonts.length, 2);
		const first = data.fonts[0];
		assert.strictEqual(first.file, '1.ttf');
		assert.strictEqual(first.name, '1');
		assert.strictEqual(first.size, 7);
		assert.strictEqual(first.url, '/font/1.ttf');
	});

	await test('POST /api/fonts：ASCII 名 + X-Label 中文显示名（sidecar）', async () => {
		const res = await fetch(base + '/api/fonts', {
			method: 'POST',
			headers: {
				'x-filename': 'xikai.ttf',
				'x-label': encodeURIComponent('细楷'),
				'content-type': 'application/octet-stream'
			},
			body: 'NEWDATA'
		});
		assert.strictEqual(res.status, 200);
		const data = await res.json();
		assert.strictEqual(data.font.file, 'xikai.ttf');
		assert.strictEqual(data.font.name, '细楷');
		assert.strictEqual(fs.readFileSync(path.join(fontDir, 'xikai.ttf'), 'utf8'), 'NEWDATA');
		assert.strictEqual(fs.readFileSync(path.join(fontDir, 'xikai.ttf.label'), 'utf8'), '细楷');
		const list = await (await fetch(base + '/api/fonts')).json();
		const hit = list.fonts.filter((f) => f.file === 'xikai.ttf')[0];
		assert.strictEqual(hit.name, '细楷');
		assert.strictEqual(list.fonts.length, 3);
	});

	await test('POST /api/fonts：非 ASCII 文件名 400；非法扩展名 400；空 body 400；超限 413', async () => {
		const cn = await fetch(base + '/api/fonts', {
			method: 'POST', headers: { 'x-filename': encodeURIComponent('楷书.ttf') }, body: 'x'
		});
		assert.strictEqual(cn.status, 400);
		const bad = await fetch(base + '/api/fonts', {
			method: 'POST', headers: { 'x-filename': 'evil.txt' }, body: 'x'
		});
		assert.strictEqual(bad.status, 400);
		const empty = await fetch(base + '/api/fonts', {
			method: 'POST', headers: { 'x-filename': 'empty.ttf' }, body: ''
		});
		assert.strictEqual(empty.status, 400);
		const big = await fetch(base + '/api/fonts', {
			method: 'POST', headers: { 'x-filename': 'big.ttf' }, body: Buffer.alloc(101)
		});
		assert.strictEqual(big.status, 413);
	});

	await test('DELETE /api/fonts/<file>：删除生效；不存在 404；去路径无法越界', async () => {
		const del = await fetch(base + '/api/fonts/1.ttf', { method: 'DELETE' });
		assert.strictEqual(del.status, 200);
		/* 删除带 label 的字体时同步清理 sidecar */
		const delLabel = await fetch(base + '/api/fonts/xikai.ttf', { method: 'DELETE' });
		assert.strictEqual(delLabel.status, 200);
		assert.ok(!fs.existsSync(path.join(fontDir, 'xikai.ttf')));
		assert.ok(!fs.existsSync(path.join(fontDir, 'xikai.ttf.label')));
		const list = await (await fetch(base + '/api/fonts')).json();
		assert.strictEqual(list.fonts.length, 1);
		const again = await fetch(base + '/api/fonts/1.ttf', { method: 'DELETE' });
		assert.strictEqual(again.status, 404);
		/* 路径穿越被 basename 收敛到 fontDir 内，文件不存在 → 404，不会删到外部 */
		const escape = await fetch(base + '/api/fonts/..%2F..%2Fevil.ttf', { method: 'DELETE' });
		assert.strictEqual(escape.status, 404);
		assert.ok(!fs.existsSync(path.join(tmp, 'evil.ttf')));
	});

	app.server.close();
	fs.rmSync(tmp, { recursive: true, force: true });

	console.log('本地服务测试：' + passed + ' 通过，' + failed + ' 失败');
	if (failed) process.exit(1);
}

main().catch((err) => {
	console.error('本地服务测试异常：', err && err.stack ? err.stack : err);
	process.exit(1);
});
