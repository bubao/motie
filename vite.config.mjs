import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(ROOT, 'font');
/* 版本号唯一来源：package.json。构建时注入产物（meta + 全局常量），保持幂等（不含时间戳） */
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const FONT_MIME = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' };

/** 产物注入版本号（package.json）：head 加 meta，供排查用户反馈时确认版本 */
function versionMetaPlugin() {
	return {
		name: 'zitie-version-meta',
		transformIndexHtml(html) {
			return html.replace('</head>', '<meta name="zitie-version" content="' + VERSION + '"></head>');
		}
	};
}

/**
 * dev 下把项目根 font/ 服务到 /font/*：与 dist/font 结构一致，
 * 避免相对地址（font/1.ttf）被 Vite SPA fallback 成 index.html 导致字体加载失败。
 */
function fontStaticPlugin() {
	return {
		name: 'zitie-font-static',
		configureServer(server) {
			server.middlewares.use('/font', function (req, res, next) {
				var rel = decodeURIComponent((req.url || '/').split('?')[0]);
				var file = path.normalize(path.join(FONT_DIR, rel));
				if (file.indexOf(FONT_DIR + path.sep) !== 0) { next(); return; }
				fs.readFile(file, function (err, buf) {
					if (err) { next(); return; }
					res.setHeader('Content-Type', FONT_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
					res.setHeader('Cache-Control', 'no-cache');
					res.end(buf);
				});
			});
		}
	};
}

/**
 * 完整版（React）构建配置，两种产物由环境变量 ZITIE_SINGLEFILE 切换：
 *   npm run build:react → dist-react/（多文件，http 部署，资源分包）
 *   npm run build      → dist/（单文件，file:// 直开；tools/build.js 设置 ZITIE_SINGLEFILE=1）
 * base 用相对路径，单文件与子目录部署均可用。
 */
const singlefile = process.env.ZITIE_SINGLEFILE === '1';

export default defineConfig({
	root: 'web',
	base: './',
	plugins: [react(), tailwindcss(), fontStaticPlugin(), versionMetaPlugin(), ...(singlefile ? [viteSingleFile()] : [])],
	resolve: {
		alias: { '@': path.resolve(ROOT, 'web/src') }
	},
	define: { __ZITIE_VERSION__: JSON.stringify(VERSION) },
	server: {
		port: 5173,
		host: '127.0.0.1',
		fs: { allow: ['..'] }
	},
	build: {
		outDir: singlefile ? '../dist' : '../dist-react',
		emptyOutDir: true
	}
});
