/**
 * lite / web 共享逻辑差分测试。
 *
 * lite-src/vendor/* 是 ES5 全局挂载副本，web/src/core/* 是 ESM 模块，两者同源、独立实现
 * （lite-src/main.js 顶部注释：改动共享逻辑需同步两处）。此前无任何机制发现两侧漂移。
 * 本测试以「同输入 → 同输出」锁定两边共有语义：任一侧重构导致行为变化都会在此失败。
 *
 * 覆盖：配置常量 / normalize* 家族 / sanitize* / resolveZgOptions / zg 背景 SVG /
 *        ContentModel.parse（共有调用形态 parse(text)）。
 * 不覆盖：DOM / canvas / IndexedDB 相关（Font 应用、资源加载）与 web 新增 API
 *        （CONTROL_*、MODE_*、PREFS_KEYS 等 lite 不存在的面）。
 *
 * 运行：node test/lite-parity.test.mjs（由 npm test 串联）。
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import * as webConfig from '../web/src/core/config.js';
import * as webContent from '../web/src/core/content.js';
import * as webZg from '../web/src/core/zg-bg.js';

var ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
var failures = [];
var passed = 0;

/* vm 沙箱与主 realm 的原型不同，deepStrictEqual 会把「同值不同原型」判为不等；
 * 两侧均为纯数据，先经 JSON 归一化回主 realm 再比较。 */
function norm(v) {
	return JSON.parse(JSON.stringify(v));
}

function check(name, fn) {
	try {
		fn();
		passed++;
	} catch (err) {
		failures.push(name + '：' + (err && err.message ? err.message : String(err)));
	}
}

/* 以 vm 加载 lite 全局命名空间（顺序与 lite-src/main.js 顶部 import 一致） */
var sandbox = { window: {} };
vm.createContext(sandbox);
for (var f of ['config.js', 'content.js', 'zg-bg.js']) {
	var code = fs.readFileSync(path.join(ROOT, 'lite-src', 'vendor', f), 'utf8');
	vm.runInContext(code, sandbox, { filename: 'lite-src/vendor/' + f });
}
var L = sandbox.window.Zitie;

/* ---------- 1. 共有常量逐一深比较 ---------- */
var CONST_KEYS = [
	'STORAGE_KEY', 'SAMPLE_TEXT',
	'ZG_COLORS', 'ZG_COLOR_VALUES',
	'ZG_LINE_MODES', 'ZG_LINE_MODE_NAMES', 'ZG_DASH_STYLES', 'ZG_DASH_STYLE_NAMES',
	'ZG_LINE_CAPS', 'ZG_LINE_CAP_NAMES', 'VERTICAL_ALIGNS', 'INK_COLORS', 'INK_COLOR_KEYS', 'INK_RGB',
	'FONT_FORMATS',
	'MIN_GRID_SIZE', 'MAX_GRID_SIZE', 'MIN_GRID_RATIO', 'MAX_GRID_RATIO',
	'MIN_INK_ALPHA', 'MAX_INK_ALPHA', 'MIN_TRACE_COUNT', 'MAX_TRACE_COUNT',
	'MIN_ZG_BORDER_SCALE', 'MAX_ZG_BORDER_SCALE', 'MIN_ZG_OPACITY', 'MAX_ZG_OPACITY',
	'MIN_ZG_DASH_DENSITY', 'MAX_ZG_DASH_DENSITY', 'MIN_ZG_INNER_RATIO', 'MAX_ZG_INNER_RATIO',
	'MIN_ZG_ENG_MID', 'MAX_ZG_ENG_MID', 'MIN_ZG_PINYIN_TOP', 'MAX_ZG_PINYIN_TOP',
	'MIN_ZG_BASELINE_POS', 'MAX_ZG_BASELINE_POS', 'MIN_ZG_LINE_SCALE', 'MAX_ZG_LINE_SCALE',
	'MIN_COLS', 'MAX_COLS', 'MIN_GAP', 'MAX_GAP'
];
var missingLite = CONST_KEYS.filter(function (k) { return !(k in L); });
check('常量键在 lite 侧存在（缺失：' + missingLite.join(',') + '）', function () {
	assert.deepEqual(missingLite, []);
});
for (var key of CONST_KEYS) {
	if (!(key in L) || !(key in webConfig)) continue;
	check('常量 ' + key, function () {
		assert.deepStrictEqual(norm(L[key]), norm(webConfig[key]));
	});
}

