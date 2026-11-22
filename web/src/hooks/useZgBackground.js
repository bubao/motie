import { useMemo } from 'react';
import { getZgBackground } from '../core/index.js';

/**
 * 字格背景 hook：按「字格类型 / 颜色 / 线宽倍率 / 线样式」取 SVG data URI。
 * getZgBackground 内部按同组合缓存，这里再包一层 useMemo，避免每次渲染重复查表。
 */
export function useZgBackground(type, color, scale, mode) {
	return useMemo(function () {
		return getZgBackground(type, color, scale, mode);
	}, [type, color, scale, mode]);
}
