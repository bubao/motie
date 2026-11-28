/**
 * 打印缩放（C-f）：避免页面宽度超出纸张可打印区导致右侧裁切。
 * 标准版核心模块；lite 使用独立副本（lite-src/vendor/，逻辑同源、语法风格有意不同步）。
 *
 * - PrintScale = 0（自动）：页宽超过 SAFE_PRINT_WIDTH_MM 时等比缩小到安全宽度；否则 1。
 * - PrintScale > 0：按用户给定百分比（上限 100，不放大）。
 */
import { SAFE_PRINT_WIDTH_MM } from './config.js';

export const printScaleOf = (cfg) => {
	const manual = Number(cfg && cfg.PrintScale);
	if (Number.isFinite(manual) && manual > 0) return Math.min(100, manual) / 100;
	const width = Number(cfg && cfg.Page && cfg.Page.width);
	if (!Number.isFinite(width) || width <= 0) return 1;
	return Math.min(1, SAFE_PRINT_WIDTH_MM / width);
};
