/**
 * 版式真源：屏幕预览、PDF 导出、打印分页共用同一份计算结果。
 * 标准版核心模块；lite 使用独立副本（lite-src/vendor/，逻辑同源、语法风格有意不同步）。
 *
 * 输出结构：
 * {
 *   page: {width, height}, margin: {top,right,bottom,left},
 *   gridMm, gapMm, rowBoxMm, pitchMm, cols, rows, rowsFirst, titleH,
 *   pages: [{ title: string, lines: [[{ char, role }]] }]
 * }
 * role ∈ model | trace | blank（见 Layout.cellRole）。
 */
import { DEFAULTS, MIN_REPEAT_COUNT, MAX_REPEAT_COUNT } from './config.js';
import { ContentModel, Layout, ENGLISH_LETTER_STEP } from './content.js';

const DEFAULT_PAGE = { width: 210, height: 297 };
const DEFAULT_MARGIN = { top: 5, right: 16, bottom: 5, left: 16 }; /* 与 @page / content.js 一致 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/* 纸张与页边距：优先取显式入参，其次配置（cfg），最后内置默认值。 */
const resolvePage = (options, cfg) => {
	const page = options.page || cfg.Page || DEFAULT_PAGE;
	const margin = options.margin || cfg.Margin || DEFAULT_MARGIN;
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
};

/* 字格边长（px，0–200）；ContentModel.pageLayout 内部按 96dpi 换算为 mm。 */
const gridPx = (value) => clamp(Number(value) || 80, 10, 200);

