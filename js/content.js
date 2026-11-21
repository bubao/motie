/**
 * 字帖内容模型：把「字帖内容」解析为行（换行）与分页（空行），
 * 供页面渲染、打印分页与 PDF 导出共用，保证三处分页口径一致。
 * 完整版与 Kindle 精简版共享此文件（精简版构建时打包内联）。
 *
 * 规则：
 *   - 换行（\r\n / \r / \n）结束当前行；
 *   - 真空行 = 分页（内容首尾的空行忽略，连续空行合并为一处分页）；
 *   - 只含空格的行 = 占位空临格行（每个空格一格，行尾再补满到整行格数）；
 *   - 非汉字字符不渲染（沿用原有行为），但「标点」不占格：附在前字右下角（mark）；
 *   - 行首标点忽略（无前字可附）；连续标点依次追加到前字（如 ……）；
 *   - 汉字判定与代理对拆分采用 ES5 码点写法，兼容精简版目标环境。
 */
(function (Z) {
	'use strict';

	var MM_PER_PX = 25.4 / 96;                                   /* CSS px → 毫米 */
	var DEFAULT_PAGE = { width: 210, height: 297 };               /* A4（mm） */
	var DEFAULT_MARGIN = { top: 5, bottom: 5, left: 16, right: 16 }; /* 与 @page 一致 */

	/* 逐码点拆分，兼容代理对（生僻字） */
	function splitChars(str) {
		var out = [];
		for (var i = 0; i < str.length; i++) {
			var code = str.charCodeAt(i);
			if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
				var next = str.charCodeAt(i + 1);
				if (next >= 0xDC00 && next <= 0xDFFF) {
					out.push(str.charAt(i) + str.charAt(i + 1));
					i++;
					continue;
				}
			}
			out.push(str.charAt(i));
		}
		return out;
	}

	function isHan(char) {
		var code = char.charCodeAt(0);
		if (char.length > 1) return code >= 0xD800 && code <= 0xDBFF; /* 代理对：按生僻字处理 */
		return (code >= 0x4E00 && code <= 0x9FFF) ||
			(code >= 0x3400 && code <= 0x4DBF) ||
			(code >= 0xF900 && code <= 0xFAFF);
	}

	/* 标点集：CJK 符号标点 + 全角标点 + 常见西文标点。
	 * 不占格，附在前字右下角（mark）。 */
	var MARK_RE = /[\u3001-\u303F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65\u2018\u2019\u201C\u201D\u2026\u2014\u00B7,.;:!?()\[\]'"-]/;

	function isMark(char) {
		return MARK_RE.test(char);
	}

	/* 空格（半角 / 全角 / 制表符）= 占位空临格：有格无字，供「插入空格子」。 */
	function isSpace(char) {
		return char === ' ' || char === '\u3000' || char === '\t';
	}

	/* 解析内容为 blocks：[{type:'row', chars:[...]} | {type:'page'}] */
	function parse(text) {
		var blocks = [];
		var lines = String(text == null ? '' : text).split(/\r\n|\r|\n/);
		for (var i = 0; i < lines.length; i++) {
			var line = lines[i];
			/* 真空行 = 分页；只含空格的行进入下方循环，解析为占位空临格行 */
			if (line === '') {
				blocks.push({ type: 'page' });
				continue;
			}
			var chars = [];
			var marks = [];
			var parts = splitChars(line);
			for (var j = 0; j < parts.length; j++) {
				var part = parts[j];
				if (isHan(part)) {
					chars.push(part);
					marks.push('');
				} else if (isSpace(part)) {
					/* 空格占位：空临格（有格无字） */
					chars.push('');
					marks.push('');
				} else if (isMark(part) && chars.length && chars[chars.length - 1] !== '') {
					/* 标点不占格：追加到前字右下角（前格为占位空格则忽略） */
					marks[marks.length - 1] += part;
				}
				/* 其余字符（字母 / 数字 / 行首标点）忽略 */
			}
			if (chars.length) blocks.push({ type: 'row', chars: chars, marks: marks });
		}

		/* 首尾空行忽略、连续空行合并 */
		var normalized = [];
		var prevPage = false;
		blocks.forEach(function (block) {
			if (block.type !== 'page') {
				normalized.push(block);
				prevPage = false;
				return;
			}
			if (!normalized.length || prevPage) return;
			normalized.push(block);
			prevPage = true;
		});
		while (normalized.length && normalized[normalized.length - 1].type === 'page') normalized.pop();

		var total = 0;
		normalized.forEach(function (block) {
			if (block.type !== 'row') return;
			block.chars.forEach(function (ch) {
				if (ch !== '') total++;
			});
		});
		return { blocks: normalized, total: total };
	}

	/* 每页可容纳的行列数（按纸张与格子大小计算）；colsOverride>0 时锁定每行格数，
	 * 但不得超过纸宽可容纳的列数（联约束：屏幕 / 打印 / PDF 三端一致，见 T0.5）。
 * 列数按纯格宽：cols*gridMm <= usableW（字距已移除，格子水平紧邻）。
 * zgType：拼音格（'5'）字格高 1.4×格（上区四线占位 0.4 + 下区田字格 1.0），行盒随之；其余 1.0×格。
 * gridRatio：格子宽高比 ×100（0 = 自动，随 zgType；60–160 = 用户值），行盒高 = 格宽 × 该比例。 */
	function pageLayout(gridPx, page, margin, colsOverride, rowGap, zgType, gridRatio) {
		page = page || DEFAULT_PAGE;
		margin = margin || DEFAULT_MARGIN;
		var size = gridPx || Z.Config.GridSize;
		var usableW = page.width - margin.left - margin.right;
		var usableH = page.height - margin.top - margin.bottom;
		var idealGridMm = size * MM_PER_PX; /* 理想格宽：决定列数 */
		/* 列数按理想格宽；实际格宽 = 可用宽 / 列数（均分铺满，无右侧留白） */
		var autoCols = Math.max(1, Math.floor(usableW / idealGridMm));
		var cols = colsOverride > 0 ? Math.min(colsOverride, autoCols) : autoCols;
		var gridMm = usableW / cols;
		/* 宽高比：0 = 自动（拼音格 1.4×，其余 1.0×）；用户值按 ×100 存储（60–160）。 */
		var ratio = gridRatio > 0 ? Math.min(2, Math.max(0.5, gridRatio / 100)) : (zgType === '5' ? 1.4 : 1);
		/* 行距 = 配置倍率 × 行盒高：行盒高 = 格宽 × 宽高比（默认随字格类型），行距随之等比放大；
		 * 这样不同字格类型 / 宽高比的行间空白与格子高度成比例（屏幕 / 打印 / PDF 三端共用）。 */
		var rowBoxMm = gridMm * ratio;
		var gapMm = rowBoxMm * (rowGap || 0);
		var pitchMm = rowBoxMm + gapMm;
		/* 行数按精确行距折算：n 行占 n×行盒 + (n-1)×行距 ≤ 可用高 */
		var rows = Math.max(1, Math.floor((usableH + gapMm) / pitchMm));
		return {
			usableW: usableW,
			usableH: usableH,
			idealGridMm: idealGridMm,
			gridMm: gridMm,
			gapMm: gapMm,
			rowBoxMm: rowBoxMm,
			pitchMm: pitchMm,
			idealPitchMm: pitchMm,
			ratio: ratio,
			cols: cols,
			maxCols: autoCols,
			rows: rows
		};
	}

	/* 分页：一行超过 cols 个字时自动折行；空行处强制分页。
	 * rowsFirst：第一页可用行数（有标题时更少），默认与 rows 相同。 */
	function paginate(model, cols, rows, rowsFirst) {
		cols = Math.max(1, cols | 0);
		rows = Math.max(1, rows | 0);
		rowsFirst = rowsFirst == null ? rows : Math.max(1, rowsFirst | 0);

		var lines = [];
		model.blocks.forEach(function (block) {
			if (block.type === 'page') {
				lines.push(null);
				return;
			}
			var chars = block.chars;
			var marks = block.marks || [];
			for (var i = 0; i < chars.length; i += cols) {
				var slice = chars.slice(i, i + cols);
				var sliceMarks = marks.slice(i, i + cols);
				/* 行尾补满空临格到整行格数（auto_fill），让每行格子数一致、左右不留参差 */
				while (slice.length < cols) {
					slice.push('');
					sliceMarks.push('');
				}
				lines.push(slice.map(function (char, k) {
					return { char: char, mark: sliceMarks[k] || '' };
				}));
			}
		});

		var pages = [];
		var current = [];
		lines.forEach(function (line) {
			if (line === null) {
				if (current.length) {
					pages.push(current);
					current = [];
				}
				return;
			}
			var limit = pages.length === 0 ? rowsFirst : rows;
			if (current.length >= limit) {
				pages.push(current);
				current = [];
			}
			current.push(line);
		});
		if (current.length) pages.push(current);
		if (!pages.length) pages.push([]);
		return pages;
	}

	/* 替换 / 删除第 index 个汉字（标点不参与编号，与渲染格子顺序一致）：
	 * newChar 为空串时删除；非单个汉字输入忽略（返回原文）。
	 * 供「点击格子编辑单字」写回 Content（T1.10）。 */
	function replaceHanAt(text, index, newChar) {
		var parts = splitChars(String(text == null ? '' : text));
		var hanIndex = 0;
		for (var i = 0; i < parts.length; i++) {
			if (!isHan(parts[i])) continue;
			if (hanIndex !== index) {
				hanIndex++;
				continue;
			}
			if (!newChar) {
				parts.splice(i, 1);
				return parts.join('');
			}
			var nextParts = splitChars(String(newChar));
			if (nextParts.length !== 1 || !isHan(nextParts[0])) return String(text);
			parts[i] = nextParts[0];
			return parts.join('');
		}
		return String(text);
	}

	/* 估算页数（格子大小 + 可选纸张 / 边距 + 可选锁定列数 / 行距）；
	 * page / margin 缺省时用 A4 默认纸，与 lite 固定版式口径一致。 */
	function estimatePages(text, gridPx, colsOverride, rowGap, page, margin, gridRatio) {
		var layout = pageLayout(gridPx, page, margin, colsOverride, rowGap, undefined, gridRatio);
		return paginate(parse(text), layout.cols, layout.rows).length;
	}

	/* 重复字统计：只计汉字，返回 [{char, count}]（count > 1），按次数降序、同次数按首次出现顺序 */
	function hanStats(text) {
		var counts = {};
		var order = [];
		parse(text).blocks.forEach(function (block) {
			if (block.type !== 'row') return;
			block.chars.forEach(function (ch) {
				if (ch === '') return; /* 占位空临格不计入重复字统计 */
				if (counts[ch] == null) {
					counts[ch] = 0;
					order.push(ch);
				}
				counts[ch]++;
			});
		});
		return order
			.map(function (ch) { return { char: ch, count: counts[ch] }; })
			.filter(function (item) { return item.count > 1; })
			.sort(function (a, b) { return b.count - a.count; });
	}

	/* 排版模板：决定行内每个格子的角色（范字 model / 描红 trace / 空临 blank） */
	var TEMPLATE_ROLE = {
		normal: function () { return 'model'; },
		trace: function () { return 'trace'; },
		trace3: function (index, traceCount) { return index < traceCount ? 'model' : 'trace'; },
		lead: function (index) { return index === 0 ? 'model' : 'trace'; },
		blank: function () { return 'blank'; }
	};

	var ROLE_NAMES = { model: true, trace: true, blank: true };

	/**
	 * 参数化模板（T2.1）：以对象描述行内角色，便于扩展「一字三描红」之外的节奏。
	 * - { model: n }：前 n 格范字，其余描红（等价 trace3）
	 * - { trace: true } / { blank: true } / { lead: true }：整页描红 / 空临格 / 首字范字
	 * - { repeat: ['model','trace','trace'] }：按行循环 pattern
	 * - { repeat: [...], decay: 1 }：逐字递减——每行从行尾减少 decay 格（至少保留 1 格），
	 *   如 ['model','trace','trace','trace'] + decay 1：1 范 3 描 → 1 范 2 描 → 1 范 1 描 → 全范字
	 * 行角色只认识 model / trace / blank，其余值回退 model。
	 */
	function roleFromParams(index, params, rowIndex) {
		var p = params || {};
		if (p.repeat && p.repeat.length) {
			var pattern = p.repeat;
			if (p.decay) {
				var drop = Math.max(0, Number(rowIndex) || 0) * Number(p.decay);
				pattern = pattern.slice(0, Math.max(1, pattern.length - drop));
			}
			var role = pattern[index % pattern.length];
			return ROLE_NAMES[role] ? role : 'model';
		}
		if (p.blank) return 'blank';
		if (p.lead) return index === 0 ? 'model' : 'trace';
		if (p.trace) return 'trace';
		if (p.model != null) return index < Number(p.model) ? 'model' : 'trace';
		return 'model';
	}

	Z.Layout = {
		cellRole: function (index, template, traceCount, rowIndex) {
			/* 对象参数优先；字符串（旧枚举）仍可用 */
			if (template && typeof template === 'object') return roleFromParams(index, template, rowIndex);
			var fn = TEMPLATE_ROLE[template] || TEMPLATE_ROLE.normal;
			return fn(index, traceCount);
		}
	};

	Z.ContentModel = {
		parse: parse,
		paginate: paginate,
		pageLayout: pageLayout,
		estimatePages: estimatePages,
		replaceHanAt: replaceHanAt,
		hanStats: hanStats,
		splitChars: splitChars,
		isHan: isHan,
		mmPerPx: MM_PER_PX,
		defaultPage: DEFAULT_PAGE,
		defaultMargin: DEFAULT_MARGIN
	};
})(window.Zitie = window.Zitie || {});
