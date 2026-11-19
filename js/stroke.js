/**
 * 笔顺动画：封装 Hanzi Writer（CDN UMD）。
 * 笔画数据由 Hanzi Writer 自行按字从 CDN 加载，失败时返回 false，由调用方降级为静态单字。
 */
(function (Z) {
	'use strict';

	var SVG_NS = 'http://www.w3.org/2000/svg';
	var writer = null;

	function isAvailable() {
		return !!(window.HanziWriter && typeof window.HanziWriter.create === 'function');
	}

	function destroy() {
		if (writer) {
			if (typeof writer.cancelAnimation === 'function') {
				try {
					writer.cancelAnimation();
				} catch (e) {
					/* 忽略 */
				}
			}
			writer = null;
		}
	}

	function play(stage, char, options) {
		if (!isAvailable() || !stage || !char) return false;
		destroy();
		stage.textContent = '';
		var svg = document.createElementNS(SVG_NS, 'svg');
		svg.setAttribute('width', '100%');
		svg.setAttribute('height', '100%');
		stage.appendChild(svg);
		try {
			writer = window.HanziWriter.create(svg, char, Object.assign({
				width: 240,
				height: 240,
				padding: 20,
				showOutline: true,
				showCharacter: true,
				strokeColor: '#B03A2C',
				outlineColor: '#DCD3BF',
				strokeAnimationSpeed: 1,
				delayBetweenStrokes: 0.15
			}, options || {}));
			writer.animateCharacter();
			return true;
		} catch (e) {
			writer = null;
			return false;
		}
	}

	Z.Stroke = {
		isAvailable: isAvailable,
		play: play,
		destroy: destroy
	};
})(window.Zitie = window.Zitie || {});
