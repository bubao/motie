/**
 * 字帖内容模型：把「字帖内容」解析为行（换行）与分页（空行），
 * 供页面渲染、打印分页与 PDF 导出共用，保证三处分页口径一致。
 * 标准版核心模块；lite 使用独立副本（lite-src/vendor/，逻辑同源、语法风格有意不同步）。
 *
 * 规则：
 *   - 换行（\r\n / \r / \n）结束当前行；
 *   - 真空行 = 分页（内容首尾的空行忽略，连续空行合并为一处分页）；
 *   - 只含空格的行 = 占位空临格行（每个空格一格，行尾再补满到整行格数）；
 *   - 非汉字字符不渲染（沿用原有行为），但「标点」不占格：附在前字右下角（mark）；
 *   - 行首标点忽略（无前字可附）；连续标点依次追加到前字（如 ……）；
 *   - 汉字判定与代理对拆分按 Unicode 码点处理。
 */
import { DEFAULTS, MIN_CHAR_GAP, MAX_CHAR_GAP, CONTROL_ALIAS_TO_KEY } from './config.js';
import { strokeKeyFor, matchStrokeToken } from './stroke-library.js';

const MM_PER_PX = 25.4 / 96;                                   /* CSS px → 毫米 */
const DEFAULT_PAGE = { width: 210, height: 297 };               /* A4（mm） */
const DEFAULT_MARGIN = { top: 5, bottom: 5, left: 16, right: 16 }; /* 与 @page 一致 */

/* 逐码点拆分，兼容代理对（生僻字） */
const splitChars = (str) => {
	const out = [];
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
			const next = str.charCodeAt(i + 1);
			if (next >= 0xDC00 && next <= 0xDFFF) {
				out.push(str.charAt(i) + str.charAt(i + 1));
				i++;
				continue;
			}
		}
		out.push(str.charAt(i));
	}
	return out;
};

const isHan = (char) => {
	const code = char.charCodeAt(0);
	if (char.length > 1) return code >= 0xD800 && code <= 0xDBFF; /* 代理对：按生僻字处理 */
	return (code >= 0x4E00 && code <= 0x9FFF) ||
		(code >= 0x3400 && code <= 0x4DBF) ||
		(code >= 0xF900 && code <= 0xFAFF);
};

