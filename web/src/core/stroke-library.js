/**
 * 笔画库（笔画字帖）：17 种基本笔画的矢量剪影（永字八法为骨架 + 折 / 钩类）。
 * 标准版核心模块；lite 无笔画模式，不使用本文件。
 *
 * 命名约定：本文件是「笔画图案库」（stroke library），与 stroke-order.js（汉字笔顺 / 字形数据）
 * 职责互斥，改动共享逻辑时注意不要改错文件。
 *
 * 为什么不用字体渲染：实测 macOS 楷体（Kaiti SC / STKaiti / KaiTi / PingFang）
 * 对 CJK 笔画区（U+31C0–31EF）字形覆盖为 0，只有 一 丨 丿 丶 等 12 字可显示，
 * ㇏ ㇀ ㇆ 等全部缺字形。因此笔画改为自绘矢量：
 * 中心线采样 + 宽度轮廓 → 填充剪影，屏幕（CSS 背景）、打印（同一背景）、
 * PDF（SVG → Image → drawImage）三端同源，与控笔图案（control.js）同架构。
 *
 * 输入别名：内容文本按「最长匹配」切成笔画 token（如「横竖撇捺」「永字八法」句），
 * 单字别名兼容 一 丨 丿 丶 等；未收录字符忽略（与汉字模式一致）。
 */
import { normalize } from './config.js';

const VIEW = 80; /* 视框边长（与字格背景 buildZgSvg 同坐标系） */

const num = (x) => (Math.round(x * 100) / 100).toString();

/* 三次贝塞尔取点（de Casteljau 展开） */
const cubicPoint = (p0, c1, c2, p1, t) => {
	const u = 1 - t;
	const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
	return {
		x: a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0],
		y: a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]
	};
};

/* 中心线采样：首段 { p } 起点，其后 { p } 直线 / { c: [c1, c2], p } 三次贝塞尔。
 * 直线同样细分（8 段），让拐角处两侧法向平滑过渡。 */
const sampleCenterline = (segs) => {
	const pts = [];
	let cur = segs[0].p;
	pts.push({ x: cur[0], y: cur[1] });
	for (let i = 1; i < segs.length; i++) {
		const seg = segs[i];
		if (seg.c) {
			const steps = 16;
			for (let k = 1; k <= steps; k++) {
				const pt = cubicPoint(cur, seg.c[0], seg.c[1], seg.p, k / steps);
				pts.push(pt);
			}
		} else {
			const steps = 8;
			for (let k = 1; k <= steps; k++) {
				const t = k / steps;
				pts.push({ x: cur[0] + (seg.p[0] - cur[0]) * t, y: cur[1] + (seg.p[1] - cur[1]) * t });
			}
		}
		cur = seg.p;
	}
	return pts;
};

/* 宽度轮廓： stops = [[t, width], ...]（t ∈ 0..1，width 为全宽 px），逐段线性插值。
 * 起笔 / 收笔的顿笔与笔锋用宽度鼓包与收尖表达。 */
const profile = (stops) => (t) => {
	if (t <= stops[0][0]) return stops[0][1];
	for (let i = 1; i < stops.length; i++) {
		if (t <= stops[i][0]) {
			const t0 = stops[i - 1][0], w0 = stops[i - 1][1];
			const t1 = stops[i][0], w1 = stops[i][1];
			return w0 + (w1 - w0) * ((t - t0) / (t1 - t0));
		}
	}
	return stops[stops.length - 1][1];
};

/**
 * 中心线点列 + 每点全宽 → 填充轮廓 path（圆头端帽 / 平滑拐角）。
 * 纯函数，供测试与三端绘制共用。
 */
