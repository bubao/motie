/**
 * 字格背景：根据样式与颜色生成 SVG data URI，同组合缓存复用。
 * 完整版与 Kindle 精简版共享此文件（精简版构建时打包内联）。
 */
(function (Z) {
	'use strict';

	function buildZgSvg(type, colorKey) {
		var color = Z.ZG_COLOR_VALUES[colorKey] || Z.ZG_COLOR_VALUES[Z.DEFAULTS.ZgColor];
		var dashed = 'stroke-dasharray="4,4" stroke-width="1" stroke="' + color.line + '" fill="none"';
		/* 实线：用于拼音格上下分区等结构线 */
		var solid = 'stroke-width="1" stroke="' + color.border + '" fill="none"';
		var paths = [];

		if (type === '1' || type === '2' || type === '3') {
			paths.push('<path d="M0 40 L80 40" ' + dashed + '/>');
			paths.push('<path d="M40 0 L40 80" ' + dashed + '/>');
		}
		if (type === '2' || type === '3') {
			paths.push('<path d="M0 0 L80 80" ' + dashed + '/>');
			paths.push('<path d="M0 80 L80 0" ' + dashed + '/>');
		}
		if (type === '5') {
			/* 拼音格：上四线三格（写拼音）+ 下田字格（写汉字） */
			paths.push('<path d="M1 10 L79 10" ' + dashed + '/>');
			paths.push('<path d="M1 20 L79 20" ' + dashed + '/>');
			paths.push('<path d="M1 26 L79 26" ' + solid + '/>');
			paths.push('<path d="M0 53 L80 53" ' + dashed + '/>');
			paths.push('<path d="M40 26 L40 80" ' + dashed + '/>');
		}
		if (type === '6') {
			/* 作文格：横线格，适合抄写与作文 */
			paths.push('<path d="M1 20 L79 20" ' + dashed + '/>');
			paths.push('<path d="M1 40 L79 40" ' + dashed + '/>');
			paths.push('<path d="M1 60 L79 60" ' + dashed + '/>');
		}
		if (type === '7') {
			/* 数字格：中间横线，便于数字定位 */
			paths.push('<path d="M1 40 L79 40" ' + dashed + '/>');
		}
		paths.push('<path d="M1 1 L79 1 L79 79 L1 79 Z" stroke-width="2" stroke="' + color.border + '" fill="none"/>');
		if (type === '3' || type === '4') {
			paths.push('<path d="M20 10 L60 10 L60 70 L20 70 Z" ' + dashed + '/>');
		}

		return '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' + paths.join('') + '</svg>';
	}

	var cache = {};

	function getZgBackground(type, colorKey) {
		type = Z.normalize(type, Z.ZG_TYPES, Z.DEFAULTS.ZgType);
		colorKey = Z.normalize(colorKey, Z.ZG_COLORS, Z.DEFAULTS.ZgColor);
		var key = type + '|' + colorKey;
		if (!cache[key]) {
			var uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildZgSvg(type, colorKey));
			cache[key] = "url('" + uri + "')";
		}
		return cache[key];
	}

	Z.buildZgSvg = buildZgSvg;
	Z.getZgBackground = getZgBackground;
})(window.Zitie = window.Zitie || {});