/* 字符集模式判定（B0）：不同模式决定哪些字符占格 */
const NUMBER_RE = /[0-9]/;
const ENGLISH_RE = /[a-zA-Z]/;
const PINYIN_RE = /[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/;

const isRenderable = (char, mode) => {
	if (mode === 'stroke') return !!strokeKeyFor(char);
	if (mode === 'number') return NUMBER_RE.test(char);
	if (mode === 'pinyin') return PINYIN_RE.test(char);
	if (mode === 'english') return ENGLISH_RE.test(char);
	return isHan(char);
};

/* 标点集：CJK 符号标点 + 全角标点 + 常见西文标点。
 * 不占格，附在前字右下角（mark）。 */
const MARK_RE = /[\u3001-\u303F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65\u2018\u2019\u201C\u201D\u2026\u2014\u00B7,.;:!?()\[\]'"-]/;

const isMark = (char) => MARK_RE.test(char);

/* 空格（半角 / 全角 / 制表符）= 占位空临格：有格无字，供「插入空格子」。 */
const isSpace = (char) => char === ' ' || char === '\u3000' || char === '\t';

/* 英文词单元几何（格宽倍率）：词内字母连续步距 < 1 格，词间空 1 格。
 * 屏幕（Preview flex/absolute）与 PDF（fillText 逐字母）共用同一组倍率。 */
export const ENGLISH_LETTER_STEP = 0.62;
export const ENGLISH_WORD_GAP = 1;

/* english 行解析：空格分词，输出词单元 [{chars, marks}]（标点附词尾字母）。
 * pairCase：每个字母展开为「大写 + 小写」两格（Aa），标点仍附词尾（小写格）。 */
const parseEnglishLine = (line, pairCase) => {
	const words = [];
	let cur = null;
	const parts = splitChars(line);
	for (let j = 0; j < parts.length; j++) {
		const part = parts[j];
		if (isRenderable(part, 'english')) {
			if (!cur) {
				cur = { chars: [], marks: [] };
				words.push(cur);
			}
			cur.chars.push(pairCase ? part.toUpperCase() : part);
			cur.marks.push('');
			if (pairCase) {
				cur.chars.push(part.toLowerCase());
				cur.marks.push('');
			}
		} else if (isSpace(part)) {
			cur = null; /* 词边界 */
		} else if (isMark(part) && cur) {
			cur.marks[cur.marks.length - 1] += part;
		}
	}
	return words.filter((w) => w.chars.length);
};

/* 解析内容为 blocks：[{type:'row', chars:[...]} | {type:'page'}]
 * mode：hanzi（默认，仅汉字）/ stroke / number / pinyin / english / control。
 * stroke：按最长匹配把内容切成笔画 token（名称 + 单字别名，如「横竖撇捺」），
 * char = 笔画 key（矢量剪影，见 stroke-library.js）；未收录字符忽略。
 * control：内容里的图形字符（CONTROL_PATTERNS 的 alias，如 1-9 / A-R）各占一个图案行；
 * 不含 alias 的非空行 = 一行默认图案；空行 = 分页。每行铺满 cols 个图案单元
 * （char = 图案 key，见 paginate）。 */
const parse = (text, mode, pairCase) => {
	const m = mode || 'hanzi';
	const blocks = [];
	const lines = String(text == null ? '' : text).split(/\r\n|\r|\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		/* 真空行 = 分页；只含空格的行进入下方循环，解析为占位空临格行 */
		if (line === '') {
			blocks.push({ type: 'page' });
			continue;
		}
		/* control：扫描图形字符（alias）→ 每个 alias 一个图案行（pattern=key）；
		 * 该行无 alias 时 pattern=null，由 paginate 回退到 ControlPattern。 */
		if (m === 'control') {
			const keys = [];
			splitChars(line).forEach((part) => {
				const key = CONTROL_ALIAS_TO_KEY[part];
				if (key) keys.push(key);
			});
			if (keys.length) {
				keys.forEach((key) => blocks.push({ type: 'row', chars: [], marks: [], pattern: key }));
			} else {
				blocks.push({ type: 'row', chars: [], marks: [], pattern: null });
			}
			continue;
		}
		/* stroke：最长匹配切分笔画 token；空格 = 空临格；标点附前笔（同汉字规则） */
		if (m === 'stroke') {
			const chars = [];
			const marks = [];
			const parts = splitChars(line);
			for (let j = 0; j < parts.length;) {
				const part = parts[j];
				if (isSpace(part)) {
					chars.push('');
					marks.push('');
					j++;
					continue;
				}
				const tok = matchStrokeToken(parts, j);
				if (tok) {
					chars.push(tok.key);
					marks.push('');
					j += tok.len;
					continue;
				}
				if (isMark(part) && chars.length && chars[chars.length - 1] !== '') {
					marks[marks.length - 1] += part;
				}
				j++; /* 其余字符忽略 */
			}
			if (chars.length) blocks.push({ type: 'row', chars, marks });
			continue;
		}
		/* english：按词解析（空格 = 词边界），同时展开 chars / marks 供统计与兼容 */
		if (m === 'english') {
			const words = parseEnglishLine(line, pairCase);
			if (words.length) {
				const chars = [];
				const marks = [];
				words.forEach((w, wi) => {
					if (wi > 0) {
						chars.push('');
						marks.push('');
					}
					w.chars.forEach((ch, ci) => {
						chars.push(ch);
						marks.push(w.marks[ci] || '');
					});
				});
				blocks.push({ type: 'row', chars, marks, words });
			}
			continue;
		}
		const chars = [];
		const marks = [];
		const parts = splitChars(line);
		for (let j = 0; j < parts.length; j++) {
			const part = parts[j];
			if (isRenderable(part, m)) {
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
		if (chars.length) blocks.push({ type: 'row', chars, marks });
	}

	/* 首尾空行忽略、连续空行合并 */
	const normalized = [];
	let prevPage = false;
	blocks.forEach((block) => {
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

	let total = 0;
	normalized.forEach((block) => {
		if (block.type !== 'row') return;
		/* control：每行 = 一行图案（文字内容不参与计数） */
		if (m === 'control') {
			total += 1;
			return;
		}
		block.chars.forEach((ch) => {
			if (ch !== '') total++;
		});
	});
	return { blocks: normalized, total };
};

/* 每页可容纳的行列数（按纸张与格子大小计算）；colsOverride>0 时锁定每行格数，
 * 但不得超过纸宽可容纳的列数（联约束：屏幕 / 打印 / PDF 三端一致）。
 * 字间距 CharGap（%）：间隙 = 格宽 × CharGap/100；列数按「格 + 间隙」有效步距自适应，
 * 实际格宽 = 可用宽均分到「格 + 间隙」（无右侧留白）；CharGap=0 时退化为纯格宽紧邻。
 * zgType：拼音格（'5'）字格高 1.4×格（上区四线占位 0.4 + 下区田字格 1.0），行盒随之；其余 1.0×格。
 * gridRatio：格子宽高比 ×100（0 = 自动，随 zgType；60–160 = 用户值），行盒高 = 格宽 × 该比例。 */
const pageLayout = (gridPx, page, margin, colsOverride, rowGap, zgType, gridRatio, overCols, charGap) => {
	page = page || DEFAULT_PAGE;
	margin = margin || DEFAULT_MARGIN;
	const size = gridPx || DEFAULTS.GridSize;
	/* 字间距收敛到 0–30（%），防脏配置 */
	const gapPct = Math.min(MAX_CHAR_GAP, Math.max(MIN_CHAR_GAP, Number(charGap) || 0));
	const gapRatio = gapPct / 100;
	const pitchFactor = 1 + gapRatio; /* 有效步距 = 格宽 × (1 + 间隙比例) */
	const usableW = page.width - margin.left - margin.right;
	const usableH = page.height - margin.top - margin.bottom;
	const idealGridMm = size * MM_PER_PX; /* 理想格宽：决定列数 */
	/* 列数按「格 + 间隙」有效步距；实际格宽 = 可用宽均分到「格 + 间隙」（均分铺满，无右侧留白） */
	const autoCols = Math.max(1, Math.floor(usableW / (idealGridMm * pitchFactor)));
	/* overCols（单元重复专用）：锁定列数可超过自适应上限，格宽随之收缩（对齐 z2h 描红本形态） */
	const cols = colsOverride > 0 ? (overCols ? colsOverride : Math.min(colsOverride, autoCols)) : autoCols;
	const gridMm = usableW / (cols + (cols - 1) * gapRatio);
	/* 宽高比：0 = 自动（拼音格 1.4×、格上拼音条 1.25×，其余 1.0×）；用户值按 ×100 存储（60–160）。 */
	const ratio = gridRatio > 0 ? Math.min(2, Math.max(0.5, gridRatio / 100)) : (zgType === '5' ? 1.4 : (zgType === '10' ? 1.25 : 1));
	/* 行距 = 配置倍率 × 行盒高：行盒高 = 格宽 × 宽高比（默认随字格类型），行距随之等比放大；
	 * 这样不同字格类型 / 宽高比的行间空白与格子高度成比例（屏幕 / 打印 / PDF 三端共用）。 */
	const rowBoxMm = gridMm * ratio;
	const gapMm = rowBoxMm * (rowGap || 0);
	const pitchMm = rowBoxMm + gapMm;
	/* 行数按精确行距折算：n 行占 n×行盒 + (n-1)×行距 ≤ 可用高 */
	const rows = Math.max(1, Math.floor((usableH + gapMm) / pitchMm));
	return {
		usableW,
		usableH,
		idealGridMm,
		gridMm,
		cellGapMm: gridMm * gapRatio,
		pitchFactor,
		gapMm,
		rowBoxMm,
		pitchMm,
		idealPitchMm: pitchMm,
		ratio,
		cols,
		maxCols: autoCols,
		rows
	};
};

/* 练习密度：把「空行 / 空列」间隔注入内容块。
 * - blankColEvery>0：逐字模式（非 english 词结构）每 N 个有字格后插一个空临格（''）；
 * - blankRowEvery>0：每 N 个内容行后插一整行空临格（单个空格行，由补满逻辑铺满）。
 * 注入的占位 '' 不占字数、不进重复字统计；分页（page）不重置行计数，保持练习节奏一致。 */
const applySpacing = (blocks, blankRowEvery, blankColEvery) => {
	const rowEvery = Math.max(0, blankRowEvery | 0);
	const colEvery = Math.max(0, blankColEvery | 0);
	if (!rowEvery && !colEvery) return blocks;
	const out = [];
	let rowsSince = 0;
	blocks.forEach((block) => {
		if (block.type === 'page') {
			out.push(block);
			return;
		}
		let next = block;
		if (colEvery && block.chars && !block.words) {
			const chars = [];
			const marks = [];
			let count = 0;
			block.chars.forEach((ch, i) => {
				chars.push(ch);
				marks.push(block.marks[i] || '');
				if (ch !== '') {
					count++;
					if (count % colEvery === 0) {
						chars.push('');
						marks.push('');
					}
				}
			});
			next = Object.assign({}, block, { chars, marks });
		}
		out.push(next);
		rowsSince++;
		if (rowEvery && rowsSince >= rowEvery) {
			rowsSince = 0;
			out.push({ type: 'row', chars: [''], marks: [''] });
		}
	});
	return out;
};

/* 分页：一行超过 cols 个字时自动折行；空行处强制分页。
 * rowsFirst：第一页可用行数（有标题时更少），默认与 rows 相同。
 * mode='english'：按词折行——词内字母连续（步距 ENGLISH_LETTER_STEP 格）、
 * 词间空 ENGLISH_WORD_GAP 格，词不被拆断；行输出 { words: [{chars, marks, offset}] }。
 * mode='control'：按内容生成图案行（每行铺满 cols 格），char = pattern（图案 key）。
 * 每行图案取自内容中该行的图形字符（alias）；无 alias 的行用 pattern（ControlPattern）。
 * 内容为空时生成满页（rows 行）。
 * controlRows>0（P1-3）：控笔练习行数显式指定总图案行数（忽略内容文本，由分页逻辑切成页）。
 * traceRounds>1：描红遍数——每条内容行整体重复 N 遍（控笔模式除外），首遍按模板、其余描红。 */
const paginate = (model, cols, rows, rowsFirst, mode, pattern, controlRows, blankRowEvery, blankColEvery, repeatUnit, traceRounds) => {
	cols = Math.max(1, cols | 0);
	rows = Math.max(1, rows | 0);
	rowsFirst = rowsFirst == null ? rows : Math.max(1, rowsFirst | 0);
	/* 练习密度（空行 / 空列）在分页前注入，保证页数估算与实际行序一致 */
	if ((blankRowEvery | 0) > 0 || (blankColEvery | 0) > 0) {
		model = Object.assign({}, model, { blocks: applySpacing(model.blocks, blankRowEvery | 0, blankColEvery | 0) });
	}
	const isEnglish = mode === 'english';
	const isControl = mode === 'control';
	const fallbackPat = pattern || DEFAULTS.ControlPattern;
	const controlRow = (key) => {
		const row = [];
		for (let k = 0; k < cols; k++) row.push({ char: key, mark: '' });
		return row;
	};

	let lines = [];
	/* 控笔练习行数（显式控件）：>0 时固定生成 N 行图案，内容文本不再参与行数 */
	const fixedControlRows = isControl ? Math.max(0, controlRows | 0) : 0;
	model.blocks.forEach((block) => {
		/* 逐字块统一在此解构：单元重复 / 常规逐字分支共用（避免重复块内 TDZ） */
		const { chars, marks = [] } = block;
		if (block.type === 'page') {
			lines.push(null);
			return;
		}
		if (isControl) {
			/* 逐行图案：alias 指定该行图案，缺省回退 ControlPattern */
			lines.push(controlRow(block.pattern || fallbackPat));
			return;
		}
		if (isEnglish && block.words) {
			/* used = 下一个词的起点（已含词宽 + 词间空）；词不拆断，放不下即换行 */
			let line = null;
			let used = 0;
			block.words.forEach((word) => {
				const w = word.chars.length * ENGLISH_LETTER_STEP;
				if (line && used + w > cols) {
					lines.push(line);
					line = null;
					used = 0;
				}
				if (!line) {
					line = { words: [], cells: [] };
					used = 0;
				}
				line.words.push({ chars: word.chars, marks: word.marks, offset: used });
				used += w + ENGLISH_WORD_GAP;
			});
		if (line) lines.push(line);
		return;
	}
	/* 单元重复（对齐 z2h）：每个单元独占一行——char 逐字成行、word 按空白分词（词不拆行）；
	 * 行内循环重复该单元直到填满列数（首格范字 / 其余描红由 sheet-layout 用模板 'repeat' 定角色）；
	 * src = 源内容序号（重复副本共享同一个），供点击编辑定位回源字；空格不产生空临格。 */
	if (repeatUnit === 'char' || repeatUnit === 'word') {
		let srcNo = 0;
		const pushUnit = (unitChars, unitMarks, unitSrcs) => {
			const len = unitChars.length;
			const line = [];
			for (let k = 0; k < cols; k++) {
				const i = k % len;
				line.push({ char: unitChars[i], mark: unitMarks[i] || '', src: unitSrcs[i] });
			}
			lines.push(line);
		};
		const units = [];
		let cur = null;
		block.chars.forEach(function (ch, i) {
			if (ch !== '' && isRenderable(ch, mode)) {
				if (!cur) { cur = { chars: [], marks: [], srcs: [] }; units.push(cur); }
				cur.chars.push(ch);
				cur.marks.push(marks[i] || '');
				cur.srcs.push(srcNo++);
				return;
			}
			/* word：空白 / 非可渲染字符断开词；char：不在此处拆，后面逐个拆行 */
			if (repeatUnit === 'word' && cur) cur = null;
		});
		units.forEach(function (u) {
			if (repeatUnit === 'char') u.chars.forEach(function (ch, i) { pushUnit([ch], [u.marks[i]], [u.srcs[i]]); });
			else pushUnit(u.chars, u.marks, u.srcs);
		});
		return;
	}
		for (let i = 0; i < chars.length; i += cols) {
			const slice = chars.slice(i, i + cols);
			const sliceMarks = marks.slice(i, i + cols);
			/* 行尾补满空临格到整行格数（auto_fill），让每行格子数一致、左右不留参差 */
			while (slice.length < cols) {
				slice.push('');
				sliceMarks.push('');
			}
			lines.push(slice.map((char, k) => ({ char, mark: sliceMarks[k] || '' })));
		}
	});

	/* control：显式行数优先；否则内容为空（无有效行）时生成满页，保证「选控笔练习即有图案」 */
	if (isControl) {
		if (fixedControlRows > 0) {
			lines.length = 0;
			for (let r = 0; r < fixedControlRows; r++) lines.push(controlRow(fallbackPat));
		} else if (!lines.length) {
			for (let r = 0; r < rows; r++) lines.push(controlRow(fallbackPat));
		}
	}

	/* 描红遍数（对齐 z2h「描红数量」）：非控笔模式下把每条内容行整体重复 N 遍，
	 * 首遍按模板角色、其余遍在 sheet-layout 强制为描红；空行分页符不复制。 */
	const rounds = Math.max(1, Math.min(50, Number(traceRounds) || 1));
	if (!isControl && rounds > 1) {
		const expanded = [];
		lines.forEach((line) => {
			if (line === null) { expanded.push(null); return; }
			for (let r = 0; r < rounds; r++) expanded.push(line);
		});
		lines = expanded;
	}

	const pages = [];
	let current = [];
	lines.forEach((line) => {
		if (line === null) {
			if (current.length) {
				pages.push(current);
				current = [];
			}
			return;
		}
		const limit = pages.length === 0 ? rowsFirst : rows;
		if (current.length >= limit) {
			pages.push(current);
			current = [];
		}
		current.push(line);
	});
	if (current.length) pages.push(current);
	if (!pages.length) pages.push([]);
	return pages;
};

/* 替换 / 删除第 index 个可渲染字符（标点不参与编号，与渲染格子顺序一致）：
 * newChar 为空串时删除；非单个可渲染字符输入忽略（返回原文）。
 * 供「点击格子编辑单字」写回 Content。mode 默认 hanzi（兼容旧调用）。 */
const replaceCharAt = (text, index, newChar, mode) => {
	const m = mode || 'hanzi';
	const parts = splitChars(String(text == null ? '' : text));
	let charIndex = 0;
	for (let i = 0; i < parts.length; i++) {
		if (!isRenderable(parts[i], m)) continue;
		if (charIndex !== index) {
			charIndex++;
			continue;
		}
		if (!newChar) {
			parts.splice(i, 1);
			return parts.join('');
		}
		const nextParts = splitChars(String(newChar));
		if (nextParts.length !== 1 || !isRenderable(nextParts[0], m)) return String(text);
		parts[i] = nextParts[0];
		return parts.join('');
	}
	return String(text);
};

/* 兼容旧名：汉字模式替换 */
const replaceHanAt = (text, index, newChar) => replaceCharAt(text, index, newChar, 'hanzi');

/* 估算页数（格子大小 + 可选纸张 / 边距 + 可选锁定列数 / 行距）；
 * page / margin 缺省时用 A4 默认纸，与 lite 固定版式口径一致。 */
const estimatePages = (text, gridPx, colsOverride, rowGap, page, margin, gridRatio, mode, pairCase, blankRowEvery, blankColEvery, repeatUnit, overCols, charGap, traceRounds) => {
	const layout = pageLayout(gridPx, page, margin, colsOverride, rowGap, undefined, gridRatio, overCols, charGap);
	return paginate(parse(text, mode, pairCase), layout.cols, layout.rows, null, mode, null, 0, blankRowEvery, blankColEvery, repeatUnit, traceRounds).length;
};

/* 重复字统计：按当前模式计可渲染字符，返回 [{char, count}]（count > 1），按次数降序、同次数按首次出现顺序 */
const charStats = (text, mode) => {
	const counts = {};
	const order = [];
	parse(text, mode).blocks.forEach((block) => {
		if (block.type !== 'row') return;
		block.chars.forEach((ch) => {
			if (ch === '') return; /* 占位空临格不计入重复字统计 */
			if (counts[ch] == null) {
				counts[ch] = 0;
				order.push(ch);
			}
			counts[ch]++;
		});
	});
	return order
		.map((ch) => ({ char: ch, count: counts[ch] }))
		.filter((item) => item.count > 1)
		.sort((a, b) => b.count - a.count);
};

/* 兼容旧名：汉字模式统计 */
const hanStats = (text) => charStats(text, 'hanzi');

/* 排版模板：决定行内每个格子的角色（范字 model / 描红 trace / 空临 blank） */
const TEMPLATE_ROLE = {
	normal: () => 'model',
	trace: () => 'trace',
	trace3: (index, traceCount) => (index < traceCount ? 'model' : 'trace'),
	lead: (index) => (index === 0 ? 'model' : 'trace'),
	blank: () => 'blank'
};

const ROLE_NAMES = { model: true, trace: true, blank: true };

/**
 * 参数化模板：以对象描述行内角色，便于扩展「一字三描红」之外的节奏。
 * - { model: n }：前 n 格范字，其余描红（等价 trace3）
 * - { trace: true } / { blank: true } / { lead: true }：整页描红 / 空临格 / 首字范字
 * - { repeat: ['model','trace','trace'] }：按行循环 pattern
 * - { repeat: [...], decay: 1 }：逐字递减——每行从行尾减少 decay 格（至少保留 1 格）
 * 行角色只认识 model / trace / blank，其余值回退 model。
 */
const roleFromParams = (index, params, rowIndex) => {
	const p = params || {};
	if (p.repeat && p.repeat.length) {
		let pattern = p.repeat;
		if (p.decay) {
			const drop = Math.max(0, Number(rowIndex) || 0) * Number(p.decay);
			pattern = pattern.slice(0, Math.max(1, pattern.length - drop));
		}
		const role = pattern[index % pattern.length];
		return ROLE_NAMES[role] ? role : 'model';
	}
	if (p.blank) return 'blank';
	if (p.lead) return index === 0 ? 'model' : 'trace';
	if (p.trace) return 'trace';
	if (p.model != null) return index < Number(p.model) ? 'model' : 'trace';
	return 'model';
};

export const Layout = {
	cellRole(index, template, traceCount, rowIndex, rhythm) {
		/* 对象参数优先；字符串（旧枚举）仍可用 */
		if (template && typeof template === 'object') return roleFromParams(index, template, rowIndex);
		if (template === 'repeat') return index === 0 ? 'model' : 'trace';
		if (template === 'rhythm') {
			/* 节奏描红：每行前 model 格范字（深），接着 trace 格描红（浅），其余 blank（临写）。
			 * decay > 0 时每行描红递减（范字保留），逐行从「描红多」过渡到「全临写」。 */
			const m = rhythm && rhythm.model > 0 ? rhythm.model : DEFAULTS.TraceModel;
			const t = rhythm && rhythm.trace != null ? Math.max(0, rhythm.trace) : DEFAULTS.TraceTrace;
			const decay = rhythm && rhythm.decay > 0 ? rhythm.decay : 0;
			const tRow = Math.max(0, t - (rowIndex || 0) * decay);
			if (index < m) return 'model';
			if (index < m + tRow) return 'trace';
			return 'blank';
		}
		const fn = TEMPLATE_ROLE[template] || TEMPLATE_ROLE.normal;
		return fn(index, traceCount);
	}
};

export const ContentModel = {
	parse,
	paginate,
	applySpacing,
	pageLayout,
	estimatePages,
	replaceHanAt,
	replaceCharAt,
	isRenderable,
	isHan,
	hanStats,
	charStats,
	splitChars,
	mmPerPx: MM_PER_PX,
	defaultPage: DEFAULT_PAGE,
	defaultMargin: DEFAULT_MARGIN
};
