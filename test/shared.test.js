/**
 * 共享核心回归测试（node test/shared.test.js / npm test）。
 * 覆盖：ConfigSchema 归一化、旧键迁移、parse / paginate / pageLayout / cellRole / SheetLayout。
 * 核心为 web/src/core 的 ESM 模块：用 esbuild 打成 CJS 单文件后执行，配最小 window + localStorage。
 */
'use strict';

var path = require('path');
var assert = require('assert');
var esbuild = require('esbuild');

var ROOT = path.resolve(__dirname, '..');

function makeStorage(initial) {
	var map = {};
	Object.keys(initial || {}).forEach(function (key) { map[key] = String(initial[key]); });
	return {
		getItem: function (key) { return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null; },
		setItem: function (key, value) { map[key] = String(value); },
		removeItem: function (key) { delete map[key]; }
	};
}

/* 核心 ESM 用 esbuild 打成 CJS 单文件后执行；每次执行得到独立模块实例
 * （Config 状态不跨测试串，与旧版逐文件 eval 语义一致）。 */
var CORE_BUNDLE = null;
function loadCore(storage) {
	/* location：share 模块拼 URL 用（encodeShare）；其余用例不读 */
	var win = {
		localStorage: storage || makeStorage(),
		ZITIE_BOOT: {},
		location: { protocol: 'https:', host: 'example.com', pathname: '/index.html', search: '', hash: '' }
	};
	global.window = win;
	if (!CORE_BUNDLE) {
		var result = esbuild.buildSync({
			entryPoints: [path.join(ROOT, 'web/src/core/index.js')],
			bundle: true,
			write: false,
			format: 'cjs',
			platform: 'browser',
			target: 'es2017',
			logLevel: 'warning'
		});
		CORE_BUNDLE = result.outputFiles[0].text;
	}
	var mod = { exports: {} };
	new Function('module', 'exports', 'require', CORE_BUNDLE)(mod, mod.exports, require);
	return mod.exports;
}

var passed = 0;
var failed = 0;

function test(name, fn) {
	try {
		fn();
		passed++;
		console.log('  ok  ' + name);
	} catch (err) {
		failed++;
		console.error('  FAIL ' + name);
		console.error('       ' + (err && err.message ? err.message : err));
	}
}

console.log('共享核心测试');

/* ---------- ConfigSchema 归一化 ---------- */

test('normalizeField：枚举非法值回退默认', function () {
	var Z = loadCore();
	assert.strictEqual(Z.normalizeField('Template', 'nope'), 'normal');
	assert.strictEqual(Z.normalizeField('InkColor', 'red'), 'cinnabar');
	assert.strictEqual(Z.normalizeField('ZgType', '12'), Z.DEFAULTS.ZgType);
	/* 新增格型 8 井字 / 9 英文四线为合法值 */
	assert.strictEqual(Z.normalizeField('ZgType', '8'), '8');
	assert.strictEqual(Z.normalizeField('ZgType', '9'), '9');
	/* 行区垂直对齐：默认居中，非法值回退居中 */
	assert.strictEqual(Z.DEFAULTS.VerticalAlign, 'center');
	assert.strictEqual(Z.normalizeField('VerticalAlign', 'top'), 'top');
	assert.strictEqual(Z.normalizeField('VerticalAlign', 'bottom'), 'bottom');
	assert.strictEqual(Z.normalizeField('VerticalAlign', 'middle'), 'center');
});

test('normalizeField：int / percent 区间夹取', function () {
	var Z = loadCore();
	assert.strictEqual(Z.normalizeField('Cols', 999), Z.MAX_COLS);
	assert.strictEqual(Z.normalizeField('Cols', -3), 0);
	assert.strictEqual(Z.normalizeField('GridSize', 10), Z.MIN_GRID_SIZE);
	assert.strictEqual(Z.normalizeField('GridRatio', 120), 120);
	assert.strictEqual(Z.normalizeField('GridRatio', 0), 0);
	assert.strictEqual(Z.normalizeField('GridRatio', 999), Z.MAX_GRID_RATIO);
	assert.strictEqual(Z.normalizeField('RowGap', 2), 1);
	assert.strictEqual(Z.normalizeField('RowGap', 0.3), 0.3);
	assert.strictEqual(Z.normalizeField('InkAlpha', 0), Z.MIN_INK_ALPHA);
	/* 字体位置：允许负偏移，区间夹取后保留两位小数 */
	assert.strictEqual(Z.normalizeField('CharOffsetX', 1), Z.MAX_CHAR_OFFSET);
	assert.strictEqual(Z.normalizeField('CharOffsetX', -1), Z.MIN_CHAR_OFFSET);
	assert.strictEqual(Z.normalizeField('CharOffsetY', 0.2), 0.2);
	assert.strictEqual(Z.normalizeField('CharOffsetY', 'x'), 0);
	/* 控笔练习行数上限 200（P：控笔扩充） */
	assert.strictEqual(Z.normalizeField('ControlRows', 999), 200);
	assert.strictEqual(Z.normalizeField('ControlRows', -1), 0);
	/* 笔画粗细（C-c）：0–80 夹取，默认 0 = 不加粗 */
	assert.strictEqual(Z.DEFAULTS.InkWidth, 0);
	assert.strictEqual(Z.normalizeField('InkWidth', 999), Z.MAX_INK_WIDTH);
	assert.strictEqual(Z.normalizeField('InkWidth', -5), Z.MIN_INK_WIDTH);
	assert.strictEqual(Z.normalizeField('InkWidth', 40), 40);
	/* PNG 分辨率（C-e）：96–384dpi 夹取，默认 144 */
	assert.strictEqual(Z.DEFAULTS.PngDpi, 144);
	assert.strictEqual(Z.normalizeField('PngDpi', 999), Z.MAX_PNG_DPI);
	assert.strictEqual(Z.normalizeField('PngDpi', 1), Z.MIN_PNG_DPI);
	assert.strictEqual(Z.normalizeField('PngDpi', 288), 288);
});

test('控笔图案库：CONTROL_PATHS 覆盖全部 CONTROL_PATTERN_KEYS', function () {
	var Z = loadCore();
	assert.ok(Z.CONTROL_PATTERN_KEYS.length >= 16, '图案数量下限');
	Z.CONTROL_PATTERN_KEYS.forEach(function (key) {
		assert.ok(Z.CONTROL_PATHS[key], '缺少路径：' + key);
	});
	/* 每个 key 都能生成 SVG（范字实线 / 描红虚线），且路径非空 */
	Z.CONTROL_PATTERN_KEYS.forEach(function (key) {
		var svg = Z.buildControlSvg(key, '#c0392b', 'model');
		assert.ok(svg.indexOf('<path') >= 0 && svg.indexOf('d="M') >= 0, key + ' 未生成路径');
		assert.ok(Z.buildControlSvg(key, '#c0392b', 'trace').indexOf('stroke-dasharray') >= 0, key + ' 描红缺虚线');
		assert.strictEqual(Z.buildControlSvg(key, '#c0392b', 'blank'), '');
	});
	/* 未知 key 回退默认，背景 URI 可缓存 */
	assert.ok(Z.buildControlSvg('nope', '#000', 'model').indexOf('d="M') >= 0);
	assert.ok(Z.getControlBackground('wave', '#000', 'model').indexOf("url('data:image/svg+xml") === 0);
	assert.strictEqual(Z.getControlBackground('wave', '#000', 'model'), Z.getControlBackground('wave', '#000', 'model'));
	assert.strictEqual(Z.getControlBackground('wave', '#000', 'blank'), null);
});

test('normalizeField：text 截断与 bool 类型守卫', function () {
	var Z = loadCore();
	assert.strictEqual(Z.normalizeField('Content', '永'.repeat(6000)).length, Z.MAX_CONTENT_LENGTH);
	assert.strictEqual(Z.normalizeField('Title', '题'.repeat(50)).length, Z.MAX_TITLE_LENGTH);
	assert.strictEqual(Z.normalizeField('ShowPinyin', 'yes'), true);
	assert.strictEqual(Z.normalizeField('ShowPinyin', false), false);
});

test('normalizeField：未登记字段原样返回', function () {
	var Z = loadCore();
	assert.strictEqual(Z.normalizeField('whatever', 1), 1);
});

/* U3：空内容判定是导出 / 打印 / 分享提示的共同口径，需与 renderPages 前置校验一致 */
test('hasExportableContent：与导出前置校验同源（U3）', function () {
	var Z = loadCore();
	assert.strictEqual(Z.hasExportableContent({ Mode: 'normal', Content: '永' }), true);
	assert.strictEqual(Z.hasExportableContent({ Mode: 'normal', Content: '' }), false);
	assert.strictEqual(Z.hasExportableContent({ Mode: 'normal', Content: '   \n　' }), false);
	assert.strictEqual(Z.hasExportableContent({ Mode: 'english', Content: 'hello' }), true);
	assert.strictEqual(Z.hasExportableContent({ Mode: 'stroke', Content: '' }), false);
	/* 控笔图案由配置生成，不依赖正文 */
	assert.strictEqual(Z.hasExportableContent({ Mode: 'control', Content: '' }), true);
	/* 脏数据（null / undefined）按空处理，不抛错 */
	assert.strictEqual(Z.hasExportableContent(null), false);
	assert.strictEqual(Z.hasExportableContent({}), false);
});

/* ---------- Config 持久化 ---------- */

test('loadConfig：非法保存值按 Schema 归一化', function () {
	var storage = makeStorage({ 'zitie.config': JSON.stringify({ Template: 'x', RowGap: 5, Cols: 99, InkAlpha: 0 }) });
	var Z = loadCore(storage);
	var cfg = Z.loadConfig();
	assert.strictEqual(cfg.Template, 'normal');
	assert.strictEqual(cfg.RowGap, 1);
	assert.strictEqual(cfg.Cols, Z.MAX_COLS);
	assert.strictEqual(cfg.InkAlpha, Z.MIN_INK_ALPHA);
});

test('loadConfig：旧键 zitie-lite.config 迁移并写回统一键', function () {
	var storage = makeStorage({ 'zitie-lite.config': JSON.stringify({ TraceMode: true, Content: '永' }) });
	var Z = loadCore(storage);
	var cfg = Z.loadConfig();
	assert.strictEqual(cfg.Template, 'trace');
	assert.strictEqual(storage.getItem('zitie-lite.config'), null);
	assert.ok(storage.getItem('zitie.config'));
});

test('normalizeField：ModeStates 归一化（未知模式 / 字段丢弃，逐字段按 Schema 夹取）', function () {
	var Z = loadCore();
	var out = Z.normalizeField('ModeStates', {
		hanzi: { Content: '永', Template: 'trace', Cols: 999, evil: 'x' },
		hack: { Content: '坏' },
		number: null,
		english: [1, 2]
	});
	/* 仅保留已知模式键；非法条目（null / 数组）跳过 */
	assert.deepStrictEqual(Object.keys(out), ['hanzi']);
	assert.strictEqual(out.hanzi.Content, '永');
	assert.strictEqual(out.hanzi.Template, 'trace');
	assert.strictEqual(out.hanzi.Cols, Z.MAX_COLS);
	assert.strictEqual(out.hanzi.evil, undefined);
	/* 缺省字段补默认值 */
	assert.strictEqual(out.hanzi.Title, Z.DEFAULTS.Title);
	/* 非对象 / 数组回退空对象 */
	assert.deepStrictEqual(Z.normalizeField('ModeStates', null), {});
	assert.deepStrictEqual(Z.normalizeField('ModeStates', ['x']), {});
});

test('pickModeSnapshot / defaultModeState：类型快照字段与首次推荐（P0-1）', function () {
	var Z = loadCore();
	var snap = Z.pickModeSnapshot(Object.assign({}, Z.DEFAULTS, { Mode: 'number', Content: '01', Title: '数字', Cols: 5 }));
	assert.strictEqual(snap.Mode, 'number');
	assert.strictEqual(snap.Content, '01');
	assert.strictEqual(snap.Title, '数字');
	assert.strictEqual(snap.Cols, 5);
	/* 内容 + 版式 + 节奏 / 控笔行数，不含字体 / 主题 / 资源 */
	assert.ok(Z.MODE_SNAPSHOT_FIELDS.indexOf('Content') >= 0);
	assert.ok(Z.MODE_SNAPSHOT_FIELDS.indexOf('ControlRows') >= 0);
	assert.strictEqual(snap.Theme, undefined);
	assert.strictEqual(snap.FontSource, undefined);
	/* 首次进入：推荐字格 + 空内容 / 标题；拼音不带显示拼音 */
	assert.strictEqual(Z.defaultModeState('hanzi').ZgType, Z.MODE_ZG.hanzi);
	assert.strictEqual(Z.defaultModeState('number').ZgType, '7');
	assert.strictEqual(Z.defaultModeState('control').ZgType, '1');
	assert.strictEqual(Z.defaultModeState('pinyin').ShowPinyin, false);
	assert.strictEqual(Z.defaultModeState('english').Content, '');
	assert.strictEqual(Z.defaultModeState('english').Title, '');
});

test('saveConfig：只写 Schema 白名单 + 特殊字段', function () {
	var storage = makeStorage();
	var Z = loadCore(storage);
	var cfg = Z.loadConfig();
	cfg.evil = 'x';
	Z.saveConfig(cfg);
	var data = JSON.parse(storage.getItem('zitie.config'));
	assert.strictEqual(data.evil, undefined);
	assert.strictEqual(data.Template, 'normal');
	assert.strictEqual(typeof data.fontURL, 'string');
	assert.strictEqual(data.ResourceMode, 'cdn');
});

test('snapshotConfig / 预设：白名单快照、保存 / 加载 / 删除', function () {
	var Z = loadCore();
	var cfg = Z.loadConfig();
	cfg.evil = 'x';
	var snap = Z.snapshotConfig(cfg);
	assert.strictEqual(snap.Template, 'normal');
	assert.strictEqual(snap.GridSize, 80);
	assert.strictEqual(snap.evil, undefined);
	assert.deepStrictEqual(Z.loadPresets(), {});
	Z.savePreset('硬笔', { Template: 'trace', GridSize: 96 });
	assert.deepStrictEqual(Object.keys(Z.loadPresets()), ['硬笔']);
	assert.strictEqual(Z.loadPresets()['硬笔'].GridSize, 96);
	Z.deletePreset('硬笔');
	assert.deepStrictEqual(Z.loadPresets(), {});
});

/* ---------- 内容模型 ---------- */

test('parse：换行成行、空行分页、非汉字忽略', function () {
	var Z = loadCore();
	var model = Z.ContentModel.parse('永红\n\nab永');
	assert.deepStrictEqual(model.blocks.map(function (b) { return b.type; }), ['row', 'page', 'row']);
	assert.strictEqual(model.total, 3);
	assert.deepStrictEqual(model.blocks[0].chars, ['永', '红']);
	assert.deepStrictEqual(model.blocks[2].chars, ['永']);
});

test('parse：首尾空行忽略、连续空行合并', function () {
	var Z = loadCore();
	var model = Z.ContentModel.parse('\n\n永\n\n\n永\n\n');
	assert.deepStrictEqual(model.blocks.map(function (b) { return b.type; }), ['row', 'page', 'row']);
	assert.strictEqual(model.total, 2);
});

test('parse：代理对生僻字按一个字处理', function () {
	var Z = loadCore();
	var model = Z.ContentModel.parse('𠀀');
	assert.strictEqual(model.blocks[0].chars.length, 1);
});

