/* lite 独立副本：与 web/src/core 同源，改动共享逻辑需同步两处（语法风格有意不同步） */
/**
 * 自定义字体（完整版与练字版共用）。
 * 三种来源：系统默认（default）/ 网络地址（url）/ 本地文件（local，二进制存 IndexedDB）。
 * - inject(url)：只做 url 注入（兼容旧调用）；
 * - apply(url)：inject + 写 Config + 持久化（练字版用）；
 * - use(source)：统一入口，按来源注入（完整版用，配置真源在 Redux）。
 * 屏幕（css/main.css / lite-src/style.css）与 PDF（标准版 web/src/core/pdf.js 读 body.custom-font）同步生效。
 * 依赖同目录 config.js 的 Z.sanitizeFontURL / Z.guessFontFormat；
 * 本地来源依赖标准版 web/src/core/font-store.js 的 FontStore（精简版未加载，缺失时降级）。
 */
(function (Z) {
	'use strict';

	var STYLE_ID = 'zitie-font-face';
	var LOCAL_FAMILY = 'ziti';
	var localFace = null; /* 当前本地 FontFace 实例，便于移除 */

	function ensureStyle() {
		var el = document.getElementById(STYLE_ID);
		if (el) return el;
		el = document.createElement('style');
		el.id = STYLE_ID;
		(document.head || document.documentElement).appendChild(el);
		return el;
	}

	function setCustomClass(on) {
		var body = document.body;
		if (!body) return;
		var cls = ' ' + (body.className || '') + ' ';
		var has = cls.indexOf(' custom-font ') !== -1;
		if (on && !has) body.className = (cls + ' custom-font').replace(/^\s+|\s+$/g, '');
		if (!on && has) body.className = cls.replace(' custom-font ', ' ').replace(/^\s+|\s+$/g, '');
	}

	/* 移除本地 FontFace（url 来源或恢复默认时调用，避免残留生效） */
	function removeLocalFace() {
		if (localFace) {
			try { document.fonts.delete(localFace); } catch (e) { /* 忽略 */ }
			localFace = null;
		}
	}

	/* 恢复系统默认字体：清 @font-face、移除本地 FontFace、去 custom-font */
	function clear() {
		removeLocalFace();
		ensureStyle().textContent = '';
		setCustomClass(false);
	}

	function inject(url) {
		removeLocalFace();
		var clean = Z.sanitizeFontURL(url || '');
		var styleEl = ensureStyle();
		if (clean) {
			styleEl.textContent = "@font-face{font-family:'" + LOCAL_FAMILY + "';src:url('" + clean + "') format('" + Z.guessFontFormat(clean) + "');}";
		} else {
			styleEl.textContent = '';
		}
		setCustomClass(clean);
		return clean;
	}

	/* 本地字体：从 IndexedDB 取二进制 → ArrayBuffer → FontFace 注入；失败返回 false（调用方可回退默认） */
	function useLocal(id) {
		return new Promise(function (resolve) {
			if (!Z.FontStore || !Z.FontStore.available || !Z.FontStore.available() || !id) {
				clear();
				resolve(false);
				return;
			}
			Z.FontStore.get(id).then(function (entry) {
				var blob = entry && entry.blob;
				if (!blob) {
					clear();
					resolve(false);
					return;
				}
				/* FontFace 的 source 需 BufferSource（Chrome 不接受 Blob），先转 ArrayBuffer */
				var ab = blob.arrayBuffer ? blob.arrayBuffer() : Promise.reject(new Error('不支持读取字体二进制'));
				Promise.resolve(ab).then(function (buffer) {
					var face;
					try {
						face = new FontFace(LOCAL_FAMILY, buffer, { style: 'normal', weight: 'normal' });
					} catch (e) {
						clear();
						resolve(false);
						return;
					}
					removeLocalFace();
					localFace = face;
					try { document.fonts.add(face); } catch (e) {
						localFace = null;
						clear();
						resolve(false);
						return;
					}
					ensureStyle().textContent = '';
					setCustomClass(true);
					face.load().then(function () { resolve(true); }, function () {
						clear();
						resolve(false);
					});
				}, function () {
					clear();
					resolve(false);
				});
			}).catch(function () {
				clear();
				resolve(false);
			});
		});
	}

	Z.Font = {
		inject: inject,
		apply: function (url) {
			var clean = inject(url);
			Z.Config.fontURL = clean;
			Z.Config.save();
			return clean;
		},
		/* 按来源应用：default / url / local。返回 Promise<boolean>（是否成功应用非默认字体） */
		use: function (source) {
			var s = source && typeof source === 'object' ? source : { type: 'default' };
			if (s.type === 'url') {
				var clean = inject(s.url || '');
				if (!clean) {
					clear();
					return Promise.resolve(false);
				}
				return document.fonts.load('16px ' + LOCAL_FAMILY).then(function (faces) {
					return !!(faces && faces.length);
				}, function () { return false; });
			}
			if (s.type === 'local') return useLocal(s.id);
			clear();
			return Promise.resolve(true);
		},
		/* 恢复默认（供管理器「停用」与失败回退调用） */
		clear: clear,
		current: function () { return Z.Config.fontURL || ''; }
	};
})(window.Zitie = window.Zitie || {});
