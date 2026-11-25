/**
 * 字格背景：根据样式与颜色生成 SVG data URI，同组合缓存复用。
 * 标准版核心模块；lite 使用独立副本（lite-src/vendor/，逻辑同源、语法风格有意不同）。
 *
 * 绘制参数（opts）由 config.resolveZgOptions 从配置派生，本模块只做纯绘制：
 * - lineColor / borderColor：内部线色 / 外框色；opacity 烘焙进颜色（兼容老浏览器）
 * - innerMode / borderMode：solid 实线 / dashed 虚线 / none 不画
 * - lineScale / borderScale：线宽倍数（0.25–3 / 0.5–3）
 * - dashStyle / dashDensity：虚线形态（划线 / 圆点 / 点划线）与密度倍数
 * - lineCap：线端样式（butt / round / square）；crisp：细线锐利
 * - innerRatio / engMid / pinyinTop / baselinePos：格型内部比例（见各分支注释）
 * - startDot：起笔点标记（左上 1/4 处圆点）
 */
import { DEFAULTS, ZG_COLOR_VALUES, ZG_TYPES, ZG_LINE_MODES, normalize } from './config.js';

const num = (x) => (Math.round(x * 100) / 100).toString();

/* #rrggbb + 不透明度 → rgba()；不透明度 1 时保持 hex 原样 */
const withAlpha = (hex, alpha) => {
	if (alpha >= 1) return hex;
	const h = String(hex).replace('#', '');
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + num(alpha) + ')';
};

/* 裸调时的有限数校验（resolveZgOptions 已收敛，这里兜底） */
const positive = (x, fallback) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : fallback);

/* 线的 style 属性：mode solid / dashed（含虚线形态与密度）；none 返回 null */
function strokeAttrs(color, width, mode, dashStyle, dashDensity, lineCap) {
	if (mode === 'none') return null;
	/* dasharray 在前，与旧版属性顺序一致 */
	let attrs = '';
	if (mode === 'dashed') {
		if (dashStyle === 'dot') {
			attrs += 'stroke-dasharray="0.1,' + num(5.5 * dashDensity) + '" stroke-linecap="round" ';
		} else if (dashStyle === 'dashdot') {
			attrs += 'stroke-dasharray="' + num(8 * dashDensity) + ',' + num(3 * dashDensity) + ',' + num(1 * dashDensity) + ',' + num(3 * dashDensity) + '" ';
		} else {
			attrs += 'stroke-dasharray="' + num(4 * dashDensity) + ',' + num(4 * dashDensity) + '" ';
		}
	}
	/* butt 是 SVG 默认值，不输出（保持旧渲染逐字符一致）；圆点虚线恒 round */
	if (lineCap && lineCap !== 'butt' && dashStyle !== 'dot') {
		attrs += 'stroke-linecap="' + lineCap + '" ';
	}
	attrs += 'stroke-width="' + num(width) + '" stroke="' + color + '" fill="none"';
	return attrs;
}

