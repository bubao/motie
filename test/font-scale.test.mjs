/**
 * 界面字号档守卫（F2）：styles.css 不得出现游离 px 字号，一律引用 main.css :root 的 --fs-* 档位。
 * 运行：node test/font-scale.test.mjs（由 npm test 串联）。
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

var ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
var failures = [];

function check(name, cond, detail) {
	if (cond) {
		console.log('  ok  ' + name);
	} else {
		failures.push(name + (detail ? '：' + detail : ''));
		console.log('  FAIL ' + name + (detail ? '：' + detail : ''));
	}
}

var stylesCss = fs.readFileSync(path.join(ROOT, 'web/src/styles.css'), 'utf8');
var mainCss = fs.readFileSync(path.join(ROOT, 'css/main.css'), 'utf8');

/* 1. 档位变量齐全且取值有限 */
var SCALE = { '--fs-xs': '11px', '--fs-sm': '12px', '--fs-md': '13px', '--fs-lg': '15px', '--fs-xl': '16px', '--fs-2xl': '22px' };
var rootBlock = (mainCss.match(/:root\s*\{([\s\S]*?)\}/) || [null, ''])[1];
Object.keys(SCALE).forEach(function (name) {
	var m = rootBlock.match(new RegExp(name.replace('--', '\\-\\-') + '\\s*:\\s*([^;]+);'));
	check('main.css :root 定义 ' + name + ' = ' + SCALE[name], !!m && m[1].trim() === SCALE[name],
		m ? '实际=' + m[1].trim() : '未找到');
});

/* 2. styles.css 无游离 px 字号（预览纸内字号由毫米值派生，只在 JSX inline style，不入此文件） */
var literal = [];
stylesCss.split('\n').forEach(function (line, i) {
	var m = line.match(/font-size:\s*([0-9.]+)px/);
	if (m) literal.push((i + 1) + ':' + m[0]);
});
check('styles.css 无游离 px 字号', literal.length === 0, literal.join('，'));

/* 3. 引用的档位必须在已定义集合内 */
var used = {};
(stylesCss.match(/var\((--fs-[a-z0-9-]+)\)/g) || []).forEach(function (raw) {
	var name = raw.slice(4, -1);
	used[name] = (used[name] || 0) + 1;
});
var unknown = Object.keys(used).filter(function (name) { return !(name in SCALE); });
check('styles.css 引用的 --fs-* 均已定义', unknown.length === 0, unknown.join('，'));
console.log('  字号档用量：' + Object.keys(used).map(function (k) { return k + '×' + used[k]; }).join(' '));

if (failures.length) {
	console.error('字号档守卫失败 ' + failures.length + ' 项');
	process.exit(1);
}
console.log('字号档守卫通过（F2）');
