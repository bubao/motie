/**
 * 本地服务：静态服务 dist/，并提供字体目录清单 / 上传 / 删除。
 * 用途：Kindle 等老浏览器打开 lite 版时，从服务端 font/ 获取字体（网络字体列表）。
 * 零依赖（Node 内置 http/fs/path/os），mac / linux / win 通用。
 * 模块格式沿用项目 tools/ 的 CommonJS（package.json 无 type 字段），语法用 ES6+。
 *
 * 接口：
 *   GET    /api/fonts        → { fonts: [{name,file,size,url}] }
 *   POST   /api/fonts        → 头 X-Filename，raw body 写入 dist/font/
 *   DELETE /api/fonts/<file> → 删除 dist/font/ 下文件
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.ico': 'image/x-icon',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2'
};

const FONT_EXT = ['.ttf', '.otf', '.woff', '.woff2'];
const MAX_FONT_SIZE = 20 * 1024 * 1024;

const fontExt = (file) => path.extname(String(file)).toLowerCase();

const decodeHeader = (value) => {
	const raw = String(value || '');
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
};

/* 文件名清洗：去路径、限 ASCII（老浏览器 / @font-face 对非 ASCII 路径支持差），扩展名白名单 */
const sanitizeFile = (name) => {
	let base = path.basename(String(name || ''));
	base = base.replace(/[\x00-\x1f\\/:*?"<>|]/g, '_').trim();
	if (!base || base === '.' || base === '..') return null;
	base = base.slice(0, 80);
	if (!/^[A-Za-z0-9._-]+$/.test(base)) return null;
	const ext = fontExt(base);
	if (!FONT_EXT.includes(ext)) return null;
	if (base.length <= ext.length) return null;
	return base;
};

/* 显示名（可含中文）：存 sidecar，列表展示用 */
const sanitizeLabel = (value) => String(value || '').trim().slice(0, 30);

const toFontItem = (file, size) => {
	const ext = fontExt(file);
	return {
		name: file.slice(0, file.length - ext.length),
		file,
		size,
		url: '/font/' + encodeURIComponent(file)
	};
};

const listFonts = (fontDir) => {
	let entries;
	try {
		entries = fs.readdirSync(fontDir);
	} catch {
		return [];
	}
	return entries
		.filter((file) => FONT_EXT.includes(fontExt(file)))
		.map((file) => {
			const full = path.join(fontDir, file);
			let stat;
			try {
				stat = fs.statSync(full);
			} catch {
				return null;
			}
			if (!stat.isFile()) return null;
			const item = toFontItem(file, stat.size);
			try {
				const label = fs.readFileSync(full + '.label', 'utf8').trim();
				if (label) item.name = label;
			} catch { /* 无 sidecar 时用文件名 */ }
			return item;
		})
		.filter(Boolean)
		.sort((a, b) => a.file.localeCompare(b.file));
};

/* 局域网地址过滤（P2-12）：挂 VPN / 代理 TUN 时会枚举出隧道地址，手机照连失败。
 * 只保留可用私网 / 常规地址，剔除保留段与隧道段；RFC1918 私网优先排序。 */
const IPV4_EXCLUDED = [
	[100, 64, 0, 0, 10],     /* CGNAT */
	[198, 18, 0, 0, 15],     /* 基准测试保留段（常见 TUN 段） */
	[192, 0, 2, 0, 24],      /* TEST-NET-1 */
	[198, 51, 100, 0, 24],   /* TEST-NET-2 */
	[203, 0, 113, 0, 24],    /* TEST-NET-3 */
	[169, 254, 0, 0, 16],    /* 链路本地 */
	[127, 0, 0, 0, 8]        /* 环回 */
];

const IPV4_PRIVATE = [
	[10, 0, 0, 0, 8],
	[172, 16, 0, 0, 12],
	[192, 168, 0, 0, 16]
];

const ipToInt = (ip) => {
	const parts = String(ip || '').split('.');
	if (parts.length !== 4) return null;
	let n = 0;
	for (const p of parts) {
		const v = Number(p);
		if (!Number.isInteger(v) || v < 0 || v > 255) return null;
		n = (n << 8) + v;
	}
	return n >>> 0;
};

const inCidr = (ip, net, prefix) => {
	const ipInt = ipToInt(ip);
	const netInt = ipToInt(net.join('.'));
	if (ipInt == null || netInt == null) return false;
	const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
	return (ipInt & mask) === (netInt & mask);
};

const isPrivate = (ip) => IPV4_PRIVATE.some(([a, b, c, d, prefix]) => inCidr(ip, [a, b, c, d], prefix));
const isExcluded = (ip) => IPV4_EXCLUDED.some(([a, b, c, d, prefix]) => inCidr(ip, [a, b, c, d], prefix));

const filterLanIPs = (interfaces) => {
	const out = [];
	for (const [name, list] of Object.entries(interfaces || {})) {
		for (const info of list || []) {
			if (!info || info.family !== 'IPv4' || info.internal) continue;
			if (isExcluded(info.address)) continue;
			out.push({ name, address: info.address, private: isPrivate(info.address) });
		}
	}
	out.sort((a, b) => (b.private - a.private) || a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
	return out;
};

const lanIPs = () => filterLanIPs(os.networkInterfaces());

const sendJson = (res, code, data) => {
	res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
	res.end(JSON.stringify(data));
};

const createServer = (opts = {}) => {
	const root = path.resolve(opts.root || path.join(__dirname, '..', 'dist'));
	const fontDir = path.resolve(opts.fontDir || path.join(root, 'font'));
	const maxFont = opts.maxFont || MAX_FONT_SIZE;

	const safeStaticPath = (urlPath) => {
		let decoded;
		try {
			decoded = decodeURIComponent(urlPath);
		} catch {
			return null;
		}
		let rel = decoded.split('?')[0].split('#')[0];
		if (rel === '/' || rel === '') rel = '/index.html';
		const full = path.normalize(path.join(root, rel));
		if (full !== root && !full.startsWith(root + path.sep)) return null;
		return full;
	};

	const serveStatic = (req, res, pathname) => {
		const full = safeStaticPath(pathname);
		if (!full) {
			res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end('Forbidden');
			return;
		}
		fs.stat(full, (err, stat) => {
			const target = !err && stat.isDirectory() ? path.join(full, 'index.html') : full;
			fs.readFile(target, (err2, buf) => {
				if (err2) {
					res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
					res.end('Not Found');
					return;
				}
				res.writeHead(200, {
					'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
					'Cache-Control': 'no-cache'
				});
				res.end(req.method === 'HEAD' ? undefined : buf);
			});
		});
	};

	const readBody = (req, limit) => new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		let done = false;
		const fail = (code, msg) => {
			if (done) return;
			done = true;
			reject({ code, msg });
			req.resume();
		};
		req.on('data', (chunk) => {
			if (done) return;
			size += chunk.length;
			if (size > limit) {
				fail(413, '字体超过 20MB 上限。');
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => {
			if (done) return;
			done = true;
			resolve(Buffer.concat(chunks));
		});
		req.on('error', () => fail(400, '读取请求失败。'));
	});

	const server = http.createServer((req, res) => {
		let urlPath;
		try {
			urlPath = new URL(req.url, 'http://' + (req.headers.host || 'localhost')).pathname || '/';
		} catch {
			res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end('Bad Request');
			return;
		}

		if (urlPath === '/api/fonts' && req.method === 'GET') {
			sendJson(res, 200, { fonts: listFonts(fontDir) });
			return;
		}

		if (urlPath === '/api/fonts' && req.method === 'POST') {
			const file = sanitizeFile(decodeHeader(req.headers['x-filename']));
			if (!file) {
				req.resume();
				sendJson(res, 400, { error: '文件名或扩展名无效（仅 .ttf/.otf/.woff/.woff2）。' });
				return;
			}
			readBody(req, maxFont).then((buf) => {
				if (!buf.length) {
					sendJson(res, 400, { error: '字体文件为空。' });
					return;
				}
				fs.mkdirSync(fontDir, { recursive: true });
				fs.writeFile(path.join(fontDir, file), buf, (err) => {
					if (err) {
						sendJson(res, 500, { error: '写入字体目录失败。' });
						return;
					}
					const label = sanitizeLabel(decodeHeader(req.headers['x-label']));
					const labelFile = path.join(fontDir, file) + '.label';
					const finish = () => sendJson(res, 200, { font: Object.assign(toFontItem(file, buf.length), label ? { name: label } : {}) });
					if (label) {
						fs.writeFile(labelFile, label, 'utf8', finish);
					} else {
						try { fs.unlinkSync(labelFile); } catch { /* 无 sidecar */ }
						finish();
					}
				});
			}, (e) => {
				res.writeHead(e.code || 400, { 'Content-Type': 'application/json; charset=utf-8' });
				res.end(JSON.stringify({ error: e.msg }));
			});
			return;
		}

		if (urlPath.startsWith('/api/fonts/') && req.method === 'DELETE') {
			let name = null;
			try {
				name = sanitizeFile(decodeURIComponent(urlPath.slice('/api/fonts/'.length)));
			} catch {
				name = null;
			}
			if (!name) {
				sendJson(res, 400, { error: '文件名或扩展名无效。' });
				return;
			}
			const target = path.join(fontDir, name);
			if (!target.startsWith(fontDir + path.sep)) {
				sendJson(res, 403, { error: '禁止访问。' });
				return;
			}
			fs.unlink(target, (err) => {
				if (err) {
					sendJson(res, 404, { error: '文件不存在。' });
					return;
				}
				try { fs.unlinkSync(target + '.label'); } catch { /* 无 sidecar */ }
				sendJson(res, 200, { ok: true });
			});
			return;
		}

		if (req.method !== 'GET' && req.method !== 'HEAD') {
			res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end('Method Not Allowed');
			return;
		}
		serveStatic(req, res, urlPath);
	});

	return {
		server,
		root,
		fontDir,
		listen: (port, host) => new Promise((resolve, reject) => {
			server.once('error', reject);
			server.listen(port, host, () => resolve(server.address()));
		})
	};
};

const start = async (opts = {}) => {
	const port = Number(opts.port || process.env.PORT || 8080);
	const host = opts.host || '0.0.0.0';
	const app = createServer(opts);
	const addr = await app.listen(port, host);
	const lines = ['墨帖服务已启动（端口 ' + addr.port + '）：'];
	lines.push('  标准版： http://127.0.0.1:' + addr.port + '/index.html');
	lines.push('  Kindle： http://127.0.0.1:' + addr.port + '/lite/index.html');
	for (const ip of lanIPs()) {
		lines.push('  局域网： http://' + ip.address + ':' + addr.port + '/lite/index.html（' + ip.name + '）');
	}
	lines.push('  字体目录： ' + app.fontDir + '（发布或放入字体后，Kindle 版刷新可见）');
	console.log(lines.join('\n'));
	return app;
};

module.exports = {
	createServer,
	start,
	sanitizeFile,
	listFonts,
	lanIPs,
	filterLanIPs,
	MIME,
	MAX_FONT_SIZE
};

if (require.main === module) {
	start().catch((err) => {
		console.error('启动失败：', err && err.message ? err.message : err);
		process.exit(1);
	});
}
