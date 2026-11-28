/**
 * 构建产物 dist/（完整版单文件，file:// 直开可用）：
 *   npm run build             → 完整版（Vite 单文件）+ 练字版
 *   npm run build -- --vendor → 额外复制 web/vendor/，并把默认资源来源设为本地（离线 http 部署）
 * 练字版单独重建见 tools/build-lite.js（npm run build:lite）。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { buildLite } = require('./build-lite');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const VENDOR_FILES = ['hanzi-writer.min.js', 'pinyin-pro.esm.js'];

function useVendor() {
	return process.argv.slice(2).some(function (arg) {
		return arg === '--vendor' || arg === 'vendor';
	});
}

function copyFile(from, to) {
	fs.mkdirSync(path.dirname(to), { recursive: true });
	fs.copyFileSync(from, to);
}

function copyDir(from, to) {
	if (!fs.existsSync(from)) return false;
	fs.mkdirSync(to, { recursive: true });
	fs.readdirSync(from, { withFileTypes: true }).forEach(function (entry) {
		if (entry.name === '.DS_Store') return;
		const src = path.join(from, entry.name);
		const dest = path.join(to, entry.name);
		if (entry.isDirectory()) copyDir(src, dest);
		else if (entry.isFile()) copyFile(src, dest);
	});
	return true;
}

function sizeOf(file) {
	return fs.existsSync(file) ? '（' + (fs.statSync(file).size / 1024).toFixed(1) + ' KB）' : '';
}

/* lite 双份产物一致性断言：lite/index.html（原位）与 dist/lite/index.html（拷贝）必须逐字节相同。
 * Go 侧 embed all:lite 与 embed all:dist 各持一份，任一处漂移都会让离线 / 分发行为不一致；
 * 构建收尾强制校验，避免「只更新一处」或拷贝中断被静默放过。 */
function assertSameContent(a, b) {
	var ba = fs.readFileSync(a);
	var bb = fs.readFileSync(b);
	if (ba.equals(bb)) return;
	console.error('lite 产物一致性校验失败：');
	console.error('  ' + path.relative(ROOT, a));
	console.error('  ' + path.relative(ROOT, b));
	console.error('两份内容不同，请确认没有手工改动产物，并重新运行 npm run build。');
	process.exit(1);
}

