/**
 * 纸张底色 / 纹理（C-d）：屏幕预览、打印、PDF 导出共用同一份派生逻辑。
 * 标准版核心模块；lite 使用独立副本（lite-src/vendor/，逻辑同源、语法风格有意不同步）。
 *
 * - paperBgOf(cfg)：PaperTint 自定义 hex 优先，否则取 PaperColor 预设；非法回退纯白。
 * - paperTextureUri(cfg)：按 PaperTexture 生成 SVG data URI（none / 非法 → null）。
 *   纹理为确定性伪随机（固定种子），保证屏幕与 PDF 平铺图案一致。
 */
import { PAPER_COLORS, sanitizeHexColor } from './config.js';

/* 平铺单元边长（px @96dpi ≈ 47.6mm）：纤维 / 洒金在该尺度内随机分布 */
export const PAPER_TILE_PX = 180;

/* 确定性伪随机（mulberry32）：同种子每次生成同一图案，避免屏幕 / PDF 不一致 */
function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0; a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const f = (n) => (Math.round(n * 100) / 100).toString();

/* 宣纸纤维：短弧线随机取向，烘焙低透明度（浅褐调），不抢字格 */
function fiberSvg() {
	const rnd = mulberry32(20261127);
	let paths = '';
	for (let i = 0; i < 26; i++) {
		const x = rnd() * PAPER_TILE_PX;
		const y = rnd() * PAPER_TILE_PX;
		const len = 20 + rnd() * 50;
		const ang = rnd() * Math.PI;
		const dx = Math.cos(ang) * len;
		const dy = Math.sin(ang) * len;
		const bend = (rnd() - 0.5) * 18;
		const alpha = f(0.06 + rnd() * 0.1);
		paths += '<path d="M ' + f(x) + ' ' + f(y)
			+ ' q ' + f(dx / 2 + bend) + ' ' + f(dy / 2 - bend)
			+ ' ' + f(dx) + ' ' + f(dy)
			+ '" stroke-width="' + f(0.5 + rnd() * 0.5)
			+ '" opacity="' + alpha + '"/>';
	}
	return '<svg xmlns="http://www.w3.org/2000/svg" width="' + PAPER_TILE_PX + '" height="' + PAPER_TILE_PX
		+ '" viewBox="0 0 ' + PAPER_TILE_PX + ' ' + PAPER_TILE_PX + '">'
		+ '<g fill="none" stroke="#60563C">' + paths + '</g></svg>';
}

/* 洒金：随机金点 + 少量深点，像手工撒金箔的疏密感 */
function speckleSvg() {
	const rnd = mulberry32(20261128);
	let dots = '';
	for (let i = 0; i < 90; i++) {
		const x = rnd() * PAPER_TILE_PX;
		const y = rnd() * PAPER_TILE_PX;
		const r = f(0.4 + rnd() * 1.3);
		const gold = rnd() > 0.25;
		const alpha = f(gold ? 0.22 + rnd() * 0.26 : 0.12 + rnd() * 0.18);
		dots += '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + r
			+ '" fill="' + (gold ? '#B08A36' : '#7A6230') + '" opacity="' + alpha + '"/>';
	}
	return '<svg xmlns="http://www.w3.org/2000/svg" width="' + PAPER_TILE_PX + '" height="' + PAPER_TILE_PX
		+ '" viewBox="0 0 ' + PAPER_TILE_PX + ' ' + PAPER_TILE_PX + '">' + dots + '</svg>';
}

/* 最终纸张底色：PaperTint 非空即覆盖预设色 */
export const paperBgOf = (cfg) => {
	const fallback = PAPER_COLORS[(cfg && cfg.PaperColor) || 'white'] || PAPER_COLORS.white;
	const tint = sanitizeHexColor(cfg && cfg.PaperTint);
	return tint || fallback;
};

/* 纹理 data URI（none / 未知 → null） */
export const paperTextureUri = (cfg) => {
	const kind = cfg && cfg.PaperTexture;
	if (kind === 'fiber') return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fiberSvg());
	if (kind === 'speckle') return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(speckleSvg());
	return null;
};