export const outlinePath = (pts, widths) => {
	const n = pts.length;
	if (n < 2) return '';
	const left = [];
	const right = [];
	for (let i = 0; i < n; i++) {
		let dx, dy;
		if (i === 0) { dx = pts[1].x - pts[0].x; dy = pts[1].y - pts[0].y; }
		else if (i === n - 1) { dx = pts[n - 1].x - pts[n - 2].x; dy = pts[n - 1].y - pts[n - 2].y; }
		else { dx = pts[i + 1].x - pts[i - 1].x; dy = pts[i + 1].y - pts[i - 1].y; }
		const len = Math.hypot(dx, dy) || 1;
		const nx = -dy / len, ny = dx / len;
		const hw = Math.max(0, widths[i]) / 2;
		left.push({ x: pts[i].x + nx * hw, y: pts[i].y + ny * hw });
		right.push({ x: pts[i].x - nx * hw, y: pts[i].y - ny * hw });
	}
	/* 端帽半圆扇：从 from 绕端点扫到 to，经过行进方向的远侧（圆头）；
	 * 尖头（宽度 < 0.6）直接连线收尖。 */
	const cap = (tip, from, to, dirX, dirY, r) => {
		if (r < 0.6) return [to];
		const a0 = Math.atan2(from.y - tip.y, from.x - tip.x);
		const a1 = Math.atan2(to.y - tip.y, to.x - tip.x);
		const dirA = Math.atan2(dirY, dirX);
		let d = a1 - a0;
		while (d > Math.PI) d -= Math.PI * 2;
		while (d < -Math.PI) d += Math.PI * 2;
		/* 选择经过远侧方向的扫角方向 */
		const mid = a0 + d / 2;
		const diff = (a, b) => {
			let x = Math.abs(a - b) % (Math.PI * 2);
			return x > Math.PI ? Math.PI * 2 - x : x;
		};
		if (diff(mid, dirA) > Math.PI / 2) d = d > 0 ? d - Math.PI * 2 : d + Math.PI * 2;
		const steps = 10;
		const out = [];
		for (let k = 1; k <= steps; k++) {
			const a = a0 + d * (k / steps);
			out.push({ x: tip.x + r * Math.cos(a), y: tip.y + r * Math.sin(a) });
		}
		return out;
	};

	let dAttr = 'M' + num(left[0].x) + ' ' + num(left[0].y);
	for (let i = 1; i < n; i++) dAttr += 'L' + num(left[i].x) + ' ' + num(left[i].y);
	/* 末端帽：行进方向 = 末段方向 */
	const endR = Math.max(0, widths[n - 1]) / 2;
	cap(pts[n - 1], left[n - 1], right[n - 1], pts[n - 1].x - pts[n - 2].x, pts[n - 1].y - pts[n - 2].y, endR)
		.forEach((p) => { dAttr += 'L' + num(p.x) + ' ' + num(p.y); });
	for (let i = n - 1; i >= 0; i--) dAttr += 'L' + num(right[i].x) + ' ' + num(right[i].y);
	/* 首端帽：行进方向 = 首段方向 */
	const startR = Math.max(0, widths[0]) / 2;
	cap(pts[0], right[0], left[0], pts[1].x - pts[0].x, pts[1].y - pts[0].y, startR)
		.forEach((p) => { dAttr += 'L' + num(p.x) + ' ' + num(p.y); });
	return dAttr + 'Z';
};

/*
 * 笔画定义：中心线（80×80 视框，四周留 15±2 边距）+ 宽度轮廓。
 * width 控制顿笔（鼓包）与笔锋（收尖）。
 */
