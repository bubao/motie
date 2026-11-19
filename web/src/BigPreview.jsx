import React, { useEffect, useRef, useState } from 'react';
import { Zitie as Z } from '../../js/core.js';

/* overlay 内可聚焦元素（用于 Tab 焦点陷阱） */
var FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * 单字放大预览 / 笔顺动画。
 * 点击字格时打开；HanziWriter 按需加载（Z.Assets.loadHanziWriter），
 * 加载失败或笔画数据缺失时降级为静态单字。样式复用 css/main.css 的 .overlay 系列。
 * 可访问性：打开时聚焦关闭按钮、Tab 在 overlay 内循环（焦点陷阱）、关闭后焦点返还触发字格。
 */
export function BigPreview({ char, onClose, strokeAnim }) {
	var stageRef = useRef(null);
	var overlayRef = useRef(null);
	var closeRef = useRef(null);
	var returnFocusRef = useRef(null);
	var animatingRef = useRef(false);
	var [animating, setAnimating] = useState(false);
	/* 系统「减少动态效果」开启时自动不播笔顺（T1.2） */
	var reduceMotion = typeof window !== 'undefined' && window.matchMedia
		? window.matchMedia('(prefers-reduced-motion: reduce)').matches
		: false;

	useEffect(function () {
		if (!char) return undefined;
		var cancelled = false;
		animatingRef.current = false;
		setAnimating(false);
		/* 记录触发元素，关闭时返还焦点 */
		returnFocusRef.current = document.activeElement;
		if (closeRef.current) closeRef.current.focus();

		var waiting = typeof Z.Assets.loadHanziWriter === 'function'
			? Z.Assets.loadHanziWriter()
			: Promise.resolve();
		Promise.resolve(waiting).catch(function () { return null; }).then(function () {
			if (cancelled || !stageRef.current) return;
			var played = strokeAnim !== false && !reduceMotion && Z.Stroke.play(stageRef.current, char);
			animatingRef.current = played;
			if (!played) stageRef.current.textContent = char;
			setAnimating(played);
		});

		return function () {
			cancelled = true;
			animatingRef.current = false;
			Z.Stroke.destroy();
			var el = returnFocusRef.current;
			returnFocusRef.current = null;
			if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
		};
	}, [char, strokeAnim]);

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

	function replay() {
		if (!stageRef.current) return;
		var played = !reduceMotion && Z.Stroke.play(stageRef.current, char);
		animatingRef.current = played;
		if (!played) stageRef.current.textContent = char;
		setAnimating(played);
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
				<div className="overlay-pinyin">{Z.getPinyin(char)}</div>
				<div className="overlay-stage" ref={stageRef} />
				<div className="overlay-actions">
					<button type="button" className="rp-btn rp-btn-primary" onClick={replay} disabled={!animating}>重播笔顺</button>
				</div>
			</div>
		</div>
	);
}
