import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './store.js';
/* PDF 组件编译绑定：npm 包 jspdf 经 Vite 打进 bundle，无 CDN / vendor 回退 */
import { jsPDF } from 'jspdf';
/* 核心统一出口（纯逻辑 ESM + 资源 / 字体 / 拼音 / 笔顺 / PDF 绑定） */
import { initPdf } from './core/index.js';
import App from './App.jsx';
/* 字帖本体样式（字格 / 分页 / 打印规则）交给 Vite 打包，dev 注入、build 合并 */
import '../../css/main.css';
import './index.css';
import './styles.css';

initPdf(jsPDF);

createRoot(document.getElementById('root')).render(
	<React.StrictMode>
		<Provider store={store}>
			<App />
		</Provider>
	</React.StrictMode>
);
