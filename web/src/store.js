/**
 * 完整版唯一状态源（Redux Toolkit）。
 * 配置从 localStorage 读一份全新对象（无全局单例），键 zitie.config；
 * 变更防抖落盘（saveConfig 只写 Schema 白名单字段）。
 */
import { configureStore, createSlice } from '@reduxjs/toolkit';
import { ConfigSchema, ContentModel, DEFAULTS, normalizeField, loadConfig, saveConfig } from './core/index.js';
import toastReducer, { pushToast, dismissToast } from './toastSlice.mjs';

/* 配置初值：盘上快照 + 默认值（按 Schema 归一化） */
const initialConfig = loadConfig();

const CONTENT_HISTORY_MAX = 100;

const configSlice = createSlice({
	name: 'config',
	initialState: Object.assign(initialConfig, { history: { past: [], future: [] } }),
	reducers: {
		setField: function (state, action) {
			const key = action.payload.key;
			var next = normalizeField(key, action.payload.value);
			if (key === 'Content') pushHistory(state, state.Content, next);
			state[key] = next;
		},
		setContent: function (state, action) {
			var next = normalizeField('Content', action.payload);
			pushHistory(state, state.Content, next);
			state.Content = next;
		},
		/* 点击格子编辑单字：按「第 n 个汉字」写回 Content（T1.10） */
		replaceHan: function (state, action) {
			var next = normalizeField('Content',
				ContentModel.replaceHanAt(state.Content, action.payload.index, action.payload.char));
			pushHistory(state, state.Content, next);
			state.Content = next;
		},
		/* 字体来源（default / url / local）：镜像 fontURL 兼容旧读取路径与设置导出 */
		setFontSource: function (state, action) {
			var src = normalizeField('FontSource', action.payload);
			state.FontSource = src;
			state.fontURL = src.type === 'url' ? src.url : '';
		},
		importConfig: function (state, action) {
			const src = action.payload || {};
			var prevContent = state.Content;
			var contentNext = state.Content;
			Object.keys(ConfigSchema).forEach(function (key) {
				/* 未提供的字段保留当前值：部分快照 / 旧预设导入不再被打回默认值（P0-2） */
				var has = Object.prototype.hasOwnProperty.call(src, key);
				state[key] = normalizeField(key, has ? src[key] : state[key]);
				if (key === 'Content') contentNext = state[key];
			});
			pushHistory(state, prevContent, contentNext);
		},
		resetConfig: function (state) {
			var nextContent = normalizeField('Content', DEFAULTS.Content);
			pushHistory(state, state.Content, nextContent);
			Object.keys(ConfigSchema).forEach(function (key) { state[key] = DEFAULTS[key]; });
		},
		/* 内容撤销 / 重做（P3-14：历史迁入 Redux，可订阅；命令式栈而非渲染状态） */
		undo: function (state) {
			var prev = state.history.past.pop();
			if (prev === undefined) return;
			state.history.future.push(state.Content);
			state.Content = prev;
		},
		redo: function (state) {
			var next = state.history.future.pop();
			if (next === undefined) return;
			state.history.past.push(state.Content);
			state.Content = next;
		},
		/* 清空历史（测试与「新内容另起一段」用） */
		resetHistory: function (state) {
			state.history.past = [];
			state.history.future = [];
		}
	}
});

/* 记录 Content 变更：未变不入栈；入栈即清空 redo（新分支）。 */
function pushHistory(state, prev, next) {
	if (prev === next) return;
	state.history.past.push(prev);
	if (state.history.past.length > CONTENT_HISTORY_MAX) state.history.past.shift();
	state.history.future = [];
}

export const {
	setField, setContent, setFontSource, replaceHan, importConfig, resetConfig,
	undo: undoAction, redo: redoAction, resetHistory
} = configSlice.actions;
export { pushToast, dismissToast };

/* 命令式入口（保留原签名：返回 boolean 供 Panel 判断提示）。 */
export function undoContent() {
	if (!store.getState().config.history.past.length) return false;
	store.dispatch(undoAction());
	return true;
}

export function redoContent() {
	if (!store.getState().config.history.future.length) return false;
	store.dispatch(redoAction());
	return true;
}

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
	/* 仅配置变化才持久化（toast 等 UI 动作不触发写盘） */
	if (config === prevConfig) return;
	prevConfig = config;
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(function () { saveConfig(config); }, 150);
});

/* 多标签页同步（P3-14）：其他标签页写盘时，重载 Config 并全量同步到本 store。
 * 本标签页写盘不触发自身 storage 事件；防抖窗口内未写盘的修改以盘上为准。 */
if (typeof window !== 'undefined' && window.addEventListener) {
	window.addEventListener('storage', function (e) {
		if (!e || e.key !== 'zitie.config') return;
		try {
			store.dispatch(importConfig(loadConfig()));
		} catch (err) { /* 盘上快照损坏时忽略，保留本页当前值 */ }
	});
}
