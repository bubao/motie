/**
 * 本地字体仓库（T3.1）：二进制存 IndexedDB，元数据存 localStorage。
 * - 二进制（Blob）：库 zitie-fonts / store fonts（keyPath id），容量大、刷新与重开仍在；
 * - 元数据：Z.FONTS_KEY（zitie.fonts）→ [{ id, name, enabled, size, createdAt }]，不含二进制。
 * file:// 直开实测可用（Chrome）；环境不支持时 available() 为 false，由上层降级。
 */
(function (Z) {
	'use strict';

	var DB_NAME = 'zitie-fonts';
	var STORE = 'fonts';
	var dbPromise = null;

	function open() {
		if (dbPromise) return dbPromise;
		dbPromise = new Promise(function (resolve, reject) {
			if (typeof indexedDB === 'undefined') {
				reject(new Error('当前环境不支持 IndexedDB'));
				return;
			}
			var req = indexedDB.open(DB_NAME, 1);
			req.onupgradeneeded = function () {
				if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
			};
			req.onsuccess = function () { resolve(req.result); };
			req.onerror = function () { reject(req.error || new Error('IndexedDB 打开失败')); };
		});
		return dbPromise;
	}

	function reqToPromise(req) {
		return new Promise(function (resolve, reject) {
			req.onsuccess = function () { resolve(req.result); };
			req.onerror = function () { reject(req.error || new Error('请求失败')); };
		});
	}

	/* 事务包装：fn(store) 返回请求 Promise，事务完成时 resolve 其结果 */
	function run(db, mode, fn) {
		return new Promise(function (resolve, reject) {
			var tx = db.transaction(STORE, mode);
			var out = null;
			Promise.resolve(fn(tx.objectStore(STORE))).then(function (v) { out = v; }, reject);
			tx.oncomplete = function () { resolve(out); };
			tx.onerror = function () { reject(tx.error || new Error('事务失败')); };
			tx.onabort = function () { reject(tx.error || new Error('事务中止')); };
		});
	}

	Z.FontStore = {
		available: function () { return typeof indexedDB !== 'undefined'; },

		/* 写入二进制（entry: { id, blob, size, createdAt }） */
		put: function (entry) {
			return open().then(function (db) {
				return run(db, 'readwrite', function (s) { return reqToPromise(s.put(entry)); });
			});
		},

		get: function (id) {
			return open().then(function (db) {
				return run(db, 'readonly', function (s) { return reqToPromise(s.get(id)); });
			});
		},

		remove: function (id) {
			return open().then(function (db) {
				return run(db, 'readwrite', function (s) { return reqToPromise(s.delete(id)); });
			});
		},

		clear: function () {
			return open().then(function (db) {
				return run(db, 'readwrite', function (s) { return reqToPromise(s.clear()); });
			});
		},

		/* ---- 元数据（localStorage，轻量） ---- */
		loadMeta: function () {
			try { return JSON.parse(localStorage.getItem(Z.FONTS_KEY)) || []; }
			catch (e) { return []; }
		},
		saveMeta: function (list) {
			try { localStorage.setItem(Z.FONTS_KEY, JSON.stringify(list)); } catch (e) { /* 忽略 */ }
		}
	};
})(window.Zitie = window.Zitie || {});
