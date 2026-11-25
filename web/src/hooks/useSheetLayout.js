import { useMemo } from 'react';
import { SheetLayout } from '../core/index.js';

/**
 * 版式真源 hook：把 SheetLayout.compute 包进 useMemo，依赖显式且全量。
 *
 * 为什么不用组件内手写 useMemo：compute 读取的 config 字段很多（Content / Title /
 * Template / TraceCount / TraceModel / TraceTrace / TraceDecay / Cols / RowGap /
 * GridSize / GridRatio / ZgType / Page / Margin），手写依赖漏一个就会出现「改了设置
 * 但预览不更新」的缓存 bug（历史上字格切换、节奏参数都踩过）。这里统一以 config
 * 对象整体为依赖（Redux 任一字段变化都会换对象），并显式列出两个可覆盖项。
 *
 * options（均为原始值，保证依赖稳定）：
 *   content：覆盖内容（默认 config.Content）
 *   cols：覆盖每行格数（默认 config.Cols；传 0 可强制自适应求上限）
 */
export function useSheetLayout(config, options) {
	options = options || {};
	var content = options.content;
	var cols = options.cols;
	return useMemo(function () {
		return SheetLayout.compute({
			content: content != null ? content : config.Content,
			mode: config.Mode,
			title: config.Title,
			template: config.Template,
			traceCount: config.TraceCount,
			traceModel: config.TraceModel,
			traceTrace: config.TraceTrace,
			traceDecay: config.TraceDecay,
			cols: cols != null ? cols : config.Cols,
			rowGap: config.RowGap,
			gridPx: config.GridSize,
			gridRatio: config.GridRatio,
			config: config
		});
	}, [config, content, cols]);
}