async function main() {
	var vendor = useVendor();

	/* 1. --vendor 模式要求本地依赖齐备 */
	if (vendor) {
		var missing = VENDOR_FILES.filter(function (name) {
			return !fs.existsSync(path.join(ROOT, 'web', 'vendor', name));
		});
		if (missing.length) {
			console.error('缺少 vendor 文件：' + missing.map(function (name) { return 'vendor/' + name; }).join('、'));
			console.error('请先运行 npm run vendor 下载第三方依赖，再重新构建。');
			process.exit(1);
		}
	}

	/* 2. 完整版：Vite 单文件产物（ZITIE_SINGLEFILE=1 → dist/index.html） */
	execSync('npx vite build', {
		stdio: 'inherit',
		cwd: ROOT,
		env: Object.assign({}, process.env, { ZITIE_SINGLEFILE: '1' })
	});

	/* 3. 练字版（lite，原位构建） */
	await buildLite();

	/* 4. 复制练字版 / 字体 / 本地 vendor */
	copyFile(path.join(ROOT, 'lite', 'index.html'), path.join(DIST, 'lite', 'index.html'));
	assertSameContent(path.join(ROOT, 'lite', 'index.html'), path.join(DIST, 'lite', 'index.html'));
	if (vendor) copyDir(path.join(ROOT, 'web', 'vendor'), path.join(DIST, 'vendor'));
	var fontCopied = copyDir(path.join(ROOT, 'font'), path.join(DIST, 'font'));
	if (!fontCopied) {
		console.warn('警告：未找到 font/ 示例字体（不随仓库分发，共 ~39MB），dist/font 为空；');
		console.warn('       「本地字体」模式将无内置示例，可放入自有 ttf/otf/woff 后重新构建。');
	}

	/* 5. PWA（doc/next-features-todo.md · A5 / roadmap E1）：manifest + 图标 + Service Worker。
	 * http(s) 部署时可「添加到主屏幕」，打开一次后核心功能离线可用；file:// 直开与桌面壳
	 * 不注册 SW（见 web/src/main.jsx）。缓存名注入 package.json 版本，升级即整体换缓存。 */
	var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
	copyFile(path.join(ROOT, 'build', 'appicon.png'), path.join(DIST, 'icon.png'));
	fs.writeFileSync(path.join(DIST, 'manifest.webmanifest'), JSON.stringify({
		name: '墨帖',
		short_name: '墨帖',
		start_url: '.',
		display: 'standalone',
		background_color: '#F5F2EA',
		theme_color: '#F5F2EA',
		icons: [{ src: 'icon.png', sizes: '1024x1024', type: 'image/png' }]
	}, null, '\t'));
	fs.writeFileSync(path.join(DIST, 'sw.js'), [
		'/* 墨帖 Service Worker（tools/build.js 生成，手改会被下次构建覆盖）。',
		' * CACHE 名注入 package.json 版本：升级即整体换缓存，activate 清理旧版本。 */',
		'var CACHE = "motie-v__VERSION__";',
		'var PRECACHE = ["index.html", "icon.png"];',
		'',
		'self.addEventListener("install", function (event) {',
		'\tevent.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(PRECACHE); }));',
		'\tself.skipWaiting();',
		'});',
		'',
		'self.addEventListener("activate", function (event) {',
		'\tevent.waitUntil(caches.keys().then(function (keys) {',
		'\t\treturn Promise.all(keys.map(function (key) {',
		'\t\t\tif (key !== CACHE) return caches.delete(key);',
		'\t\t\treturn undefined;',
		'\t\t}));',
		'\t}).then(function () { return self.clients.claim(); }));',
		'});',
		'',
		'self.addEventListener("fetch", function (event) {',
		'\tvar req = event.request;',
		'\tif (req.method !== "GET") return;',
		'\tvar url = new URL(req.url);',
		'',
		'\t/* 导航（页面）：network-first，离线回退缓存的 index.html */',
		'\tif (req.mode === "navigate") {',
		'\t\tevent.respondWith(fetch(req).then(function (res) {',
		'\t\t\tvar copy = res.clone();',
		'\t\t\tcaches.open(CACHE).then(function (cache) { cache.put(req, copy); });',
		'\t\t\treturn res;',
		'\t\t}).catch(function () {',
		'\t\t\treturn caches.match(req).then(function (hit) { return hit || caches.match("index.html"); });',
		'\t\t}));',
		'\t\treturn;',
		'\t}',
		'',
		'\t/* 同源静态资源与 pinyin-pro CDN：cache-first，未命中才联网并写入缓存 */',
		'\tif (url.origin === self.location.origin || url.hostname === "cdn.jsdelivr.net") {',
		'\t\tevent.respondWith(caches.match(req).then(function (hit) {',
		'\t\t\tif (hit) return hit;',
		'\t\t\treturn fetch(req).then(function (res) {',
		'\t\t\t\tif (res.ok) {',
		'\t\t\t\t\tvar copy = res.clone();',
		'\t\t\t\t\tcaches.open(CACHE).then(function (cache) { cache.put(req, copy); });',
		'\t\t\t\t}',
		'\t\t\t\treturn res;',
		'\t\t\t});',
		'\t\t}));',
		'\t}',
		'});'
	].join('\n').replace('__VERSION__', String(pkg.version)));

	/* 6. --vendor：把默认资源来源写死为本地（页面设置仍可切换回 CDN） */
	if (vendor) {
		var indexPath = path.join(DIST, 'index.html');
		var html = fs.readFileSync(indexPath, 'utf8');
		html = html.replace('</head>', '<script>window.ZITIE_BOOT={ResourceMode:"local"};</script></head>');
		fs.writeFileSync(indexPath, html, 'utf8');
	}

	/* 7. 构建汇总 */
	console.log('构建完成 dist/：');
	console.log('  完整版：单文件（file:// 直开）；资源来源 ' + (vendor ? '本地 vendor（离线可用）' : 'CDN'));
	console.log('  dist/index.html' + sizeOf(path.join(DIST, 'index.html')));
	console.log('  dist/lite/index.html' + sizeOf(path.join(DIST, 'lite', 'index.html')));
	if (vendor) {
		VENDOR_FILES.forEach(function (name) {
			console.log('  dist/vendor/' + name + sizeOf(path.join(DIST, 'vendor', name)));
		});
	}
	if (fontCopied) console.log('  dist/font/（可选字体已复制）');
	console.log('  dist/icon.png / manifest.webmanifest / sw.js' + sizeOf(path.join(DIST, 'manifest.webmanifest')));
}

main().catch(function (err) {
	console.error('构建失败：', err && err.message ? err.message : err);
	process.exit(1);
});
