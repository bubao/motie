/**
 * 笔顺：封装 Hanzi Writer（CDN UMD）。
 * 笔画数据由 Hanzi Writer 自行按字从 CDN 加载，失败时返回 false / null，由调用方降级为静态单字。
 * 动画（play）与静态笔顺序号（loadCharData / getStrokeMedians）共用同一份字形数据缓存。
 *
 * 命名约定：本文件是「笔顺 / 字形数据」（stroke order），与 stroke-library.js（内置笔画剪影图案库）
 * 职责互斥，改动共享逻辑时注意不要改错文件。
 */

import { loadHanziWriter } from './assets.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/* 字形数据参考框边长（hanzi-writer-data 的 1024 坐标系） */
const GLYPH_BOX = 1024;
let writer = null;
let watcher = null;

const isAvailable = () => !!(window.HanziWriter && typeof window.HanziWriter.create === 'function');

/* 字形数据缓存：char -> Promise（字形数据或 null）；动画与静态笔顺共用，避免重复请求 */
const dataCache = new Map();

/* 从字形数据提取每笔中点（0..1 相对 1024 参考框，y 向下）。
 * 纯函数，供测试与屏幕 / PDF 绘制共用。 */
export const extractMedians = (charData) => {
	const medians = charData && charData.medians;
	if (!Array.isArray(medians) || !medians.length) return null;
	const out = [];
	for (let i = 0; i < medians.length; i++) {
		const pts = medians[i];
		if (!Array.isArray(pts) || !pts.length) continue;
		/* 取笔画采样点的中位点，代表该笔中段位置 */
		const mid = pts[Math.floor(pts.length / 2)];
		if (!Array.isArray(mid) || mid.length < 2) continue;
		const x = Number(mid[0]);
		const y = Number(mid[1]);
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		out.push({ x: x / GLYPH_BOX, y: y / GLYPH_BOX });
	}
	return out.length ? out : null;
};

/* 加载字形数据（HanziWriter.loadCharacterData，内部按字缓存）；未就绪 / 失败返回 null */
export const loadCharData = async (char) => {
	if (!char) return null;
	if (!dataCache.has(char)) {
		dataCache.set(char, (async () => {
			const ok = await loadHanziWriter();
			if (!ok || !isAvailable()) return null;
			try {
				return await window.HanziWriter.loadCharacterData(char);
			} catch {
				return null;
			}
		})());
	}
	const data = await dataCache.get(char);
	/* 未就绪 / 加载失败不缓存：删除以便下次重试（避免时序问题导致永久不显示） */
	if (!data) dataCache.delete(char);
	return data || null;
};

/* 每笔中点（0..1）；未就绪 / 失败返回 null（调用方不显示，不阻塞渲染） */
export const getStrokeMedians = async (char) => {
	const data = await loadCharData(char);
	return data ? extractMedians(data) : null;
};

/* 清缓存（资源来源切换 / 测试隔离用） */
export const resetStrokeData = () => {
	dataCache.clear();
};

const destroy = () => {
	if (watcher) {
		try { watcher.disconnect(); } catch { /* 忽略 */ }
		watcher = null;
	}
	if (writer) {
		if (typeof writer.cancelAnimation === 'function') {
			try { writer.cancelAnimation(); } catch { /* 忽略 */ }
		}
		writer = null;
	}
};

const play = (stage, char, options) => {
	if (!isAvailable() || !stage || !char) return false;
	destroy();
	stage.textContent = '';
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('width', '100%');
	svg.setAttribute('height', '100%');
	stage.appendChild(svg);
	try {
		writer = window.HanziWriter.create(svg, char, {
			width: 240,
			height: 240,
			padding: 20,
			showOutline: true,
			showCharacter: true,
			strokeColor: '#B03A2C',
			outlineColor: '#DCD3BF',
			strokeAnimationSpeed: 1,
			delayBetweenStrokes: 0.15,
			...(options || {})
		});
		/* svg 的 CSS 尺寸是画布尺寸（280），而 HanziWriter 按 width/height 选项（240）
		 * 布局（内部 g transform 按 240 坐标系）。不设 viewBox 时用户坐标不随 CSS
		 * 缩放，字形会按 240 排在左上角、明显偏离田字格中心。 */
		svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
		centerGlyph(svg);
		/* 笔画数据异步加载：DOM 填充后重算居中 */
		if (typeof MutationObserver !== 'undefined') {
			watcher = new MutationObserver(() => centerGlyph(svg));
			watcher.observe(svg, { childList: true, subtree: true });
		}
		writer.animateCharacter();
		return true;
	} catch {
		writer = null;
		return false;
	}
};

/* 按字形实际墨迹包围盒（含轮廓）把字形中心平移到画布中心。
 * HanziWriter 的 g transform 以字形数据参考框（1024）的 bounds 居中，
 * 该 bounds 与实际笔画墨迹范围不一致（如「永」字墨迹偏左上），
 * 直接缩放仍会看着歪。这里解析 g 的 translate/scale，换算墨迹中心在
 * 240 坐标系的位置，再用 viewBox 平移对齐中心（不改 HanziWriter 内部坐标）。 */
const centerGlyph = (svg) => {
	if (!svg) return;
	const g = svg.querySelector('g');
	if (!g) return;
	let bb;
	try {
		bb = g.getBBox();
	} catch {
		return;
	}
	if (!bb || !bb.width || !bb.height) return;
	const t = (g.getAttribute('transform') || '').replace(/\s+/g, ' ');
	const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)\s*scale\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(t);
	if (!m) return;
	const tx = Number(m[1]), ty = Number(m[2]), sx = Number(m[3]), sy = Number(m[4]);
	const x0 = tx + sx * bb.x, x1 = tx + sx * (bb.x + bb.width);
	const y0 = ty + sy * bb.y, y1 = ty + sy * (bb.y + bb.height);
	const cx = (Math.min(x0, x1) + Math.max(x0, x1)) / 2;
	const cy = (Math.min(y0, y1) + Math.max(y0, y1)) / 2;
	/* 240 = HanziWriter 的 width/height 选项（见 play），viewBox 与布局同尺寸 */
	svg.setAttribute('viewBox', `${(cx - 120).toFixed(2)} ${(cy - 120).toFixed(2)} 240 240`);
};

export const Stroke = {
	isAvailable,
	play,
	destroy
};
