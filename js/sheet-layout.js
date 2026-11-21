/**
 * 版式真源：屏幕预览、PDF 导出、打印分页共用同一份计算结果。
 * 完整版与 Kindle 精简版共享（精简版按需打包内联）。
 *
 * 输出结构：
 * {
 *   page: {width, height}, margin: {top,right,bottom,left},
 *   gridMm, gapMm, rowBoxMm, pitchMm, cols, rows, rowsFirst, titleH,
 *   pages: [{ title: string, lines: [[{ char, role }]] }]
 * }
 * role ∈ model | trace | blank（见 Z.Layout.cellRole）。
 */
(function (Z) {
	'use strict';

	var DEFAULT_PAGE = { width: 210, height: 297 };
	var DEFAULT_MARGIN = { top: 5, right: 16, bottom: 5, left: 16 }; /* 与 @page / content.js 一致 */

	function clamp(value, min, max) {
		return Math.min(max, Math.max(min, value));
	}

	/* 纸张与页边距：优先取显式入参，其次配置（cfg），最后内置默认值。 */
	function resolvePage(options, cfg) {
		var page = options.page || cfg.Page || DEFAULT_PAGE;
		var margin = options.margin || cfg.Margin || DEFAULT_MARGIN;
		return {
			page: {
				width: Number(page.width) > 0 ? Number(page.width) : DEFAULT_PAGE.width,
				height: Number(page.height) > 0 ? Number(page.height) : DEFAULT_PAGE.height
			},
			margin: {
				top: clamp(Number(margin.top) || 0, 0, 60),
				right: clamp(Number(margin.right) || 0, 0, 60),
				bottom: clamp(Number(margin.bottom) || 0, 0, 60),
				left: clamp(Number(margin.left) || 0, 0, 60)
			}
		};
	}

	/* 字格边长（px，0–200）；ContentModel.pageLayout 内部按 96dpi 换算为 mm。 */
	function gridPx(value) {
		return clamp(Number(value) || 80, 10, 200);
	}

	function compute(options) {
		options = options || {};
		/* config 显式传入时以它为准（Redux 唯一状态源）；缺省回退 Z.Config（共享核心/精简版）。 */
		var cfg = options.config || Z.Config;

		var resolved = resolvePage(options, cfg);
		var page = resolved.page;
		var margin = resolved.margin;
		var gridSize = options.gridPx != null ? options.gridPx : cfg.GridSize;
		var rowGap = options.rowGap != null ? options.rowGap : cfg.RowGap;
		var colsOverride = options.cols != null ? options.cols : cfg.Cols;
		var template = options.template || cfg.Template;
		var traceCount = options.traceCount != null ? options.traceCount : cfg.TraceCount;
		var content = options.content != null ? options.content : cfg.Content;
		var title = options.title != null ? options.title : cfg.Title;

		var zgType = options.zgType != null ? options.zgType : cfg.ZgType;
		var gridRatio = options.gridRatio != null ? options.gridRatio : cfg.GridRatio;
		var base = Z.ContentModel.pageLayout(gridPx(gridSize), page, margin, colsOverride, rowGap, zgType, gridRatio);
		var titleH = title ? base.gridMm * 0.9 : 0;
		var rowsFirst = base.rows;
		if (titleH > 0 && base.rows > 1) rowsFirst = base.rows - 1;
		/* 行距为精确值（见 pageLayout），各页行距周期一致；有标题时第一页只少一行，
		 * 行区在可用高内垂直居中（渲染侧 .rows 统一处理），无需按页重算行距。 */
		var pitchFirstMm = base.pitchMm;

		var pages = Z.ContentModel.paginate(
			Z.ContentModel.parse(content),
			base.cols,
			base.rows,
			rowsFirst
		);

		/* 行号跨页累计：参数化模板的 decay（逐字递减）按练习进程递减 */
		var rowNo = 0;
		var out = pages.map(function (lines, pageIndex) {
			var rendered = lines.map(function (cells) {
				var rowIndex = rowNo++;
				return cells.map(function (item, index) {
					/* 空格占位 / 行尾补满格：有格无字，一律按空临格处理 */
					var role = item.char === '' ? 'blank' : Z.Layout.cellRole(index, template, traceCount, rowIndex);
					return { char: item.char, mark: item.mark || '', role: role };
				});
			});
			/* 整页铺满：页内不足目标行数时补空临格行（有字显示字，无字也画格）。
			 * 补行不计入 rowNo，保持 decay 模板按内容行号递减的语义。 */
			var target = pageIndex === 0 ? rowsFirst : base.rows;
			while (rendered.length < target) {
				var blankLine = [];
				for (var c = 0; c < base.cols; c++) blankLine.push({ char: '', mark: '', role: 'blank' });
				rendered.push(blankLine);
			}
			return { title: pageIndex === 0 ? title : '', lines: rendered };
		});

		return {
			page: page,
			margin: margin,
			usableW: base.usableW,
			usableH: base.usableH,
			gridMm: base.gridMm,
			gapMm: base.gapMm,
			rowBoxMm: base.rowBoxMm,
			pitchMm: base.pitchMm,
			ratio: base.ratio,
			pitchFirstMm: pitchFirstMm,
			cols: base.cols,
			rows: base.rows,
			rowsFirst: rowsFirst,
			fixedCols: colsOverride > 0,
			titleH: titleH,
			pages: out
		};
	}

	Z.SheetLayout = { compute: compute };
})(window.Zitie = window.Zitie || {});
