/**
 * 自定义字体：三种来源——系统默认（default）/ 网络地址（url）/ 本地文件（local，二进制存 IndexedDB）。
 * - inject(url)：只做 url 注入（兼容旧调用）；
 * - use(source)：统一入口，按来源注入（完整版用，配置真源在 Redux）；
 * - clear()：恢复系统默认（管理器「停用」与失败回退）。
 * 屏幕（css/main.css）与 PDF（core/pdf.js 读 body.custom-font）同步生效。
 * 依赖 config 的 sanitizeFontURL / guessFontFormat 与 font-store 的 FontStore。
 */
import { sanitizeFontURL, guessFontFormat, FONT_WEIGHT_NUM } from './config.js';
import { FontStore } from './font-store.js';

const STYLE_ID = 'zitie-font-face';
const LOCAL_FAMILY = 'ziti';
let localFace = null; /* 当前本地 FontFace 实例，便于移除 */

/* 桌面端本地字体二进制获取器（Go fonts 服务）：async (id) => ArrayBuffer | null。
 * 未设置时（浏览器）回退 IndexedDB（FontStore）。 */
let localResolver = null;
export function setLocalResolver(fn) {
	localResolver = typeof fn === 'function' ? fn : null;
}

/* CSS 字符串转义（系统字体族名注入 @font-face / 规则） */
function escapeFamily(name) {
	return String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

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

const inject = (url, weight) => {
	removeLocalFace();
	const clean = sanitizeFontURL(url || '');
	const styleEl = ensureStyle();
	styleEl.textContent = clean
		? `@font-face{font-family:'${LOCAL_FAMILY}';font-weight:${weight};src:url('${clean}') format('${guessFontFormat(clean)}');}`
		: '';
	setCustomClass(clean);
	return clean;
};

/* 系统字体可用性检测（G5）：canvas 同文本宽度复核——与 monospace 兜底宽度相同即视为缺字体。
 * （FontFaceSet.check 不可靠：实测对未安装的字名也返回 true。）
 * 字体名已由 normalizeFontSource 限制字符集（无引号 / 反斜杠），可安全拼接。 */
const systemFontUsable = (name) => {
	const family = `"${name}"`;
	try {
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		if (!ctx) return false;
		const sample = '永ww';
		ctx.font = '16px monospace';
		const fallbackW = ctx.measureText(sample).width;
		ctx.font = `16px ${family}, monospace`;
		return Math.abs(ctx.measureText(sample).width - fallbackW) > 0.5;
	} catch {
		return false;
	}
};

/* 本地字体：优先桌面 resolver（Go 字体文件），回退 IndexedDB；
 * 得到 ArrayBuffer → FontFace 注入；失败返回 false（调用方可回退默认） */
const resolveLocalBuffer = async (id) => {
	if (localResolver && id) {
		try {
			const buf = await localResolver(id);
			if (buf) return buf;
		} catch { /* 落到下方 IndexedDB 回退 */ }
	}
	if (!FontStore || !FontStore.available || !FontStore.available() || !id) return null;
	let entry;
	try {
		entry = await FontStore.get(id);
	} catch {
		return null;
	}
	const blob = entry && entry.blob;
	if (!blob) return null;
	/* FontFace 的 source 需 BufferSource（Chrome 不接受 Blob），先转 ArrayBuffer */
	try {
		return await (blob.arrayBuffer ? blob.arrayBuffer() : Promise.reject(new Error('不支持读取字体二进制')));
	} catch {
		return null;
	}
};

/* 供组件预览 / 应用取二进制（浏览器 IndexedDB / 桌面内核文件），不注入 */
export const loadLocalBuffer = (id) => resolveLocalBuffer(id);

const useLocal = async (id, weight) => {
	let buffer;
	try {
		buffer = await resolveLocalBuffer(id);
	} catch {
		buffer = null;
	}
	if (!buffer) {
		clear();
		return false;
	}
	let face;
	try {
		face = new FontFace(LOCAL_FAMILY, buffer, { style: 'normal', weight: String(weight) });
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
	/* 按来源应用：default / url / local。返回 Promise<boolean>（是否成功应用非默认字体）。
	 * options.weight：FontWeight 配置值（normal / bold），决定 @font-face 注册与加载字重；
	 * 字体文件无对应字重时由浏览器按 font-synthesis 合成（屏幕 / 打印 / PDF 同源）。 */
	use(source, options) {
		const s = source && typeof source === 'object' ? source : { type: 'default' };
		const weight = FONT_WEIGHT_NUM[(options && options.weight) in FONT_WEIGHT_NUM ? options.weight : 'normal'];
		if (s.type === 'url') {
			const clean = inject(s.url || '', weight);
			if (!clean) {
				clear();
				return Promise.resolve(false);
			}
			return document.fonts.load(`${weight} 16px ${LOCAL_FAMILY}`).then(
				(faces) => !!(faces && faces.length),
				() => false
			);
		}
		if (s.type === 'local') return useLocal(s.id, weight);
		if (s.type === 'system') {
			const name = String((s && s.name) || '').trim();
			/* 字体不可用（未安装 / 已卸载）时回退默认字体，由调用方提示用户 */
			if (!name || !systemFontUsable(name)) {
				clear();
				return Promise.resolve(false);
			}
			removeLocalFace();
			ensureStyle().textContent =
				`body.custom-font .hz-line,body.custom-font .overlay-stage{font-family:'${escapeFamily(name)}',var(--font-kai)}`;
			setCustomClass(true);
			/* 不阻塞：CSS 层已生效，缺失字重由 font-synthesis 合成 */
			return Promise.resolve(true);
		}
		clear();
		return Promise.resolve(true);
	},
	/* 恢复默认（供管理器「停用」与失败回退调用） */
	clear
};
