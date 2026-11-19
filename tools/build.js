/**
 * 构建产物 dist/（完整版单文件，file:// 直开可用）：
 *   npm run build             → 完整版（Vite 单文件）+ 练字版
 *   npm run build -- --vendor → 额外复制 vendor/，并把默认资源来源设为本地（离线 http 部署）
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

async function main() {
	var vendor = useVendor();

	/* 1. --vendor 模式要求本地依赖齐备 */
	if (vendor) {
		var missing = VENDOR_FILES.filter(function (name) {
			return !fs.existsSync(path.join(ROOT, 'vendor', name));
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
	if (vendor) copyDir(path.join(ROOT, 'vendor'), path.join(DIST, 'vendor'));
	var fontCopied = copyDir(path.join(ROOT, 'font'), path.join(DIST, 'font'));

	/* 5. --vendor：把默认资源来源写死为本地（页面设置仍可切换回 CDN） */
	if (vendor) {
		var indexPath = path.join(DIST, 'index.html');
		var html = fs.readFileSync(indexPath, 'utf8');
		html = html.replace('</head>', '<script>window.ZITIE_BOOT={ResourceMode:"local"};</script></head>');
		fs.writeFileSync(indexPath, html, 'utf8');
	}

	/* 6. 构建汇总 */
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
}

main().catch(function (err) {
	console.error('构建失败：', err && err.message ? err.message : err);
	process.exit(1);
});
