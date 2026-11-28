/**
 * 模态浮层焦点管理单测（vitest · jsdom）。
 *
 * 覆盖 useFocusTrap（分享二维码 / 预设导入等浮层，U1）：
 *   - 打开后初始聚焦（默认首个可聚焦元素 / initialSelector 指定项）
 *   - Tab 在最后一个元素处循环回第一个；Shift+Tab 在第一个处循环到最后一个
 *   - Esc 关闭浮层并把焦点返还给触发元素（真实语义：点击触发按钮后打开，
 *     hook 记录的 returnRef 即该按钮）
 *
 * 局限（如实声明）：jsdom 无布局，offsetParent 恒为 null，这里 stub 为
 * 「有父节点即可见」，使 hook 的可见性过滤与浏览器一致；jsdom 也不模拟
 * Tab 键的真实移动，故边界用例先手动 focus 到边界元素再派发 keydown。
 * 真实的 Tab 遍历顺序与屏幕阅读器文案仍属人工走查（见 doc/web-features.md §7）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import React, { useRef, useState, useCallback } from 'react';
import { useFocusTrap } from '../web/src/hooks/useFocusTrap.js';

beforeEach(() => {
	/* jsdom: HTMLElement.offsetParent 恒 null，stub 成「挂载即有父节点」 */
	Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
		configurable: true,
		get() {
			return this.parentNode;
		},
	});
});
afterEach(() => cleanup());

function Harness({ initialSelector }) {
	const [open, setOpen] = useState(false);
	const close = useCallback(() => setOpen(false), []);
	const openOverlay = useCallback(() => setOpen(true), []);
	const overlayRef = useRef(null);
	const triggerRef = useRef(null);
	useFocusTrap({ ref: overlayRef, active: open, onClose: close, initialSelector });
	return (
		<div>
			<button ref={triggerRef} type="button" onClick={openOverlay}>打开浮层</button>
			{open ? (
				<div ref={overlayRef} role="dialog">
					<button className="first" type="button">第一</button>
					<input className="middle" aria-label="中间输入" />
					<button className="last" type="button">最后</button>
				</div>
			) : null}
		</div>
	);
}

function press(key, opts) {
	const init = Object.assign({ key, bubbles: true, cancelable: true }, opts || {});
	document.dispatchEvent(new KeyboardEvent('keydown', init));
}

/** 模拟真实入口：点击触发按钮打开浮层（浏览器点击会先聚焦按钮，
 *   Hook 因此记录的 returnRef 就是该按钮；jsdom 的 click 不自动聚焦，需显式 focus） */
function openViaTrigger(container) {
	const trigger = container.querySelector('button');
	act(function () {
		trigger.focus();
		fireEvent.click(trigger);
	});
	return trigger;
}

describe('useFocusTrap：浮层焦点管理', function () {
	it('打开后默认聚焦浮层内第一个可聚焦元素', function () {
		const { container } = render(<Harness />);
		openViaTrigger(container);
		expect(document.activeElement.className).toBe('first');
	});

	it('initialSelector 指定时优先聚焦该元素', function () {
		const { container } = render(<Harness initialSelector=".last" />);
		openViaTrigger(container);
		expect(document.activeElement.className).toBe('last');
	});

	it('Tab 在最后一个元素处循环回第一个', function () {
		const { container } = render(<Harness />);
		openViaTrigger(container);
		const last = container.querySelector('.last');
		act(function () { last.focus(); });
		expect(document.activeElement).toBe(last);
		act(function () { press('Tab'); });
		expect(document.activeElement.className).toBe('first');
	});

	it('Shift+Tab 在第一个元素处循环到最后一个', function () {
		const { container } = render(<Harness />);
		openViaTrigger(container);
		const first = container.querySelector('.first');
		act(function () { first.focus(); });
		act(function () { press('Tab', { shiftKey: true }); });
		expect(document.activeElement.className).toBe('last');
	});

	it('Esc 关闭浮层并把焦点返还触发元素', function () {
		const { container, queryByRole } = render(<Harness />);
		const trigger = openViaTrigger(container);
		act(function () { press('Escape'); });
		expect(queryByRole('dialog')).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});
});
