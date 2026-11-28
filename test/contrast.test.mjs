/**
 * 主题对比度回归（node test/contrast.test.mjs · U1）。
 * 解析 css/main.css 的设计变量（亮色 :root / 暗色 html[data-theme=dark]），
 * 按 WCAG 2.x 相对亮度公式计算「文本色 vs 背景色」对比度，正文级要求 ≥4.5（AA）。
 * 变量调整时必须保持全表达标，避免无痕引入低对比。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'css/main.css'), 'utf8');
const appCss = readFileSync(join(root, 'web/src/styles.css'), 'utf8');

/* 提取某个选择器块内的 --name: #hex 变量 */
function varsOf(selector) {
	const start = css.indexOf(selector);
	assert.ok(start >= 0, '未找到选择器 ' + selector);
	let end = css.indexOf('\n}', start);
	if (end < 0) end = css.length;
	const block = css.slice(start, end);
	const out = {};
	for (const m of block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2].toUpperCase();
	return out;
}

const light = varsOf(':root {');
const dark = varsOf('html[data-theme="dark"]');

function luminance(hex) {
	const h = hex.replace('#', '');
	const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
	const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
	return 0.2126 * f(ch[0]) + 0.7152 * f(ch[1]) + 0.0722 * f(ch[2]);
}

function ratio(a, b) {
	const la = luminance(a);
	const lb = luminance(b);
	const hi = Math.max(la, lb);
	const lo = Math.min(la, lb);
	return (hi + 0.05) / (lo + 0.05);
}

/* 解析某选择器块里的 background，并把 var(--x) 解析为该主题的变量值 */
function bgOf(text, selector, vars) {
	const start = text.indexOf(selector);
	assert.ok(start >= 0, '未找到选择器 ' + selector);
	const end = text.indexOf('\n}', start);
	const block = text.slice(start, end < 0 ? text.length : end);
	const m = block.match(/background:\s*([^;]+);/);
	assert.ok(m, selector + ' 缺少 background');
	let val = m[1].trim();
	const v = val.match(/^var\((--[\w-]+)\)$/);
	if (v) {
		assert.ok(vars[v[1]], '主题缺少变量 ' + v[1]);
		val = vars[v[1]];
	}
	return val;
}

/* 正文文本色（AA 4.5）与主按钮白字（AA 4.5）在各主题背景上的组合 */
const cases = [
	['--ink', ['--paper', '--sheet']],
	['--ink-soft', ['--paper', '--sheet', '--ui-subtle']],
	['--ink-faint', ['--paper', '--sheet']],
	['--cinnabar', ['--paper', '--sheet']],
	/* 强调态：当前项 / 激活 chip 的朱砂字压在暖底上（axe 曾在深色下报 3.99，此处固化） */
	['--cinnabar', ['--ui-active-warm']]
];

let failed = 0;
for (const [themeName, vars] of [['light', light], ['dark', dark]]) {
	for (const [fgKey, bgKeys] of cases) {
		const fg = vars[fgKey];
		assert.ok(fg, themeName + ' 缺少变量 ' + fgKey);
		for (const bgKey of bgKeys) {
			const bg = vars[bgKey];
			assert.ok(bg, themeName + ' 缺少变量 ' + bgKey);
			const r = ratio(fg, bg);
			const ok = r >= 4.5;
			if (!ok) failed++;
			console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${themeName.padEnd(5)} ${fgKey.padEnd(13)} on ${bgKey.padEnd(12)} ${r.toFixed(2)}`);
		}
	}
	/* 主按钮：白字压在实际生效的按钮底色上（暗色另有覆盖规则） */
	const btnBg = themeName === 'dark'
		? bgOf(css, 'html[data-theme="dark"] .rp-btn-primary', dark)
		: bgOf(appCss, '.rp-btn-primary {', light);
	const btn = ratio('#FFFFFF', btnBg);
	if (btn < 4.5) failed++;
	console.log(`  ${btn >= 4.5 ? 'ok  ' : 'FAIL'} ${themeName.padEnd(5)} #FFFFFF      on ${btnBg}        ${btn.toFixed(2)}`);
}

assert.strictEqual(failed, 0, failed + ' 组对比度低于 AA 4.5');
console.log('');
console.log('对比度检查通过（明 / 暗两套主题，正文与按钮均 ≥4.5）');
