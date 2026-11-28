/**
 * 窄屏布局不变量（node test/responsive.test.mjs · U2）。
 * 遮挡缺陷的根因是「遮罩与 rail / 顶栏在同一条层叠上下文里比层级」，
 * 这里把关键层级关系与断点一致性固化成断言，避免改样式时无声回归。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'web/src/styles.css'), 'utf8');
const panelJsx = readFileSync(join(root, 'web/src/Panel.jsx'), 'utf8');

function blockOf(text, selector) {
	const start = text.indexOf(selector);
	assert.ok(start >= 0, '未找到规则 ' + selector);
	const end = text.indexOf('\n}', start);
	return text.slice(start, end < 0 ? text.length : end);
}

function zIndexOf(block) {
	const m = block.match(/z-index:\s*(\d+)/);
	assert.ok(m, '规则缺少 z-index：' + block.slice(0, 60));
	return Number(m[1]);
}

/* 窄屏媒体块整体取出 */
const mediaStart = css.indexOf('@media (max-width: 720px) {');
assert.ok(mediaStart >= 0, 'styles.css 缺少 720px 断点');
const mediaEnd = css.indexOf('\n}', mediaStart);
const media = css.slice(mediaStart, mediaEnd);

/* JS 侧 matchMedia 与 CSS 断点必须一致，否则出现「逻辑窄屏 / 视觉宽屏」错配 */
assert.ok(panelJsx.includes("'(max-width: 720px)'"), 'Panel.jsx 的 matchMedia 断点与 styles.css 不一致');

const scrimZ = zIndexOf(blockOf(media, '.rp-panel-scrim'));
const railZ = zIndexOf(blockOf(media, '.rp-rail'));
const topbarZ = zIndexOf(blockOf(media, '.rp-topbar'));
const zoomZ = zIndexOf(blockOf(media, '.rp-zoombar'));

assert.ok(railZ > scrimZ, `rail 层级(${railZ})必须高于抽屉遮罩(${scrimZ})，否则打开后无法切分类`);
assert.ok(topbarZ > scrimZ, `顶栏层级(${topbarZ})必须高于抽屉遮罩(${scrimZ})，否则打开后无法导出/打印`);
assert.ok(zoomZ < scrimZ, `缩放条层级(${zoomZ})应低于遮罩(${scrimZ})，避免浮在暗化层上`);

console.log(`  遮罩 ${scrimZ} / rail ${railZ} / 顶栏 ${topbarZ} / 缩放条 ${zoomZ}`);
console.log('窄屏布局不变量通过（层级关系 + 断点一致）');
