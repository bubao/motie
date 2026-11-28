/**
 * 完整版唯一状态源（Redux Toolkit）。
 * 配置从 localStorage 读一份全新对象（无全局单例），键 zitie.config；
 * 变更防抖落盘（saveConfig 只写 Schema 白名单字段）。
 */
import { configureStore, createSlice } from '@reduxjs/toolkit';
import {
	ConfigSchema, ContentModel, DEFAULTS, normalizeField,
	pickModeSnapshot, defaultModeState, pickPrefs,
	loadConfig, saveConfig
} from './core/index.js';
import toastReducer, { pushToast, dismissToast, setBackendMode } from './toastSlice.mjs';
import { sharedClient } from './ipc/client.ts';

/* 桌面端偏好（Theme / 模板 / 字格 / 页边距 / 字体 / 资源模式等）以 Go 配置服务为 SSOT：
 * 本地变更防抖 PUT，SSE config.changed 经 applyRemotePrefs 回填（不回推，防环）；
 * 客户端走进程级共享实例（sharedClient），避免重复建连。 */

/* 配置初值：盘上快照 + 默认值（按 Schema 归一化） */
const initialConfig = loadConfig();

const CONTENT_HISTORY_MAX = 100;

/* 模式迁移（switchMode 与 applyFields 共用）：保存当前类型快照 → 恢复目标类型快照 / 推荐默认。
 * ModeStates 随 zitie.config 主链落盘、多标签同步与导入导出。 */
function applyModeSwitch(state, m) {
	var snap = pickModeSnapshot(state);
	delete snap.Mode; /* 入库快照不带模式自身（模式即键名） */
	var all = Object.assign({}, state.ModeStates || {});
	all[state.Mode] = snap;
	var target = all[m] || defaultModeState(m);
	Object.keys(target).forEach(function (k) { state[k] = target[k]; });
	state.Mode = m;
	state.ModeStates = all;
}

const configSlice = createSlice({
	name: 'config',
	initialState: Object.assign(initialConfig, { history: { past: [], future: [] } }),
	reducers: {
		setField: function (state, action) {
			const key = action.payload.key;
			var next = normalizeField(key, action.payload.value);
			pushHistory(state, pickModeSnapshot(state));
			state[key] = next;
		},
		setContent: function (state, action) {
			var next = normalizeField('Content', action.payload);
			pushHistory(state, pickModeSnapshot(state));
			state.Content = next;
		},
		/* 批量套用字段（快捷形态预置）：单次历史快照，避免 N 个字段的撤销步数。
		 * fields.Mode 与当前不同时先做类型快照迁移（与 switchMode 同语义），再套用其余字段。 */
		applyFields: function (state, action) {
			var src = (action.payload && action.payload.fields) || {};
			var fields = Object.assign({}, src);
			var mode = Object.prototype.hasOwnProperty.call(src, 'Mode') ? normalizeField('Mode', src.Mode) : null;
			if (mode) delete fields.Mode;
			if (!mode && !Object.keys(fields).length) return;
			pushHistory(state, pickModeSnapshot(state));
			if (mode && mode !== state.Mode) applyModeSwitch(state, mode);
			Object.keys(fields).forEach(function (k) {
				if (!ConfigSchema[k]) return; /* 未知字段丢弃（与 Go 配置同口径） */
				state[k] = normalizeField(k, fields[k]);
			});
		},
		/* 点击格子编辑单字：按「第 n 个汉字」写回 Content（T1.10） */
		replaceHan: function (state, action) {
			var next = normalizeField('Content',
				ContentModel.replaceCharAt(state.Content, action.payload.index, action.payload.char, state.Mode));
			pushHistory(state, pickModeSnapshot(state));
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
			var prevSnap = pickModeSnapshot(state);
			Object.keys(ConfigSchema).forEach(function (key) {
				/* 未提供的字段保留当前值：部分快照 / 旧预设导入不再被打回默认值（P0-2） */
				var has = Object.prototype.hasOwnProperty.call(src, key);
				state[key] = normalizeField(key, has ? src[key] : state[key]);
			});
			pushHistory(state, prevSnap);
		},
		resetConfig: function (state) {
			pushHistory(state, pickModeSnapshot(state));
			Object.keys(ConfigSchema).forEach(function (key) { state[key] = DEFAULTS[key]; });
			state.ModeStates = {}; /* 恢复默认同时清空各类型的独立记忆（避免切回时复活旧状态） */
		},
		/* 切换字帖类型：委托 applyModeSwitch 保存当前快照并恢复目标类型记忆 */
		switchMode: function (state, action) {
			var m = normalizeField('Mode', action.payload);
			if (m === state.Mode) return;
			pushHistory(state, pickModeSnapshot(state));
			applyModeSwitch(state, m);
		},
		/* 撤销 / 重做（P0-2：栈内存完整状态快照，跨模式 / 版式整体回退） */
		undo: function (state) {
			var snap = state.history.past.pop();
			if (snap === undefined) return;
			state.history.future.push(pickModeSnapshot(state));
			applySnapshot(state, snap);
		},
		redo: function (state) {
			var snap = state.history.future.pop();
			if (snap === undefined) return;
			state.history.past.push(pickModeSnapshot(state));
			applySnapshot(state, snap);
		},
		/* 清空历史（测试与「新内容另起一段」用） */
		resetHistory: function (state) {
			state.history.past = [];
			state.history.future = [];
		}
	}
});

