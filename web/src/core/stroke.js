/**
 * 笔顺动画：封装 Hanzi Writer（CDN UMD）。
 * 笔画数据由 Hanzi Writer 自行按字从 CDN 加载，失败时返回 false，由调用方降级为静态单字。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
let writer = null;
let watcher = null;

const isAvailable = () => !!(window.HanziWriter && typeof window.HanziWriter.create === 'function');

const destroy = () => {
	if (watcher) {
		try { watcher.disconnect(); } catch { /* 忽略 */ }
		watcher = null;
	}
	if (writer) {
		if (typeof writer.cancelAnimation === 'function') {
			try { writer.cancelAnimation(); } catch { /* 忽略 */ }
		}
		writer = null;
	}
};

const play = (stage, char, options) => {
	if (!isAvailable() || !stage || !char) return false;
	destroy();
	stage.textContent = '';
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('width', '100%');
	svg.setAttribute('height', '100%');
	stage.appendChild(svg);
	try {
		writer = window.HanziWriter.create(svg, char, {
			width: 240,
			height: 240,
			padding: 20,
			showOutline: true,
			showCharacter: true,
			strokeColor: '#B03A2C',
			outlineColor: '#DCD3BF',
			strokeAnimationSpeed: 1,
			delayBetweenStrokes: 0.15,
			...(options || {})
		});
		/* svg 的 CSS 尺寸是画布尺寸（280），而 HanziWriter 按 width/height 选项（240）
		 * 布局（内部 g transform 按 240 坐标系）。不设 viewBox 时用户坐标不随 CSS
		 * 缩放，字形会按 240 排在左上角、明显偏离田字格中心。 */
		svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
		centerGlyph(svg);
		/* 笔画数据异步加载：DOM 填充后重算居中 */
		if (typeof MutationObserver !== 'undefined') {
			watcher = new MutationObserver(() => centerGlyph(svg));
			watcher.observe(svg, { childList: true, subtree: true });
		}
		writer.animateCharacter();
		return true;
	} catch {
		writer = null;
		return false;
	}
};

/* 按字形实际墨迹包围盒（含轮廓）把字形中心平移到画布中心。
 * HanziWriter 的 g transform 以字形数据参考框（1024）的 bounds 居中，
 * 该 bounds 与实际笔画墨迹范围不一致（如「永」字墨迹偏左上），
 * 直接缩放仍会看着歪。这里解析 g 的 translate/scale，换算墨迹中心在
 * 240 坐标系的位置，再用 viewBox 平移对齐中心（不改 HanziWriter 内部坐标）。 */
const centerGlyph = (svg) => {
	if (!svg) return;
	const g = svg.querySelector('g');
	if (!g) return;
	let bb;
	try {
		bb = g.getBBox();
	} catch {
		return;
	}
	if (!bb || !bb.width || !bb.height) return;
	const t = (g.getAttribute('transform') || '').replace(/\s+/g, ' ');
	const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)\s*scale\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(t);
	if (!m) return;
	const tx = Number(m[1]), ty = Number(m[2]), sx = Number(m[3]), sy = Number(m[4]);
	const x0 = tx + sx * bb.x, x1 = tx + sx * (bb.x + bb.width);
	const y0 = ty + sy * bb.y, y1 = ty + sy * (bb.y + bb.height);
	const cx = (Math.min(x0, x1) + Math.max(x0, x1)) / 2;
	const cy = (Math.min(y0, y1) + Math.max(y0, y1)) / 2;
	/* 240 = HanziWriter 的 width/height 选项（见 play），viewBox 与布局同尺寸 */
	svg.setAttribute('viewBox', `${(cx - 120).toFixed(2)} ${(cy - 120).toFixed(2)} 240 240`);
};

export const Stroke = {
	isAvailable,
	play,
	destroy
};
