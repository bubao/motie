/**
 * 汉字拼音：按需动态加载 pinyin-pro（CDN 或本地 vendor，由 core/assets 决定），
 * 失败时静默降级（不显示拼音）。
 */
import { loadPinyinLib } from './assets.js';

const TONE_OPTIONS = { toneType: 'symbol', type: 'string' };
let fn = null;
let loading = null;
let cache = {};

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
};

/* 同步取拼音：模块就绪后可用；未就绪时返回空串（调用方可在就绪后重渲染） */
export const getPinyin = (char) => {
	if (!char) return '';
	if (!fn && typeof window !== 'undefined' && typeof window.pinyinPro === 'function') fn = window.pinyinPro;
	if (!fn) return '';
	if (!Object.prototype.hasOwnProperty.call(cache, char)) cache[char] = compute(char);
	return cache[char];
};

/* 加载状态提示 */
export const isPinyinReady = () => !!fn;