/* 已知功能集差异（web 先行新增、lite 尚未跟进，属设计而非语义漂移）：
 * ZG_TYPES +「10」、TEMPLATES/TEMPLATE_KEYS +「repeat」、SAMPLES +笔画/数字/拼音/英文示例。
 * 锁定口径：lite 侧必须是 web 侧的子集（共有条目内容一致、顺序一致）。 */
/* 保序子序列检查：a 的元素按原顺序均出现在 b 中（允许 b 中间插入新条目） */
function isSubsequence(a, b) {
	var j = 0;
	for (var i = 0; i < b.length && j < a.length; i++) {
		if (b[i] === a[j]) j++;
	}
	return j === a.length;
}
check('ZG_TYPES：lite 为 web 保序子序列', function () {
	var a = norm(L.ZG_TYPES), b = norm(webConfig.ZG_TYPES);
	assert.ok(isSubsequence(a, b), 'lite=' + JSON.stringify(a) + ' web=' + JSON.stringify(b));
});
check('TEMPLATES：lite 条目为 web 子集且同名同义', function () {
	var bByKey = {};
	for (var t of norm(webConfig.TEMPLATES)) bByKey[t.key] = t.name;
	for (var lt of norm(L.TEMPLATES)) {
		assert.equal(bByKey[lt.key], lt.name, '模板 ' + lt.key);
	}
});
check('TEMPLATE_KEYS：lite 为 web 保序子序列', function () {
	var a = norm(L.TEMPLATE_KEYS), b = norm(webConfig.TEMPLATE_KEYS);
	assert.ok(isSubsequence(a, b), 'lite=' + JSON.stringify(a) + ' web=' + JSON.stringify(b));
});
check('SAMPLES：共有示例文本一致（允许 web 额外条目）', function () {
	var bByName = {};
	for (var s of norm(webConfig.SAMPLES)) bByName[s.name] = s.text;
	for (var ls of norm(L.SAMPLES)) {
		assert.equal(bByName[ls.name], ls.text, '示例 ' + ls.name);
	}
});

/* ---------- 2. normalize 家族（共有 Schema 键 × 代表值） ---------- */
var SCHEMA_KEYS = Object.keys(webConfig.ConfigSchema).filter(function (k) {
	return L.ConfigSchema && k in L.ConfigSchema;
});
var SAMPLES = [undefined, null, '', 'x', 0, -1, 1, 9999, true, false, {}, []];
for (var sk of SCHEMA_KEYS) {
	for (var sv of SAMPLES) {
		check('normalizeField(' + sk + ', ' + JSON.stringify(sv) + ')', function () {
			assert.deepStrictEqual(norm(L.normalizeField(sk, sv)), norm(webConfig.normalizeField(sk, sv)));
		});
	}
}

var NUM_SAMPLES = [undefined, null, '', '5', 'abc', 0, -3, 2.5, 9999, NaN, Infinity];
for (var nv of NUM_SAMPLES) {
	check('normalizeInt(' + String(nv) + ')', function () {
		assert.strictEqual(L.normalizeInt(nv, 1, 10, 3), webConfig.normalizeInt(nv, 1, 10, 3));
	});
	check('normalizeFloat(' + String(nv) + ')', function () {
		assert.strictEqual(L.normalizeFloat(nv, 0.1, 1, 0.5), webConfig.normalizeFloat(nv, 0.1, 1, 0.5));
	});
}
check('normalizeSize(undefined)', function () {
	assert.strictEqual(L.normalizeSize(undefined, 80), webConfig.normalizeSize(undefined, 80));
});
check('normalize(越界枚举)', function () {
	assert.strictEqual(L.normalize('zzz', ['a', 'b'], 'a'), webConfig.normalize('zzz', ['a', 'b'], 'a'));
});

/* ---------- 3. sanitize / 格式推测 ---------- */
var URL_SAMPLES = ['', 'https://a.com/f.ttf', '//evil', 'javascript:alert(1)', 'data:font/ttf;base64,AA',
	'/api/fonts/file/x', ' HTTPs://a.com/f.woff2 ', 'http://127.0.0.1:39130/a.otf'];