test('parse：标点不占格（附前字右下角）', function () {
	var Z = loadCore();
	/* 含标点与纯汉字格子数相同 */
	var withMark = Z.ContentModel.parse('天地玄黄，宇宙洪荒');
	var plain = Z.ContentModel.parse('天地玄黄宇宙洪荒');
	assert.strictEqual(withMark.total, plain.total);
	assert.strictEqual(withMark.blocks[0].chars.length, 8);
	assert.deepStrictEqual(withMark.blocks[0].chars, ['天', '地', '玄', '黄', '宇', '宙', '洪', '荒']);
	assert.deepStrictEqual(withMark.blocks[0].marks, ['', '', '', '，', '', '', '', '']);
});

test('parse：连续标点依次追加、行首标点忽略', function () {
	var Z = loadCore();
	var model = Z.ContentModel.parse('永……红，');
	assert.deepStrictEqual(model.blocks[0].chars, ['永', '红']);
	assert.deepStrictEqual(model.blocks[0].marks, ['……', '，']);
	var lead = Z.ContentModel.parse('，永');
	assert.deepStrictEqual(lead.blocks[0].chars, ['永']);
	assert.deepStrictEqual(lead.blocks[0].marks, ['']);
});

test('parse：空格占位为空临格（计入格子、不计入字数）', function () {
	var Z = loadCore();
	var half = Z.ContentModel.parse('天 地');
	assert.deepStrictEqual(half.blocks[0].chars, ['天', '', '地']);
	assert.deepStrictEqual(half.blocks[0].marks, ['', '', '']);
	assert.strictEqual(half.total, 2);
	var full = Z.ContentModel.parse('天　地');
	assert.deepStrictEqual(full.blocks[0].chars, ['天', '', '地']);
	assert.strictEqual(full.total, 2);
});

test('parse：标点前是空格占位时忽略（不附到空格）', function () {
	var Z = loadCore();
	var model = Z.ContentModel.parse('天 ，地');
	assert.deepStrictEqual(model.blocks[0].chars, ['天', '', '地']);
	assert.deepStrictEqual(model.blocks[0].marks, ['', '', '']);
});

test('parse：真空行分页、纯空格行是占位空临格行', function () {
	var Z = loadCore();
	var paged = Z.ContentModel.parse('天\n\n地');
	assert.strictEqual(paged.blocks[1].type, 'page');
	var blankRow = Z.ContentModel.parse('天\n   \n地');
	assert.strictEqual(blankRow.blocks[1].type, 'row');
	assert.deepStrictEqual(blankRow.blocks[1].chars, ['', '', '']);
	assert.strictEqual(blankRow.total, 2);
	var filled = Z.ContentModel.paginate(blankRow, 8, 9, 9);
	assert.strictEqual(filled.length, 1);
	assert.strictEqual(filled[0].length, 3);
	assert.strictEqual(filled[0][1].length, 8);
	assert.ok(filled[0][1].every(function (c) { return c.char === ''; }));
});

test('paginate：每行末尾补满空临格到整行格数', function () {
	var Z = loadCore();
	var pages = Z.ContentModel.paginate(Z.ContentModel.parse('一二三四五'), 3, 9, 9);
	assert.deepStrictEqual(pages[0][0].map(function (c) { return c.char; }), ['一', '二', '三']);
	assert.deepStrictEqual(pages[0][1].map(function (c) { return c.char; }), ['四', '五', '']);
});

test('hanStats：占位空格不计入重复字统计', function () {
	var Z = loadCore();
	assert.deepStrictEqual(Z.ContentModel.hanStats('天 天'), [{ char: '天', count: 2 }]);
});

test('replaceHanAt：按汉字序号替换 / 删除，标点不参与编号', function () {
	var Z = loadCore();
	var text = '天地玄黄，宇宙洪荒';
	assert.strictEqual(Z.ContentModel.replaceHanAt(text, 3, '水'), '天地玄水，宇宙洪荒');
	assert.strictEqual(Z.ContentModel.replaceHanAt(text, 0, '一'), '一地玄黄，宇宙洪荒');
	assert.strictEqual(Z.ContentModel.replaceHanAt(text, 7, ''), '天地玄黄，宇宙洪');
	assert.strictEqual(Z.ContentModel.replaceHanAt(text, 3, '，'), text); /* 非汉字输入忽略 */
	assert.strictEqual(Z.ContentModel.replaceHanAt(text, 99, '水'), text); /* 越界不变 */
});

test('hanStats：只计汉字、按次数降序、同次数按首现顺序', function () {
	var Z = loadCore();
	assert.deepStrictEqual(Z.ContentModel.hanStats('天地玄黄，宇宙洪荒'), []);
	assert.deepStrictEqual(Z.ContentModel.hanStats('永永永红'), [{ char: '永', count: 3 }]);
	assert.deepStrictEqual(Z.ContentModel.hanStats('红永红永'), [{ char: '红', count: 2 }, { char: '永', count: 2 }]);
	assert.deepStrictEqual(Z.ContentModel.hanStats('永a永，永'), [{ char: '永', count: 3 }]);
	assert.deepStrictEqual(Z.ContentModel.hanStats(''), []);
});

test('B0 字符集模式：number / pinyin / english 解析与替换', function () {
	var Z = loadCore();
	assert.deepStrictEqual(Z.ContentModel.parse('123abc456', 'number').blocks[0].chars, ['1', '2', '3', '4', '5', '6']);
	var py = Z.ContentModel.parse('āáǎà', 'pinyin').blocks[0].chars;
	assert.deepStrictEqual(py, ['ā', 'á', 'ǎ', 'à']);
	var en = Z.ContentModel.parse('Hello World', 'english').blocks[0].chars;
	assert.deepStrictEqual(en, ['H', 'e', 'l', 'l', 'o', '', 'W', 'o', 'r', 'l', 'd']);
	assert.strictEqual(Z.ContentModel.isRenderable('5', 'number'), true);
	assert.strictEqual(Z.ContentModel.isRenderable('a', 'number'), false);
	assert.strictEqual(Z.ContentModel.isRenderable('ǚ', 'pinyin'), true);
	assert.strictEqual(Z.ContentModel.isRenderable('永', 'hanzi'), true);
	assert.strictEqual(Z.ContentModel.replaceCharAt('a1b2', 1, '9', 'number'), 'a1b9');
	assert.strictEqual(Z.ContentModel.replaceCharAt('a1b2', 0, '永', 'number'), 'a1b2'); /* 非数字输入忽略 */
	assert.deepStrictEqual(Z.ContentModel.charStats('1122', 'number'), [{ char: '1', count: 2 }, { char: '2', count: 2 }]);
});

test('B3 英文词单元：parse 分词 / paginate 按词折行（词内连续、词间留空、不拆词）', function () {
	var Z = loadCore();
	var model = Z.ContentModel.parse('Hello World', 'english');
	assert.deepStrictEqual(model.blocks[0].words.map(function (w) { return w.chars.join(''); }), ['Hello', 'World']);
	assert.strictEqual(model.total, 10);
	/* cols=6：Hello 占 3.1 + 词间空 1 = 下一词起点 4.1；World 宽 3.1 → 4.1+3.1=7.2 > 6，换行 */
	var pages = Z.ContentModel.paginate(model, 6, 9, null, 'english');
	assert.strictEqual(pages[0].length, 2);
	assert.strictEqual(pages[0][0].words[0].chars.join(''), 'Hello');
	assert.strictEqual(pages[0][1].words[0].chars.join(''), 'World');
	assert.strictEqual(pages[0][0].words[0].offset, 0);
	/* 短词同行：a b c 在 cols=10 内一行放下 */
	var p2 = Z.ContentModel.paginate(Z.ContentModel.parse('a b c', 'english'), 10, 9, null, 'english');
	assert.strictEqual(p2[0].length, 1);
	assert.strictEqual(p2[0][0].words.length, 3);
	assert.deepStrictEqual(p2[0][0].words.map(function (w) { return w.offset; }), [0, 0.62 + 1, (0.62 + 1) + 0.62 + 1]);
	/* 标点附词尾，不阻断分词 */
	var p3 = Z.ContentModel.parse('Hi, ok', 'english').blocks[0].words;
	assert.deepStrictEqual(p3.map(function (w) { return w.chars.join(''); }), ['Hi', 'ok']);
	assert.strictEqual(p3[0].marks[1], ',');
});

test('paginate：行内元素携带 char 与 mark', function () {
	var Z = loadCore();
	var pages = Z.ContentModel.paginate(Z.ContentModel.parse('天地，玄黄'), 2, 9, 9);
	var line = pages[0][0];
	assert.deepStrictEqual(line.map(function (c) { return c.char; }), ['天', '地']);
	assert.deepStrictEqual(line.map(function (c) { return c.mark; }), ['', '，']);
});

/* ---------- 版式计算 ---------- */

	test('pageLayout：A4 / 80px 基准与锁定列数', function () {
		var Z = loadCore();
		var base = Z.ContentModel.pageLayout(80, null, null, 5, 0.12);
		assert.strictEqual(base.cols, 5);
	assert.ok(Math.abs(base.gridMm - base.usableW / 5) < 1e-6, '格宽应均分可用宽');
	assert.ok(Math.abs(base.gapMm - base.gridMm * 0.12) < 1e-6, '行距应为配置倍率 × 行盒高（非拼音格 1.0×格）');
	assert.ok(Math.abs(base.rowBoxMm - base.gridMm * 1) < 1e-6, '非拼音格行盒应为 1.0×格');
	assert.ok(Math.abs(base.pitchMm - base.rowBoxMm - base.gapMm) < 1e-9, '行距周期 = 行盒 + 行距');
	assert.strictEqual(base.rows, Math.max(1, Math.floor((base.usableH + base.gapMm) / base.pitchMm)), '行数按精确行距折算');
	assert.ok(base.rows * base.rowBoxMm + (base.rows - 1) * base.gapMm <= base.usableH + 1e-9, '行块不超出可用高');
	assert.ok((base.rows + 1) * base.rowBoxMm + base.rows * base.gapMm > base.usableH - 1e-9, '行数应取可容纳的最大值');
		var auto = Z.ContentModel.pageLayout(80, null, null, 0, 0.12);
	assert.strictEqual(auto.cols, 8);
	assert.strictEqual(auto.maxCols, 8);
	assert.ok(Math.abs(auto.gridMm - auto.usableW / 8) < 1e-6, '自适应格宽应均分');
});

test('pageLayout：锁定列数不超过纸宽可容纳列数（联约束）', function () {
	var Z = loadCore();
	var auto = Z.ContentModel.pageLayout(80, null, null, 0, 0.12).cols;
	assert.strictEqual(Z.ContentModel.pageLayout(80, null, null, 14, 0.12).cols, auto);
	assert.strictEqual(Z.ContentModel.pageLayout(80, null, null, 20, 0.12).cols, auto);
	assert.strictEqual(Z.ContentModel.pageLayout(120, null, null, 0, 0.12).cols, 5);
	assert.strictEqual(Z.ContentModel.pageLayout(120, null, null, 20, 0.12).cols, 5);
});

test('pageLayout：格子均分铺满可用宽（无右侧留白）', function () {
	var Z = loadCore();
	var l = Z.ContentModel.pageLayout(80, null, null, 0, 0.12);
	assert.ok(Math.abs(l.cols * l.gridMm - l.usableW) < 1e-6, '列宽总和应等于可用宽');
	assert.strictEqual(Z.ContentModel.pageLayout(80, null, null, 14, 0.12).cols, l.maxCols);
});

test('pageLayout：字间距按有效步距缩减列数且行占位不超宽（对齐 z2h）', function () {
	var Z = loadCore();
	var plain = Z.ContentModel.pageLayout(80, null, null, 0, 0.12);
	assert.strictEqual(plain.pitchFactor, 1, 'CharGap=0 时间距系数 1');
	assert.strictEqual(plain.cellGapMm, 0);
	var g = Z.ContentModel.pageLayout(80, null, null, 0, 0.12, undefined, 0, false, 20);
	assert.ok(g.cols < plain.cols, '字间距应按有效步距减少列数');
	assert.ok(Math.abs(g.pitchFactor - 1.2) < 1e-9, '间距系数 = 1 + 20%');
	assert.ok(Math.abs(g.cellGapMm - g.gridMm * 0.2) < 1e-9, '间隙 = 格宽 × 20%');
	/* 行占位 = (cols−1)×步距 + 格宽 ≤ 可用宽 */
	assert.ok(((g.cols - 1) * g.pitchFactor + 1) * g.gridMm <= g.usableW + 1e-9, '含间距行占位不超宽');
	/* 锁定列数同样不超宽（列宽收缩分摊间隙） */
	var fixed = Z.ContentModel.pageLayout(80, null, null, 5, 0.12, undefined, 0, false, 20);
	assert.strictEqual(fixed.cols, 5);
	assert.ok(((fixed.cols - 1) * fixed.pitchFactor + 1) * fixed.gridMm <= fixed.usableW + 1e-9, '锁定列数含间距不超宽');
	/* 脏值收敛到 0–30 */
	assert.strictEqual(Z.ContentModel.pageLayout(80, null, null, 0, 0.12, undefined, 0, false, 999).pitchFactor, 1.3, '上限收敛 30%');
	assert.strictEqual(Z.ContentModel.pageLayout(80, null, null, 0, 0.12, undefined, 0, false, -5).pitchFactor, 1, '负值收敛 0');
});

test('SheetLayout.compute：字间距透传版式真源且估算同源', function () {
	var Z = loadCore();
	var base = { Mode: 'hanzi', Content: '你好世界', ZgType: '3' };
	var layout = Z.SheetLayout.compute({ config: Object.assign({}, Z.DEFAULTS, base, { CharGap: 20 }) });
	assert.ok(layout.cellGapMm > 0, 'compute 输出间隙');
	assert.ok(Math.abs(layout.pitchFactor - 1.2) < 1e-9);
	var plain = Z.SheetLayout.compute({ config: Object.assign({}, Z.DEFAULTS, base) });
	assert.ok(layout.cols <= plain.cols, '字间距列数不多于无间距');
	/* estimatePages 跟随 CharGap（同参数序列 + charGap 末位） */
	var text30 = '一二三四五六七八九十'.repeat(3);
	var estPlain = Z.ContentModel.estimatePages(text30, 80, 0, Z.DEFAULTS.RowGap, null, null, 0, 'hanzi', false, 0, 0, null, false, 0);
	var estGap = Z.ContentModel.estimatePages(text30, 80, 0, Z.DEFAULTS.RowGap, null, null, 0, 'hanzi', false, 0, 0, null, false, 20);
	assert.ok(estGap >= estPlain, '字间距不增加每页容量（页数不减）');
});

test('ConfigSchema：TraceRounds（描红数量）已登记且归一化', function () {
	var Z = loadCore();
	assert.strictEqual(Z.DEFAULTS.TraceRounds, 1, '默认不重复');
	assert.strictEqual(Z.ConfigSchema.TraceRounds.type, 'int');
	assert.strictEqual(Z.ConfigSchema.TraceRounds.group, 'layout');
	assert.strictEqual(Z.normalizeField('TraceRounds', 0), Z.MIN_TRACE_ROUNDS);
	assert.strictEqual(Z.normalizeField('TraceRounds', 99), Z.MAX_TRACE_ROUNDS);
	assert.strictEqual(Z.normalizeField('TraceRounds', 'x'), 1);
	/* 形态预置引用的字段必须已登记（含新增的反复描红 / 英文单词 / 英文段落） */
	Z.CONTENT_FORMS.forEach(function (f) {
		Object.keys(f.apply).forEach(function (k) { assert.ok(Z.ConfigSchema[k], f.key + ' 引用未登记字段 ' + k); });
	});
});

