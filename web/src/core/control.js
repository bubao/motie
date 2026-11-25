/**
 * 控笔练习图案（C1）：把预置控笔图案生成为 SVG data URI，
 * 屏幕（CSS 多层背景）、打印（同一背景随 CSS 输出）与 PDF（canvas drawImage）三端同源。
 * 标准版核心模块；lite 使用独立副本（lite-src/vendor/，逻辑同源、语法风格有意不同步）。
 *
 * 图案绘制在 80×80 视框内（与字格背景 buildZgSvg 同坐标系），叠加在字格背景之上。
 * role ∈ model | trace | blank：范字实线深色、描红虚线浅色、空临格不画图案。
 * 空间利用（参考 z2h.cn 控笔库）：图案以「同一笔画元素的重复 / 阵列」填满格子
 * （主体 10–70，与字格外框保留宽松间隙，不贴边）；直线类为平行线组、闭合类为 2×2
 * 阵列或品字多圆、曲线类为多条平行重复，不做单个小图形。
 */
import { DEFAULTS, CONTROL_PATTERN_KEYS, normalize } from './config.js';

const num = (x) => (Math.round(x * 100) / 100).toString();

/* 螺旋：极坐标采样为折线（2.25 圈，半径 2→rMax），圆心与最大半径可调。 */
const spiralD = (cx, cy, rMax, turns = 2.25, steps = 72) => {
	let d = '';
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const a = t * turns * Math.PI * 2;
		const r = 2 + t * (rMax - 2);
		d += (i === 0 ? 'M' : 'L') + num(cx + r * Math.cos(a)) + ' ' + num(cy + r * Math.sin(a));
	}
	return d;
};

/* 路径平移：逐命令解析参数，只移动坐标（弧仅移端点，保留半径 / 旗标）。 */
const translatePath = (d, dx, dy) => {
	const tok = d.match(/[MLHVCZA]|-?\d+(?:\.\d+)?/g);
	let out = '', i = 0, cmd = '';
	while (i < tok.length) {
		if (/^[MLHVCZA]$/.test(tok[i])) { cmd = tok[i++]; out += cmd; continue; }
		let s;
		if (cmd === 'H') { s = num(Number(tok[i]) + dx); i += 1; }
		else if (cmd === 'V') { s = num(Number(tok[i]) + dy); i += 1; }
		else if (cmd === 'A') {
			s = tok.slice(i, i + 7).map((v, idx) => (idx === 5 || idx === 6) ? num(Number(v) + (idx === 5 ? dx : dy)) : v).join(' ');
			i += 7;
		} else {
			const pairs = cmd === 'C' ? 3 : 1;
			const parts = [];
			for (let k = 0; k < pairs; k++) {
				parts.push(num(Number(tok[i]) + dx), num(Number(tok[i + 1]) + dy));
				i += 2;
			}
			s = parts.join(' ');
		}
		out += ' ' + s;
	}
	return out;
};

/* 2×2 阵列：以 (dx,dy) 为列 / 行间距生成四份平移副本。 */
const quad = (d, dx, dy) => d
	+ ' ' + translatePath(d, dx, 0)
	+ ' ' + translatePath(d, 0, dy)
	+ ' ' + translatePath(d, dx, dy);

/* 图案路径库：80×80 视框，导出供面板画缩略图（真源唯一）。
 * 排布策略（参考 z2h.cn）：同一笔画元素重复填满格子——直线类为平行线组，
 * 闭合类为 2×2 阵列 / 品字多圆，曲线类为多条平行重复，同心弧 / 同心圆为多层嵌套。
 * 2×2 单元统一放在左上 24×24 区域（11–35）、间距 34，副本平移到 (45–69)。
 * 整圆用两段半弧（起终点重合会使单段弧退化消失）；闭合图形用 Z。 */
