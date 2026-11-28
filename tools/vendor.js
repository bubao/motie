/**
 * 下载「本地 vendor」模式的第三方资源（不入库，体积较大；存 web/vendor/，避免与 Go 的 vendor 机制冲突）。
 * 用法：npm run vendor
 * 下载后由 web/src/core/assets.js 在「资源来源 = 本地 vendor」时加载，
 * 页面需通过 http 服务托管（file:// 下浏览器会拦截本地 ESM import）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'web', 'vendor');

const FILES = [
	{
		url: 'https://cdn.jsdelivr.net/npm/hanzi-writer@2.2.2/dist/hanzi-writer.min.js',
		name: 'hanzi-writer.min.js'
	},
	{
		url: 'https://cdn.jsdelivr.net/npm/pinyin-pro@3.29.5/+esm',
		name: 'pinyin-pro.esm.js'
	}
];

async function run() {
	fs.mkdirSync(DIR, { recursive: true });
	for (const file of FILES) {
		process.stdout.write('下载 ' + file.name + ' … ');
		const res = await fetch(file.url);
		if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + file.url);
		const buf = Buffer.from(await res.arrayBuffer());
		fs.writeFileSync(path.join(DIR, file.name), buf);
		console.log((buf.length / 1024).toFixed(1) + ' KB');
	}
	console.log('完成：web/vendor/ 已就绪（页面通过 http 托管后可在设置中切换「本地 vendor」）。');
}

run().catch((err) => {
	console.error('vendor 下载失败：', err && err.message ? err.message : err);
	process.exit(1);
});