const compute = (options) => {
	options = options || {};
	/* config 显式传入时以它为准（Redux 唯一状态源）；缺省回退 DEFAULTS。 */
	const cfg = options.config || DEFAULTS;

	const resolved = resolvePage(options, cfg);
	const { page, margin } = resolved;
	const gridSize = options.gridPx != null ? options.gridPx : cfg.GridSize;
	const rowGap = options.rowGap != null ? options.rowGap : cfg.RowGap;
	const colsOverride = options.cols != null ? options.cols : cfg.Cols;
	const template = options.template || cfg.Template;
	const highlightFirst = options.highlightFirst != null ? options.highlightFirst : cfg.HighlightFirst;
	const traceCount = options.traceCount != null ? options.traceCount : cfg.TraceCount;
	/* 描红遍数（对齐 z2h）：非控笔、>1 时内容行整体重复，首遍按模板、其余强制描红 */
	const traceRounds = options.traceRounds != null ? options.traceRounds : cfg.TraceRounds;
	/* 节奏描红参数（仅 template === 'rhythm' 生效）：每行范字 / 描红 / 逐行递减 */
	const rhythm = {
		model: options.traceModel != null ? options.traceModel : cfg.TraceModel,
		trace: options.traceTrace != null ? options.traceTrace : cfg.TraceTrace,
		decay: options.traceDecay != null ? options.traceDecay : cfg.TraceDecay
	};
	const content = options.content != null ? options.content : cfg.Content;
	const mode = options.mode != null ? options.mode : cfg.Mode;
	/* 英文字母大小写成对（仅解析期生效）；练习密度（空行 / 空列） */
	const pairCase = options.pairCase != null ? options.pairCase : cfg.EngPairCase;
	const blankRowEvery = options.blankRowEvery != null ? options.blankRowEvery : cfg.BlankRowEvery;
	const blankColEvery = options.blankColEvery != null ? options.blankColEvery : cfg.BlankColEvery;
	/* 控笔图案 key（仅 Mode='control' 生效；行单元 char 字段存该值） */
	const pattern = options.pattern != null ? options.pattern : cfg.ControlPattern;
	/* 控笔练习行数（P1-3：仅 Mode='control' 且 >0 生效；0 = 跟随内容行 / 满页） */
	const controlRows = options.controlRows != null ? options.controlRows : cfg.ControlRows;
	const title = options.title != null ? options.title : cfg.Title;
	/* 每页页首标题（Z2=C-b）：默认仅首页；开启后每页显示，字号为格高百分比 */
	const showPageTitle = options.showPageTitle != null ? options.showPageTitle : cfg.ShowPageTitle;
	const pageTitleScale = options.pageTitleScale != null ? options.pageTitleScale : cfg.PageTitleScale;

	const zgType = options.zgType != null ? options.zgType : cfg.ZgType;
	const gridRatio = options.gridRatio != null ? options.gridRatio : cfg.GridRatio;
	/* 字间距（%）：0–30，间隙 = 格宽 × 该值；列数按「格 + 间隙」有效步距自适应 */
	const charGap = options.charGap != null ? options.charGap : cfg.CharGap;
	/* 单元重复（对齐 z2h）：模板为 repeat 时每个单元独占一行，列数锁定为「描红数 + 1」，
	 * 允许格宽小于理想值（overCols）；其余情况仍受自适应列数上限约束。 */
	const repeatUnit = options.repeatUnit != null ? options.repeatUnit : cfg.RepeatUnit;
	const repeatCount = Math.max(MIN_REPEAT_COUNT, Math.min(MAX_REPEAT_COUNT,
		Number(options.repeatCount != null ? options.repeatCount : cfg.RepeatCount) || DEFAULTS.RepeatCount));
	const useRepeat = template === 'repeat' && (repeatUnit === 'char' || repeatUnit === 'word');
	const base = ContentModel.pageLayout(gridPx(gridSize), page, margin, useRepeat ? repeatCount + 1 : colsOverride, rowGap, zgType, gridRatio, useRepeat, charGap);
	const titleH = title ? base.gridMm * 0.9 : 0;
	/* 每页都带标题时，所有页少一行；否则维持「仅首页少一行」的旧行为 */
	const eachTitle = !!title && !!showPageTitle;
	const rowsFirst = titleH > 0 && base.rows > 1 ? base.rows - 1 : base.rows;
	const rowsRest = eachTitle && base.rows > 1 ? base.rows - 1 : base.rows;
	/* 行距为精确值（见 pageLayout），各页行距周期一致；有标题时第一页只少一行，
	 * 行区在可用高内垂直居中（渲染侧 .rows 统一处理），无需按页重算行距。 */
	const pitchFirstMm = base.pitchMm;

	const pages = ContentModel.paginate(
		ContentModel.parse(content, mode, pairCase),
		base.cols,
		base.rows,
		rowsFirst,
		mode,
		pattern,
		controlRows,
		blankRowEvery,
		blankColEvery,
		useRepeat ? repeatUnit : null,
		traceRounds
	);

	/* 行号跨页累计：参数化模板的 decay（逐字递减）按练习进程递减 */
	let rowNo = 0;
	const out = pages.map((lines, pageIndex) => {
		const rendered = lines.map((line) => {
			const rowIndex = rowNo++;
			/* english：词单元行（词折行；整词一个角色，词内字母连续） */
			if (line.words) {
				return {
					eng: true,
					words: line.words.map((word, index) => {
						let role = Layout.cellRole(index, template, traceCount, rowIndex, rhythm);
						if (highlightFirst && index === 0) role = 'model';
						/* 描红遍数：非首遍一律描红（含词内字母） */
						if (traceRounds > 1 && rowIndex % traceRounds !== 0 && word.chars.length) role = 'trace';
						return { chars: word.chars, marks: word.marks, offset: word.offset, role };
					}),
					cells: []
				};
			}
			return {
				eng: false,
				words: [],
				cells: line.map((item, index) => {
					/* 空格占位 / 行尾补满格：有格无字，一律按空临格处理 */
					let role = item.char === '' ? 'blank' : Layout.cellRole(index, template, traceCount, rowIndex, rhythm);
					/* 首字高亮（A5）：每行首字强制范字（深色），其余按模板 */
					if (highlightFirst && index === 0 && item.char !== '') role = 'model';
					/* 描红遍数：非首遍强制描红（空临格保持 blank） */
					if (traceRounds > 1 && rowIndex % traceRounds !== 0 && item.char !== '') role = 'trace';
					/* src：单元重复下重复副本携带源内容序号，供点击编辑定位回源字（与 replaceCharAt 编号一致） */
					return { char: item.char, mark: item.mark || '', role, src: item.src };
				})
			};
		});
		/* 整页铺满：页内不足目标行数时补空临格行（有字显示字，无字也画格）。
		 * 补行不计入 rowNo，保持 decay 模板按内容行号递减的语义。 */
		const target = pageIndex === 0 ? rowsFirst : rowsRest;
		while (rendered.length < target) {
			if (mode === 'english') {
				rendered.push({ eng: true, words: [], cells: [] });
			} else {
				const blankLine = [];
				for (let c = 0; c < base.cols; c++) blankLine.push({ char: '', mark: '', role: 'blank' });
				rendered.push({ eng: false, words: [], cells: blankLine });
			}
		}
		/* 本页覆盖的可渲染字符序号区间（Z3：页级删页 / 合并反推源内容；无内容则为 null） */
		let srcFrom = -1;
		let srcTo = -1;
		rendered.forEach(function (line) {
			(line.cells || []).forEach(function (c) {
				if (c.src == null) return;
				if (srcFrom < 0 || c.src < srcFrom) srcFrom = c.src;
				if (c.src > srcTo) srcTo = c.src;
			});
			(line.words || []).forEach(function (w) {
				if (w.src == null) return;
				const last = w.src + w.chars.length - 1;
				if (srcFrom < 0 || w.src < srcFrom) srcFrom = w.src;
				if (last > srcTo) srcTo = last;
			});
		});
		return {
			title: eachTitle || pageIndex === 0 ? title : '',
			lines: rendered,
			srcFrom: srcFrom < 0 ? null : srcFrom,
			srcTo: srcFrom < 0 ? null : srcTo
		};
	});

	return {
		page,
		margin,
		usableW: base.usableW,
		usableH: base.usableH,
		gridMm: base.gridMm,
		cellGapMm: base.cellGapMm,
		pitchFactor: base.pitchFactor,
		gapMm: base.gapMm,
		rowBoxMm: base.rowBoxMm,
		pitchMm: base.pitchMm,
		ratio: base.ratio,
		pitchFirstMm,
		cols: base.cols,
		rows: base.rows,
		rowsFirst,
		showPageTitle: eachTitle,
		pageTitleScale: pageTitleScale,
		fixedCols: colsOverride > 0,
		repeat: useRepeat,
		titleH,
		letterStep: ENGLISH_LETTER_STEP,
		pages: out
	};
};

export const SheetLayout = { compute };
