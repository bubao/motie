import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store, applyRemotePrefs } from './store.js';
/* 核心统一出口（纯逻辑 ESM + 资源 / 字体 / 拼音 / 笔顺 / PDF 绑定） */
import { setLocalResolver } from './core/index.js';
import { sharedClient, isDesktopEnv } from './ipc/client.ts';
import { EVENTS } from './generated/types';
import App from './App.jsx';
/* 字帖本体样式（字格 / 分页 / 打印规则）交给 Vite 打包，dev 注入、build 合并 */
import '../../css/main.css';
import './styles.css';


/* 桌面端启动：先向 Go 内核取偏好（SSOT）再渲染；SSE config.changed 多标签 / 多窗口同步。
 * 内核与页面同源同进程，读取失败（极端时序）时退回 localStorage 初值。 */
async function boot() {
	if (isDesktopEnv()) {
		const client = sharedClient();
		/* 本地字体二进制改从 Go fonts 服务取（替换 IndexedDB）；失败回退 IndexedDB */
		setLocalResolver(async function (id) {
			const res = await fetch(client.fontFileURL(id));
			if (!res.ok) return null;
			return res.arrayBuffer();
		});
		try {
			const prefs = await client.getConfig();
			applyRemotePrefs(prefs);
		} catch (err) {
			console.error('motie: 读取内核配置失败，使用本地缓存', err);
		}
		client.subscribe(function (payload) {
			if (payload.event === EVENTS.ConfigChanged && payload.data) {
				applyRemotePrefs(payload.data);
			}
		});
	}

	createRoot(document.getElementById('root')).render(
		<React.StrictMode>
			<Provider store={store}>
				<App />
			</Provider>
		</React.StrictMode>
	);
}

boot();