for (var u of URL_SAMPLES) {
	check('sanitizeFontURL(' + JSON.stringify(u) + ')', function () {
		assert.strictEqual(L.sanitizeFontURL(u), webConfig.sanitizeFontURL(u));
	});
	check('guessFontFormat(' + JSON.stringify(u) + ')', function () {
		assert.strictEqual(L.guessFontFormat(u), webConfig.guessFontFormat(u));
	});
}
var COLOR_SAMPLES = ['#ffffff', '#FFF', 'fff', '#12345678', 'red', '', '#gggggg', 'rgb(1,2,3)'];
for (var c of COLOR_SAMPLES) {
	check('sanitizeHexColor(' + JSON.stringify(c) + ')', function () {
		assert.strictEqual(L.sanitizeHexColor(c), webConfig.sanitizeHexColor(c));
	});
}
var SRC_SAMPLES = [undefined, null, 'default', 'url', 'local', 'system', 'junk', { type: 'url' }];
for (var s of SRC_SAMPLES) {
	check('normalizeFontSource(' + JSON.stringify(s) + ')', function () {
		assert.deepStrictEqual(L.normalizeFontSource(s, 'default'), webConfig.normalizeFontSource(s, 'default'));
	});
}

/* ---------- 4. resolveZgOptions：cfg 组合 → opts ---------- */
var CFGS = [
	{},
	{ ZgType: '1' }, { ZgType: '2' }, { ZgType: '3' }, { ZgType: '4' }, { ZgType: '5' },
	{ ZgType: '6' }, { ZgType: '7' }, { ZgType: '99' },
	{ ZgType: '3', ZgLineColor: '#ff0000', ZgBorderColor: '#00ff00', ZgOpacity: 0.5 },
	{ ZgType: '3', ZgInnerMode: 'none', ZgBorderMode: 'dashed', ZgDashStyle: 'dot' },
	{ ZgType: '2', ZgDashStyle: 'dashdot', ZgDashDensity: 2, ZgLineCap: 'round', ZgCrisp: true },
	{ ZgType: '4', ZgInnerRatio: 0.66, ZgEngMid: 0.5, ZgPinyinTop: 0.2, ZgBaselinePos: 0.8 },
	{ ZgType: '3', ZgStartDot: true, ZgLineScale: 2, ZgBorderScale: 3 }
];
var OPTS = [];
for (var cfg of CFGS) {
	check('resolveZgOptions(' + JSON.stringify(cfg) + ')', function () {
		var a = L.resolveZgOptions(cfg);
		var b = webConfig.resolveZgOptions(cfg);
		assert.deepStrictEqual(norm(a), norm(b));
		OPTS.push(a);
	});
}

/* ---------- 5. zg 背景 SVG 字符串完全一致 ---------- */
for (var i = 0; i < OPTS.length; i++) {
	check('buildZgSvg(opts#' + i + ')', function () {
		assert.strictEqual(L.buildZgSvg(OPTS[i]), webZg.buildZgSvg(OPTS[i]));
	});
	check('getZgBackground(opts#' + i + ')', function () {
		assert.strictEqual(L.getZgBackground(OPTS[i]), webZg.getZgBackground(OPTS[i]));
	});
}

/* ---------- 6. ContentModel.parse：共有调用形态 parse(text) ---------- */
var TEXTS = [
	'天地玄黄',
	'天地玄黄 宇宙洪荒\n寒来暑往\t秋收冬藏',
	'人之初，性本善。性相近，习相远。',
	'Hello world 你好 abc',
	'床前明月光，\n\n疑是地上霜。',
	'生僻字𠀀𠀁测试',
	''
];
	for (var t of TEXTS) {
	check('ContentModel.parse(' + JSON.stringify(t.slice(0, 12)) + ')', function () {
		assert.deepStrictEqual(norm(L.ContentModel.parse(t)), norm(webContent.ContentModel.parse(t)));
	});
}

/* ---------- 汇总 ---------- */
console.log('lite-parity：通过 ' + passed + ' 项');
if (failures.length) {
	console.log('失败 ' + failures.length + ' 项：');
	for (var msg of failures.slice(0, 40)) console.log('  FAIL ' + msg);
	if (failures.length > 40) console.log('  ...（其余 ' + (failures.length - 40) + ' 项省略）');
	process.exit(1);
}
console.log('lite 与 web 共享语义一致。');