test('paginate：TraceRounds 把内容行整体重复 N 遍（分页符不复制；控笔除外）', function () {
	var Z = loadCore();
	var model = Z.ContentModel.parse('甲\n乙\n\n丙');
	var once = Z.ContentModel.paginate(model, 8, 11, null, 'hanzi');
	var twice = Z.ContentModel.paginate(model, 8, 11, null, 'hanzi', null, 0, 0, 0, null, 2);
	var flat = function (pages) {
		return pages.map(function (p) { return p.map(function (l) { return l.map(function (c) { return c.char; }).join(''); }); });
	};
	assert.deepStrictEqual(flat(once), [['甲', '乙'], ['丙']], '1 遍保持原行序（空行分页）');
	assert.deepStrictEqual(flat(twice), [['甲', '甲', '乙', '乙'], ['丙', '丙']], '2 遍逐行重复且保留分页');
	/* 控笔模式忽略遍数（行数由 ControlRows / 内容决定） */
	var ctl = Z.ContentModel.paginate(Z.ContentModel.parse('1', 'control'), 6, 11, null, 'control', 'wave', 0, 0, 0, null, 3);
	assert.strictEqual(ctl[0].length, 1);
});

test('SheetLayout.compute：TraceRounds 首遍按模板、其余遍强制描红（对齐 z2h）', function () {
	var Z = loadCore();
	var cfg = Object.assign({}, Z.DEFAULTS, { Mode: 'hanzi', Content: '一一', Template: 'normal', TraceRounds: 3, GridSize: 80 });
	var layout = Z.SheetLayout.compute({ config: cfg });
	/* 只取每行前 2 个有字格（行尾会补空临格） */
	var roles = layout.pages[0].lines.slice(0, 3).map(function (l) {
		return l.cells.slice(0, 2).map(function (c) { return c.role; });
	});
	assert.deepStrictEqual(roles, [['model', 'model'], ['trace', 'trace'], ['trace', 'trace']]);
	/* 估算页数与版式真源一致（末位 traceRounds 参数） */
	var est = Z.ContentModel.estimatePages('一一', 80, 0, cfg.RowGap, cfg.Page, cfg.Margin, 0, 'hanzi', false, 0, 0, null, false, 0, 3);
	assert.strictEqual(est, layout.pages.length);
	/* 英文词行：非首遍的词同样降为描红 */
	var eng = Z.SheetLayout.compute({ config: Object.assign({}, cfg, { Mode: 'english', Content: 'hi', Template: 'normal', TraceRounds: 2 }) });
	var engRoles = eng.pages[0].lines.slice(0, 2).map(function (l) { return l.words.map(function (w) { return w.role; }); });
	assert.deepStrictEqual(engRoles, [['model'], ['trace']]);
});

test('estimatePages：跟随纸张 / 边距（P3-17）', function () {
	var Z = loadCore();
	var text = '永'.repeat(200);
	var a4 = Z.ContentModel.estimatePages(text, 80, 0, 0.12);
	var big = Z.ContentModel.estimatePages(text, 80, 0, 0.12, { width: 420, height: 594 }, { top: 10, right: 10, bottom: 10, left: 10 });
	assert.ok(big < a4, '更大纸张应减少估算页数');
	/* 缺省 page / margin 时保持 A4 默认纸口径 */
	assert.strictEqual(a4, Z.ContentModel.estimatePages(text, 80, 0, 0.12, null, null));
});

test('ConfigSchema：Page/Margin/fontURL/ResourceMode 归一化', function () {
	var Z = loadCore();
	assert.deepStrictEqual(Z.normalizeField('Page', { width: 210, height: 297 }), { width: 210, height: 297 });
	assert.deepStrictEqual(Z.normalizeField('Page', { width: 'x', height: 100 }), { width: 210, height: 100 });
	assert.deepStrictEqual(Z.normalizeField('Page', { width: 100 }), { width: 100, height: Z.DEFAULTS.Page.height });
	assert.deepStrictEqual(Z.normalizeField('Margin', { top: 5, right: 16, bottom: 5, left: 16 }), { top: 5, right: 16, bottom: 5, left: 16 });
	assert.deepStrictEqual(Z.normalizeField('Margin', null), Z.DEFAULTS.Margin);
	assert.strictEqual(Z.normalizeField('fontURL', 'javascript:alert(1)'), '');
	assert.strictEqual(Z.normalizeField('fontURL', 'https://a.com/f.woff2'), 'https://a.com/f.woff2');
	assert.strictEqual(Z.normalizeField('fontLocalName', '我的字体'), '我的字体');
	assert.strictEqual(Z.normalizeField('ResourceMode', 'local'), 'local');
	assert.strictEqual(Z.normalizeField('ResourceMode', 'hack'), Z.DEFAULTS.ResourceMode);
});

test('ConfigSchema：元信息字段（Name / ShowMeta / ShowPageNo）归一化', function () {
	var Z = loadCore();
	assert.strictEqual(Z.DEFAULTS.Name, '');
	assert.strictEqual(Z.DEFAULTS.ShowMeta, false);
	assert.strictEqual(Z.DEFAULTS.ShowPageNo, true);
	assert.strictEqual(Z.normalizeField('Name', '张三'), '张三');
	assert.strictEqual(Z.normalizeField('Name', '张'.repeat(20)).length, 12);
	assert.strictEqual(Z.normalizeField('Name', 123), '');
	assert.strictEqual(Z.normalizeField('ShowMeta', 'yes'), false);
	assert.strictEqual(Z.normalizeField('ShowMeta', true), true);
	assert.strictEqual(Z.normalizeField('ShowPageNo', 0), true);
	assert.strictEqual(Z.normalizeField('ShowPageNo', false), false);
});

test('ConfigSchema：字体字段（FontSource / PreviewText）归一化', function () {
	var Z = loadCore();
	assert.deepStrictEqual(Z.DEFAULTS.FontSource, { type: 'default' });
	assert.strictEqual(Z.DEFAULTS.PreviewText, '天地玄黄，宇宙洪荒');
	assert.deepStrictEqual(
		Z.normalizeField('FontSource', { type: 'url', url: 'https://a.com/f.woff2' }),
		{ type: 'url', url: 'https://a.com/f.woff2' }
	);
	assert.deepStrictEqual(Z.normalizeField('FontSource', { type: 'url', url: 'javascript:alert(1)' }), { type: 'default' });
	assert.deepStrictEqual(Z.normalizeField('FontSource', { type: 'local', id: 'f1abc' }), { type: 'local', id: 'f1abc' });
	assert.deepStrictEqual(Z.normalizeField('FontSource', { type: 'local', id: 'bad id!' }), { type: 'default' });
	assert.deepStrictEqual(Z.normalizeField('FontSource', null), { type: 'default' });
	assert.deepStrictEqual(Z.normalizeField('FontSource', { type: 'hack' }), { type: 'default' });
	assert.strictEqual(Z.normalizeField('PreviewText', '永'), '永');
	assert.strictEqual(Z.normalizeField('PreviewText', '永'.repeat(50)).length, 40);
	assert.strictEqual(Z.normalizeField('PreviewText', 123), Z.DEFAULTS.PreviewText);
});

test('loadConfig：旧 fontURL 迁移为 FontSource（url）', function () {
	var storage = makeStorage({ 'zitie.config': JSON.stringify({ fontURL: 'https://a.com/f.woff2' }) });
	var Z = loadCore(storage);
	var cfg = Z.loadConfig();
	assert.deepStrictEqual(cfg.FontSource, { type: 'url', url: 'https://a.com/f.woff2' });
	/* 已显式保存过来源（default）时不迁移 */
	var storage2 = makeStorage({ 'zitie.config': JSON.stringify({ fontURL: 'https://a.com/f.woff2', FontSource: { type: 'default' } }) });
	var Z2 = loadCore(storage2);
	var cfg2 = Z2.loadConfig();
	assert.deepStrictEqual(cfg2.FontSource, { type: 'default' });
});

test('pageLayout：行距越大行数越少', function () {
	var Z = loadCore();
	var tight = Z.ContentModel.pageLayout(80, null, null, 0, 0);
	var loose = Z.ContentModel.pageLayout(80, null, null, 0, 1);
	assert.ok(loose.rows < tight.rows, tight.rows + ' vs ' + loose.rows);
});

test('pageLayout：行距连续精确（无死区、行数单调不增）', function () {
	var Z = loadCore();
	/* 旧实现把行距均分到整页高度，4%~16% 区间实际行距几乎不变（死区）。
	 * 现在行距 = 配置格倍数 × 格宽，任意两值之差应精确等于格宽差。 */
	var a = Z.ContentModel.pageLayout(80, null, null, 0, 0.04);
	var b = Z.ContentModel.pageLayout(80, null, null, 0, 0.16);
	assert.ok(Math.abs(a.gapMm / a.gridMm - 0.04) < 1e-9, '行距应精确等于配置倍率 × 行盒高');
	assert.ok(Math.abs(b.gapMm / b.gridMm - 0.16) < 1e-9, '行距应精确等于配置倍率 × 行盒高');
	assert.strictEqual(a.gridMm, b.gridMm);
	assert.ok(Math.abs((b.gapMm - a.gapMm) - b.gridMm * 0.12) < 1e-9, '行距差应精确等于行盒高 × 配置差');
	/* 同格宽下行数随行距单调不增 */
	var seq = [0, 0.04, 0.08, 0.12, 0.2, 0.4, 0.8, 1.6].map(function (g) {
		return Z.ContentModel.pageLayout(80, null, null, 0, g).rows;
	});
	for (var i = 1; i < seq.length; i++) {
		assert.ok(seq[i] <= seq[i - 1], '行数应随行距单调不增：' + seq.join(','));
	}
});

test('pageLayout：A5 可用宽 / 高更小，列数与行数上限随之收缩', function () {
	var Z = loadCore();
	var margin = { top: 5, bottom: 5, left: 16, right: 16 };
	var a4 = Z.ContentModel.pageLayout(80, { width: 210, height: 297 }, margin, 0, 0.12);
	var a5 = Z.ContentModel.pageLayout(80, { width: 148, height: 210 }, margin, 0, 0.12);
	assert.ok(a5.cols < a4.cols, 'A5 cols=' + a5.cols + ' / A4 cols=' + a4.cols);
	assert.ok(a5.rows < a4.rows, 'A5 rows=' + a5.rows + ' / A4 rows=' + a4.rows);
});

test('paginate：按列折行、按行分页、rowsFirst 生效', function () {
	var Z = loadCore();
	var model = Z.ContentModel.parse('一二三四五六七八');
	var pages = Z.ContentModel.paginate(model, 3, 2, 1);
	assert.deepStrictEqual(pages.map(function (p) { return p.map(function (l) { return l.map(function (c) { return c.char; }).join(''); }); }), [['一二三'], ['四五六', '七八']]);
});

test('paginate：空行强制分页', function () {
	var Z = loadCore();
	var pages = Z.ContentModel.paginate(Z.ContentModel.parse('永\n\n永'), 5, 9);
	assert.strictEqual(pages.length, 2);
});

test('cellRole：五种模板角色分布与未知模板回退', function () {
	var Z = loadCore();
	assert.deepStrictEqual([0, 1, 2].map(function (i) { return Z.Layout.cellRole(i, 'normal'); }), ['model', 'model', 'model']);
	assert.deepStrictEqual([0, 1].map(function (i) { return Z.Layout.cellRole(i, 'trace'); }), ['trace', 'trace']);
	assert.deepStrictEqual([0, 1, 2, 3].map(function (i) { return Z.Layout.cellRole(i, 'trace3', 3); }), ['model', 'model', 'model', 'trace']);
	assert.deepStrictEqual([0, 1].map(function (i) { return Z.Layout.cellRole(i, 'lead'); }), ['model', 'trace']);
	assert.deepStrictEqual([0, 1].map(function (i) { return Z.Layout.cellRole(i, 'blank'); }), ['blank', 'blank']);
	assert.strictEqual(Z.Layout.cellRole(0, 'nope'), 'model');
	/* traceCount 边界：缩略图按同一函数生成，角色分布随 traceCount 收缩 / 扩张（T1.12） */
	assert.deepStrictEqual([0, 1, 2].map(function (i) { return Z.Layout.cellRole(i, 'trace3', 1); }), ['model', 'trace', 'trace']);
	assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 6].map(function (i) { return Z.Layout.cellRole(i, 'trace3', 6); }), ['model', 'model', 'model', 'model', 'model', 'model', 'trace']);
});

test('cellRole：节奏描红（范字 / 描红 / 临写 + 逐行递减）', function () {
	var Z = loadCore();
	var r = { model: 2, trace: 3, decay: 0 };
	assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map(function (i) { return Z.Layout.cellRole(i, 'rhythm', 0, 0, r); }), ['model', 'model', 'trace', 'trace', 'trace', 'blank']);
	/* 递减：每行描红 -1，范字保留；描红减到 0 后其余全为临写 */
	var d = { model: 1, trace: 3, decay: 1 };
	assert.deepStrictEqual([0, 1, 2, 3, 4].map(function (i) { return Z.Layout.cellRole(i, 'rhythm', 0, 0, d); }), ['model', 'trace', 'trace', 'trace', 'blank']);
	assert.deepStrictEqual([0, 1, 2, 3].map(function (i) { return Z.Layout.cellRole(i, 'rhythm', 0, 1, d); }), ['model', 'trace', 'trace', 'blank']);
	assert.deepStrictEqual([0, 1, 2, 3].map(function (i) { return Z.Layout.cellRole(i, 'rhythm', 0, 2, d); }), ['model', 'trace', 'blank', 'blank']);
	/* 缺省参数回退默认（1 范 3 描，其余临写） */
	assert.deepStrictEqual([0, 1, 2, 3, 4].map(function (i) { return Z.Layout.cellRole(i, 'rhythm', 0, 0, undefined); }), ['model', 'trace', 'trace', 'trace', 'blank']);
});

test('cellRole：参数对象（model / trace / blank / lead / repeat）', function () {
	var Z = loadCore();
	/* { model: n } 前 n 格范字，其余描红（等价 trace3） */
	assert.deepStrictEqual([0, 1, 2].map(function (i) { return Z.Layout.cellRole(i, { model: 2 }); }), ['model', 'model', 'trace']);
	assert.deepStrictEqual([0, 1].map(function (i) { return Z.Layout.cellRole(i, { trace: true }); }), ['trace', 'trace']);
	assert.deepStrictEqual([0, 1].map(function (i) { return Z.Layout.cellRole(i, { blank: true }); }), ['blank', 'blank']);
	assert.deepStrictEqual([0, 1].map(function (i) { return Z.Layout.cellRole(i, { lead: true }); }), ['model', 'trace']);
	/* repeat 按行循环；非法角色回退 model */
	assert.deepStrictEqual([0, 1, 2, 3, 4].map(function (i) { return Z.Layout.cellRole(i, { repeat: ['model', 'trace', 'trace'] }); }), ['model', 'trace', 'trace', 'model', 'trace']);
	assert.strictEqual(Z.Layout.cellRole(0, { repeat: ['nope'] }), 'model');
	/* 空对象回退 normal */
	assert.deepStrictEqual([0, 1].map(function (i) { return Z.Layout.cellRole(i, {}); }), ['model', 'model']);
});

