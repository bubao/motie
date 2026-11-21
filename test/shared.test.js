/**
 * 共享核心回归测试（node test/shared.test.js / npm test）。
 * 覆盖：ConfigSchema 归一化、旧键迁移、parse / paginate / pageLayout / cellRole / SheetLayout。
 * 共享核心是 IIFE（挂 window.Zitie），此处用最小 window + localStorage 模拟加载。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var assert = require('assert');

var ROOT = path.resolve(__dirname, '..');
var CORE = ['js/config.js', 'js/content.js', 'js/zg-bg.js', 'js/sheet-layout.js'];

function makeStorage(initial) {
	var map = {};
	Object.keys(initial || {}).forEach(function (key) { map[key] = String(initial[key]); });
	return {
		getItem: function (key) { return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null; },
		setItem: function (key, value) { map[key] = String(value); },
		removeItem: function (key) { delete map[key]; }
	};
}

function loadCore(storage) {
	var win = { localStorage: storage || makeStorage(), ZITIE_BOOT: {} };
	global.window = win;
	CORE.forEach(function (file) {
		eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
	});
	return win.Zitie;
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
	assert.strictEqual(Z.normalizeField('ZgType', '9'), Z.DEFAULTS.ZgType);
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

/* ---------- Config 持久化 ---------- */

test('Config.load：非法保存值按 Schema 归一化', function () {
	var storage = makeStorage({ 'zitie.config': JSON.stringify({ Template: 'x', RowGap: 5, Cols: 99, InkAlpha: 0 }) });
	var Z = loadCore(storage);
	Z.Config.load();
	assert.strictEqual(Z.Config.Template, 'normal');
	assert.strictEqual(Z.Config.RowGap, 1);
	assert.strictEqual(Z.Config.Cols, Z.MAX_COLS);
	assert.strictEqual(Z.Config.InkAlpha, Z.MIN_INK_ALPHA);
});

test('Config.load：旧键 zitie-lite.config 迁移并写回统一键', function () {
	var storage = makeStorage({ 'zitie-lite.config': JSON.stringify({ TraceMode: true, Content: '永' }) });
	var Z = loadCore(storage);
	Z.Config.load();
	assert.strictEqual(Z.Config.Template, 'trace');
	assert.strictEqual(storage.getItem('zitie-lite.config'), null);
	assert.ok(storage.getItem('zitie.config'));
});

test('Config.save：只写 Schema 白名单 + 特殊字段', function () {
	var storage = makeStorage();
	var Z = loadCore(storage);
	Z.Config.load();
	Z.Config.evil = 'x';
	Z.Config.save();
	var data = JSON.parse(storage.getItem('zitie.config'));
	assert.strictEqual(data.evil, undefined);
	assert.strictEqual(data.Template, 'normal');
	assert.strictEqual(typeof data.fontURL, 'string');
	assert.strictEqual(data.ResourceMode, 'cdn');
});

test('Config.snapshot / 预设：白名单快照、保存 / 加载 / 删除', function () {
	var Z = loadCore();
	var snap = Z.Config.snapshot();
	assert.strictEqual(snap.Template, 'normal');
	assert.strictEqual(snap.GridSize, 80);
	assert.strictEqual(snap.evil, undefined);
	assert.deepStrictEqual(Z.Config.loadPresets(), {});
	Z.Config.savePreset('硬笔', { Template: 'trace', GridSize: 96 });
	assert.deepStrictEqual(Object.keys(Z.Config.loadPresets()), ['硬笔']);
	assert.strictEqual(Z.Config.loadPresets()['硬笔'].GridSize, 96);
	Z.Config.deletePreset('硬笔');
	assert.deepStrictEqual(Z.Config.loadPresets(), {});
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

test('Config.load：旧 fontURL 迁移为 FontSource（url）', function () {
	var storage = makeStorage({ 'zitie.config': JSON.stringify({ fontURL: 'https://a.com/f.woff2' }) });
	var Z = loadCore(storage);
	Z.Config.load();
	assert.deepStrictEqual(Z.Config.FontSource, { type: 'url', url: 'https://a.com/f.woff2' });
	/* 已显式保存过来源（default）时不迁移 */
	var storage2 = makeStorage({ 'zitie.config': JSON.stringify({ fontURL: 'https://a.com/f.woff2', FontSource: { type: 'default' } }) });
	var Z2 = loadCore(storage2);
	Z2.Config.load();
	assert.deepStrictEqual(Z2.Config.FontSource, { type: 'default' });
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
	assert.deepStrictEqual(rows[0].map(function (c) { return c.role; }), ['model', 'trace', 'trace', 'trace']);
	assert.deepStrictEqual(rows[1].map(function (c) { return c.role; }), ['model', 'trace', 'trace', 'model']);
	assert.deepStrictEqual(rows[2].map(function (c) { return c.role; }), ['model', 'trace', 'model', 'trace']);
	assert.deepStrictEqual(rows[3].map(function (c) { return c.role; }), ['model', 'model', 'model', 'model']);
	/* 旧枚举仍可用（回归） */
	var legacy = Z.SheetLayout.compute({ content: '永'.repeat(8), cols: 4, template: 'trace3', traceCount: 1 });
	assert.deepStrictEqual(legacy.pages[0].lines[0].map(function (c) { return c.role; }), ['model', 'trace', 'trace', 'trace']);
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
	assert.strictEqual(layout.pages[0].lines[0].length, 8);
	assert.deepStrictEqual(layout.pages[0].lines[0].map(function (c) { return c.role; }), Array(8).fill('model'));
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
	assert.deepStrictEqual(layout.pages[0].lines[0].map(function (c) { return c.char; }), ['天', '', '地', '']);
	assert.deepStrictEqual(layout.pages[0].lines[0].map(function (c) { return c.role; }), ['model', 'blank', 'model', 'blank']);
});

/* ---------- 字格背景（zg-bg） ---------- */

test('buildZgSvg：拼音格（type5）1×1.4——上区四线三格 + 下区正方形田字格（预览 / 字帖一致）', function () {
		var Z = loadCore();
		var svg = Z.buildZgSvg('5', '1');
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

test('buildZgSvg：作文格（type6）纯方格无内线，数字格（type7）下 1/3 基线横线', function () {
	var Z = loadCore();
	/* 作文格 = 作文纸：只有外框，一格一字 */
	var zw = Z.buildZgSvg('6', '1');
	assert.strictEqual((zw.match(/<path[^>]*>/g) || []).length, 1, '作文格应只有外框（纯方格，无内部线）');
	/* 数字格 = 数学本：一条横虚线作基线（下 1/3，字占上 2/3） */
	var sz = Z.buildZgSvg('7', '1');
	assert.ok(sz.indexOf('M1 53 L79 53') >= 0, '数字格应为下 1/3 基线横线 y=53');
	assert.strictEqual((sz.match(/<path[^>]*>/g) || []).length, 2, '数字格 = 基线横线 + 外框');
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
		layout.pages[0].lines[0].map(function (c) { return c.char; }),
		['永'].concat(Array(7).fill(''))
	);
	assert.ok(layout.pages[0].lines.slice(1).every(function (line) {
		return line.length === 8 && line.every(function (c) { return c.char === '' && c.role === 'blank'; });
	}), '补满行应为 8 个空临格');
});

console.log('');
console.log(passed + ' 通过，' + failed + ' 失败');
if (failed) process.exitCode = 1;
