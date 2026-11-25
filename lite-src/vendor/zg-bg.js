/* lite 独立副本：与 web/src/core 同源，改动共享逻辑需同步两处（语法风格有意不同步） */
/**
 * 字格背景：根据样式与颜色生成 SVG data URI，同组合缓存复用。
 * 完整版与 Kindle 精简版共享此文件（精简版构建时打包内联）。
 * 绘制参数（opts）由 Z.resolveZgOptions 从配置派生，本模块只做纯绘制。
 */
(function (Z) {
	'use strict';

	function num(x) { return (Math.round(x * 100) / 100).toString(); }

	/* #rrggbb + 不透明度 → rgba()；不透明度 1 时保持 hex 原样（兼容老浏览器） */
	function withAlpha(hex, alpha) {
		if (alpha >= 1) return hex;
		var h = String(hex).replace('#', '');
		var r = parseInt(h.slice(0, 2), 16);
		var g = parseInt(h.slice(2, 4), 16);
		var b = parseInt(h.slice(4, 6), 16);
		return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + num(alpha) + ')';
	}

	/* 裸调时的有限正数校验（resolveZgOptions 已收敛，这里兜底） */
	function positive(x, fallback) {
		return isFinite(Number(x)) && Number(x) > 0 ? Number(x) : fallback;
	}

	/* 线的 style 属性：mode solid / dashed（含虚线形态与密度）；none 返回 null */
	function strokeAttrs(color, width, mode, dashStyle, dashDensity, lineCap) {
		if (mode === 'none') return null;
		/* dasharray 在前，与旧版属性顺序一致 */
		var attrs = '';
		if (mode === 'dashed') {
			if (dashStyle === 'dot') {
				attrs += 'stroke-dasharray="0.1,' + num(5.5 * dashDensity) + '" stroke-linecap="round" ';
			} else if (dashStyle === 'dashdot') {
				attrs += 'stroke-dasharray="' + num(8 * dashDensity) + ',' + num(3 * dashDensity) + ',' + num(1 * dashDensity) + ',' + num(3 * dashDensity) + '" ';
			} else {
				attrs += 'stroke-dasharray="' + num(4 * dashDensity) + ',' + num(4 * dashDensity) + '" ';
			}
		}
		/* butt 是 SVG 默认值，不输出（保持旧渲染一致）；圆点虚线恒 round */
		if (lineCap && lineCap !== 'butt' && dashStyle !== 'dot') {
			attrs += 'stroke-linecap="' + lineCap + '" ';
		}
		attrs += 'stroke-width="' + num(width) + '" stroke="' + color + '" fill="none"';
		return attrs;
	}

	function buildZgSvg(opts) {
		opts = opts || {};
		var type = Z.normalize(opts.type, Z.ZG_TYPES, Z.DEFAULTS.ZgType);
		var preset = Z.ZG_COLOR_VALUES[Z.DEFAULTS.ZgColor];
		var opacity = isFinite(Number(opts.opacity)) && Number(opts.opacity) > 0 ? Math.min(1, Number(opts.opacity)) : 1;
		var lineColor = withAlpha(opts.lineColor || preset.line, opacity);
		var borderColor = withAlpha(opts.borderColor || preset.border, opacity);
		var innerMode = Z.normalize(opts.innerMode, Z.ZG_LINE_MODES, Z.DEFAULTS.ZgInnerLineMode);
		var borderMode = Z.normalize(opts.borderMode, Z.ZG_LINE_MODES, Z.DEFAULTS.ZgLineMode);
		var dashStyle = Z.normalize(opts.dashStyle, ['dash', 'dot', 'dashdot'], Z.DEFAULTS.ZgDashStyle);
		var dashDensity = positive(opts.dashDensity, 1);
		var lineCap = Z.normalize(opts.lineCap, ['butt', 'round', 'square'], Z.DEFAULTS.ZgLineCap);
		var crisp = opts.crisp === true;
		/* 格型内部比例（百分比 / ×300，见各分支注释） */
		var innerRatio = positive(opts.innerRatio, 25);
		var engMid = positive(opts.engMid, 100);
		var pinyinTop = positive(opts.pinyinTop, 29);
		var baselinePos = positive(opts.baselinePos, 66);
		var startDot = opts.startDot === true;
		/* 内部线宽 = lineScale；外框宽 = 内部线宽 × borderRatio（缺省随类型：拼音格 1 / 其余 2） */
		var lineW = positive(opts.lineScale, 1);
		var borderRatio = positive(opts.borderScale, type === '5' ? 1 : 2);

		var paths = [];
		var w = 80, h = 80;

		function inner(d) {
			var attrs = strokeAttrs(lineColor, lineW, innerMode, dashStyle, dashDensity, lineCap);
			if (attrs) paths.push('<path d="' + d + '" ' + attrs + '/>');
		}
		function border(d) {
			var attrs = strokeAttrs(borderColor, lineW * borderRatio, borderMode, dashStyle, dashDensity, lineCap);
			if (attrs) paths.push('<path d="' + d + '" ' + attrs + '/>');
		}
		/* 结构实线（不受内部线样式影响的骨架线，如拼音格上区末线）：恒实线 */
		function fixed(d, color, width) {
			paths.push('<path d="' + d + '" stroke-width="' + num(width) + '" stroke="' + color + '" fill="none"/>');
		}

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
			var mx = w * innerRatio / 100, my = mx / 2;
			inner('M' + num(mx) + ' ' + num(my) + ' L' + num(w - mx) + ' ' + num(my) + ' L' + num(w - mx) + ' ' + num(h - my) + ' L' + num(mx) + ' ' + num(h - my) + ' Z');
		}
		/* 拼音格：1 格宽 × 1.4 格高——上区四线三格（顶/末线实线，中间两虚线），
		 * 下区 1.0 格正方形田字格（top..112），底边 / 左右边由外框充当，上下拼接成一体。
		 * 上区高度 = 整格 × pinyinTop%；上区末线是上区与下区的共用骨架，恒实线（innerMode 不影响）。 */
		if (type === '5') {
			w = 80;
			h = 112;
			var top = Math.round(h * pinyinTop / 100);
			inner('M1 ' + num(top / 3) + ' L79 ' + num(top / 3));
			inner('M1 ' + num(top * 2 / 3) + ' L79 ' + num(top * 2 / 3));
			fixed('M1 ' + top + ' L79 ' + top, lineColor, lineW);
			inner('M40 ' + top + ' L40 112');
			inner('M0 72 L80 72');
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
			var mid = h * engMid / 300;
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
			var dotR = Math.max(1.5, w * 0.04);
			paths.push('<circle cx="' + num(w / 4) + '" cy="' + num(h / 4) + '" r="' + num(dotR) + '" fill="' + lineColor + '"/>');
		}

		return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"'
			+ (crisp ? ' shape-rendering="crispEdges"' : '')
			+ ' style="overflow:visible">' + paths.join('') + '</svg>';
	}

	var cache = {};

	/* 字格背景：屏幕预览与字帖（打印 / PDF）一致。
	 * opts 为 Z.resolveZgOptions 的输出（裸调时逐字段回退默认，与旧版渲染一致）。 */
	function getZgBackground(opts) {
		opts = opts || {};
		var key = [
			opts.type, opts.lineColor, opts.borderColor, opts.innerMode, opts.borderMode,
			opts.lineScale, opts.borderScale, opts.opacity, opts.dashStyle, opts.dashDensity,
			opts.lineCap, opts.crisp, opts.innerRatio, opts.engMid, opts.pinyinTop,
			opts.baselinePos, opts.startDot
		].join('|');
		if (!cache[key]) {
			var uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildZgSvg(opts));
			cache[key] = "url('" + uri + "')";
		}
		return cache[key];
	}

	Z.buildZgSvg = buildZgSvg;
	Z.getZgBackground = getZgBackground;
})(window.Zitie = window.Zitie || {});