test('cellRole：repeat + decay 逐字递减（跨行收缩，至少保留 1 格）', function () {
	var Z = loadCore();
	var params = { repeat: ['model', 'trace', 'trace', 'trace'], decay: 1 };
	/* 行 0：1 范 3 描；行 1：1 范 2 描；行 2：1 范 1 描；行 3+：全范字 */
	assert.deepStrictEqual([0, 1, 2, 3].map(function (i) { return Z.Layout.cellRole(i, params, 0, 0); }), ['model', 'trace', 'trace', 'trace']);
	assert.deepStrictEqual([0, 1, 2, 3].map(function (i) { return Z.Layout.cellRole(i, params, 0, 1); }), ['model', 'trace', 'trace', 'model']);
	assert.deepStrictEqual([0, 1, 2, 3].map(function (i) { return Z.Layout.cellRole(i, params, 0, 2); }), ['model', 'trace', 'model', 'trace']);
	assert.deepStrictEqual([0, 1, 2, 3].map(function (i) { return Z.Layout.cellRole(i, params, 0, 3); }), ['model', 'model', 'model', 'model']);
	assert.deepStrictEqual([0, 1, 2, 3].map(function (i) { return Z.Layout.cellRole(i, params, 0, 9); }), ['model', 'model', 'model', 'model']);
});

test('SheetLayout.compute：参数化模板逐字递减跨页生效', function () {
	var Z = loadCore();
	/* 每行 4 格、共 2 页：行号跨页累计，decay 持续收缩 */
	var layout = Z.SheetLayout.compute({ content: '永'.repeat(32), cols: 4, template: { repeat: ['model', 'trace', 'trace', 'trace'], decay: 1 } });
	var rows = layout.pages.map(function (p) { return p.lines; }).reduce(function (a, b) { return a.concat(b); }, []);
	assert.deepStrictEqual(rows[0].cells.map(function (c) { return c.role; }), ['model', 'trace', 'trace', 'trace']);
	assert.deepStrictEqual(rows[1].cells.map(function (c) { return c.role; }), ['model', 'trace', 'trace', 'model']);
	assert.deepStrictEqual(rows[2].cells.map(function (c) { return c.role; }), ['model', 'trace', 'model', 'trace']);
	assert.deepStrictEqual(rows[3].cells.map(function (c) { return c.role; }), ['model', 'model', 'model', 'model']);
	/* 旧枚举仍可用（回归） */
	var legacy = Z.SheetLayout.compute({ content: '永'.repeat(8), cols: 4, template: 'trace3', traceCount: 1 });
	assert.deepStrictEqual(legacy.pages[0].lines[0].cells.map(function (c) { return c.role; }), ['model', 'trace', 'trace', 'trace']);
});

test('SheetLayout.compute：分页 / 标题占位 / 角色同源', function () {
	var Z = loadCore();
	/* cols=8 = A4 / 80px 自适应列数（锁定值等于上限，不触发联约束） */
	var layout = Z.SheetLayout.compute({ content: '永'.repeat(96), title: '练习', cols: 8 });
	assert.strictEqual(layout.cols, 8);
	assert.strictEqual(layout.rowsFirst, layout.rows - 1);
	/* 有标题时第一页只少一行；行距为精确值，各页行距周期一致（不再按页重算，P3-18） */
	assert.strictEqual(layout.pitchFirstMm, layout.pitchMm);
	assert.ok(Math.abs(layout.gapMm - layout.gridMm * 0.12) < 1e-9, '行距应为配置倍率 × 行盒高（非拼音格 1.0×格）');
	assert.ok(Math.abs(layout.rowBoxMm - layout.gridMm * 1) < 1e-9, '非拼音格行盒应为 1.0×格');
	assert.strictEqual(layout.pages.length, 2);
	/* 第 1 页 rowsFirst=10 行（标题占 1 行）；第 2 页 2 行内容补满到 rows=11 行（行盒 1.0×格） */
	assert.deepStrictEqual(layout.pages.map(function (p) { return p.lines.length; }), [10, 11]);
	assert.strictEqual(layout.pages[0].title, '练习');
	assert.strictEqual(layout.pages[1].title, '');
	assert.strictEqual(layout.pages[0].lines[0].cells.length, 8);
	assert.deepStrictEqual(layout.pages[0].lines[0].cells.map(function (c) { return c.role; }), Array(8).fill('model'));
});

test('SheetLayout.compute：自适应列数与默认页边距', function () {
	var Z = loadCore();
	var layout = Z.SheetLayout.compute({ content: '永', cols: 0, gridPx: 80 });
	assert.strictEqual(layout.cols, 8);
	assert.strictEqual(layout.fixedCols, false);
	assert.strictEqual(layout.margin.top, 5);
	assert.strictEqual(layout.margin.left, 16);
});

test('SheetLayout.compute：显式空行分页', function () {
	var Z = loadCore();
	var layout = Z.SheetLayout.compute({ content: '永\n\n永', cols: 5 });
	assert.strictEqual(layout.pages.length, 2);
});

test('SheetLayout.compute：空格占位与行尾补满为空临格', function () {
	var Z = loadCore();
	var layout = Z.SheetLayout.compute({ content: '天 地', cols: 4, gridPx: 80 });
	assert.deepStrictEqual(layout.pages[0].lines[0].cells.map(function (c) { return c.char; }), ['天', '', '地', '']);
	assert.deepStrictEqual(layout.pages[0].lines[0].cells.map(function (c) { return c.role; }), ['model', 'blank', 'model', 'blank']);
});

/* ---------- 字格背景（zg-bg） ---------- */

