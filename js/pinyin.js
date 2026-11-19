/**
 * 汉字拼音：按需动态加载 pinyin-pro（CDN 或本地 vendor，由 assets.js 决定），失败时静默降级（不显示拼音）。
 */
(function (Z) {
	'use strict';

	var TONE_OPTIONS = { toneType: 'symbol', type: 'string' };
	var fn = null;
	var loading = null;
	var cache = {};

	function compute(char) {
		if (!fn) return '';
		try {
			var result = fn(char, TONE_OPTIONS);
			return typeof result === 'string' ? result : '';
		} catch (e) {
			return '';
		}
	}

	/* 启动加载；已加载 / 加载失败都只会 resolve，不抛错 */
	Z.loadPinyin = function () {
		/* 兼容通过 <script type="module"> 预置的全局函数 */
		if (!fn && typeof window.pinyinPro === 'function') fn = window.pinyinPro;
		if (!fn && !loading) {
		loading = Z.Assets.loadPinyin().then(function (m) {
			if (m && typeof m.pinyin === 'function') fn = m.pinyin;
			return fn;
		}).catch(function () {
			return null;
		});
	}
	return loading || Promise.resolve(fn);
};

	/* 切换资源来源后重置，重新加载拼音库 */
	Z.resetPinyin = function () {
		fn = null;
		loading = null;
		cache = {};
	};

	/* 同步取拼音：模块就绪后可用；未就绪时返回空串（调用方可在就绪后重渲染） */
	Z.getPinyin = function (char) {
		if (!char) return '';
		if (!fn && typeof window.pinyinPro === 'function') fn = window.pinyinPro;
		if (!fn) return '';
		if (!Object.prototype.hasOwnProperty.call(cache, char)) cache[char] = compute(char);
		return cache[char];
	};

	/* 加载状态提示 */
	Z.isPinyinReady = function () {
		return !!fn;
	};
})(window.Zitie = window.Zitie || {});
