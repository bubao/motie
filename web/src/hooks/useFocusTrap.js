import { useEffect, useRef } from 'react';

/* 浮层可聚焦元素（与 BigPreview 的焦点陷阱同源） */
const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * 模态浮层焦点管理（U1）：打开时聚焦初始元素、Tab 在浮层内循环、Esc 关闭、
 * 关闭后焦点返还触发元素。用于分享二维码 / 预设导入等浮层（BigPreview 内有同款实现）。
 *
 * opts：{ ref, active, onClose, initialSelector? }
 */
export function useFocusTrap(opts) {
	const ref = opts.ref;
	const active = !!opts.active;
	const onClose = opts.onClose;
	const initialSelector = opts.initialSelector;
	const returnRef = useRef(null);
	/* onClose 通过 ref 读取最新值，避免父组件内联函数导致 effect 反复重跑、焦点被重置 */
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(function () {
		if (!active) return undefined;
		var root = ref.current;
		if (!root) return undefined;
		returnRef.current = document.activeElement;

		function focusables() {
			return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), function (el) {
				return el.offsetParent !== null || el === document.activeElement;
			});
		}
		/* 初始聚焦：指定元素优先，否则第一个可聚焦元素 */
		var initial = initialSelector ? root.querySelector(initialSelector) : null;
		var list = focusables();
		(initial && initial.focus ? initial : (list[0] || root)).focus();

		function onKey(e) {
			if (e.key === 'Escape') {
				e.preventDefault();
				close();
				return;
			}
			if (e.key !== 'Tab') return;
			var nodes = focusables();
			if (!nodes.length) { e.preventDefault(); return; }
			var first = nodes[0];
			var last = nodes[nodes.length - 1];
			var activeEl = document.activeElement;
			if (!root.contains(activeEl)) { e.preventDefault(); first.focus(); return; }
			if (e.shiftKey && activeEl === first) { e.preventDefault(); last.focus(); }
			else if (!e.shiftKey && activeEl === last) { e.preventDefault(); first.focus(); }
		}
		function close() {
			if (onCloseRef.current) onCloseRef.current();
			var back = returnRef.current;
			returnRef.current = null;
			if (back && typeof back.focus === 'function' && document.contains(back)) back.focus();
		}
		document.addEventListener('keydown', onKey);
		return function () { document.removeEventListener('keydown', onKey); };
	}, [active, initialSelector, ref]);
}
