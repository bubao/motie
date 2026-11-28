/**
 * 全局轻提示（toast）状态。
 * 独立成模块：纯 Redux slice，无 React / DOM 依赖，便于 node 直接测试。
 * 失败提示带 action（如「重试」），成功 / 信息由 ToastHost 自动消失。
 */
import { createSlice } from '@reduxjs/toolkit';

let seq = 0;

const toastSlice = createSlice({
	name: 'ui',
	// backend：当前接入模式（U6）。'init' 表示尚未解析；'mock' 时界面需明确标注本地模式
	initialState: { toasts: [], backend: 'init' },
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
		},
		/* 接入模式标记（U6）：'http' = 已连 Go 内核；'mock' = 本地模式（数据仅存本机） */
		setBackendMode: function (state, action) {
			state.backend = action.payload === 'http' ? 'http' : 'mock';
		}
	}
});

export var TOAST_AUTOHIDE_MS = 3500;
export var TOAST_TYPES = ['success', 'error', 'info'];

export const { pushToast, dismissToast, setBackendMode } = toastSlice.actions;
export default toastSlice.reducer;
