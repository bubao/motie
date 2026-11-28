/**
 * 汉字拼音：按需动态加载 pinyin-pro（CDN 或本地 vendor，由 core/assets 决定），
 * 失败时静默降级（不显示拼音）。
 */
import { loadPinyinLib } from './assets.js';

const TONE_OPTIONS = { toneType: 'symbol', type: 'string' };
let fn = null;
let loading = null;
let cache = {};
/* 行级语境结果缓存（多音字按词定音）：key = 行内非空字符拼接串 */
let lineCache = {};

const compute = (char) => {
	if (!fn) return '';
	try {
		const result = fn(char, TONE_OPTIONS);
		return typeof result === 'string' ? result : '';
	} catch {
		return '';
	}
};

/* 启动加载；已加载 / 加载失败都只会 resolve，不抛错 */
export const loadPinyin = async () => {
	/* 兼容通过 <script type="module"> 预置的全局函数 */
	if (!fn && typeof window !== 'undefined' && typeof window.pinyinPro === 'function') fn = window.pinyinPro;
	if (!fn && !loading) {
		loading = (async () => {
			try {
				const m = await loadPinyinLib();
				if (m && typeof m.pinyin === 'function') fn = m.pinyin;
				return fn;
			} catch {
				return null;
			}
		})();
	}
	return loading || Promise.resolve(fn);
};

/* 切换资源来源后重置，重新加载拼音库 */
export const resetPinyin = () => {
	fn = null;
	loading = null;
	cache = {};
	lineCache = {};
};

/* 同步取拼音：模块就绪后可用；未就绪时返回空串（调用方可在就绪后重渲染） */
export const getPinyin = (char) => {
	if (!char) return '';
	if (!fn && typeof window !== 'undefined' && typeof window.pinyinPro === 'function') fn = window.pinyinPro;
	if (!fn) return '';
	if (!Object.prototype.hasOwnProperty.call(cache, char)) cache[char] = compute(char);
	return cache[char];
};

/* 行级语境取音：整段文本交给 pinyin-pro（内置词典，多音字按词定音，如「长大」zhǎng dà、「长沙」cháng shā）。
 * type:'array' 对汉字 / 标点 / 空白 / 字母逐元素对齐（已实测 vendor/pinyin-pro.esm.js）；
 * 结果缓存到 lineCache。 */
export const getPinyinArray = (text) => {
	const key = String(text == null ? '' : text);
	if (!key) return [];
	if (!fn && typeof window !== 'undefined' && typeof window.pinyinPro === 'function') fn = window.pinyinPro;
	if (!fn) return [];
	if (!Object.prototype.hasOwnProperty.call(lineCache, key)) {
		try {
			const result = fn(key, Object.assign({}, TONE_OPTIONS, { type: 'array' }));
			lineCache[key] = Array.isArray(result) ? result : [];
		} catch {
			lineCache[key] = [];
		}
	}
	return lineCache[key];
};

const isHanzi = (ch) => /[\u4e00-\u9fa5]/.test(ch);

/* 一行单元的拼音序列（与 cells 等长）：只拼接非空 char 查询，blank 格不查；
 * 非汉字（标点 / 字母 / 数字 / 空白）不给拼音——保证多音字在词中取音，单字回退首个读音。 */
export const getLinePinyins = (cells) => {
	const out = (cells || []).map(function () { return ''; });
	const chars = [];
	const idx = [];
	(cells || []).forEach(function (c, i) {
		const ch = c && c.char ? String(c.char) : '';
		if (!ch) return;
		chars.push(ch);
		idx.push(i);
	});
	if (!chars.length) return out;
	const arr = getPinyinArray(chars.join(''));
	for (let k = 0; k < idx.length; k++) {
		const ch = chars[k];
		out[idx[k]] = isHanzi(ch) && arr[k] ? arr[k] : '';
	}
	return out;
};

/* 加载状态提示 */
export const isPinyinReady = () => !!fn;
