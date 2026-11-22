/**
 * 字格背景：根据样式与颜色生成 SVG data URI，同组合缓存复用。
 * 标准版核心模块；lite 使用独立副本（lite-src/vendor/，逻辑同源、语法风格有意不同步）。
 */
import { DEFAULTS, ZG_COLOR_VALUES, ZG_TYPES, ZG_COLORS, ZG_LINE_MODES, normalize } from './config.js';

const num = (x) => (Math.round(x * 100) / 100).toString();

export const buildZgSvg = (type, colorKey, lineScale, lineMode) => {
	const color = ZG_COLOR_VALUES[colorKey] || ZG_COLOR_VALUES[DEFAULTS.ZgColor];
	/* 线宽倍率 ×100（0 / 缺省 = 1）；外框样式 solid / dashed / none */
	const scale = lineScale > 0 ? Math.max(0.5, Math.min(2, lineScale / 100)) : 1;
	const mode = normalize(lineMode, ZG_LINE_MODES, DEFAULTS.ZgLineMode);
	const w1 = num(scale);
	const dashed = `stroke-dasharray="4,4" stroke-width="${w1}" stroke="${color.line}" fill="none"`;
	const solid = `stroke-width="${w1}" stroke="${color.line}" fill="none"`;
	const paths = [];
	let w = 80, h = 80;

	/* 田字格 */
	if (type === '1' || type === '2' || type === '3') {
		paths.push(`<path d="M0 40 L80 40" ${dashed}/>`);
		paths.push(`<path d="M40 0 L40 80" ${dashed}/>`);
	}
	/* 拼音格：1 格宽 × 1.4 格高——上区四线三格（上下实线、中间两虚线），
	 * 顶线由外框顶边充当（y=0）、末线与下区田字格顶边共用（y=32）；
	 * 下区 1.0 格正方形田字格（32..112），底边 / 左右边由外框充当，上下拼接成一体。
	 * 四线是格线的一部分，屏幕预览与字帖（打印 / PDF）一致；预览另在上区叠加拼音文字。 */
	if (type === '5') {
		w = 80;
		h = 112;
		/* 上区 0.4 格（32/80）：四线等距（间距 32/3），顶线 = 外框顶边 */
		const y1 = (32 / 3).toFixed(2), y2 = (64 / 3).toFixed(2);
		[y1, y2].forEach((y) => {
			paths.push(`<path d="M1 ${y} L79 ${y}" ${dashed}/>`);
		});
		paths.push(`<path d="M1 32 L79 32" ${solid}/>`);
		paths.push(`<path d="M40 32 L40 112" ${dashed}/>`);
		paths.push(`<path d="M0 72 L80 72" ${dashed}/>`);
	}
	if (type === '2' || type === '3') {
		paths.push(`<path d="M0 0 L80 80" ${dashed}/>`);
		paths.push(`<path d="M0 80 L80 0" ${dashed}/>`);
	}
	if (type === '6') {
		/* 作文格 = 作文纸：纯方格，无内部线（一格一字，标点占格） */
	}
	if (type === '7') {
		/* 数字格 = 数学本：横线格，一条横虚线作基线（下 1/3，字占上 2/3） */
		paths.push(`<path d="M1 53 L79 53" ${dashed}/>`);
	}
	/* 外框：拼音格线多，用细边框与内部线统一；其余字格用 2× 凸显边界。
	 * 粗细随线宽倍率；样式 solid 实线 / dashed 虚线 / none 无框（由配置控制）。 */
	if (mode !== 'none') {
		const borderW = num((type === '5' ? 1 : 2) * scale);
		const frame = mode === 'dashed'
			? `stroke-dasharray="4,4" stroke-width="${borderW}" stroke="${color.border}" fill="none"`
			: `stroke-width="${borderW}" stroke="${color.border}" fill="none"`;
		paths.push(`<path d="M0 0 L${w} 0 L${w} ${h} L0 ${h} Z" ${frame}/>`);
	}
	if (type === '3' || type === '4') {
		paths.push(`<path d="M20 10 L60 10 L60 70 L20 70 Z" ${dashed}/>`);
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow:visible">${paths.join('')}</svg>`;
};

const cache = {};

/* 字格背景：type5 上区四线三格 + 下区田字格，屏幕预览与字帖（打印 / PDF）一致。
 * lineScale / lineMode 影响线宽与外框样式（默认 1 / solid，与旧版一致）。 */
export const getZgBackground = (type, colorKey, lineScale, lineMode) => {
	type = normalize(type, ZG_TYPES, DEFAULTS.ZgType);
	colorKey = normalize(colorKey, ZG_COLORS, DEFAULTS.ZgColor);
	const scale = lineScale > 0 ? Math.max(0.5, Math.min(2, lineScale / 100)) : 1;
	const mode = normalize(lineMode, ZG_LINE_MODES, DEFAULTS.ZgLineMode);
	const key = `${type}|${colorKey}|${scale}|${mode}`;
	if (!cache[key]) {
		const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildZgSvg(type, colorKey, scale * 100, mode));
		cache[key] = `url('${uri}')`;
	}
	return cache[key];
};
