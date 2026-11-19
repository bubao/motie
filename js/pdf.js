/**
 * 导出 PDF：把当前字帖（内容 / 排版模板 / 文字颜色 / 标题 / 版式 / 字格 / 拼音 / 字体）
 * 按 A4 逐页渲染到 canvas，再用 jsPDF 合成 PDF 文件。
 * jsPDF 由专业版构建时编译绑定（npm 包，经 Z.Pdf.setJsPdf 注入），无 CDN / vendor 回退。
 *
 * 版式（折行 / 分页 / 标题占位 / 行列数）来自唯一真源 Z.SheetLayout，
 * 与屏幕预览、页面打印共用同一份计算结果。
 */
(function (Z) {
	'use strict';

	var PAGE = Z.ContentModel.defaultPage;      /* A4（mm） */
	var SCALE = 2;                              /* 画布分辨率：CSS 96dpi 的 2 倍 */
	var PX_PER_MM = 96 / 25.4 * SCALE;
	/* 专业版构建时注入 npm 包构造器（web/src/main.jsx 编译绑定 jspdf） */
	var injectedCtor = null;

	function mmPx(mm) {
		return mm * PX_PER_MM;
	}

	function charFontStack() {
		var custom = document.body && document.body.classList.contains('custom-font');
		return (custom ? '"ziti", ' : '') + '"Kaiti SC", "STKaiti", "KaiTi", "TW-Kai", "DFKai-SB", serif';
	}

	function pinyinFontStack() {
		return '"Helvetica Neue", "Arial Unicode MS", "PingFang SC", "Microsoft YaHei", sans-serif';
	}

	function inkRGB(cfg) {
		return Z.INK_RGB[cfg.InkColor] || Z.INK_RGB.cinnabar;
	}

	function loadImage(src) {
		return new Promise(function (resolve, reject) {
			var img = new Image();
			img.onload = function () { resolve(img); };
			img.onerror = function () { reject(new Error('字格图片加载失败')); };
			img.src = src;
		});
	}

	/* 元信息日期（T2.2）：YYYY-MM-DD，与屏幕 / 打印一致 */
	function dateStamp() {
		var d = new Date();
		function pad(n) { return (n < 10 ? '0' : '') + n; }
		return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
	}

	function drawPage(page, layout, gridImg, cfg, pageIndex, pageCount) {
		var lines = page.lines;
		var gridMm = layout.gridMm;
		var pitchMm = layout.pitchMm;
		var gridDevice = mmPx(gridMm);
		var gapDevice = mmPx(layout.gapMm);

		var pageSize = layout.page || PAGE;
		var canvas = document.createElement('canvas');
		canvas.width = Math.round(mmPx(pageSize.width));
		canvas.height = Math.round(mmPx(pageSize.height));

		var ctx = canvas.getContext('2d');
		ctx.fillStyle = '#FFFFFF';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		/* 行起点：锁定列数时整行居中 */
		var rowWidth = lines.length ? lines[0].length * gridDevice + Math.max(0, lines[0].length - 1) * gapDevice : 0;
		var usableDevice = mmPx(layout.usableW);
		var startX = mmPx(layout.margin.left);
		if (layout.fixedCols && rowWidth > 0 && rowWidth < usableDevice) {
			startX += (usableDevice - rowWidth) / 2;
		}

		/* 标题（仅第一页，来自版式真源） */
		var titleH = page.title ? mmPx(gridMm * 0.9) : 0;
		if (page.title) {
			ctx.font = Math.round(mmPx(gridMm * 0.55)) + 'px ' + charFontStack();
			ctx.fillStyle = 'rgba(35, 38, 43, .92)';
			ctx.fillText(page.title, mmPx(pageSize.width) / 2, mmPx(layout.margin.top) + mmPx(gridMm * 0.42));
		}
		var startY = mmPx(layout.margin.top) + titleH;
		var rgb = inkRGB(cfg);
		var modelColor = 'rgba(' + rgb + ', ' + cfg.InkAlpha + ')';
		var traceColor = 'rgba(' + rgb + ', ' + (cfg.InkAlpha * 0.5) + ')';

		lines.forEach(function (line, r) {
			var y = startY + r * mmPx(pitchMm);
			line.forEach(function (item, c) {
				var char = item.char;
				var role = item.role;
				var x = startX + c * (gridDevice + gapDevice);

				/* 拼音 */
				if (cfg.ShowPinyin) {
					ctx.font = Math.round(mmPx(gridMm * 0.15)) + 'px ' + pinyinFontStack();
					ctx.fillStyle = 'rgba(35, 38, 43, .62)';
					ctx.fillText(Z.getPinyin(char), x + gridDevice / 2, y + gridDevice * 0.125);
				}

				/* 字格 */
				ctx.drawImage(gridImg, x, y + gridDevice * 0.25, gridDevice, gridDevice);

				/* 汉字（与 CSS 的 line-height .725 / 1.0625 对齐）；空临格不画字 */
				if (role !== 'blank') {
					ctx.font = Math.round(mmPx(gridMm * 0.725)) + 'px ' + charFontStack();
					ctx.fillStyle = role === 'trace' ? traceColor : modelColor;
					ctx.fillText(char, x + gridDevice / 2, y + gridDevice * 0.25 + gridDevice * 0.53125);
				}

				/* 标点：不占格，字格右下角（T0.8）；空临格也照画 */
				if (item.mark) {
					ctx.font = Math.round(mmPx(gridMm * 0.3)) + 'px ' + charFontStack();
					ctx.fillStyle = role === 'trace' ? traceColor : modelColor;
					ctx.fillText(item.mark, x + gridDevice * 0.82, y + gridDevice * 0.25 + gridDevice * 0.82);
				}
			});
		});

		/* 元信息与页码（T2.2）：底部边距内，屏幕 / 打印 / PDF 共用同一份配置 */
		var metaSize = Math.round(mmPx(2.2));
		var metaY = canvas.height - mmPx(Math.max(layout.margin.bottom, 2.5)) * 0.5;
		if (cfg.ShowMeta) {
			ctx.font = metaSize + 'px ' + pinyinFontStack();
			ctx.fillStyle = 'rgba(107, 114, 128, .9)';
			ctx.textAlign = 'left';
			ctx.fillText('姓名：' + (cfg.Name || '＿＿＿＿'), mmPx(layout.margin.left), metaY);
			ctx.textAlign = 'right';
			ctx.fillText('日期：' + dateStamp(), mmPx(pageSize.width - layout.margin.right), metaY);
		}
		if (cfg.ShowPageNo) {
			ctx.font = metaSize + 'px ' + pinyinFontStack();
			ctx.fillStyle = 'rgba(107, 114, 128, .9)';
			ctx.textAlign = 'center';
			ctx.fillText('第 ' + (pageIndex + 1) + ' / ' + pageCount + ' 页', mmPx(pageSize.width / 2), metaY);
		}

		return canvas;
	}

	function fileStamp() {
		var d = new Date();
		function pad(n) { return (n < 10 ? '0' : '') + n; }
		return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
	}

	Z.Pdf = {
		setJsPdf: function (ctor) { injectedCtor = ctor || null; },
		export: function (config) {
			/* config 显式传入时以它为准（Redux 唯一状态源）；缺省回退 Z.Config（共享核心/精简版）。 */
			var cfg = config || Z.Config;
			if (!String(cfg.Content || '').trim()) {
				return Promise.reject(new Error('请先输入字帖内容'));
			}
			if (!injectedCtor) return Promise.reject(new Error('PDF 组件未注入，请重新打开页面'));
			var JsPdf = injectedCtor;
			var layout = Z.SheetLayout.compute({ config: cfg });
			return Z.loadPinyin().then(function () {
				/* 自定义字体可能仍在加载：等字体就绪再绘制，避免 canvas 回落默认字体 */
				if (document.fonts && document.fonts.ready) return Promise.resolve(document.fonts.ready);
			}).then(function () {
				var uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(Z.buildZgSvg(cfg.ZgType, cfg.ZgColor));
				return loadImage(uri).then(function (gridImg) {
					return { JsPdf: JsPdf, layout: layout, canvases: layout.pages.map(function (page, i) { return drawPage(page, layout, gridImg, cfg, i, layout.pages.length); }) };
				});
			}).then(function (r) {
				var pageSize = r.layout.page || PAGE;
				/* compress: 开启流压缩，避免 PNG 像素数据以未压缩形式嵌入（体积可降至 1/20） */
				var pdf = new r.JsPdf({ unit: 'mm', format: [pageSize.width, pageSize.height], orientation: 'portrait', compress: true });
				/* 文档元信息（T2.3）：标题固定含「墨帖」，可带内容标题；作者取练习者姓名 */
				if (pdf.setProperties) {
					pdf.setProperties({
						title: '墨帖' + (cfg.Title ? ' · ' + cfg.Title : ''),
						subject: '字帖练习',
						creator: '墨帖',
						author: cfg.Name || ''
					});
				}
				r.canvases.forEach(function (canvas, i) {
					if (i > 0) pdf.addPage();
					pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageSize.width, pageSize.height);
				});
				pdf.save('墨帖-' + fileStamp() + '.pdf');
				return r.canvases.length;
			});
		}
	};
})(window.Zitie = window.Zitie || {});
