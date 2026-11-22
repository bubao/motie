import { useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { pushToast } from './store.js';
import { exportPdf as exportPdfCore } from './core/index.js';

/* 导出 PDF：配置从 Redux 显式传入 exportPdf（与屏幕 / 打印同一份 SheetLayout 计算）。
   顶栏与「输出」页共用同一份逻辑，busy 态由调用方渲染。 */
export function usePdfExport() {
	const config = useSelector(function (s) { return s.config; });
	const dispatch = useDispatch();
	const [busy, setBusy] = useState(false);
	/* 重试可能晚于多次渲染被点击，需调用最新闭包（拿到当前配置） */
	const exportRef = useRef(null);

	function exportPdf() {
		if (busy) return;
		setBusy(true);
		/* 先让按钮状态重绘，再开始渲染（与原生版一致） */
		window.setTimeout(function () {
			exportPdfCore(config).then(function () {
				setBusy(false);
				dispatch(pushToast({ type: 'success', text: '已导出 PDF。' }));
			}, function (err) {
				setBusy(false);
				dispatch(pushToast({
					type: 'error',
					text: '导出失败：' + (err && err.message ? err.message : String(err)),
					action: { label: '重试', onClick: function () { exportRef.current(); } }
				}));
			});
		}, 30);
	}
	exportRef.current = exportPdf;

	return { busy: busy, exportPdf: exportPdf };
}
