import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { dismissToast } from './store.js';
import { TOAST_AUTOHIDE_MS } from './toastSlice.mjs';

/**
 * 全局轻提示（T2.5）。成功 / 信息自动消失；失败（error）常驻并提供「重试」入口。
 * 挂在 App 根部，打印时随 .no-print 隐藏。
 */
function ToastItem({ toast }) {
	const dispatch = useDispatch();

	useEffect(function () {
		if (toast.type === 'error') return; /* 失败不自动消失，便于重试 */
		const timer = setTimeout(function () { dispatch(dismissToast(toast.id)); }, TOAST_AUTOHIDE_MS);
		return function () { clearTimeout(timer); };
	}, [toast.id, toast.type]);

	return (
		<div className={'rp-toast rp-toast-' + toast.type} role={toast.type === 'error' ? 'alert' : 'status'}>
			<span className="rp-toast-text">{toast.text}</span>
			{toast.action && (
				<button
					type="button"
					className="rp-toast-action"
					onClick={function () {
						dispatch(dismissToast(toast.id));
						if (toast.action.onClick) toast.action.onClick();
					}}
				>
					{toast.action.label}
				</button>
			)}
			<button
				type="button"
				className="rp-toast-close"
				aria-label="关闭提示"
				onClick={function () { dispatch(dismissToast(toast.id)); }}
			>×</button>
		</div>
	);
}

export function ToastHost() {
	const toasts = useSelector(function (s) { return s.ui.toasts; });
	if (!toasts.length) return null;
	return (
		<div className="rp-toasts no-print" aria-live="polite">
			{toasts.map(function (t) { return <ToastItem key={t.id} toast={t} />; })}
		</div>
	);
}