/* 记录状态快照（变更前，由调用方在改写 state 前摘取）：与栈顶相同则跳过，避免连续重复入栈；
 * 入栈即清空 redo（新分支）。非快照字段（字体 / 主题 / 资源等）变化不改快照 → 不入栈。 */
function pushHistory(state, prevSnap) {
	var top = state.history.past[state.history.past.length - 1];
	if (top && JSON.stringify(top) === JSON.stringify(prevSnap)) return;
	state.history.past.push(prevSnap);
	if (state.history.past.length > CONTENT_HISTORY_MAX) state.history.past.shift();
	state.history.future = [];
}

/* 套用历史快照（undo / redo）：只覆盖快照字段，不动 ModeStates / 字体 / 主题等 */
function applySnapshot(state, snap) {
	Object.keys(snap).forEach(function (k) { state[k] = snap[k]; });
}

export const {
	setField, setContent, setFontSource, replaceHan, applyFields, importConfig, resetConfig, switchMode,
	undo: undoAction, redo: redoAction, resetHistory
} = configSlice.actions;
export { pushToast, dismissToast, setBackendMode };

/**
 * 接入模式选择器（U6）：UI / 能力门 / 配置回推都以 ui.backend 为唯一真源。
 * boot 时由 initSharedClient 结果写入（http / mock）；'init' 视为未接入内核。
 */
export function selectBackendOnline(s) {
	return !!(s && s.ui && s.ui.backend === 'http');
}

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

/* 持久化与远端同步的分工（SSOT 口径）：
 * - localStorage 是本地缓存 + 多标签页同步介质（storage 事件），也是浏览器模式下的主存储；
 * - 桌面端 Go config 服务是 SSOT：本地变更防抖 PUT 镜像，SSE config.changed 经
 *   applyRemotePrefs 回填；内核不可达时仅存本地，下次变更自然重试。 */
let saveTimer = null;
let prevConfig = store.getState().config;

/* 立即把防抖窗口内的变更落盘并镜像给内核（用于退出前 / 应用远端前） */
function flushNow() {
	if (!saveTimer) return;
	clearTimeout(saveTimer);
	saveTimer = null;
	const config = store.getState().config;
	saveConfig(config);
	/* 已连 Go 内核才回推（web 经反代打开同样适用）；本地模式只落 localStorage */
	if (selectBackendOnline(store.getState())) {
		sharedClient().setConfig(pickPrefs(config)).catch(function () { /* 内核暂不可达时忽略，下次变更重试 */ });
	}
}

/* applyingRemote：标记期间 subscribe 不回放，避免「本地 PUT → 服务端广播 → 再 PUT」环路。
 * 单线程同步块内有效；与远端并发到达时由 flushNow 先落本地，保证双方都不丢。 */
var applyingRemote = false;
export function applyRemotePrefs(prefs) {
	flushNow(); /* 先把本地待同步变更送出，防止被远端同名字段覆盖后丢失 */
	applyingRemote = true;
	try { store.dispatch(importConfig(prefs)); } finally { applyingRemote = false; }
}

store.subscribe(function () {
	const config = store.getState().config;
	/* 仅配置变化才持久化（toast 等 UI 动作不触发写盘） */
	if (config === prevConfig) return;
	if (applyingRemote) return; /* 远端导入：本地无需再落盘 / 回推 */
	prevConfig = config;
	if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(function () {
		saveTimer = null;
			saveConfig(config);
			if (selectBackendOnline(store.getState())) {
				sharedClient().setConfig(pickPrefs(config)).catch(function () { /* 内核暂不可达时忽略，下次变更重试 */ });
			}
		}, 150);
});

/* 退出前把防抖窗口内的变更落盘，缩短丢同步窗口（内核 PUT 尽力而为，localStorage 必达） */
if (typeof window !== 'undefined' && window.addEventListener) {
	window.addEventListener('beforeunload', function () { flushNow(); });
}

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
