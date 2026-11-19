/**
 * 第三方资源来源管理：CDN（默认，file:// 直开可用）与本地 vendor（可选）。
 * 本地模式需先运行 `npm run vendor` 下载资源，并且页面需由 http 服务托管
 * （file:// 下浏览器会拦截本地 ESM 的动态 import，届时自动回退 CDN）。
 * 本地文件缺失时自动回退 CDN，并把状态显示到 #assetStatus。
 */
(function (Z) {
	'use strict';

	var CDN_URLS = {
		hanziWriter: 'https://cdn.jsdelivr.net/npm/hanzi-writer@2.2.2/dist/hanzi-writer.min.js',
		pinyin: 'https://cdn.jsdelivr.net/npm/pinyin-pro@3.29.5/+esm'
	};
	/* 注意：动态 import() 在 classic script 中按「脚本自身 URL」解析相对路径，
	   因此本地资源统一按 document.baseURI 解析为绝对路径，避免 /js/vendor/… 404 */
	var LOCAL_PATHS = {
		hanziWriter: 'vendor/hanzi-writer.min.js',
		pinyin: 'vendor/pinyin-pro.esm.js'
	};
	var LOCAL_URLS = {};
	Object.keys(LOCAL_PATHS).forEach(function (name) {
		LOCAL_URLS[name] = new URL(LOCAL_PATHS[name], document.baseURI).href;
	});
	var LABELS = { hanziWriter: 'HanziWriter', pinyin: '拼音库' };

	/* 本地模式下失败（已回退 CDN）的资源 */
	var failed = {};
	/* 已注入的 HanziWriter 地址，避免重复注入 */
	var writerUrl = null;

	function isLocal() {
		return Z.Config.ResourceMode === 'local';
	}

	function urlOf(name) {
		return isLocal() ? LOCAL_URLS[name] : CDN_URLS[name];
	}

	function statusEl() {
		return document.getElementById('assetStatus');
	}

	function renderStatus() {
		var el = statusEl();
		if (!el) return;
		var list = [];
		if (isLocal()) {
			['hanziWriter', 'pinyin'].forEach(function (name) {
				if (failed[name]) list.push(LABELS[name]);
			});
		}
		if (list.length) {
			el.textContent = '本地模式：' + list.join('、') + ' 缺失，已回退 CDN。';
			el.className = 'field-hint field-hint-error';
		} else if (isLocal()) {
			el.textContent = '本地 vendor 模式（http 托管可用）；未通过 npm run vendor 下载时会自动回退 CDN。';
			el.className = 'field-hint';
		} else {
			el.textContent = 'CDN 模式（jsDelivr），file:// 直开可用；笔画数据按字从 CDN 加载。';
			el.className = 'field-hint';
		}
	}

	function markFailed(name) {
		failed[name] = true;
		renderStatus();
	}

	/* 动态注入 <script>，成功 resolve、失败 reject */
	function injectScript(url) {
		return new Promise(function (resolve, reject) {
			var script = document.createElement('script');
			script.src = url;
			script.async = true;
			script.onload = function () {
				if (url === urlOf('hanziWriter')) writerUrl = url;
				resolve(url);
			};
			script.onerror = function () {
				if (url === urlOf('hanziWriter')) writerUrl = null;
				reject(new Error('脚本加载失败：' + url));
			};
			(document.head || document.documentElement).appendChild(script);
		});
	}

	/* HanziWriter：动态注入 <script>；本地缺失时回退 CDN。返回 Promise 供调用方等待（原生版 apply 忽略返回值） */
	var loadingHanzi = null;
	function loadHanziWriter() {
		var target = urlOf('hanziWriter');
		if (writerUrl === target) return Promise.resolve(writerUrl);
		writerUrl = target;
		if (!loadingHanzi) {
			loadingHanzi = injectScript(target).catch(function () {
				if (target === CDN_URLS.hanziWriter) {
					markFailed('hanziWriter');
					return null;
				}
				markFailed('hanziWriter');
				writerUrl = null;
				return injectScript(CDN_URLS.hanziWriter).catch(function () {
					markFailed('hanziWriter');
					return null;
				});
			});
		}
		return loadingHanzi;
	}

	/* 外部资源统一出口 */
	Z.Assets = {
		CDN_URLS: CDN_URLS,
		LOCAL_URLS: LOCAL_URLS,

		loadHanziWriter: loadHanziWriter,

		apply: function () {
			failed = {};
			loadHanziWriter();
			renderStatus();
		},

		urlOf: urlOf,
		renderStatus: renderStatus,

		loadPinyin: function () {
			var target = urlOf('pinyin');
			return import(target).catch(function () {
				if (target === CDN_URLS.pinyin) return null;
				markFailed('pinyin');
				return import(CDN_URLS.pinyin).catch(function () {
					return null;
				});
			});
		},

		/* 供调试：查看当前生效的资源地址 */
		describe: function () {
			return {
				mode: isLocal() ? 'local' : 'cdn',
				hanziWriter: urlOf('hanziWriter'),
				pinyin: urlOf('pinyin'),
				failed: Object.keys(failed)
			};
		}
	};
})(window.Zitie = window.Zitie || {});