test('buildZgSvg：拼音格（type5）1×1.4——上区四线三格 + 下区正方形田字格（预览 / 字帖一致）', function () {
		var Z = loadCore();
		var svg = Z.buildZgSvg({ type: '5' });
		assert.ok(svg.indexOf('width="80" height="112"') >= 0, '字格应为 1×1.4');
		var paths = svg.match(/<path[^>]*>/g) || [];
		function lineAt(y) {
			return paths.filter(function (p) { return p.indexOf('M1 ' + y + ' L79 ' + y) >= 0; })[0] || '';
		}
		/* 四线：顶线由外框顶边（y=0）充当；中间两虚线等距（间距 32/3）；末线实线与田字格顶边共用（y=32） */
		['10.67', '21.33'].forEach(function (y) {
			assert.ok(lineAt(y) !== '', '上区应有虚线 y=' + y);
			assert.ok(lineAt(y).indexOf('stroke-dasharray') >= 0, '中间两线应为虚线 y=' + y);
		});
		assert.ok(lineAt('32') !== '', '上区应有末线实线 y=32');
		assert.ok(lineAt('32').indexOf('stroke-dasharray') === -1, '末线应为实线 y=32');
		/* 下区田字格 32..112：竖线 + 中横；底边 / 左右边由外框充当 */
		assert.ok(svg.indexOf('M40 32 L40 112') >= 0, '下区应有竖线（田字格 32..112）');
		assert.ok(svg.indexOf('M0 72 L80 72') >= 0, '下区应有横线');
		assert.strictEqual(paths.length, 6, '四线虚/实 3 + 田字格竖/横 2 + 外框 1');
		/* 顶 / 底不再各画一条线与外框重叠（消除“多一条线”） */
		assert.ok(svg.indexOf('M1 4 ') === -1 && svg.indexOf('M1 28 ') === -1, '不应再画 y=4 / y=28 四线');
		assert.ok(svg.indexOf('M0 108 ') === -1, '不应再画 y=108 田字格底边');
		/* 拼音格外框用 1px 细线，与内部线统一 */
		assert.ok(/stroke-width="1" stroke="/.test(svg), '拼音格外框应为 1px');
	});

test('buildZgSvg：方格（type6）纯方格无内线，数字格（type7）下 1/3 基线横线', function () {
	var Z = loadCore();
	/* 方格 = 作文纸：只有外框，一格一字 */
	var zw = Z.buildZgSvg({ type: '6' });
	assert.strictEqual((zw.match(/<path[^>]*>/g) || []).length, 1, '方格应只有外框（纯方格，无内部线）');
	/* 数字格 = 数学本：一条横虚线作基线（下 1/3，字占上 2/3） */
	var sz = Z.buildZgSvg({ type: '7' });
	assert.ok(sz.indexOf('M1 53 L79 53') >= 0, '数字格应为下 1/3 基线横线 y=53');
	assert.strictEqual((sz.match(/<path[^>]*>/g) || []).length, 2, '数字格 = 基线横线 + 外框');
});

test('buildZgSvg：井字格（type8）两竖两横，英文四线格（type9）四线（外框充当上下边）', function () {
	var Z = loadCore();
	var zj = Z.buildZgSvg({ type: '8' });
	assert.strictEqual((zj.match(/<path[^>]*>/g) || []).length, 5, '井字格 = 4 条内部线 + 外框');
	assert.ok(zj.indexOf('M26.67 0 L26.67 80') >= 0 && zj.indexOf('M0 53.33 L80 53.33') >= 0, '井字格 1/3 与 2/3 线');
	/* 英文格：默认外框 solid + 内部虚线 → 中间两条虚线，上下边由外框充当 */
	var en = Z.buildZgSvg({ type: '9' });
	assert.strictEqual((en.match(/<path[^>]*>/g) || []).length, 3, '英文格 = 中间两虚线 + 外框');
	assert.ok(en.indexOf('M1 26.67 L79 26.67') >= 0 && en.indexOf('M1 53.33 L79 53.33') >= 0, '英文格中间两线等距');
	/* 外框关掉时补画四条独立横线（仍是四线格） */
	var enNoBorder = Z.buildZgSvg({ type: '9', borderMode: 'none' });
	assert.strictEqual((enNoBorder.match(/<path[^>]*>/g) || []).length, 4, '无框英文格 = 4 条横线');
});

test('buildZgSvg：格上拼音条（type10）1×1.25——顶部窄条 + 实线分隔 + 下区田字格', function () {
	var Z = loadCore();
	var svg = Z.buildZgSvg({ type: '10' });
	assert.ok(svg.indexOf('width="80" height="100"') >= 0, '字格应为 1×1.25');
	/* 窄条与田字格之间的分隔线恒实线（不受内部虚线样式影响） */
	assert.ok(svg.indexOf('M0 20 L80 20') >= 0, '分隔实线 y=20');
	assert.ok(/<path d="M0 20 L80 20" [^>]*fill="none"\/>/.test(svg), '分隔线无 dasharray');
	/* 下区 1.0 格田字格：竖中线 20..100、横中线 y=60；底边由外框充当 */
	assert.ok(svg.indexOf('M40 20 L40 100') >= 0 && svg.indexOf('M1 60 L79 60') >= 0, '下区田字格十字');
	/* 外框存在时底部不另画线（由外框底边 y=100 充当） */
	assert.strictEqual((svg.match(/<path[^>]*>/g) || []).length, 4, '分隔线 + 两条内部线 + 外框');
	/* 外框关掉时窄条分隔线仍在（结构骨架），田字格开口 */
	var noBorder = Z.buildZgSvg({ type: '10', borderMode: 'none' });
	assert.ok(noBorder.indexOf('M0 20 L80 20') >= 0, '无框仍保留分隔实线');
});

test('ContentModel.pageLayout：格上拼音条（type10）自动宽高比 1.25', function () {
	var Z = loadCore();
	var layout = Z.ContentModel.pageLayout(80, null, null, 0, 0.12, '10', 0);
	assert.ok(Math.abs(layout.ratio - 1.25) < 1e-9, 'type10 自动 ratio = 1.25');
	assert.ok(Math.abs(layout.rowBoxMm - layout.gridMm * 1.25) < 1e-9, '行盒随 1.25×格');
	/* 用户显式 GridRatio 优先；其余格型不受影响 */
	var custom = Z.ContentModel.pageLayout(80, null, null, 0, 0.12, '10', 120);
	assert.ok(Math.abs(custom.ratio - 1.2) < 1e-9, '显式值覆盖自动');
	var normal = Z.ContentModel.pageLayout(80, null, null, 0, 0.12, '1', 0);
	assert.ok(Math.abs(normal.ratio - 1) < 1e-9, '普通格型仍 1.0');
});

test('ConfigSchema：PinyinBar 已登记且默认关闭（格上拼音条开关）', function () {
	var Z = loadCore();
	assert.strictEqual(Z.DEFAULTS.PinyinBar, false);
	assert.strictEqual(Z.ConfigSchema.PinyinBar.type, 'bool');
	assert.ok(Z.PRESET_KEYS.indexOf('PinyinBar') >= 0, '纳入预设白名单');
	assert.ok(Z.ZG_TYPES.indexOf('10') >= 0, '格型 10 已登记');
});

test('buildZgSvg：格线粗细（倍率）与外框样式（实 / 虚 / 无框）', function () {
	var Z = loadCore();
	/* 默认：外框 2px 实线、内部虚线 1px */
	var base = Z.buildZgSvg({ type: '1' });
	assert.ok(/stroke-width="2" stroke="/.test(base), '默认外框 2px');
	/* 倍率 ×2：外框 4px、内部线 2px */
	var thick = Z.buildZgSvg({ type: '1', lineScale: 2 });
	assert.ok(/stroke-width="4" stroke="/.test(thick), '×2 外框 4px');
	assert.ok(/stroke-dasharray="4,4" stroke-width="2"/.test(thick), '×2 内部虚线 2px');
	/* 虚线外框 */
	var dash = Z.buildZgSvg({ type: '1', borderMode: 'dashed' });
	assert.ok(/stroke-dasharray="4,4" stroke-width="2" stroke="/.test(dash), '虚线外框');
	/* 无框：田字格只剩 2 条内部线 */
	var none = Z.buildZgSvg({ type: '1', borderMode: 'none' });
	assert.strictEqual((none.match(/<path[^>]*>/g) || []).length, 2, '无框田字格只有 2 条内部线');
	assert.ok(none.indexOf('M0 0 L80 0') === -1, '不应有外框路径');
	/* 缺省参数与旧版一致 */
	assert.strictEqual(Z.buildZgSvg({ type: '1' }), base);
});

test('buildZgSvg：内部线样式独立于外框（实 / 虚 / 无）', function () {
	var Z = loadCore();
	/* 内部实线：十字无 dasharray；外框仍为实线 */
	var solid = Z.buildZgSvg({ type: '1', innerMode: 'solid' });
	assert.strictEqual(solid.indexOf('stroke-dasharray'), -1, '内部实线不应出现 dasharray');
	/* 内部无：田字格只剩外框 1 条 */
	var noInner = Z.buildZgSvg({ type: '1', innerMode: 'none' });
	assert.strictEqual((noInner.match(/<path[^>]*>/g) || []).length, 1, '内部无 = 只有外框');
	/* 米字格内部无：斜线与十字都不画 */
	var miNoInner = Z.buildZgSvg({ type: '2', innerMode: 'none' });
	assert.strictEqual((miNoInner.match(/<path[^>]*>/g) || []).length, 1, '米字格内部无 = 只有外框');
});

test('buildZgSvg：外框粗细独立（borderScale），0 / 缺省 = 随类型自动', function () {
	var Z = loadCore();
	/* 其余格型默认 2×；显式 100% = 1× */
	var auto = Z.buildZgSvg({ type: '1' });
	var thin = Z.buildZgSvg({ type: '1', borderScale: 1 });
	assert.ok(/stroke-width="1" stroke="#00b050"/.test(thin), '显式 100% 外框 1px');
	assert.ok(/stroke-width="2" stroke="#00b050"/.test(auto), '默认自动 200% 外框 2px');
	/* 拼音格自动 1×（与内部线同粗），显式 200% = 2px */
	var pyAuto = Z.buildZgSvg({ type: '5' });
	assert.ok(/stroke-width="1" stroke="#00b050"/.test(pyAuto), '拼音格外框自动 1×');
	var pyThick = Z.buildZgSvg({ type: '5', borderScale: 2 });
	assert.ok(/stroke-width="2" stroke="#00b050"/.test(pyThick), '拼音格显式 200% 外框 2px');
});

test('buildZgSvg：内部线 / 外框分色与不透明度（烘焙进颜色）', function () {
	var Z = loadCore();
	var svg = Z.buildZgSvg({ type: '1', lineColor: '#ff0000', borderColor: '#0000ff', opacity: 0.5 });
	assert.ok(svg.indexOf('stroke="rgba(255, 0, 0, 0.5)"') >= 0, '内部线色 + 透明度烘焙');
	assert.ok(svg.indexOf('stroke="rgba(0, 0, 255, 0.5)"') >= 0, '外框色 + 透明度烘焙');
	/* 不透明度 100% 保持 hex */
	var full = Z.buildZgSvg({ type: '1', lineColor: '#ff0000', borderColor: '#0000ff' });
	assert.ok(full.indexOf('stroke="#ff0000"') >= 0 && full.indexOf('stroke="#0000ff"') >= 0, '默认不烘焙透明度');
});

test('buildZgSvg：虚线密度与形态（划线 / 圆点）', function () {
	var Z = loadCore();
	var dense = Z.buildZgSvg({ type: '1', dashDensity: 0.5 });
	assert.ok(/stroke-dasharray="2,2"/.test(dense), '密度 50% → 2,2');
	var sparse = Z.buildZgSvg({ type: '1', dashDensity: 2 });
	assert.ok(/stroke-dasharray="8,8"/.test(sparse), '密度 200% → 8,8');
	/* 圆点：0.1 划线长 + round 端头 */
	var dot = Z.buildZgSvg({ type: '1', dashStyle: 'dot' });
	assert.ok(/stroke-dasharray="0.1,5.5"/.test(dot), '圆点间距默认 5.5');
	assert.ok(dot.indexOf('stroke-linecap="round"') >= 0, '圆点需要 round 端头');
});

test('buildZgSvg：米字格辅助线细分——十字 / 对角线 / 内框同为内部线（划线 / 圆点 / 点划线，C-g）', function () {
	var Z = loadCore();
	/* 米字回字格（type3）：默认内部虚线（划线），外框实线 */
	var base = Z.buildZgSvg({ type: '3' });
	assert.ok(/stroke-dasharray="4,4"/.test(base), '默认划线虚线');
	assert.strictEqual((base.match(/<path[^>]*>/g) || []).length, 6, '外框 + 十字2 + 对角2 + 内框1');
	/* 圆点：十字 / 对角线 / 内框都变点线，且外框保持实线 */
	var dot = Z.buildZgSvg({ type: '3', innerMode: 'dashed', dashStyle: 'dot' });
	assert.strictEqual((dot.match(/stroke-dasharray="0.1,5.5"/g) || []).length, 5, '5 条内部线均为点线');
	var borderPath = (dot.match(/<path[^>]*stroke-width="2"[^>]*>/g) || [])[0] || '';
	assert.ok(borderPath && borderPath.indexOf('stroke-dasharray') === -1, '外框（2× 宽）保持实线');
	/* 点划线与密度同样作用于内部线 */
	var dd = Z.buildZgSvg({ type: '2', dashStyle: 'dashdot', dashDensity: 2 });
	assert.ok(/stroke-dasharray="16,6,2,6"/.test(dd), '点划线 × 200% 密度');
	/* 内部线关闭后仅剩外框 */
	var none = Z.buildZgSvg({ type: '3', innerMode: 'none' });
	assert.strictEqual((none.match(/<path[^>]*>/g) || []).length, 1);
});

test('resolveZgOptions：旧配置按预设色派生，渲染契约不变', function () {
	var Z = loadCore();
	/* 旧配置只有 ZgType / ZgColor：颜色取预设，线型 / 线宽走默认 */
	var old = Z.resolveZgOptions({ ZgType: '1', ZgColor: '1' });
	assert.strictEqual(old.lineColor, '#70d39d');
	assert.strictEqual(old.borderColor, '#00b050');
	assert.strictEqual(old.innerMode, 'dashed');
	assert.strictEqual(old.borderMode, 'solid');
	assert.strictEqual(old.borderScale, 2);
	assert.strictEqual(old.opacity, 1);
	/* 自定义色覆盖预设；非法色回退预设 */
	var custom = Z.resolveZgOptions({ ZgColor: '3', ZgLineColor: '#123456', ZgBorderColor: 'nope' });
	assert.strictEqual(custom.lineColor, '#123456');
	assert.strictEqual(custom.borderColor, '#980f29');
	/* 拼音格外框自动 1×；显式 borderScale 优先 */
	assert.strictEqual(Z.resolveZgOptions({ ZgType: '5' }).borderScale, 1);
	assert.strictEqual(Z.resolveZgOptions({ ZgType: '5', ZgBorderScale: 150 }).borderScale, 1.5);
	/* 空值 / undefined 配置安全 */
	assert.strictEqual(Z.resolveZgOptions(null).type, Z.DEFAULTS.ZgType);
});

test('resolveZgOptions：格型内部参数与辅助标记派生', function () {
	var Z = loadCore();
	/* 默认值 */
	var d = Z.resolveZgOptions(null);
	assert.strictEqual(d.innerRatio, Z.DEFAULTS.ZgInnerRatio);
	assert.strictEqual(d.engMid, 100);
	assert.strictEqual(d.pinyinTop, 29);
	assert.strictEqual(d.baselinePos, 66);
	assert.strictEqual(d.startDot, false);
	assert.strictEqual(d.lineCap, 'butt');
	assert.strictEqual(d.crisp, false);
	/* 自定义值 + 越界收敛 */
	var c = Z.resolveZgOptions({ ZgInnerRatio: 999, ZgEngMid: 1, ZgPinyinTop: 40, ZgBaselinePos: 50, ZgStartDot: true, ZgLineCap: 'round', ZgCrisp: true });
	assert.strictEqual(c.innerRatio, Z.MAX_ZG_INNER_RATIO);
	assert.strictEqual(c.engMid, Z.MIN_ZG_ENG_MID);
	assert.strictEqual(c.pinyinTop, 40);
	assert.strictEqual(c.baselinePos, 50);
	assert.strictEqual(c.startDot, true);
	assert.strictEqual(c.lineCap, 'round');
	assert.strictEqual(c.crisp, true);
	/* 非法枚举回退 */
	assert.strictEqual(Z.resolveZgOptions({ ZgLineCap: 'nope' }).lineCap, 'butt');
});

test('buildZgSvg：默认参数与旧版渲染逐字符兼容（本轮新增比例的基准）', function () {
	var Z = loadCore();
	assert.ok(Z.buildZgSvg({ type: '3' }).indexOf('M20 10 L60 10 L60 70 L20 70 Z') >= 0, '回字内框默认 25%');
	assert.ok(Z.buildZgSvg({ type: '5' }).indexOf('M1 32 L79 32') >= 0, '拼音上区默认 32');
	assert.ok(Z.buildZgSvg({ type: '5' }).indexOf('M1 10.67 L79 10.67') >= 0, '上区虚线均布');
	assert.ok(Z.buildZgSvg({ type: '7' }).indexOf('M1 53 L79 53') >= 0, '数字基线默认 53');
	assert.ok(Z.buildZgSvg({ type: '9' }).indexOf('M1 26.67 L79 26.67') >= 0 && Z.buildZgSvg({ type: '9' }).indexOf('M1 53.33 L79 53.33') >= 0, '英文格默认等分');
});

test('buildZgSvg：格型内部比例可调（回字 / 英文 / 拼音 / 数字）', function () {
	var Z = loadCore();
	/* 回字：水平边距 = 格宽 × 40% = 32，垂直取其一半 = 16 */
	assert.ok(Z.buildZgSvg({ type: '4', innerRatio: 40 }).indexOf('M32 16 L48 16 L48 64 L32 64 Z') >= 0, '回字内框 40%');
	/* 英文：中间区 = 80 × 150/300 = 40 → 上下各 20 */
	var en = Z.buildZgSvg({ type: '9', borderMode: 'none', engMid: 150 });
	assert.ok(en.indexOf('M1 20 L79 20') >= 0 && en.indexOf('M1 60 L79 60') >= 0, '英文中间区 50%');
	/* 拼音：上区 = round(112 × 40%) = 45 */
	var py = Z.buildZgSvg({ type: '5', pinyinTop: 40 });
	assert.ok(py.indexOf('M1 45 L79 45') >= 0 && py.indexOf('M1 15 L79 15') >= 0, '拼音上区 40% 且虚线均布');
	/* 数字：基线 = round(80 × 50%) = 40 */
	assert.ok(Z.buildZgSvg({ type: '7', baselinePos: 50 }).indexOf('M1 40 L79 40') >= 0, '基线 50%');
});

test('buildZgSvg：起笔点标记（仅方块类格型，用内部线色含透明度）', function () {
	var Z = loadCore();
	var on = Z.buildZgSvg({ type: '1', startDot: true, lineColor: '#ff0000', opacity: 0.5 });
	assert.ok(on.indexOf('<circle cx="20" cy="20" r="3.2" fill="rgba(255, 0, 0, 0.5)"/>') >= 0, '圆点在左上 1/4，色随内部线');
	assert.ok(Z.buildZgSvg({ type: '8', startDot: true }).indexOf('<circle') >= 0, '井字格可用');
	assert.ok(Z.buildZgSvg({ type: '5', startDot: true }).indexOf('<circle') < 0, '拼音格不适用');
	assert.ok(Z.buildZgSvg({ type: '1' }).indexOf('<circle') < 0, '默认关闭');
});

test('buildZgSvg：线端样式与点划线形态', function () {
	var Z = loadCore();
	/* butt 是 SVG 默认值，不输出属性（保持旧渲染） */
	assert.ok(Z.buildZgSvg({ type: '1' }).indexOf('stroke-linecap') < 0, '默认无线端属性');
	assert.ok(Z.buildZgSvg({ type: '1', lineCap: 'square' }).indexOf('stroke-linecap="square"') >= 0, '方头生效');
	/* 点划线：8,3,1,3 × 密度 */
	var dd = Z.buildZgSvg({ type: '1', dashStyle: 'dashdot', dashDensity: 2 });
	assert.ok(dd.indexOf('stroke-dasharray="16,6,2,6"') >= 0, '点划线 200%');
	/* 圆点恒 round，不受 lineCap 影响 */
	var dot = Z.buildZgSvg({ type: '1', dashStyle: 'dot', lineCap: 'square' });
	assert.ok(dot.indexOf('stroke-linecap="round"') >= 0 && dot.indexOf('square') < 0, '圆点忽略 lineCap');
});

test('buildZgSvg：细线锐利开关（crispEdges）', function () {
	var Z = loadCore();
	assert.ok(Z.buildZgSvg({ type: '1', crisp: true }).indexOf('shape-rendering="crispEdges"') >= 0, '开启时输出');
	assert.ok(Z.buildZgSvg({ type: '1' }).indexOf('shape-rendering') < 0, '默认不输出');
});

test('resolveZgOptions：内部线宽倍率范围 0.25–3.0', function () {
	var Z = loadCore();
	assert.strictEqual(Z.resolveZgOptions({ ZgLineScale: 25 }).lineScale, 0.25);
	assert.strictEqual(Z.resolveZgOptions({ ZgLineScale: 300 }).lineScale, 3);
	assert.strictEqual(Z.resolveZgOptions({ ZgLineScale: 10 }).lineScale, 0.25, '下限收敛');
	assert.strictEqual(Z.resolveZgOptions({ ZgLineScale: 999 }).lineScale, 3, '上限收敛');
	assert.strictEqual(Z.ConfigSchema.ZgLineScale.min, Z.MIN_ZG_LINE_SCALE);
	assert.strictEqual(Z.ConfigSchema.ZgLineScale.max, Z.MAX_ZG_LINE_SCALE);
});

test('ConfigSchema：本轮新字段已登记（grid 组）', function () {
	var Z = loadCore();
	['ZgInnerRatio', 'ZgEngMid', 'ZgPinyinTop', 'ZgBaselinePos', 'ZgStartDot', 'ZgLineCap', 'ZgCrisp'].forEach(function (k) {
		assert.ok(Z.ConfigSchema[k], k + ' 已登记');
		assert.strictEqual(Z.ConfigSchema[k].group, 'grid', k + ' 属 grid 组');
	});
	assert.deepStrictEqual(Z.ConfigSchema.ZgDashStyle.values, ['dash', 'dot', 'dashdot']);
	assert.deepStrictEqual(Z.ConfigSchema.ZgLineCap.values, ['butt', 'round', 'square']);
	/* 推荐搭配只引用已登记字段 */
	Z.ZG_SCHEMES.forEach(function (s) {
		Object.keys(s.apply).forEach(function (k) { assert.ok(Z.ConfigSchema[k], s.key + ' 引用了未登记字段 ' + k); });
	});
});

test('pageLayout：拼音格行盒 1.4×格（其余 1.0×格），行数相应减少', function () {
	var Z = loadCore();
	var normal = Z.ContentModel.pageLayout(80, null, null, 0, 0.12, '1');
	var py = Z.ContentModel.pageLayout(80, null, null, 0, 0.12, '5');
	assert.ok(Math.abs(normal.rowBoxMm - normal.gridMm) < 1e-9, '非拼音格行盒 1.0×格');
	assert.ok(Math.abs(py.rowBoxMm - py.gridMm * 1.4) < 1e-9, '拼音格行盒 1.4×格');
	assert.ok(Math.abs(normal.gapMm - normal.gridMm * 0.12) < 1e-9, '非拼音格行距 = 行盒高 × 配置倍率');
	assert.ok(Math.abs(py.gapMm - py.gridMm * 1.4 * 0.12) < 1e-9, '拼音格行距随行盒高 1.4×格等比放大');
	assert.ok(py.rows < normal.rows, '拼音格行数应更少：' + py.rows + ' vs ' + normal.rows);
});

test('pageLayout：宽高比可调（0=自动随字格类型；60–160 用户值）', function () {
	var Z = loadCore();
	var auto1 = Z.ContentModel.pageLayout(80, null, null, 0, 0.12, '1', 0);
	var auto5 = Z.ContentModel.pageLayout(80, null, null, 0, 0.12, '5', 0);
	assert.ok(Math.abs(auto1.ratio - 1) < 1e-9, '自动：非拼音格 1.0');
	assert.ok(Math.abs(auto5.ratio - 1.4) < 1e-9, '自动：拼音格 1.4');
	var custom = Z.ContentModel.pageLayout(80, null, null, 0, 0.12, '1', 120);
	assert.ok(Math.abs(custom.ratio - 1.2) < 1e-9, '用户值 ×1.20');
	assert.ok(Math.abs(custom.rowBoxMm - custom.gridMm * 1.2) < 1e-9, '行盒高 = 格宽 × 1.2');
	assert.ok(Math.abs(Z.ContentModel.pageLayout(80, null, null, 0, 0.12, '1', 999).ratio - 2) < 1e-9, '上限收敛 2');
	assert.ok(Math.abs(Z.ContentModel.pageLayout(80, null, null, 0, 0.12, '1', 1).ratio - 0.5) < 1e-9, '下限收敛 0.5');
});

test('SheetLayout.compute：GridRatio 透传（0=自动；用户值生效）', function () {
	var Z = loadCore();
	var auto = Z.SheetLayout.compute({ content: '永', cols: 0, gridPx: 80, config: Z.Config });
	assert.ok(Math.abs(auto.ratio - 1) < 1e-9, '默认自动 1.0');
	var custom = Z.SheetLayout.compute({ content: '永', cols: 0, gridPx: 80, gridRatio: 120, config: Z.Config });
	assert.ok(Math.abs(custom.ratio - 1.2) < 1e-9, '用户值 ×1.20');
	assert.ok(Math.abs(custom.rowBoxMm - custom.gridMm * 1.2) < 1e-9, '行盒随宽高比');
});

test('SheetLayout.compute：每页铺满空临格行（无字也画格）', function () {
	var Z = loadCore();
	var layout = Z.SheetLayout.compute({ content: '永', cols: 0, gridPx: 80 });
	assert.strictEqual(layout.pitchFirstMm, layout.pitchMm); /* 无标题时与整页行距一致 */
	assert.strictEqual(layout.cols, 8);
	assert.strictEqual(layout.rows, 11);
	assert.strictEqual(layout.pages.length, 1);
	assert.strictEqual(layout.pages[0].lines.length, 11);
	assert.deepStrictEqual(
		layout.pages[0].lines[0].cells.map(function (c) { return c.char; }),
		['永'].concat(Array(7).fill(''))
	);
	assert.ok(layout.pages[0].lines.slice(1).every(function (line) {
		return line.cells.length === 8 && line.cells.every(function (c) { return c.char === '' && c.role === 'blank'; });
	}), '补满行应为 8 个空临格');
});

test('StrokeOrder：默认关闭且为 bool schema', function () {
	var Z = loadCore();
	assert.strictEqual(Z.DEFAULTS.StrokeOrder, false);
	assert.strictEqual(Z.ConfigSchema.StrokeOrder.type, 'bool');
	assert.strictEqual(Z.ConfigSchema.StrokeOrder.group, 'text');
	assert.strictEqual(Z.normalizeField('StrokeOrder', true), true);
	assert.strictEqual(Z.normalizeField('StrokeOrder', 'x'), false);
});

test('extractMedians：每笔取中位点并归一化到 0..1', function () {
	var Z = loadCore();
	var m = Z.extractMedians({ medians: [
		[[0, 0], [512, 512], [1024, 1024]],
		[[100, 200]],
		[]
	] });
	assert.ok(Array.isArray(m));
	assert.strictEqual(m.length, 2);
	assert.ok(Math.abs(m[0].x - 0.5) < 1e-9 && Math.abs(m[0].y - 0.5) < 1e-9, '首笔中位点 0.5,0.5');
	assert.ok(Math.abs(m[1].x - 100 / 1024) < 1e-9 && Math.abs(m[1].y - 200 / 1024) < 1e-9, '次笔点归一化');
	assert.strictEqual(Z.extractMedians(null), null);
	assert.strictEqual(Z.extractMedians({ medians: [] }), null);
});

/* ---------- C1 控笔练习 ---------- */

test('ControlPattern：默认 line-h 且为 enum schema', function () {
	var Z = loadCore();
	assert.ok(Z.MODES.indexOf('control') >= 0, 'MODES 含 control');
	assert.strictEqual(Z.MODE_NAMES.control, '控笔');
	assert.strictEqual(Z.MODE_ZG.control, '1');
	assert.strictEqual(Z.DEFAULTS.ControlPattern, 'line-h');
	assert.strictEqual(Z.ConfigSchema.ControlPattern.type, 'enum');
	assert.ok(Z.ConfigSchema.ControlPattern.values.indexOf('spiral') >= 0, '图案库含螺旋');
	assert.strictEqual(Z.normalizeField('ControlPattern', 'wave'), 'wave');
	assert.strictEqual(Z.normalizeField('ControlPattern', 'nope'), 'line-h');
});

test('buildControlSvg：角色线型与缓存', function () {
	var Z = loadCore();
	var model = Z.buildControlSvg('line-h', 'rgba(1, 2, 3, 0.5)', 'model');
	assert.ok(model.indexOf('<svg') === 0, '返回 SVG');
	assert.ok(model.indexOf('stroke="rgba(1, 2, 3, 0.5)"') >= 0, '范字用色');
	assert.ok(model.indexOf('stroke-dasharray') < 0, '范字实线');
	var trace = Z.buildControlSvg('wave', '#123456', 'trace');
	assert.ok(trace.indexOf('stroke-dasharray="5,4"') >= 0, '描红虚线');
	assert.strictEqual(Z.buildControlSvg('line-h', '#000', 'blank'), '', '空临格不画图案');
	assert.strictEqual(Z.getControlBackground('line-h', '#000', 'model'), Z.getControlBackground('line-h', '#000', 'model'), '同组合复用缓存');
	assert.strictEqual(Z.getControlBackground('line-h', '#000', 'blank'), null, '空临格无背景');
});

test('ContentModel：control 跳过文字解析，按行生成图案单元', function () {
	var Z = loadCore();
	var model = Z.ContentModel.parse('忽略内容\n第二行\n\n第三行', 'control');
	assert.strictEqual(model.blocks.length, 4, '行 + 分页');
	assert.strictEqual(model.blocks[2].type, 'page');
	var pages = Z.ContentModel.paginate(model, 8, 11, null, 'control', 'wave');
	assert.strictEqual(pages.length, 2, '空行分页');
	assert.strictEqual(pages[0].length, 2, '前两行');
	assert.ok(pages[0].every(function (line) {
		return line.length === 8 && line.every(function (c) { return c.char === 'wave' && c.mark === ''; });
	}), '每行 8 格图案');
	/* 空内容：生成满页 */
	var empty = Z.ContentModel.paginate(Z.ContentModel.parse('', 'control'), 8, 11, null, 'control', 'line-v');
	assert.strictEqual(empty.length, 1);
	assert.strictEqual(empty[0].length, 11, '满页行数');
});

test('SheetLayout.compute：control 输出图案单元并套用模板', function () {
	var Z = loadCore();
	var cfg = Object.assign({}, Z.DEFAULTS, { Mode: 'control', ControlPattern: 'zigzag', Content: '' });
	var layout = Z.SheetLayout.compute({ config: cfg });
	assert.strictEqual(layout.pages[0].lines[0].cells[0].char, 'zigzag', 'char 存图案 key');
	assert.strictEqual(layout.pages[0].lines[0].cells[0].role, 'model', 'normal 模板全范字');
	var traceCfg = Object.assign({}, cfg, { Template: 'trace' });
	var traceLayout = Z.SheetLayout.compute({ config: traceCfg });
	assert.strictEqual(traceLayout.pages[0].lines[0].cells[0].role, 'trace', '整页描红');
	assert.strictEqual(
		Z.ContentModel.estimatePages('', 80, 0, 0.12, null, null, 0, 'control'),
		traceLayout.pages.length,
		'估算页数与版式一致'
	);
});

test('paginate controlRows（P1-3）：显式行数固定且忽略内容；0 = 跟随内容 / 空则满页', function () {
	var Z = loadCore();
	/* 固定 3 行：内容 5 行文字不参与行数 */
	var fixed = Z.ContentModel.paginate(Z.ContentModel.parse('一二三四五'), 8, 11, null, 'control', 'wave', 3);
	assert.strictEqual(fixed[0].length, 3);
	assert.ok(fixed[0].every(function (line) {
		return line.length === 8 && line.every(function (c) { return c.char === 'wave'; });
	}), '每行 8 格图案');
	/* 0 = 按内容行数（2 行文字 → 2 行图案） */
	var follow = Z.ContentModel.paginate(Z.ContentModel.parse('甲\n乙'), 8, 11, null, 'control', 'wave', 0);
	assert.strictEqual(follow[0].length, 2);
	/* 0 + 空内容 = 满页 */
	var full = Z.ContentModel.paginate(Z.ContentModel.parse(''), 8, 11, null, 'control', 'wave', 0);
	assert.strictEqual(full[0].length, 11);
	/* 固定行数跨页：25 行 / 每页 11 行 → 3 页（11+11+3） */
	var paged = Z.ContentModel.paginate(Z.ContentModel.parse(''), 8, 11, null, 'control', 'wave', 25);
	assert.strictEqual(paged.length, 3);
	assert.deepStrictEqual(paged.map(function (p) { return p.length; }), [11, 11, 3]);
});

test('SheetLayout.compute：ControlRows 透传（固定 N 行图案，其余为整页铺满空临格）', function () {
	var Z = loadCore();
	var cfg = Object.assign({}, Z.DEFAULTS, { Mode: 'control', ControlPattern: 'wave', Content: '', ControlRows: 3 });
	var layout = Z.SheetLayout.compute({ config: cfg });
	var lines = layout.pages[0].lines;
	assert.strictEqual(lines.length, 11, '整页铺满仍补足每页行数');
	assert.strictEqual(lines[0].cells[0].char, 'wave');
	assert.strictEqual(lines[2].cells[0].char, 'wave', '前 3 行为图案');
	assert.strictEqual(lines[3].cells[0].char, '', '第 4 行起为补满空临格');
	assert.ok(lines.slice(3).every(function (l) {
		return l.cells.every(function (c) { return c.char === '' && c.role === 'blank'; });
	}));
});

test('控笔别名表：alias 唯一且与图案一一对应（z2h PenControl 式字符）', function () {
	var Z = loadCore();
	assert.ok(Z.CONTROL_PATTERN_KEYS.length >= 27, '图案扩充至 27 种');
	assert.strictEqual(Z.CONTROL_PATTERN_ALIASES.length, Z.CONTROL_PATTERN_KEYS.length);
	assert.strictEqual(new Set(Z.CONTROL_PATTERN_ALIASES).size, Z.CONTROL_PATTERN_ALIASES.length, 'alias 不重复');
	Z.CONTROL_PATTERNS.forEach(function (p) {
		assert.strictEqual(Z.CONTROL_ALIAS_TO_KEY[p.alias], p.key, 'alias→key：' + p.alias);
	});
	/* 新增类别路径齐全 */
	['square-in', 'spiral-square', 'cross-diag', 'diamond', 'tee', 'hourglass', 'bars', 'dash-h', 'dash-v', 'circle-in', 'triangle'].forEach(function (k) {
		assert.ok(Z.CONTROL_PATHS[k], '缺路径：' + k);
	});
});

test('control 序列：内容图形字符逐行编排（对齐 z2h PenControl）', function () {
	var Z = loadCore();
	/* 每行一个 alias → 三行三种图案 */
	var three = Z.ContentModel.paginate(Z.ContentModel.parse('1\n2\n3', 'control'), 6, 11, null, 'control', 'arch');
	assert.deepStrictEqual(three[0].map(function (l) { return l[0].char; }), ['line-h', 'line-v', 'line-slash']);
	/* 同行多个 alias → 多行；非 alias 文本忽略 */
	var flat = Z.ContentModel.paginate(Z.ContentModel.parse('练123习', 'control'), 6, 11, null, 'control', 'arch');
	assert.strictEqual(flat[0].length, 3);
	assert.deepStrictEqual(flat[0].map(function (l) { return l[0].char; }), ['line-h', 'line-v', 'line-slash']);
	/* 无 alias 的非空行 → 回退 ControlPattern（旧行为） */
	var fallback = Z.ContentModel.paginate(Z.ContentModel.parse('永', 'control'), 6, 11, null, 'control', 'zigzag');
	assert.deepStrictEqual(fallback[0].map(function (l) { return l[0].char; }), ['zigzag']);
	/* 混合：alias 行 + 默认行 */
	var mixed = Z.ContentModel.paginate(Z.ContentModel.parse('A\n文字\nB', 'control'), 4, 11, null, 'control', 'wave');
	assert.deepStrictEqual(mixed[0].map(function (l) { return l[0].char; }), ['s-curve', 'wave', 'spiral']);
	/* ControlRows>0 覆盖序列 */
	var fixed = Z.ContentModel.paginate(Z.ContentModel.parse('1\n2\n3', 'control'), 6, 11, null, 'control', 'wave', 2);
	assert.strictEqual(fixed[0].length, 2);
	assert.ok(fixed[0].every(function (l) { return l.every(function (c) { return c.char === 'wave'; }); }));
	/* 三端同源的版面：SheetLayout 输出 char 序列 + estimatePages 一致 */
	var cfg = Object.assign({}, Z.DEFAULTS, { Mode: 'control', ControlPattern: 'arch', Content: '1\n2\n3', GridSize: 80 });
	var layout = Z.SheetLayout.compute({ config: cfg });
	assert.deepStrictEqual(
		layout.pages[0].lines.slice(0, 3).map(function (l) { return l.cells[0].char; }),
		['line-h', 'line-v', 'line-slash']
	);
	assert.strictEqual(
		Z.ContentModel.estimatePages('1\n2\n3', 80, 0, 0.12, null, null, 0, 'control'),
		layout.pages.length,
		'估算页数与版式一致'
	);
});

/* ---------- 笔画字帖 ---------- */

test('笔画模式：MODES 顺序 / 名称 / 推荐字格 / 默认快照', function () {
	var Z = loadCore();
	assert.strictEqual(Z.MODES.indexOf('stroke') - Z.MODES.indexOf('hanzi'), 1, '笔画紧跟汉字');
	assert.strictEqual(Z.MODE_NAMES.stroke, '笔画');
	assert.strictEqual(Z.MODE_ZG.stroke, '3');
	var st = Z.defaultModeState('stroke');
	assert.strictEqual(st.ZgType, '3', '推荐米字回字');
	assert.strictEqual(st.RepeatCount, 5, '笔画推荐单元重复描红 5 格（G5）');
	assert.strictEqual(Z.ConfigSchema.Mode.values.indexOf('stroke') >= 0, true);
	/* 各类型推荐字内偏移（G5）：数字下移落基线区、拼音上移 */
	assert.strictEqual(Z.defaultModeState('number').CharOffsetY, 0.2);
	assert.strictEqual(Z.defaultModeState('pinyin').CharOffsetY, -0.12);
	assert.strictEqual(Z.defaultModeState('hanzi').CharOffsetY, Z.DEFAULTS.CharOffsetY, '汉字保持默认');
	assert.strictEqual(Z.defaultModeState('hanzi').RepeatCount, Z.DEFAULTS.RepeatCount, '汉字保持默认描红数');
});

test('笔画库：17 笔形、别名唯一、名称映射', function () {
	var Z = loadCore();
	assert.strictEqual(Z.STROKE_LIBRARY.length, 17);
	var seen = {};
	Z.STROKE_LIBRARY.forEach(function (s) {
		assert.ok(s.key && s.name, '条目含 key/name');
		s.aliases.forEach(function (a) {
			assert.ok(!seen[a], '别名不重复：' + a);
			seen[a] = s.key;
		});
	});
	assert.strictEqual(Z.STROKE_KEYS.length, Z.STROKE_LIBRARY.length);
	assert.strictEqual(Z.STROKE_NAMES.heng, '横');
	assert.strictEqual(Z.matchStrokeToken(['短', '撇'], 0).key, 'duanpie', '两字名称优先');
	assert.strictEqual(Z.matchStrokeToken(['钩'], 0).key, 'shugou');
	assert.strictEqual(Z.strokeKeyFor('一'), 'heng');
});

test('ContentModel：笔画解析（名称 / 单字别名 / 最长匹配 / 空格 / 标点）', function () {
	var Z = loadCore();
	var r1 = Z.ContentModel.parse('横竖撇捺点提折钩', 'stroke').blocks[0];
	assert.deepStrictEqual(r1.chars, ['heng', 'shu', 'pie', 'na', 'dian', 'ti', 'hengzhe', 'shugou']);
	var r2 = Z.ContentModel.parse('一丨丿丶', 'stroke').blocks[0];
	assert.deepStrictEqual(r2.chars, ['heng', 'shu', 'pie', 'dian']);
	/* 永字八法句 */
	var r3 = Z.ContentModel.parse('点横竖钩提撇短撇捺', 'stroke').blocks[0];
	assert.deepStrictEqual(r3.chars, ['dian', 'heng', 'shugou', 'ti', 'pie', 'duanpie', 'na']);
	/* 「横折」整体命中横折（而非 横+折） */
	assert.deepStrictEqual(Z.ContentModel.parse('横折', 'stroke').blocks[0].chars, ['hengzhe']);
	/* 空格 = 空临格；未收录字符忽略 */
	var r4 = Z.ContentModel.parse('横X竖 撇', 'stroke').blocks[0];
	assert.deepStrictEqual(r4.chars, ['heng', 'shu', '', 'pie']);
	/* 标点附前笔；前一格为空时忽略 */
	var r5 = Z.ContentModel.parse('横，竖', 'stroke').blocks[0];
	assert.strictEqual(r5.marks[0], '，');
	var r6 = Z.ContentModel.parse('横 ，竖', 'stroke').blocks[0];
	assert.strictEqual(r6.marks[0], '', '空临格后的标点不占位');
	/* 空行分页 */
	var blocks = Z.ContentModel.parse('横\n\n竖', 'stroke').blocks;
	assert.strictEqual(blocks.length, 3);
	assert.strictEqual(blocks[1].type, 'page');
});

test('buildStrokeSvg：角色与缓存', function () {
	var Z = loadCore();
	var model = Z.buildStrokeSvg('heng', '#123456', 'model');
	assert.ok(model.indexOf('<svg') === 0, '返回 SVG');
	assert.ok(model.indexOf('fill="#123456"') >= 0, '范字用色');
	assert.strictEqual(Z.buildStrokeSvg('heng', '#000', 'blank'), '', '空临格不画');
	assert.ok(Z.strokePath('heng').indexOf('M') === 0, '轮廓 path 以 M 起始');
	assert.strictEqual(Z.getStrokeBackground('heng', '#000', 'model'), Z.getStrokeBackground('heng', '#000', 'model'), '同组合复用缓存');
	assert.strictEqual(Z.getStrokeBackground('heng', '#000', 'blank'), null, '空临格无背景');
	assert.ok(Z.strokeDataUri('heng', '#000', 'model').indexOf('data:image/svg+xml') === 0);
});

test('CONTENT_FORMS：字段合法性与模式覆盖', function () {
	var Z = loadCore();
	assert.ok(Z.CONTENT_FORMS.length >= 8);
	Z.CONTENT_FORMS.forEach(function (f) {
		assert.ok(f.key && f.name, '条目含 key/name');
		assert.ok(Z.MODES.indexOf(f.apply.Mode) >= 0, 'Mode 已登记：' + f.key);
		Object.keys(f.apply).forEach(function (k) {
			assert.ok(Z.ConfigSchema[k], 'apply 字段已登记：' + k);
		});
	});
	var strokeForm = Z.CONTENT_FORMS.filter(function (f) { return f.apply.Mode === 'stroke'; })[0];
	assert.strictEqual(strokeForm.name, '笔画入门');
	assert.strictEqual(strokeForm.apply.Template, 'lead');
	/* 单元重复两种形态已登记且 apply 字段合法 */
	var repeatForms = Z.CONTENT_FORMS.filter(function (f) { return f.apply.Template === 'repeat'; });
	assert.deepStrictEqual(repeatForms.map(function (f) { return f.apply.RepeatUnit; }), ['char', 'word']);
	/* 段落书写预置（对齐 z2h 横线格段落形态） */
	var para = Z.CONTENT_FORMS.filter(function (f) { return f.key === 'paragraph'; })[0];
	assert.ok(para, '段落预置已登记');
	assert.strictEqual(para.apply.Mode, 'hanzi');
	assert.strictEqual(para.apply.ZgType, '7', '横线格');
	assert.strictEqual(para.apply.CharGap, 0);
	assert.ok(para.apply.RowGap > Z.DEFAULTS.RowGap, '行距加大以呈段落感');
});

test('单元重复行：单字模式锁列、整行重复、首格范字（对齐 z2h）', function () {
	var Z = loadCore();
	var cfg = Object.assign({}, Z.DEFAULTS, { Mode: 'hanzi', Content: '你好世界', Template: 'repeat', RepeatUnit: 'char', RepeatCount: 19 });
	var layout = Z.SheetLayout.compute({ config: cfg });
	assert.strictEqual(layout.cols, 20, '列数锁定为描红数 + 1');
	assert.strictEqual(layout.repeat, true);
	assert.ok(layout.gridMm < 80 * 25.4 / 96 - 1e-9, '格宽小于理想值（overCols 生效，格子收缩）');
	var rows = layout.pages[0].lines;
	/* 版式会整页铺满空临格行：有字行 = 4 个源字各一行 */
	var inked = rows.filter(function (line) { return line.cells.some(function (c) { return c.char !== ''; }); });
	assert.strictEqual(inked.length, 4, '4 个源字各占一行');
	inked.forEach(function (line, i) {
		assert.strictEqual(line.cells.length, 20);
		assert.deepStrictEqual(line.cells.map(function (c) { return c.char; }), Array(20).fill('你好世界'[i]));
		assert.strictEqual(line.cells[0].role, 'model', '首格范字深色');
		assert.ok(line.cells.slice(1).every(function (c) { return c.role === 'trace'; }), '其余描红');
		assert.strictEqual(line.cells[0].src, i, 'src 指向源内容序号');
		assert.strictEqual(line.cells[19].src, i, '重复副本共享同一 src');
	});
	assert.ok(rows.length >= inked.length && rows.slice(inked.length).every(function (line) {
		return line.cells.every(function (c) { return c.role === 'blank'; });
	}), '版式余行铺满空临格');
});

test('单元重复行：词组模式按空白分词且词不拆行', function () {
	var Z = loadCore();
	var cfg = Object.assign({}, Z.DEFAULTS, { Mode: 'hanzi', Content: '你好 世界', Template: 'repeat', RepeatUnit: 'word', RepeatCount: 3 });
	var layout = Z.SheetLayout.compute({ config: cfg });
	assert.strictEqual(layout.cols, 4);
	var rows = layout.pages[0].lines.filter(function (line) { return line.cells.some(function (c) { return c.char !== ''; }); });
	assert.strictEqual(rows.length, 2, '两个词各占一行（余行铺满空临格）');
	assert.deepStrictEqual(rows[0].cells.map(function (c) { return c.char; }), ['你', '好', '你', '好'], '第一词循环');
	assert.deepStrictEqual(rows[1].cells.map(function (c) { return c.char; }), ['世', '界', '世', '界'], '第二词循环');
	assert.strictEqual(rows[0].cells[1].src, 1);
	assert.strictEqual(rows[1].cells[0].src, 2, 'src 跨词连续编号');
});

test('单元重复行：点数估算与版式计算同源', function () {
	var Z = loadCore();
	var base = { Mode: 'hanzi', Content: '你好世界', ZgType: '3', Template: 'repeat', RepeatUnit: 'char', RepeatCount: 19 };
	var layout = Z.SheetLayout.compute({ config: Object.assign({}, Z.DEFAULTS, base) });
	var est = Z.ContentModel.estimatePages('你好世界', 80, 20, Z.DEFAULTS.RowGap, null, null, 0, 'hanzi', false, 0, 0, 'char', true);
	assert.strictEqual(est, layout.pages.length, 'estimatePages 与 compute 页数一致');
	/* 单元行数超过单页容量时按版式分页 */
	var text30 = '一二三四五六七八九十'.repeat(3);
	var manyCfg = Object.assign({}, Z.DEFAULTS, base, { Content: text30 });
	var many = Z.SheetLayout.compute({ config: manyCfg });
	var estMany = Z.ContentModel.estimatePages(text30, 80, 20, Z.DEFAULTS.RowGap, null, null, 0, 'hanzi', false, 0, 0, 'char', true);
	assert.ok(many.pages.length >= 2, '30 个单元超出单页行数时分页');
	assert.strictEqual(estMany, many.pages.length, '多页场景估算一致');
});

test('单元重复行：点击编辑按 src 回溯源字', function () {
	var Z = loadCore();
	var cfg = Object.assign({}, Z.DEFAULTS, { Mode: 'hanzi', Content: '你好世界', Template: 'repeat', RepeatUnit: 'char', RepeatCount: 19 });
	var layout = Z.SheetLayout.compute({ config: cfg });
	var firstRow = layout.pages[0].lines[0];
	assert.strictEqual(firstRow.cells[7].src, 0, '第 8 格仍是源字第 0 个');
	var edited = Z.ContentModel.replaceCharAt('你好世界', firstRow.cells[7].src, '您', 'hanzi');
	assert.strictEqual(edited, '您好世界', '写回后源字被替换');
});

test('SheetLayout.compute：笔画按模板产出角色（剪影 char=key）', function () {
	var Z = loadCore();
	var cfg = Object.assign({}, Z.DEFAULTS, { Mode: 'stroke', Content: '横竖撇', ZgType: '3', Template: 'lead' });
	var layout = Z.SheetLayout.compute({ config: cfg });
	var cells = layout.pages[0].lines[0].cells;
	assert.strictEqual(cells[0].char, 'heng');
	assert.strictEqual(cells[0].role, 'model');
	assert.strictEqual(cells[1].role, 'trace', '首字范字其余描红');
	assert.strictEqual(cells[2].char, 'pie');
	var blank = Object.assign({}, cfg, { Content: '' });
	var bl = Z.SheetLayout.compute({ config: blank });
	assert.strictEqual(bl.pages[0].lines[0].cells[0].role, 'blank', '空内容为空临格');
});

test('练习密度：空行 / 空列注入（applySpacing + paginate + estimatePages 一致）', function () {
	var Z = loadCore();
	/* 空列：每 2 个字后插一个空临格；占位 '' 不占字数 */
	var model = Z.ContentModel.parse('天地玄黄', 'hanzi');
	assert.strictEqual(model.total, 4, '原文总计 4 字');
	var p1 = Z.ContentModel.paginate(model, 4, 10, null, 'hanzi', null, 0, 0, 2);
	assert.strictEqual(p1.length, 1);
	assert.deepStrictEqual(p1[0][0].map(function (c) { return c.char; }), ['天', '地', '', '玄']);
	assert.strictEqual(p1[0][1].map(function (c) { return c.char; }).join(''), '黄', '第二行仅 1 字');
	assert.strictEqual(Z.ContentModel.parse('天地玄黄', 'hanzi').total, 4, '注入不改变字数统计');

	/* 空行：每 2 个内容行后插一整行空临格（跨分页连续计数） */
	/* Cols=8：格子较小、每页约 11 行，6 行练习行全部落在第一页 */
	var cfg = Object.assign({}, Z.DEFAULTS, {
		Mode: 'hanzi', Content: '天地\n玄黄\n宇宙\n洪荒', Cols: 8, GridSize: 40,
		BlankRowEvery: 2, BlankColEvery: 0
	});
	var layout = Z.SheetLayout.compute({ config: cfg });
	var lines = layout.pages[0].lines;
	assert.strictEqual(lines.length, layout.rows, '整页补满到 rows 行');
	var isBlank = function (line) { return line.cells.every(function (c) { return c.role === 'blank' && c.char === ''; }); };
	assert.ok(isBlank(lines[2]) && isBlank(lines[5]), '第 3 / 6 行为整行空临格');
	assert.ok(!isBlank(lines[0]) && !isBlank(lines[1]), '前两行为内容行');
	assert.strictEqual(layout.pages[0].lines.slice(0, 6).filter(isBlank).length, 2, '6 个练习行中恰有 2 行空行');

	/* 页数估算与真源一致 */
	var pages = Z.ContentModel.estimatePages(cfg.Content, 40, 8, cfg.RowGap, cfg.Page, cfg.Margin, 0, 'hanzi', false, 2, 0);
	assert.strictEqual(pages, layout.pages.length);
});

test('练习密度：英文跳过空列（词结构不被打散）', function () {
	var Z = loadCore();
	var model = Z.ContentModel.parse('ab cd', 'english');
	var p1 = Z.ContentModel.paginate(model, 10, 10, null, 'english', null, 0, 0, 2);
	assert.ok(p1[0][0].words, '仍为词单元行');
	assert.strictEqual(p1[0][0].cells.length, 0, 'english 行不使用 cells');
});

test('英文字母大小写成对（EngPairCase）', function () {
	var Z = loadCore();
	/* 关闭：原样 */
	var off = Z.ContentModel.parse('abc', 'english');
	assert.deepStrictEqual(off.blocks[0].chars.join(''), 'abc');
	/* 开启：大写 + 小写两格；标点附词尾（小写格） */
	var on = Z.ContentModel.parse("don't", 'english', true);
	assert.deepStrictEqual(on.blocks[0].chars.join(''), 'DdOoNnTt');
	assert.strictEqual(on.blocks[0].marks[5], "'", "撇号附在前字 n 的小写格（第 6 格）");
	var tail = Z.ContentModel.parse('hi!', 'english', true);
	assert.strictEqual(tail.blocks[0].marks[3], '!', '词尾标点附末字母的小写格');
	/* 词宽按展开后字母数计算（自动折行口径一致） */
	var one = Z.ContentModel.parse('ab', 'english', true);
	var p1 = Z.ContentModel.paginate(one, 2, 10, null, 'english', null, 0, 0, 0);
	assert.strictEqual(p1[0][0].words[0].chars.length, 4);
});

test('ConfigSchema：练习密度与大小写配对字段已登记并归一化', function () {
	var Z = loadCore();
	['BlankRowEvery', 'BlankColEvery', 'EngPairCase'].forEach(function (k) {
		assert.ok(Z.ConfigSchema[k], '字段已登记：' + k);
	});
	assert.strictEqual(Z.normalizeField('BlankRowEvery', 9), 5, '上限 5');
	assert.strictEqual(Z.normalizeField('BlankRowEvery', -1), 0, '下限 0');
	assert.strictEqual(Z.normalizeField('BlankColEvery', 'x'), 0, '非数字回退默认');
	assert.strictEqual(Z.normalizeField('EngPairCase', true), true);
	assert.strictEqual(Z.normalizeField('EngPairCase', 'yes'), false, '非 bool 回退默认');
});

test('分享链接：编解码往返（内容 / 标题 / 版式字段含 Mode）', function () {
	var Z = loadCore();
	var cfg = Object.assign({}, Z.DEFAULTS, {
		Mode: 'hanzi',
		Template: 'trace3',
		TraceCount: 4,
		Title: '早读',
		Content: '天地玄黄 宇宙洪荒'
	});
	var res = Z.encodeShare(cfg);
	assert.ok(res.ok, '短内容应编码成功');
	assert.strictEqual(res.url.indexOf('#s='), 'https://example.com/index.html'.length, 'hash 直接拼在文档地址后');
	var fields = Z.decodeShare(res.hash);
	assert.ok(fields, '可解回');
	assert.strictEqual(fields.Mode, 'hanzi');
	assert.strictEqual(fields.Template, 'trace3');
	assert.strictEqual(fields.TraceCount, 4);
	assert.strictEqual(fields.Title, '早读');
	assert.strictEqual(fields.Content, '天地玄黄 宇宙洪荒');
	/* 全局偏好不进载荷（跟随打开者本机） */
	assert.strictEqual(fields.Theme, undefined, 'Theme 不分享');
	assert.strictEqual(fields.FontSource, undefined, '字体来源不分享');
});

test('分享链接：损坏 / 版本不符返回 null', function () {
	var Z = loadCore();
	assert.strictEqual(Z.decodeShare(''), null, '空串');
	assert.strictEqual(Z.decodeShare('#s=!!!不是base64!!!'), null, '非法 base64');
	assert.strictEqual(Z.decodeShare('#s=' + Buffer.from('{"v":1}', 'utf8').toString('base64')), null, '缺 d 字段');
	var future = Buffer.from(JSON.stringify({ v: 999, d: { Mode: 'hanzi' } }), 'utf8').toString('base64')
		.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	assert.strictEqual(Z.decodeShare('#s=' + future), null, '未来版本不误解析');
});

test('分享链接：超长内容降级为不生成 URL', function () {
	var Z = loadCore();
	var cfg = Object.assign({}, Z.DEFAULTS, { Content: '永'.repeat(5000) });
	var res = Z.encodeShare(cfg);
	assert.strictEqual(res.ok, false);
	assert.strictEqual(res.reason, 'too-long');
	assert.strictEqual(res.chars, 5000);
	assert.ok(res.urlLength > Z.MAX_SHARE_URL_CHARS, '确实超限');
});

test('分享链接：shareFromLocation 只认 #s=', function () {
	var Z = loadCore();
	var cfg = Object.assign({}, Z.DEFAULTS, { Content: '你好' });
	var res = Z.encodeShare(cfg);
	assert.ok(Z.shareFromLocation({ hash: res.hash }).Content === '你好', '标准 hash');
	assert.strictEqual(Z.shareFromLocation({ hash: '' }), null, '无标记');
	assert.strictEqual(Z.shareFromLocation({ hash: '#x=abc' }), null, '其它 hash 参数不误触');
	assert.strictEqual(Z.shareFromLocation({ hash: '#s=%%%坏载荷' }), null, '损坏载荷');
});

test('PNG 导出文件名：标题清洗 / 时间戳 / 多页页码', function () {
	var Z = loadCore();
	assert.match(Z.pngFilename('', 0, 1), /^墨帖-\d{8}-\d{4}\.png$/, '无标题');
	assert.match(Z.pngFilename('早读', 0, 1), /^墨帖-早读-\d{8}-\d{4}\.png$/, '含标题');
	/* Windows / 路径非法字符统一替换为 - */
	assert.match(
		Z.pngFilename('a/b:c*d?e"f<g>h|i\\j', 0, 1),
		/^墨帖-a-b-c-d-e-f-g-h-i-j-\d{8}-\d{4}\.png$/,
		'非法字符清洗'
	);
	assert.match(Z.pngFilename('早读', 2, 5), /^墨帖-早读-\d{8}-\d{4}-p3\.png$/, '多页带页码');
	/* 超长标题截断到 40 字符（清洗后） */
	var longName = Z.pngFilename('字'.repeat(60), 0, 1);
	assert.ok(longName.indexOf('-' + '字'.repeat(40) + '-') > 0, '超长标题截断 40');
});

test('元信息：ShowScore 默认关闭并随快照持久化', function () {
	var Z = loadCore();
	assert.strictEqual(Z.DEFAULTS.ShowScore, false);
	Z.saveConfig(Object.assign({}, Z.DEFAULTS, { ShowScore: true }));
	assert.strictEqual(Z.loadConfig().ShowScore, true, '落盘后可读回');
});

test('多音字：行级语境取音与单元对齐（getLinePinyins）', function () {
	var Z = loadCore();
	/* 迷你替身：词级定音表 + 逐字回退（真实 pinyin-pro 行为已用 vendor 文件实测：
	 * 「长大」zhǎng dà / 「长沙」cháng shā / array 模式逐元素对齐） */
	var DICT = { '长大': ['zhǎng', 'dà'], '长沙': ['cháng', 'shā'], '还可以': ['hái', 'kě', 'yǐ'] };
	var SINGLE = { 长: 'cháng', 大: 'dà', 还: 'hái', 可: 'kě', 以: 'yǐ', 沙: 'shā' };
	global.window.pinyinPro = function (text, opts) {
		if (opts && opts.type === 'array') {
			if (Object.prototype.hasOwnProperty.call(DICT, text)) return DICT[text];
			return String(text).split('').map(function (ch) { return Object.prototype.hasOwnProperty.call(SINGLE, ch) ? SINGLE[ch] : ch; });
		}
		var arr = global.window.pinyinPro(text, { type: 'array' });
		return Array.isArray(arr) ? arr.join(' ') : '';
	};
	Z.resetPinyin();
	assert.deepStrictEqual(Z.getLinePinyins([{ char: '长' }, { char: '大' }]), ['zhǎng', 'dà'], '词中定音');
	assert.deepStrictEqual(Z.getLinePinyins([{ char: '长' }]), ['cháng'], '单字回退首音');
	assert.deepStrictEqual(
		Z.getLinePinyins([{ char: '还' }, { char: '' }, { char: '可' }, { char: '以' }]),
		['hái', '', 'kě', 'yǐ'],
		'blank 格不参与查询且保持空位'
	);
	assert.deepStrictEqual(
		Z.getLinePinyins([{ char: 'A' }, { char: '可' }]),
		['', 'kě'],
		'非汉字不给拼音'
	);
});


/* 打印范围（D3 / web-features.md）：文本 → 0-based 页码集合 */
(function () {
	var Z = loadCore();
	function sort(set) { return Array.from(set).sort(function (a, b) { return a - b; }); }
	assert.deepStrictEqual(parseOf(''), { all: true, invalid: false }, '空文本 = 全部');
	assert.deepStrictEqual(parseOf('   '), { all: true, invalid: false }, '空白 = 全部');
	assert.deepStrictEqual(parseOf('2', 5), { all: false, invalid: false, pages: [1] }, '单页');
	assert.deepStrictEqual(parseOf('1,3-5', 6), { all: false, invalid: false, pages: [0, 2, 3, 4] }, '混合区间');
	assert.deepStrictEqual(parseOf('1-3', 3), { all: false, invalid: false, pages: [0, 1, 2] }, '全区间');
	assert.strictEqual(parseOf('0', 3).invalid, true, '0 越界');
	assert.strictEqual(parseOf('4', 3).invalid, true, '超过总页数');
	assert.strictEqual(parseOf('3-1', 5).invalid, true, '倒序区间');
	assert.strictEqual(parseOf('abc', 5).invalid, true, '非数字');
	assert.strictEqual(parseOf('1,,2', 5).invalid, true, '空项');
	assert.strictEqual(parseOf('2', 0).all, true, '无页数按全部处理');

	function parseOf(text, total) {
		total = total === undefined ? 5 : total;
		var r = Z.parsePageRange(text, total);
		if (r.invalid) return { invalid: true };
		if (r.all) return { all: true, invalid: false };
		return { all: false, invalid: false, pages: sort(r.set) };
	}
})();


/* 分享二维码（D4）：文本 → 模块矩阵；空串 / 超长降级 */
(function () {
	var Z = loadCore();
	var m1 = Z.buildQrMatrix('https://example.com/index.html#s=AAAA');
	assert.strictEqual(m1.ok, true, '正常链接可编码');
	assert.ok(m1.size > 0 && m1.cells.length === m1.size * m1.size, '矩阵尺寸一致');
	assert.strictEqual(Z.buildQrMatrix('').ok, false, '空串拒绝');
	assert.strictEqual(Z.buildQrMatrix('   ').ok, false, '空白拒绝');
	assert.strictEqual(Z.buildQrMatrix('A'.repeat(3000)).reason, 'too-long', '超长返回 too-long');
})();

test('traceAlphaOf：TraceRatio 连续可调（Z1=C-a）', function () {
	var Z = loadCore();
	/* 默认 50%：与旧 auto=0.5 行为一致 */
	assert.ok(Math.abs(Z.traceAlphaOf(Object.assign({}, Z.DEFAULTS)) - Z.DEFAULTS.InkAlpha * 0.5) < 1e-9);
	assert.ok(Math.abs(Z.traceAlphaOf({ InkAlpha: 0.8, TraceRatio: 100 }) - 0.8) < 1e-9);
	assert.ok(Math.abs(Z.traceAlphaOf({ InkAlpha: 0.8, TraceRatio: 10 }) - 0.08) < 1e-9);
	/* 非法值回退默认，不产生 NaN / 负值 */
	var bad = Z.traceAlphaOf({ InkAlpha: 0, TraceRatio: 0 });
	assert.ok(bad > 0 && isFinite(bad), '非法输入应回退 DEFAULTS');
});

test('SheetLayout.compute：每页页首标题与字号（Z2=C-b）', function () {
	var Z = loadCore();
	var base = { content: '永'.repeat(96), title: '练习', cols: 8 };
	/* 默认仅首页 */
	var legacy = Z.SheetLayout.compute(base);
	assert.strictEqual(legacy.pages[0].title, '练习');
	assert.strictEqual(legacy.pages[1].title, '');
	assert.strictEqual(legacy.showPageTitle, false);
	/* 开启后每页显示，且每页都占一行标题位 */
	var each = Z.SheetLayout.compute(Object.assign({}, base, { showPageTitle: true, pageTitleScale: 60 }));
	assert.deepStrictEqual(each.pages.map(function (p) { return p.title; }), ['练习', '练习']);
	assert.deepStrictEqual(each.pages.map(function (p) { return p.lines.length; }), [each.rows - 1, each.rows - 1]);
	assert.strictEqual(each.showPageTitle, true);
	assert.strictEqual(each.pageTitleScale, 60);
	/* 无标题内容不受开关影响 */
	var noTitle = Z.SheetLayout.compute({ content: '永'.repeat(96), title: '', cols: 8, showPageTitle: true });
	assert.deepStrictEqual(noTitle.pages.map(function (p) { return p.title; }), ['', '']);
	assert.strictEqual(noTitle.showPageTitle, false);
});

test('页级删页 / 合并 helpers（Z3）', function () {
	var Z = loadCore();
	var CM = Z.ContentModel;
	/* 可渲染序号：天0 地1 玄2 黄3 | 宇4 宙5 洪6 荒7 */
	assert.strictEqual(CM.removeCharsRange('天地玄黄\n\n宇宙洪荒', 0, 3, 'hanzi'), '宇宙洪荒');
	assert.strictEqual(CM.removeCharsRange('天地玄黄\n\n宇宙洪荒', 4, 7, 'hanzi'), '天地玄黄');
	/* 区间非法时原样返回 */
	assert.strictEqual(CM.removeCharsRange('天地', 5, 9, 'hanzi'), '天地');
	/* 合并：显式空行边界删除空行 */
	assert.strictEqual(CM.mergeAtBoundary('甲乙丙丁\n\n戊己庚辛', 3, 4, 'hanzi'), '甲乙丙丁\n戊己庚辛');
	/* 自动分页（无空行）不成立 */
	assert.strictEqual(CM.mergeAtBoundary('甲乙丙丁戊己庚辛', 3, 4, 'hanzi'), null);
	/* 仅一个换行也不是分页符 */
	assert.strictEqual(CM.mergeAtBoundary('甲乙丙丁\n戊己庚辛', 3, 4, 'hanzi'), null);
});

test('SheetLayout.compute：页 src 区间可供页级操作（Z3）', function () {
	var Z = loadCore();
	var layout = Z.SheetLayout.compute({ content: '永'.repeat(96), cols: 8 });
	assert.ok(layout.pages.length >= 2, '应至少两页');
	layout.pages.forEach(function (p) {
		assert.notStrictEqual(p.srcFrom, null, '有内容页应有 srcFrom');
		assert.ok(p.srcTo >= p.srcFrom, 'srcTo >= srcFrom');
	});
	for (var i = 1; i < layout.pages.length; i++) {
		assert.ok(layout.pages[i].srcFrom > layout.pages[i - 1].srcTo, '相邻页区间不重叠');
	}
	assert.strictEqual(layout.pages[0].srcFrom, 0);
	assert.strictEqual(layout.pages[layout.pages.length - 1].srcTo, 95);
});

test('粘贴长文一键清洗（Z4）', function () {
	var Z = loadCore();
	/* trim + 折叠空行 + 汉字后半角标点转全角 */
	var r1 = Z.ContentModel.cleanImportedText('  天地玄黄  \n\n\n\n宇宙洪荒  ', 'hanzi');
	assert.strictEqual(r1.text, '天地玄黄\n\n宇宙洪荒');
	assert.ok(r1.blankLines > 0, '应统计被折叠的空行');
	/* 汉字后的半角标点统一为全角；英文模式不转换 */
	var r2 = Z.ContentModel.cleanImportedText('你好,世界!今天天气好吗? yes.', 'hanzi');
	assert.strictEqual(r2.text, '你好，世界！今天天气好吗？ yes.');
	assert.strictEqual(r2.puncts, 3);
	var r3 = Z.ContentModel.cleanImportedText('hello, world!', 'english');
	assert.strictEqual(r3.text, 'hello, world!');
	assert.strictEqual(r3.puncts, 0);
	/* 字间空格是「空临格」，不得清洗 */
	var r4 = Z.ContentModel.cleanImportedText('天 地  玄 黄', 'hanzi');
	assert.strictEqual(r4.text, '天 地  玄 黄');
	/* 干净内容零改动 */
	var r5 = Z.ContentModel.cleanImportedText('天地\n\n玄黄', 'hanzi');
	assert.strictEqual(r5.text, '天地\n\n玄黄');
	assert.strictEqual(r5.blankLines, 0);
	assert.strictEqual(r5.puncts, 0);
});

test('纸张底色 / 纹理（C-d）', function () {
	var Z = loadCore();
	/* 默认纯白；PaperTint 自定义 hex 覆盖预设 */
	assert.strictEqual(Z.paperBgOf(Z.DEFAULTS), '#FFFFFF');
	assert.strictEqual(Z.paperBgOf({ PaperColor: 'cream' }), Z.PAPER_COLORS.cream);
	assert.strictEqual(Z.paperBgOf({ PaperColor: 'rice', PaperTint: '#E8DCC0' }), '#e8dcc0');
	/* 非法 tint / 未知预设回退 */
	assert.strictEqual(Z.paperBgOf({ PaperColor: 'nope', PaperTint: 'red' }), '#FFFFFF');
	/* 纹理：none / 未知 → null；fiber / speckle 为 SVG data URI 且确定性一致 */
	assert.strictEqual(Z.paperTextureUri({ PaperTexture: 'none' }), null);
	assert.strictEqual(Z.paperTextureUri({}), null);
	var a = Z.paperTextureUri({ PaperTexture: 'fiber' });
	var b = Z.paperTextureUri({ PaperTexture: 'fiber' });
	assert.ok(a && a.indexOf('data:image/svg+xml') === 0);
	assert.strictEqual(a, b, '同种子生成应稳定');
	assert.ok(a.indexOf('%3Csvg') !== -1 || a.indexOf('<svg') !== -1, '应为内联 SVG');
	assert.ok(Z.paperTextureUri({ PaperTexture: 'speckle' }).indexOf('data:image/svg+xml') === 0);
});

test('打印缩放（C-f）', function () {
	var Z = loadCore();
	/* 默认配置（A4 210mm）：自动缩到安全宽度 */
	var auto = Z.printScaleOf(Z.DEFAULTS);
	assert.ok(Math.abs(auto - Z.SAFE_PRINT_WIDTH_MM / 210) < 1e-9, 'A4 应按安全宽度缩小');
	/* 页宽不超过安全宽度：不缩 */
	assert.strictEqual(Z.printScaleOf({ Page: { width: 190 }, PrintScale: 0 }), 1);
	/* 手动百分比优先；上限 100，不放大大于 100% */
	assert.strictEqual(Z.printScaleOf({ Page: { width: 210 }, PrintScale: 60 }), 0.6);
	assert.strictEqual(Z.printScaleOf({ Page: { width: 210 }, PrintScale: 120 }), 1);
	/* 非法输入回退 */
	assert.strictEqual(Z.printScaleOf(null), 1);
	assert.strictEqual(Z.printScaleOf({ Page: { width: 0 }, PrintScale: 0 }), 1);
});

console.log('');
console.log(passed + ' 通过，' + failed + ' 失败');
if (failed) process.exitCode = 1;
