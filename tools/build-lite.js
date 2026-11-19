/**
 * 构建 Kindle 精简版：
 *   esbuild 把 lite-src/main.js 打包成 ES5 IIFE，
 *   再连同 CSS 内联进模板，产出单文件 lite/index.html（离线可用）。
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'lite-src');
const DIST = path.join(ROOT, 'lite');
/* 版本号唯一来源：package.json（占位符替换，保持构建幂等） */
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

async function buildLite() {
	const appPath = path.join(DIST, 'app.js');

	await esbuild.build({
		entryPoints: [path.join(SRC, 'main.js')],
		outfile: appPath,
		bundle: true,
		minify: true,
		target: 'es5',
		charset: 'utf8', /* 页面本身是 UTF-8，保留原始字符比 \uXXXX 转义省 1/3 体积 */
		format: 'iife',
		legalComments: 'none',
		write: true,
		logLevel: 'warning'
	});

	const css = fs.readFileSync(path.join(SRC, 'style.css'), 'utf8');
	const js = fs.readFileSync(appPath, 'utf8');
	const template = fs.readFileSync(path.join(SRC, 'template.html'), 'utf8');

	/* 用函数形式替换，避免替换串中的 $ 符号被当作特殊模式 */
	const html = template
		.replace('/*__STYLE__*/', () => css)
		.replace('/*__SCRIPT__*/', () => js)
		.replace(/__ZITIE_VERSION__/g, () => VERSION);

	fs.writeFileSync(path.join(DIST, 'index.html'), html, 'utf8');
	fs.unlinkSync(appPath); /* 只做中转，最终产物是单文件 HTML */

	const sizeKb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
	console.log('已生成 lite/index.html（' + sizeKb + ' KB，含内联 JS/CSS，可离线打开）');
}

if (require.main === module) {
	buildLite().catch((err) => {
		console.error('构建失败：', err && err.message ? err.message : err);
		process.exit(1);
	});
}

module.exports = { buildLite };