const DEFS = [
	{ key: 'heng', name: '横', aliases: ['横', '一'], segs: [{ p: [20, 43] }, { c: [[35, 41], [48, 39]], p: [60, 37] }], width: [[0, 8.5], [0.06, 5.5], [0.86, 5.5], [0.94, 6.5], [1, 9.5]] },
	{ key: 'shu', name: '竖', aliases: ['竖', '丨'], segs: [{ p: [40, 17] }, { p: [40, 60] }], width: [[0, 8.5], [0.06, 6.5], [0.82, 6.5], [1, 1]] },
	{ key: 'pie', name: '撇', aliases: ['撇', '丿'], segs: [{ p: [52, 17] }, { c: [[51, 32], [41, 50]], p: [18, 63] }], width: [[0, 8], [0.12, 5.5], [0.6, 3.5], [1, 1]] },
	{ key: 'na', name: '捺', aliases: ['捺', '㇏'], segs: [{ p: [25, 19] }, { c: [[35, 29], [43, 39]], p: [50, 48] }, { c: [[57, 55], [64, 58]], p: [68, 59] }], width: [[0, 2.5], [0.25, 3.5], [0.7, 8], [0.85, 7], [0.93, 9], [1, 2.5]] },
	{ key: 'dian', name: '点', aliases: ['点', '丶'], segs: [{ p: [37, 16] }, { c: [[44, 24], [41, 35]], p: [34, 45] }], width: [[0, 1.2], [0.2, 7], [0.55, 7], [0.85, 3.6], [1, 1]] },
	{ key: 'ti', name: '提', aliases: ['提', '㇀'], segs: [{ p: [22, 53] }, { c: [[36, 44], [48, 31]], p: [58, 19] }], width: [[0, 7.5], [0.12, 5], [0.7, 3.2], [1, 1]] },
	{ key: 'hengzhe', name: '横折', aliases: ['折'], segs: [{ p: [20, 27] }, { p: [50, 27] }, { p: [50, 54] }], width: [[0, 8], [0.06, 5.5], [0.5, 5.5], [0.56, 6], [0.94, 5.5], [1, 7.5]] },
	{ key: 'shugou', name: '竖钩', aliases: ['钩', '亅'], segs: [{ p: [40, 17] }, { p: [40, 52] }, { c: [[40, 58], [35, 60]], p: [30, 57] }], width: [[0, 8], [0.06, 6], [0.82, 6], [0.9, 5], [1, 1.2]] },
	{ key: 'wangou', name: '弯钩', aliases: ['弯'], segs: [{ p: [40, 16] }, { c: [[40, 36], [35, 51]], p: [26, 58] }, { c: [[32, 57], [36, 53]], p: [38, 50] }], width: [[0, 8], [0.06, 5.5], [0.7, 5], [0.88, 4.5], [1, 1.2]] },
	{ key: 'xiegou', name: '斜钩', aliases: ['斜'], segs: [{ p: [26, 18] }, { c: [[40, 30], [52, 44]], p: [60, 56] }, { c: [[63, 60], [60, 62]], p: [56, 57] }], width: [[0, 7], [0.1, 5], [0.75, 6], [0.88, 6.5], [1, 1.5]] },
	{ key: 'wogou', name: '卧钩', aliases: ['卧'], segs: [{ p: [16, 42] }, { c: [[30, 34], [48, 37]], p: [58, 46] }, { c: [[56, 40], [48, 37]], p: [42, 38] }], width: [[0, 2], [0.3, 6], [0.65, 6.5], [0.85, 5.5], [1, 1.5]] },
	{ key: 'duanpie', name: '短撇', aliases: ['啄'], segs: [{ p: [45, 16] }, { c: [[43, 28], [37, 40]], p: [27, 48] }], width: [[0, 7.5], [0.15, 5], [1, 1]] },
	{ key: 'hengpie', name: '横撇', aliases: [], segs: [{ p: [20, 26] }, { p: [44, 26] }, { c: [[38, 38], [28, 50]], p: [16, 58] }], width: [[0, 7.5], [0.05, 5], [0.35, 5], [0.5, 3.6], [0.8, 2.6], [1, 1]] },
	{ key: 'piezhe', name: '撇折', aliases: [], segs: [{ p: [50, 15] }, { c: [[42, 28], [32, 38]], p: [24, 44] }, { c: [[36, 49], [50, 49]], p: [62, 45] }], width: [[0, 7], [0.3, 1.5], [0.4, 5], [0.92, 5], [1, 6.5]] },
	{ key: 'shuwan', name: '竖弯', aliases: [], segs: [{ p: [40, 17] }, { p: [40, 46] }, { c: [[40, 55], [49, 57]], p: [60, 54] }], width: [[0, 8], [0.06, 5.5], [0.68, 5.5], [0.85, 6.5], [1, 7.5]] },
	{ key: 'shuzhe', name: '竖折', aliases: [], segs: [{ p: [40, 17] }, { p: [40, 44] }, { p: [60, 44] }], width: [[0, 8], [0.06, 5.5], [0.52, 5.5], [0.58, 6], [0.94, 5.5], [1, 7.5]] },
	{ key: 'henggou', name: '横钩', aliases: ['乛'], segs: [{ p: [20, 27] }, { p: [50, 27] }, { c: [[55, 30], [57, 35]], p: [57, 40] }], width: [[0, 7.5], [0.05, 5], [0.82, 5], [0.9, 5.5], [1, 1.2]] }
];

