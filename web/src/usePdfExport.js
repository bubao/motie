import { useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { pushToast } from './store.js';
import { renderPages as renderPagesCore, pdfFilename } from './core/index.js';
import { sharedClient, isDesktopEnv } from './ipc/client.ts';

/* 导出 PDF：配置从 Redux 显式传入（与屏幕 / 打印同一份 SheetLayout 计算）。
 * 前端只负责光栅化（renderPages → 每页 JPEG），PDF 组装在 Go 内核（multipart 上传）；
 * 纯浏览器（无内核）不提供合成，入口置灰 + 提示。 */
export function usePdfExport() {
	const config = useSelector(function (s) { return s.config; });
	const dispatch = useDispatch();
	const [busy, setBusy] = useState(false);
	/* 导出进度（页）：由 core/pdf.js 逐页回调，忙时渲染到按钮文案 */
	const [progress, setProgress] = useState(null);
	/* 重试可能晚于多次渲染被点击，需调用最新闭包（拿到当前配置） */
	const exportRef = useRef(null);

	function exportPdf() {
		if (busy) return;
		if (!isDesktopEnv()) {
			dispatch(pushToast({ type: 'info', text: 'PDF 导出仅在桌面版可用（需连接桌面内核）。' }));
			return;
		}
		setBusy(true);
		setProgress({ done: 0, total: 0 });
		/* 先让按钮状态重绘，再开始渲染（与原生版一致） */
		window.setTimeout(function () {
			var onProgress = function (done, total) { setProgress({ done: done, total: total }); };
			renderPagesCore(config, { onProgress: onProgress }).then(function (result) {
				var filename = pdfFilename();
				return sharedClient()
					.buildPDF(filename, result.widthMM, result.heightMM, result.pages)
					.then(function (saved) {
						if (!saved) throw new Error('内核未返回保存路径');
					});
			}).then(function () {
				setBusy(false);
				setProgress(null);
				dispatch(pushToast({ type: 'success', text: '已导出 PDF。' }));
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
	exportRef.current = exportPdf;

	return { busy: busy, progress: progress, exportPdf: exportPdf };
}