export const buildZgSvg = (opts) => {
	opts = opts || {};
	const type = normalize(opts.type, ZG_TYPES, DEFAULTS.ZgType);
	const preset = ZG_COLOR_VALUES[DEFAULTS.ZgColor];
	const opacity = Number.isFinite(Number(opts.opacity)) && Number(opts.opacity) > 0 ? Math.min(1, Number(opts.opacity)) : 1;
	const lineColor = withAlpha(opts.lineColor || preset.line, opacity);
	const borderColor = withAlpha(opts.borderColor || preset.border, opacity);
	const innerMode = normalize(opts.innerMode, ZG_LINE_MODES, DEFAULTS.ZgInnerLineMode);
	const borderMode = normalize(opts.borderMode, ZG_LINE_MODES, DEFAULTS.ZgLineMode);
	const dashStyle = normalize(opts.dashStyle, ['dash', 'dot', 'dashdot'], DEFAULTS.ZgDashStyle);
	const dashDensity = positive(opts.dashDensity, 1);
	const lineCap = normalize(opts.lineCap, ['butt', 'round', 'square'], DEFAULTS.ZgLineCap);
	const crisp = opts.crisp === true;
	/* 格型内部比例（均为百分比 / ×300，见各分支注释） */
	const innerRatio = positive(opts.innerRatio, 25);
	const engMid = positive(opts.engMid, 100);
	const pinyinTop = positive(opts.pinyinTop, 29);
	const baselinePos = positive(opts.baselinePos, 66);
	const startDot = opts.startDot === true;
	/* 内部线宽 = lineScale；外框宽 = 内部线宽 × borderScale（borderScale 已按类型解析，缺省 2） */
	const lineW = positive(opts.lineScale, 1);
	const borderRatio = positive(opts.borderScale, type === '5' ? 1 : 2);

	const paths = [];
	let w = 80, h = 80;

	const inner = (d) => {
		const attrs = strokeAttrs(lineColor, lineW, innerMode, dashStyle, dashDensity, lineCap);
		if (attrs) paths.push('<path d="' + d + '" ' + attrs + '/>');
	};
	const border = (d) => {
		const attrs = strokeAttrs(borderColor, lineW * borderRatio, borderMode, dashStyle, dashDensity, lineCap);
		if (attrs) paths.push('<path d="' + d + '" ' + attrs + '/>');
	};
	/* 结构实线（不受内部线样式影响的骨架线，如拼音格上区末线）：恒实线 */
	const fixed = (d, color, width) => {
		paths.push('<path d="' + d + '" stroke-width="' + num(width) + '" stroke="' + color + '" fill="none"/>');
	};

	/* 田字格 / 米字格 / 米字回字：十字 */
	if (type === '1' || type === '2' || type === '3') {
		inner('M0 40 L80 40');
		inner('M40 0 L40 80');
	}
	if (type === '2' || type === '3') {
		inner('M0 0 L80 80');
		inner('M0 80 L80 0');
	}
	/* 回字内框：水平留白 = 格宽 × innerRatio%，垂直留白取其一半（25% 时与旧版一致） */
	if (type === '3' || type === '4') {
		const mx = w * innerRatio / 100, my = mx / 2;
		inner('M' + num(mx) + ' ' + num(my) + ' L' + num(w - mx) + ' ' + num(my) + ' L' + num(w - mx) + ' ' + num(h - my) + ' L' + num(mx) + ' ' + num(h - my) + ' Z');
	}
	/* 拼音格：1 格宽 × 1.4 格高——上区四线三格（顶/末线实线，中间两虚线），
	 * 下区 1.0 格正方形田字格（top..112），底边 / 左右边由外框充当，上下拼接成一体。
	 * 上区高度 = 整格 × pinyinTop%；上区末线是上区与下区的共用骨架，恒实线（innerMode 不影响）。 */
	if (type === '5') {
		w = 80;
		h = 112;
		const top = Math.round(h * pinyinTop / 100);
		inner('M1 ' + num(top / 3) + ' L79 ' + num(top / 3));
		inner('M1 ' + num(top * 2 / 3) + ' L79 ' + num(top * 2 / 3));
		fixed('M1 ' + top + ' L79 ' + top, lineColor, lineW);
		inner('M40 ' + top + ' L40 112');
		inner('M0 72 L80 72');
	}
	/* 格上拼音条（对齐 z2h「显示拼音」）：1 格宽 × 1.25 格高——顶部 0.25 格窄条（无内部线，写拼音），
	 * 一条实线与下方 1.0 格田字格分隔；底边 / 左右边由外框充当。 */
	if (type === '10') {
		w = 80;
		h = 100;
		fixed('M0 20 L80 20', lineColor, lineW);
		inner('M40 20 L40 100');
		inner('M1 60 L79 60');
	}
	/* 方格（原「作文格」）：作文纸纯方格，无内部线（一格一字，标点占格） */
	if (type === '6') {
		/* 无内部线 */
	}
	/* 数字格 = 数学本：横线格，一条横虚线作基线（距顶 = 格高 × baselinePos%） */
	if (type === '7') {
		inner('M1 ' + Math.round(h * baselinePos / 100) + ' L79 ' + Math.round(h * baselinePos / 100));
	}
	/* 井字格（九宫格）：两竖两横（1/3 与 2/3 处） */
	if (type === '8') {
		inner('M26.67 0 L26.67 80');
		inner('M53.33 0 L53.33 80');
		inner('M0 26.67 L80 26.67');
		inner('M0 53.33 L80 53.33');
	}
	/* 英文四线格：四条横线，中间区（x-height）= 格高 × engMid/300；
	 * 外框存在时上下边由外框充当，只画中间两条（避免双线加粗）。 */
	if (type === '9') {
		const mid = h * engMid / 300;
		[0, (h - mid) / 2, (h + mid) / 2, h].forEach(function (y, i) {
			if (borderMode !== 'none' && (i === 0 || i === 3)) return;
			inner('M1 ' + num(y) + ' L79 ' + num(y));
		});
	}
	/* 外框：拼音格线多，用细边框与内部线统一；其余字格默认 2× 凸显边界。
	 * 宽度 = 内部线宽 × borderRatio；样式 solid / dashed / none 由配置控制。 */
	if (borderMode !== 'none') {
		border('M0 0 L' + w + ' 0 L' + w + ' ' + h + ' L0 ' + h + ' Z');
	}
	/* 起笔点：左上 1/4 处小圆点，用内部线色（含透明度），置于最上层 */
	if (startDot && (type === '1' || type === '2' || type === '3' || type === '4' || type === '8')) {
		const r = Math.max(1.5, w * 0.04);
		paths.push('<circle cx="' + num(w / 4) + '" cy="' + num(h / 4) + '" r="' + num(r) + '" fill="' + lineColor + '"/>');
	}

	return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"'
		+ (crisp ? ' shape-rendering="crispEdges"' : '')
		+ ' style="overflow:visible">' + paths.join('') + '</svg>';
};

const cache = {};

/* 字格背景：屏幕预览与字帖（打印 / PDF）一致。
 * opts 为 resolveZgOptions 的输出（裸调时逐字段回退默认，与旧版渲染一致）。 */
export const getZgBackground = (opts) => {
	opts = opts || {};
	const key = [
		opts.type, opts.lineColor, opts.borderColor, opts.innerMode, opts.borderMode,
		opts.lineScale, opts.borderScale, opts.opacity, opts.dashStyle, opts.dashDensity,
		opts.lineCap, opts.crisp, opts.innerRatio, opts.engMid, opts.pinyinTop,
		opts.baselinePos, opts.startDot
	].join('|');
	if (!cache[key]) {
		const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildZgSvg(opts));
		cache[key] = `url('${uri}')`;
	}
	return cache[key];
};
