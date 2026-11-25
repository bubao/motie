import React, { useEffect, useRef, useState } from 'react';
import { getPinyin, loadPinyin, Stroke, loadHanziWriter, FONT_WEIGHT_NUM } from './core/index.js';

/* overlay 内可聚焦元素（用于 Tab 焦点陷阱） */
var FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * 单字放大预览 / 笔顺动画。
 * 点击字格时打开：默认显示当前字体的静态字（与字帖格子一致），不自动播笔顺；
 * 点「播放笔顺」才加载 HanziWriter 播放（其字形为标准字形，无法套用自定义字体），失败降级为静态字。
 * 可访问性：打开时聚焦关闭按钮、Tab 在 overlay 内循环（焦点陷阱）、关闭后焦点返还触发字格。
 */
export function BigPreview({ char, onClose, strokeAnim, zg, isPy, bar, dx, dy, ratio, weight, scale }) {
	var stageRef = useRef(null);
	var overlayRef = useRef(null);
	var closeRef = useRef(null);
	var returnFocusRef = useRef(null);
	var animatingRef = useRef(false);
	var [animating, setAnimating] = useState(false);
	/* 拼音文本自管理：未加载时先空，加载完成后补显（不依赖全局 pinyinReady） */
	var [pinyin, setPinyin] = useState('');
	/* 系统「减少动态效果」开启时自动不播笔顺（T1.2） */
	var reduceMotion = typeof window !== 'undefined' && window.matchMedia
		? window.matchMedia('(prefers-reduced-motion: reduce)').matches
		: false;

	useEffect(function () {
		if (!char) return undefined;
		var cancelled = false;
		animatingRef.current = false;
		setAnimating(false);
		/* 拼音：已就绪先同步显示；未就绪则等加载完成后补显 */
		setPinyin(getPinyin(char));
		loadPinyin().then(function () {
			if (!cancelled) setPinyin(getPinyin(char));
		});
		/* 记录触发元素，关闭时返还焦点 */
		returnFocusRef.current = document.activeElement;
		if (closeRef.current) closeRef.current.focus();
		/* 默认显示当前字体的静态字（与字帖格子同款字体），不自动播笔顺 */
		showStatic();

		return function () {
			cancelled = true;
			animatingRef.current = false;
			Stroke.destroy();
			var el = returnFocusRef.current;
			returnFocusRef.current = null;
			if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
		};
	}, [char]);

	/* Esc 关闭 */
	useEffect(function () {
		if (!char) return undefined;
		function onKey(e) {
			if (e.key === 'Escape') onClose();
		}
		window.addEventListener('keydown', onKey);
		return function () { window.removeEventListener('keydown', onKey); };
	}, [char, onClose]);

	/* Tab 焦点陷阱：焦点不出 overlay */
	function onOverlayKeyDown(e) {
		if (e.key !== 'Tab') return;
		var root = overlayRef.current;
		if (!root) return;
		var nodes = Array.prototype.filter.call(
			root.querySelectorAll(FOCUSABLE),
			function (el) { return el.offsetParent !== null; }
		);
		if (!nodes.length) {
			e.preventDefault();
			return;
		}
		var first = nodes[0];
		var last = nodes[nodes.length - 1];
		var active = document.activeElement;
		if (!root.contains(active)) {
			e.preventDefault();
			first.focus();
		} else if (e.shiftKey && active === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
	}

	/* 格上拼音条（type10）：拼音写进舞台顶部窄条，与字帖格子同形态 */
	function syncBar(text) {
		var stage = stageRef.current;
		if (!stage || !bar) return;
		var el = stage.querySelector('.overlay-pinyin-bar');
		if (!el) {
			el = document.createElement('span');
			el.className = 'overlay-pinyin-bar';
			stage.appendChild(el);
		}
		el.textContent = text == null ? getPinyin(char) : text;
	}

	/* 拼音加载完成 / 值变化后同步条内文字（showStatic / 笔顺会清空舞台，也需重建） */
	useEffect(function () {
		syncBar(pinyin);
	}, [bar, pinyin]);

	/* 降级 / 默认静态字：包一层 .overlay-stage-char，便于在拼音格内定位到下区田字格 */
	function showStatic() {
		var stage = stageRef.current;
		if (!stage) return;
		stage.textContent = '';
		var s = document.createElement('span');
		s.className = 'overlay-stage-char';
		s.textContent = char;
		stage.appendChild(s);
		syncBar();
	}

	/* 主动播放笔顺：按需加载 HanziWriter；失败降级为静态字 */
	function play() {
		if (!stageRef.current || animatingRef.current) return;
		var waiting = typeof loadHanziWriter === 'function'
			? loadHanziWriter()
			: Promise.resolve();
		Promise.resolve(waiting).catch(function () { return null; }).then(function () {
			if (!stageRef.current) return;
			var played = strokeAnim !== false && !reduceMotion && Stroke.play(stageRef.current, char);
			animatingRef.current = played;
			if (!played) showStatic();
			else syncBar(); /* 笔顺 SVG 之上保留格上拼音条 */
			setAnimating(played);
		});
	}

	if (!char) return null;

	return (
		<div
			ref={overlayRef}
			className="overlay is-open"
			role="dialog"
			aria-modal="true"
			aria-label="单字放大预览"
			onClick={onClose}
			onKeyDown={onOverlayKeyDown}
		>
			<div className="overlay-inner" onClick={function (e) { e.stopPropagation(); }}>
				<button ref={closeRef} type="button" className="overlay-close" aria-label="关闭" onClick={onClose}>×</button>
				{bar ? null : <div className="overlay-pinyin">{pinyin}</div>}
				<div
					className={'overlay-stage' + (isPy ? ' is-py' : '')}
					ref={stageRef}
					style={Object.assign({
					/* 字体在格内的水平 / 垂直偏移（格倍数），与字帖格子（Preview）同源 */
					'--char-dx': String(dx || 0),
					'--char-dy': String(dy || 0),
					/* 字体粗细（A1）：与字帖格子同源 */
					'--char-weight': String(FONT_WEIGHT_NUM[weight] || 400),
					/* 字占格比例（A2）：与字帖格子同源 */
					'--char-scale': String(scale == null ? 0.725 : scale),
					/* 宽高比：舞台高 = 宽 × ratio（与字帖格子同源） */
					'--overlay-ratio': String(ratio || 1)
				}, zg ? {
						/* 字格背景：与当前版式同源（ZgType/ZgColor），铺满整个画布；静态字 / 笔顺 SVG 叠加其上 */
						backgroundImage: zg,
						backgroundSize: '100% 100%',
						backgroundRepeat: 'no-repeat',
						backgroundPosition: 'center'
					} : {})}
				/>
				<div className="overlay-actions">
					<button type="button" className="rp-btn rp-btn-primary" onClick={play} disabled={animating || strokeAnim === false}>播放笔顺</button>
				</div>
			</div>
		</div>
	);
}