export const STROKE_LIBRARY = DEFS.map((d) => ({ key: d.key, name: d.name, aliases: d.aliases.slice() }));
export const STROKE_KEYS = DEFS.map((d) => d.key);
export const STROKE_NAMES = DEFS.reduce((acc, d) => {
	acc[d.key] = d.name;
	return acc;
}, {});

/* token 表：名称 + 单字别名 → key； greedy 最长匹配（名称两字优先于单字） */
const TOKEN_MAP = new Map();
const TOKEN_LENS = new Set();
DEFS.forEach((d) => {
	const tokens = [d.name].concat(d.aliases);
	tokens.forEach((tok) => {
		if (TOKEN_MAP.has(tok)) return; /* 别名冲突时先注册者优先（单字别名不会重复） */
		TOKEN_MAP.set(tok, d.key);
		TOKEN_LENS.add(tok.length);
	});
});
const MATCH_LENS = Array.from(TOKEN_LENS).sort((a, b) => b - a);

/* 单个字符 → key（兼容旧调用 / 调试）；未收录返回 null */
export const strokeKeyFor = (char) => TOKEN_MAP.get(String(char)) || null;

/* 在 parts（码点数组）的 i 处匹配笔画 token：优先最长；命中返回 { key, len}，否则 null */
export const matchStrokeToken = (parts, i) => {
	for (let li = 0; li < MATCH_LENS.length; li++) {
		const len = MATCH_LENS[li];
		if (i + len > parts.length) continue;
		const tok = parts.slice(i, i + len).join('');
		const key = TOKEN_MAP.get(tok);
		if (key) return { key, len };
	}
	return null;
};

/* 轮廓 path 缓存：key → path d（面板缩略图 / 屏幕 / PDF 共用真源） */
const pathCache = new Map();
export const strokePath = (key) => {
	if (pathCache.has(key)) return pathCache.get(key);
	const def = DEFS.find((d) => d.key === key);
	if (!def) return '';
	const pts = sampleCenterline(def.segs);
	const widthFn = profile(def.width);
	const widths = pts.map((_, i) => widthFn(i / (pts.length - 1)));
	const d = outlinePath(pts, widths);
	pathCache.set(key, d);
	return d;
};

/* 笔画 SVG：填充剪影；role='blank' 返回空串（不画）。 */
export const buildStrokeSvg = (key, color, role) => {
	if (role === 'blank') return '';
	const d = strokePath(key);
	if (!d) return '';
	const fill = color || '#000000';
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW}" height="${VIEW}" viewBox="0 0 ${VIEW} ${VIEW}" style="overflow:visible">`
		+ `<path d="${d}" fill="${fill}"/>`
		+ `</svg>`;
};

const uriCache = new Map();

/* data URI（PDF drawImage / 调试用） */
export const strokeDataUri = (key, color, role) => {
	if (role === 'blank') return null;
	const ck = `${key}|${color}|${role}`;
	if (!uriCache.has(ck)) {
		uriCache.set(ck, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildStrokeSvg(key, color, role)));
	}
	return uriCache.get(ck);
};

/* CSS 背景（屏幕预览 / 打印）：与 buildZgSvg 同风格的 url(...)，缓存复用 */
export const getStrokeBackground = (key, color, role) => {
	if (role === 'blank') return null;
	const ck = `${key}|${color}|${role}`;
	if (!uriCache.has(ck)) {
		uriCache.set(ck, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildStrokeSvg(key, color, role)));
	}
	return `url('${uriCache.get(ck)}')`;
};

/* 归一化笔画 key（非法值回退默认首项「横」） */
export const normalizeStrokeKey = (value) => normalize(value, STROKE_KEYS, STROKE_KEYS[0]);
