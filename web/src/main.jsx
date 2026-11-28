import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store, applyRemotePrefs, applyFields, pushToast, setBackendMode } from './store.js';
/* 核心统一出口（纯逻辑 ESM + 资源 / 字体 / 拼音 / 笔顺 / PDF 绑定） */
import { setLocalResolver, shareFromLocation } from './core/index.js';
import { initSharedClient, backendKind } from './ipc/client.ts';
import { EVENTS } from './generated/types';
import App from './App.jsx';
/* 字帖本体样式（字格 / 分页 / 打印规则）交给 Vite 打包，dev 注入、build 合并 */
import '../../css/main.css';
import './styles.css';


/* 桌面端启动：先向 Go 内核取偏好（SSOT）再渲染；SSE config.changed 多标签 / 多窗口同步。
 * 内核与页面同源同进程，读取失败（极端时序）时退回 localStorage 初值。 */
async function boot() {
	/* 分享链接（doc/next-features-todo.md · A1）：hash 中 #s= 载荷优先级最高——
	 * 在桌面 prefs 之后应用，避免 PREFS_KEYS（Template / ZgType / 页边距等）覆盖分享版式；
	 * 主题与字体来源仍跟随本机偏好（本地导入字体无法随链接转移）。 */
	var shared = shareFromLocation(window.location);
	/* 接入模式（U6）：先探测可达的 Go 内核再决定 transport——桌面壳同源注入直接命中，
	 * 独立 web 部署按「当前 origin → URL / 记忆端口 → 默认端口」依次探测；全部不可达才落本地模式，
	 * 并在顶栏标注，避免字体 / 字帖管理在「看起来能用」的假象下丢数据。 */
	var client = await initSharedClient();
	store.dispatch(setBackendMode(backendKind()));
	if (backendKind() === 'http') {
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

	if (shared) {
		store.dispatch(applyFields({ fields: shared }));
		if (window.history && window.history.replaceState) {
			window.history.replaceState(null, '', window.location.pathname + window.location.search);
		}
		var sharedChars = typeof shared.Content === 'string' ? shared.Content.length : 0;
		store.dispatch(pushToast({ type: 'success', text: '已载入分享的字帖（约 ' + sharedChars + ' 字）。' }));
	}

	/* PWA（roadmap E1 / 待办 A5）：http(s) 部署时注册 SW——导航 network-first、静态与 CDN
	 * 资源 cache-first，「打开过一次」后核心功能离线可用。file:// 不支持 SW；桌面壳原生
	 * 离线，两者都不注册。 */
	if (backendKind() !== 'http' && (window.location.protocol === 'http:' || window.location.protocol === 'https:') &&
		'serviceWorker' in navigator) {
		window.navigator.serviceWorker.register('sw.js').catch(function () { /* 注册失败忽略 */ });
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
