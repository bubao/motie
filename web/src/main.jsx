import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './store.js';
/* 共享核心：assets 管理 HanziWriter / 拼音的 CDN 或本地 vendor，pinyin 提供 Z.loadPinyin / Z.getPinyin，
   pdf 提供 Z.Pdf.export()（读 Z.Config，与屏幕预览 / 打印同源，见 js/pdf.js） */
import '../../js/assets.js';
import '../../js/pinyin.js';
import '../../js/pdf.js';
/* 笔顺动画封装（点击字格放大预览用，依赖 window.HanziWriter，由 assets 按需注入） */
import '../../js/stroke.js';
/* PDF 组件编译绑定：npm 包 jspdf 经 Vite 打进 bundle，无 CDN / vendor 回退 */
import { jsPDF } from 'jspdf';
import { Zitie } from '../../js/core.js';
import App from './App.jsx';
/* 字帖本体样式（字格 / 分页 / 打印规则）交给 Vite 打包，dev 注入、build 合并 */
import '../../css/main.css';
import './index.css';
import './styles.css';

Zitie.Pdf.setJsPdf(jsPDF);

createRoot(document.getElementById('root')).render(
	<React.StrictMode>
		<Provider store={store}>
			<App />
		</Provider>
	</React.StrictMode>
);
