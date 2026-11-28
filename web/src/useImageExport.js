import { useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { pushToast } from './store.js';
import { renderPages as renderPagesCore, pngFilename, hasExportableContent } from './core/index.js';

/* 导出 PNG（doc/next-features-todo.md · A2 / roadmap D2）：与 PDF 共用 renderPages
 * 光栅化路径（同一份 SheetLayout / 同一套绘制，仅输出格式不同），纯前端完成——
 * 浏览器与桌面端均可使用。多页时逐张下载（每张一个文件，错峰触发避免被浏览器拦截）。 */

/* 逐个触发浏览器下载：创建临时 objectURL + <a download>；item = { blob, name } */
function saveAll(items) {
	items.forEach(function (item, i) {
		window.setTimeout(function () {
			var url = URL.createObjectURL(item.blob);
			var a = document.createElement('a');
			a.href = url;
			a.download = item.name;
			document.body.appendChild(a);
			a.click();
			a.remove();
			window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
		}, i * 250);
	});
}

export function useImageExport() {
	const config = useSelector(function (s) { return s.config; });
	const dispatch = useDispatch();
	const [busy, setBusy] = useState(false);
	/* 导出进度（页）：由 core/pdf.js 逐页回调，忙时渲染到按钮文案 */
	const [progress, setProgress] = useState(null);
	/* 重试可能晚于多次渲染被点击，需调用最新闭包（拿到当前配置） */
	const exportRef = useRef(null);

	function exportPng() {
		if (busy) return;
		/* 空内容统一前置提示（U3）：避免落到 renderPages 抛错、出现无意义的「重试」 */
		if (!hasExportableContent(config)) {
			dispatch(pushToast({ type: 'info', text: '内容为空：请先在「内容」页输入汉字，再导出 PNG。' }));
			return;
		}
		setBusy(true);
		setProgress({ done: 0, total: 0 });
		/* 先让按钮状态重绘，再开始渲染 */
		window.setTimeout(function () {
			var onProgress = function (done, total) { setProgress({ done: done, total: total }); };
			renderPagesCore(config, { format: 'image/png', onProgress: onProgress }).then(function (result) {
				var total = result.pages.length;
				var items = result.pages.map(function (blob, i) {
					return { blob: blob, name: pngFilename(config.Title, i, total) };
				});
				saveAll(items);
				setBusy(false);
				setProgress(null);
				dispatch(pushToast({
					type: 'success',
					text: total > 1 ? ('已导出 ' + total + ' 张 PNG（每页一张）。') : '已导出 PNG。'
				}));
			}, function (err) {
				setBusy(false);
				setProgress(null);
				dispatch(pushToast({
					type: 'error',
					text: '导出失败：' + (err && err.message ? err.message : String(err)),
					action: { label: '重试', onClick: function () { exportRef.current(); } }
				}));
			});
		}, 30);
	}
	exportRef.current = exportPng;

	return { busy: busy, progress: progress, exportPng: exportPng };
}
