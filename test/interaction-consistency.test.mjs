/**
 * 交互一致性不变量（node test/interaction-consistency.test.mjs · U4）。
 * 目标：toast / 禁用态 / 加载 spinner / 焦点管理四处「复用与统一」不因局部改动漂移。
 * 断言方式与 responsive / contrast 一致：解析样式表与 JSX 源码，固化关键不变量。
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'web/src/styles.css'), 'utf8');
const panelJsx = readFileSync(join(root, 'web/src/Panel.jsx'), 'utf8');
const docsJsx = readFileSync(join(root, 'web/src/DocsPage.jsx'), 'utf8');
const bigJsx = readFileSync(join(root, 'web/src/BigPreview.jsx'), 'utf8');

function blockOf(text, selector) {
	const start = text.indexOf(selector);
	assert.ok(start >= 0, '未找到规则 ' + selector);
	const end = text.indexOf('\n}', start);
	return text.slice(start, end < 0 ? text.length : end);
}

/* ---- 禁用态：滑杆不再「看起来可拖」（U4-a） ---- */
const rangeDisabled = blockOf(css, '.rp-range:disabled');
assert.match(rangeDisabled, /accent-color:\s*var\(--ink-faint\)/, '禁用滑杆应改用降权色');
assert.match(rangeDisabled, /cursor:\s*not-allowed/, '禁用滑杆应有禁用光标');

/* 文档打开中：hover 规则不得作用于已禁用按钮（否则禁用态仍显 hover 边框） */
assert.ok(css.includes('.rp-docs-main:hover:not(:disabled)'), 'rp-docs-main 的 hover 需排除 :disabled');
const docsBusy = blockOf(css, '.rp-docs-busy');
assert.match(docsBusy, /display:\s*inline-flex/, '打开中提示应为行内弹性布局');

/* ---- 加载 spinner：忙碌态复用同一 rp-spinner，而非只切文案 ---- */
const updateStart = panelJsx.indexOf('function UpdateGroup()');
assert.ok(updateStart >= 0, '未找到 UpdateGroup');
const updateBlock = panelJsx.slice(updateStart, panelJsx.indexOf('\n}', updateStart));
assert.ok(updateBlock.includes('rp-spinner'), '「检查更新」busy 态应有 spinner');
assert.ok(updateBlock.includes('正在检查…'), '「检查更新」busy 态应有文案');

const openBtnStart = docsJsx.indexOf("className={'rp-docs-main'");
assert.ok(openBtnStart >= 0, '未找到文档打开按钮');
const openBtnBlock = docsJsx.slice(openBtnStart, docsJsx.indexOf('</button>', openBtnStart));
assert.ok(openBtnBlock.includes('disabled={openingId === doc.id}'), '打开中应禁用按钮防重复触发');
assert.ok(openBtnBlock.includes('rp-docs-busy'), '打开中应显示 spinner 文案（不再只有隐式 class）');

/* ---- 焦点管理：浮层统一走 useFocusTrap ---- */
assert.ok(bigJsx.includes("import { useFocusTrap } from './hooks/useFocusTrap.js'"), 'BigPreview 应复用 useFocusTrap');
assert.ok(bigJsx.includes('useFocusTrap({ ref: overlayRef'), 'BigPreview 应调用 useFocusTrap');
assert.ok(!bigJsx.includes('onOverlayKeyDown'), 'BigPreview 不应再保留自建 Tab 陷阱');
assert.ok(panelJsx.includes('useFocusTrap('), 'Panel 浮层应继续使用 useFocusTrap');

/* ---- 播放笔顺：忙碌态 spinner；无数据态给出可见原因 ---- */
const playBtnStart = bigJsx.indexOf('<button type="button" className="rp-btn rp-btn-primary" onClick={play}');
assert.ok(playBtnStart >= 0, '未找到播放笔顺按钮');
const playBtnBlock = bigJsx.slice(playBtnStart, bigJsx.indexOf('</button>', playBtnStart));
assert.ok(playBtnBlock.includes('rp-spinner'), '播放中应有 spinner');
assert.ok(playBtnBlock.includes('当前字暂无笔顺数据'), '无笔顺数据时应给出可见原因');

/* ---- toast / 二次确认：统一走应用内通道，不用原生弹窗 ---- */
const srcFiles = readdirSync(join(root, 'web/src')).filter(function (f) {
	return /\.(jsx?|ts)$/.test(f);
});
var nativeDialogs = [];
srcFiles.forEach(function (f) {
	const text = readFileSync(join(root, 'web/src', f), 'utf8');
	const m = text.match(/window\.(confirm|alert)\s*\(/);
	if (m) nativeDialogs.push(f + ':' + m[1]);
});
assert.deepEqual(nativeDialogs, [], '二次确认应使用应用内 toast / 内联确认态，不得出现 window.confirm / alert');

console.log('  禁用滑杆 / 文档打开中 / 检查更新 / 播放笔顺 / useFocusTrap 统一性通过');
console.log('交互一致性不变量通过（U4）');
