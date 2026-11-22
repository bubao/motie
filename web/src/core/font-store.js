/**
 * 本地字体仓库：二进制存 IndexedDB，元数据存 localStorage（zitie.fonts）。
 * 标准版核心模块；lite 使用独立副本（lite-src/vendor/font-store 未提供，lite 不加载）。
 * - 二进制（Blob）：库 zitie-fonts / store fonts（keyPath id），容量大、刷新与重开仍在；
 * - 元数据：FONTS_KEY（zitie.fonts）→ [{ id, name, enabled, size, createdAt }]，不含二进制。
 * file:// 直开实测可用（Chrome）；环境不支持时 available() 为 false，由上层降级。
 */
import { FONTS_KEY } from './config.js';

const DB_NAME = 'zitie-fonts';
const STORE = 'fonts';
let dbPromise = null;

const open = () => {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(new Error('当前环境不支持 IndexedDB'));
			return;
		}
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
	});
	return dbPromise;
};

const reqToPromise = (req) => new Promise((resolve, reject) => {
	req.onsuccess = () => resolve(req.result);
	req.onerror = () => reject(req.error || new Error('请求失败'));
});

/* 事务包装：fn(store) 返回请求 Promise，事务完成时 resolve 其结果 */
const run = (db, mode, fn) => new Promise((resolve, reject) => {
	const tx = db.transaction(STORE, mode);
	let out = null;
	Promise.resolve(fn(tx.objectStore(STORE))).then((v) => { out = v; }, reject);
	tx.oncomplete = () => resolve(out);
	tx.onerror = () => reject(tx.error || new Error('事务失败'));
	tx.onabort = () => reject(tx.error || new Error('事务中止'));
});

export const FontStore = {
	available: () => typeof indexedDB !== 'undefined',

	/* 写入二进制（entry: { id, blob, size, createdAt }） */
	async put(entry) {
		const db = await open();
		return run(db, 'readwrite', (s) => reqToPromise(s.put(entry)));
	},

	async get(id) {
		const db = await open();
		return run(db, 'readonly', (s) => reqToPromise(s.get(id)));
	},

	async remove(id) {
		const db = await open();
		return run(db, 'readwrite', (s) => reqToPromise(s.delete(id)));
	},

	async clear() {
		const db = await open();
		return run(db, 'readwrite', (s) => reqToPromise(s.clear()));
	},

	/* ---- 元数据（localStorage，轻量） ---- */
	loadMeta() {
		try { return JSON.parse(localStorage.getItem(FONTS_KEY)) || []; }
		catch { return []; }
	},
	saveMeta(list) {
		try { localStorage.setItem(FONTS_KEY, JSON.stringify(list)); } catch { /* 忽略 */ }
	}
};