const DASH_H = 'M10 20 H18 M23 20 H31 M36 20 H44 M49 20 H57 M62 20 H70';
const DASH_V = 'M20 10 V18 M20 23 V31 M20 36 V44 M20 49 V57 M20 62 V70';
export const CONTROL_PATHS = {
	/* 直线组：平行线重复（各占满一个方向）。 */
	'line-h': 'M10 11 H70 M10 22 H70 M10 33 H70 M10 44 H70 M10 55 H70 M10 66 H70',
	'line-v': 'M11 10 V70 M22 10 V70 M33 10 V70 M44 10 V70 M55 10 V70 M66 10 V70',
	'line-slash': 'M10 22 L22 10 M10 36 L36 10 M10 50 L50 10 M10 64 L64 10',
	'line-backslash': 'M16 10 L70 64 M30 10 L70 50 M44 10 L70 36 M58 10 L70 22',
	/* 波浪：三条平行波（每 10 宽一个半波，波幅 ±10），波线相接成帘。 */
	'wave': (() => {
		const b = 'M10 20 C13 10 17 10 20 20 C23 30 27 30 30 20 C33 10 37 10 40 20 C43 30 47 30 50 20 C53 10 57 10 60 20 C63 30 67 30 70 20';
		return b + ' ' + translatePath(b, 0, 20) + ' ' + translatePath(b, 0, 40);
	})(),
	'teeth': 'M10 58 L20 22 L30 58 L40 22 L50 58 L60 22 L70 58',
	'zigzag': 'M10 70 L25 10 L40 70 L55 10 L70 70',
	/* S 形：两条并排（左 10–40、右 40–70），竖向双弯。 */
	's-curve': 'M10 12 C40 12 40 40 25 40 C10 40 10 68 40 68 M40 12 C70 12 70 40 55 40 C40 40 40 68 70 68',
	'spiral': spiralD(40, 40, 30),
	/* 十字：2×2 四个十字（单元中心 23 / 57，臂长 10）。 */
	'cross': quad('M23 13 V33 M13 23 H33', 34, 34),
	/* 交叉线：2×2 四个 X（对角交叉）。 */
	'cross-diag': quad('M11 11 L35 35 M35 11 L11 35', 34, 34),
	/* T 形：2×2 四个 T。 */
	'tee': quad('M11 15 H35 M23 15 V35', 34, 34),
	/* 高低竖线：底部对齐，长度从左到右递增（像琴键升起）。 */
	'bars': 'M17 46 V70 M40 28 V70 M63 10 V70',
	/* 断续横 / 竖线：各三条平行线，每条五段等距短划（段长 8、间隔 5）。 */
	'dash-h': DASH_H + ' ' + translatePath(DASH_H, 0, 20) + ' ' + translatePath(DASH_H, 0, 40),
	'dash-v': DASH_V + ' ' + translatePath(DASH_V, 20, 0) + ' ' + translatePath(DASH_V, 40, 0),
	'steps': 'M10 70 H25 V55 H40 V40 H55 V25 H70',
	/* 同心弧组：三条共圆心半弧（彩虹 / 桥洞状），半径 12 / 21 / 30，填满格高。 */
	'arc': 'M28 40 A12 12 0 0 0 52 40 M19 40 A21 21 0 0 0 61 40 M10 40 A30 30 0 0 0 70 40',
	'arch': 'M28 40 A12 12 0 0 1 52 40 M19 40 A21 21 0 0 1 61 40 M10 40 A30 30 0 0 1 70 40',
	/* 圆圈：品字形三圆（上一下二）。 */
	'circle': 'M40 10 A15 15 0 0 1 40 40 A15 15 0 0 1 40 10 M23 42 A13 13 0 0 1 23 68 A13 13 0 0 1 23 42 M57 42 A13 13 0 0 1 57 68 A13 13 0 0 1 57 42',
	/* 方框 / 回字：2×2 阵列（单元 26×26，间隙 8）。 */
	'square': quad('M10 10 H36 V36 H10 Z', 34, 34),
	'square-in': quad('M10 10 H36 V36 H10 Z M17 17 H29 V29 H17 Z', 34, 34),
	'spiral-square': 'M10 10 H70 V70 H25 V25 H55 V55 H40 V40',
	/* 菱形：2×2 四个菱形。 */
	'diamond': quad('M23 11 L35 23 L23 35 L11 23 Z', 34, 34),
	/* 沙漏：2×2 四个对顶双三角。 */
	'hourglass': quad('M11 11 H35 L23 23 Z M11 35 H35 L23 23 Z', 34, 34),
	/* 三角：2×2 四个三角形。 */
	'triangle': quad('M23 11 L35 35 H11 Z', 34, 34),
	/* 同心圆：四圈（半径 30 / 22 / 14 / 6）。 */
	'circle-in': 'M40 10 A30 30 0 0 1 40 70 A30 30 0 0 1 40 10 M40 18 A22 22 0 0 1 40 62 A22 22 0 0 1 40 18 M40 26 A14 14 0 0 1 40 54 A14 14 0 0 1 40 26 M40 34 A6 6 0 0 1 40 46 A6 6 0 0 1 40 34',
	/* 圆点：天然小，2×2 四个大点（中心 21 / 59，半径 11）。 */
	'dot': quad('M21 10 A11 11 0 0 1 21 32 A11 11 0 0 1 21 10', 38, 38)
};

/* 图案 SVG：color 为 CSS 颜色串（rgba/hex），role 决定线型；blank 返回空串。 */
export const buildControlSvg = (pattern, color, role) => {
	if (role === 'blank') return '';
	const key = normalize(pattern, CONTROL_PATTERN_KEYS, DEFAULTS.ControlPattern);
	const d = CONTROL_PATHS[key] || CONTROL_PATHS[DEFAULTS.ControlPattern];
	const stroke = color || '#000000';
	const dash = role === 'trace' ? 'stroke-dasharray="5,4"' : '';
	return `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80" style="overflow:visible">`
		+ `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" ${dash}/>`
		+ `</svg>`;
};

const cache = {};

/* 图案背景：与 buildZgSvg 同风格的 SVG data URI，供 CSS background-image 叠加（多层背景上层）。
 * 同组合（图案 / 颜色 / 角色）缓存复用；blank 返回 null（不叠加）。 */
export const getControlBackground = (pattern, color, role) => {
	if (role === 'blank') return null;
	const key = `${pattern}|${color}|${role}`;
	if (!cache[key]) {
		const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildControlSvg(pattern, color, role));
		cache[key] = `url('${uri}')`;
	}
	return cache[key];
};
