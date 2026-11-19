/**
 * 完整版唯一状态源（Redux Toolkit）。
 * 配置从共享核心 Config 读取（与原生版共用 localStorage 键 zitie.config），
 * 任何变更同步回 window.Zitie.Config 并防抖持久化。
 */
import { configureStore, createSlice } from '@reduxjs/toolkit';
import { Config, ConfigSchema, ContentModel, DEFAULTS, normalizeField } from '../../js/core.js';
import toastReducer, { pushToast, dismissToast } from './toastSlice.mjs';

Config.load();

function snapshot() {
	const out = {};
	Object.keys(ConfigSchema).forEach(function (key) { out[key] = Config[key]; });
	return out;
}

const configSlice = createSlice({
	name: 'config',
	initialState: snapshot(),
	reducers: {
		setField: function (state, action) {
			const key = action.payload.key;
			state[key] = normalizeField(key, action.payload.value);
		},
		setContent: function (state, action) {
			state.Content = normalizeField('Content', action.payload);
		},
		/* 点击格子编辑单字：按「第 n 个汉字」写回 Content（T1.10） */
		replaceHan: function (state, action) {
			state.Content = normalizeField('Content',
				ContentModel.replaceHanAt(state.Content, action.payload.index, action.payload.char));
		},
		setFontURL: function (state, action) {
			state.fontURL = normalizeField('fontURL', action.payload);
		},
		/* 字体来源（default / url / local）：镜像 fontURL 兼容旧读取路径与设置导出 */
		setFontSource: function (state, action) {
			var src = normalizeField('FontSource', action.payload);
			state.FontSource = src;
			state.fontURL = src.type === 'url' ? src.url : '';
		},
		importConfig: function (state, action) {
			const src = action.payload || {};
			Object.keys(ConfigSchema).forEach(function (key) { state[key] = normalizeField(key, src[key]); });
		},
		resetConfig: function (state) {
			Object.keys(ConfigSchema).forEach(function (key) { state[key] = DEFAULTS[key]; });
		}
	}
});

export const { setField, setContent, setFontURL, setFontSource, replaceHan, importConfig, resetConfig } = configSlice.actions;
export { pushToast, dismissToast };

export const store = configureStore({
	reducer: { config: configSlice.reducer, ui: toastReducer },
	/* toast 的 action.onClick 是函数（重试入口），属有意存放，关闭其序列化检查以避免噪音 */
	middleware: function (getDefaultMiddleware) {
		return getDefaultMiddleware({
			serializableCheck: { ignoredPaths: ['ui.toasts'], ignoredActionPaths: ['payload.action.onClick'] }
		});
	}
});

let saveTimer = null;
let prevConfig = store.getState().config;

store.subscribe(function () {
	const config = store.getState().config;
	/* 仅配置变化才镜像 + 持久化（toast 等 UI 动作不触发写盘） */
	if (config === prevConfig) return;
	prevConfig = config;
	Object.keys(ConfigSchema).forEach(function (key) { Config[key] = config[key]; });
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(function () { Config.save(); }, 150);
});
