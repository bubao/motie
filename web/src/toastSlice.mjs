/**
 * 全局轻提示（toast）状态。
 * 独立成模块：纯 Redux slice，无 React / DOM 依赖，便于 node 直接测试。
 * 失败提示带 action（如「重试」），成功 / 信息由 ToastHost 自动消失。
 */
import { createSlice } from '@reduxjs/toolkit';

let seq = 0;

const toastSlice = createSlice({
	name: 'ui',
	initialState: { toasts: [] },
	reducers: {
		/* payload: { type?: 'success' | 'error' | 'info', text: string, action?: { label, onClick } } */
		pushToast: function (state, action) {
			var t = action.payload || {};
			state.toasts.push({
				id: ++seq,
				type: t.type || 'info',
				text: String(t.text || ''),
				action: t.action || null
			});
		},
		dismissToast: function (state, action) {
			state.toasts = state.toasts.filter(function (t) { return t.id !== action.payload; });
		}
	}
});

export var TOAST_AUTOHIDE_MS = 3500;
export var TOAST_TYPES = ['success', 'error', 'info'];

export const { pushToast, dismissToast } = toastSlice.actions;
export default toastSlice.reducer;
