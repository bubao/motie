import { useMemo } from 'react';
import { getZgBackground, resolveZgOptions } from '../core/index.js';

/**
 * 字格背景 hook：配置 → 绘制参数（resolveZgOptions）→ SVG data URI。
 * 预览 / PDF / 面板缩略图同源；配置引用变化才重算。
 */
export function useZgBackground(config) {
	var opts = useMemo(function () {
		return resolveZgOptions(config);
	}, [config]);
	return useMemo(function () {
		return getZgBackground(opts);
	}, [opts]);
}
