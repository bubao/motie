/**
 * 自定义字体：三种来源——系统默认（default）/ 网络地址（url）/ 本地文件（local，二进制存 IndexedDB）。
 * - inject(url)：只做 url 注入（兼容旧调用）；
 * - use(source)：统一入口，按来源注入（完整版用，配置真源在 Redux）；
 * - clear()：恢复系统默认（管理器「停用」与失败回退）。
 * 屏幕（css/main.css）与 PDF（core/pdf.js 读 body.custom-font）同步生效。
 * 依赖 config 的 sanitizeFontURL / guessFontFormat 与 font-store 的 FontStore。
 */
import { sanitizeFontURL, guessFontFormat } from './config.js';
import { FontStore } from './font-store.js';

const STYLE_ID = 'zitie-font-face';
const LOCAL_FAMILY = 'ziti';
let localFace = null; /* 当前本地 FontFace 实例，便于移除 */

const ensureStyle = () => {
	const el = document.getElementById(STYLE_ID);
	if (el) return el;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	(document.head || document.documentElement).appendChild(style);
	return style;
};

const setCustomClass = (on) => {
	const body = document.body;
	if (!body) return;
	const cls = ` ${body.className || ''} `;
	const has = cls.includes(' custom-font ');
	if (on && !has) body.className = `${cls} custom-font`.trim();
	if (!on && has) body.className = cls.replace(' custom-font ', ' ').trim();
};

/* 移除本地 FontFace（url 来源或恢复默认时调用，避免残留生效） */
const removeLocalFace = () => {
	if (localFace) {
		try { document.fonts.delete(localFace); } catch { /* 忽略 */ }
		localFace = null;
	}
};

/* 恢复系统默认字体：清 @font-face、移除本地 FontFace、去 custom-font */
const clear = () => {
	removeLocalFace();
	ensureStyle().textContent = '';
	setCustomClass(false);
};

const inject = (url) => {
	removeLocalFace();
	const clean = sanitizeFontURL(url || '');
	const styleEl = ensureStyle();
	styleEl.textContent = clean
		? `@font-face{font-family:'${LOCAL_FAMILY}';src:url('${clean}') format('${guessFontFormat(clean)}');}`
		: '';
	setCustomClass(clean);
	return clean;
};

/* 本地字体：从 IndexedDB 取二进制 → ArrayBuffer → FontFace 注入；失败返回 false（调用方可回退默认） */
const useLocal = async (id) => {
	if (!FontStore || !FontStore.available || !FontStore.available() || !id) {
		clear();
		return false;
	}
	let entry;
	try {
		entry = await FontStore.get(id);
	} catch {
		clear();
		return false;
	}
	const blob = entry && entry.blob;
	if (!blob) {
		clear();
		return false;
	}
	/* FontFace 的 source 需 BufferSource（Chrome 不接受 Blob），先转 ArrayBuffer */
	let buffer;
	try {
		buffer = await (blob.arrayBuffer ? blob.arrayBuffer() : Promise.reject(new Error('不支持读取字体二进制')));
	} catch {
		clear();
		return false;
	}
	let face;
	try {
		face = new FontFace(LOCAL_FAMILY, buffer, { style: 'normal', weight: 'normal' });
	} catch {
		clear();
		return false;
	}
	removeLocalFace();
	localFace = face;
	try { document.fonts.add(face); } catch {
		localFace = null;
		clear();
		return false;
	}
	ensureStyle().textContent = '';
	setCustomClass(true);
	try {
		await face.load();
		return true;
	} catch {
		clear();
		return false;
	}
};

export const Font = {
	inject,
	/* 按来源应用：default / url / local。返回 Promise<boolean>（是否成功应用非默认字体） */
	use(source) {
		const s = source && typeof source === 'object' ? source : { type: 'default' };
		if (s.type === 'url') {
			const clean = inject(s.url || '');
			if (!clean) {
				clear();
				return Promise.resolve(false);
			}
			return document.fonts.load(`16px ${LOCAL_FAMILY}`).then(
				(faces) => !!(faces && faces.length),
				() => false
			);
		}
		if (s.type === 'local') return useLocal(s.id);
		clear();
		return Promise.resolve(true);
	},
	/* 恢复默认（供管理器「停用」与失败回退调用） */
	clear
};
