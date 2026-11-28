/**
 * 导出：把当前字帖（内容 / 排版模板 / 文字颜色 / 标题 / 版式 / 字格 / 拼音 / 字体）
 * 按纸张逐页渲染到 canvas，输出每页 JPEG 图像序列（0.92）与纸张尺寸。
 * PDF 由桌面内核（Go）组装（internal/pdf）：JPEG 以 /DCTDecode 直通嵌入，
 * 不经纯 JS 解码路径；纯浏览器（无内核）不提供合成，导出入口置灰。
 *
 * 版式（折行 / 分页 / 标题占位 / 行列数）来自唯一真源 SheetLayout，
 * 与屏幕预览、页面打印共用同一份计算结果。
 */
import { ContentModel, hasExportableContent } from './content.js';
import { SheetLayout } from './sheet-layout.js';
import { buildZgSvg } from './zg-bg.js';
import { buildControlSvg } from './control.js';
import { strokeDataUri } from './stroke-library.js';
import { INK_RGB, FONT_WEIGHT_NUM, MIN_INK_WIDTH, MAX_INK_WIDTH, resolveZgOptions, traceAlphaOf } from './config.js';
import { loadPinyin, getLinePinyins } from './pinyin.js';
import { getStrokeMedians } from './stroke-order.js';
import { paperBgOf, paperTextureUri, PAPER_TILE_PX } from './paper.js';

const PAGE = ContentModel.defaultPage;      /* A4（mm） */
/* 画布分辨率：CSS 96dpi 的 1.5 倍。P3-15 实测（20 页 A4）：
 * 2×PNG 5.31MB / 13.2s，1.5×PNG 3.86MB / 8.0s，二者缩放后笔画清晰度目视无差。
 *
 * 2026-11 复测（5000 字 / 57 页）：PNG + jsPDF 38.9s、长任务 650ms/页（瓶颈是 jsPDF
 * 的 PNG 解码）；同条件 JPEG(0.92) 2.4s。现已改为 Go 侧组装，JPEG 直通 DCTDecode，
 * 前端只负责光栅化；PDF 固定 1.5×，PNG 由 PngDpi 控制（96–384dpi，C-e）。 */
const SCALE = 1.5;
/* PDF 导出基准密度（JPEG 直通 DCTDecode）；PNG 走 PngDpi 可配置（C-e） */
const BASE_DPI = 96 * SCALE; /* 144dpi = 原 1.5× 基准 */

const charFontStack = () => {
	const custom = document.body && document.body.classList.contains('custom-font');
	return (custom ? '"ziti", ' : '') + '"Kaiti SC", "STKaiti", "KaiTi", "TW-Kai", "DFKai-SB", serif';
};

const pinyinFontStack = () => '"Helvetica Neue", "Arial Unicode MS", "PingFang SC", "Microsoft YaHei", sans-serif';

const inkRGB = (cfg) => INK_RGB[cfg.InkColor] || INK_RGB.cinnabar;

const loadImage = (src) => new Promise((resolve, reject) => {
	const img = new Image();
	img.onload = () => resolve(img);
	img.onerror = () => reject(new Error('字格图片加载失败'));
	img.src = src;
});

/* 元信息日期（T2.2）：YYYY-MM-DD，与屏幕 / 打印一致 */
const dateStamp = () => {
	const d = new Date();
	const pad = (n) => (n < 10 ? '0' : '') + n;
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/* canvas 由调用方传入并逐页复用：每页绘制完立即编码为 JPEG，不再让整版位图同时驻留内存 */
const drawPage = (canvas, page, layout, gridImg, paperImg, cfg, pageIndex, pageCount, strokeMarks, controlImgs, strokeImgs, pxPerMm) => {
	const { lines } = page;
	const { gridMm } = layout;
	const mmPx = (mm) => mm * pxPerMm; /* 分辨率随调用传入（PDF 基准 / PNG 按 PngDpi，C-e） */
	const gridDevice = mmPx(gridMm);
	/* 字间距：有效步距 = 格宽 × pitchFactor（版式真源，CharGap=0 时为 1） */
	const pitchFactor = layout.pitchFactor || 1;
	/* 控笔（C1）/ 笔画：格子内画剪影（SVG → Image → drawImage），不画文字 */
	const isControl = cfg.Mode === 'control';
	const isStroke = cfg.Mode === 'stroke';

	const pageSize = layout.page || PAGE;
	canvas.width = Math.round(mmPx(pageSize.width));
	canvas.height = Math.round(mmPx(pageSize.height));

	const ctx = canvas.getContext('2d');
	/* 纸张底色 / 纹理（C-d）：与屏幕 / 打印同源（PaperTint 优先，纹理按 PAPER_TILE_PX 等比平铺） */
	ctx.fillStyle = paperBgOf(cfg);
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	if (paperImg) {
		const tileDevice = mmPx(PAPER_TILE_PX * 25.4 / 96); /* px@96dpi → mm → 当前画布密度 */
		for (let ty = 0; ty < canvas.height; ty += tileDevice) {
			for (let tx = 0; tx < canvas.width; tx += tileDevice) {
				ctx.drawImage(paperImg, tx, ty, tileDevice, tileDevice);
			}
		}
	}
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';

	/* 行起点：锁定列数时整行居中（含字距的有效占位 = (cols−1)×步距 + 格宽）。
	 * 行宽按版式真源 cols（english 词单元行无 cells，不能取 lines[0].length）。 */
	const rowWidth = lines.length ? ((layout.cols - 1) * pitchFactor + 1) * gridDevice : 0;
	const usableDevice = mmPx(layout.usableW);
	let startX = mmPx(layout.margin.left);
	if (layout.fixedCols && rowWidth > 0 && rowWidth < usableDevice) {
		startX += (usableDevice - rowWidth) / 2;
	}

	/* 标题（来自版式真源；是否每页由 ShowPageTitle 决定，见 SheetLayout） */
	const titleScale = layout.pageTitleScale != null ? layout.pageTitleScale : 42;
	const titleH = page.title ? mmPx(gridMm * 0.9) : 0;
	if (page.title) {
		ctx.font = `${Math.round(mmPx(gridMm * titleScale / 100))}px ${charFontStack()}`;
		ctx.fillStyle = 'rgba(35, 38, 43, .92)';
		ctx.fillText(page.title, mmPx(pageSize.width) / 2, mmPx(layout.margin.top) + mmPx(gridMm * 0.42));
	}
	const rgb = inkRGB(cfg);
	const modelColor = `rgba(${rgb}, ${cfg.InkAlpha})`;
	/* 描红颜色（A3 + Z1=C-a）：auto = 同主色，指定色 = 该色；浓度统一由 TraceRatio 决定 */
	const traceRGB = cfg.TraceColor === 'auto' ? rgb : (INK_RGB[cfg.TraceColor] || rgb);
	const traceColor = `rgba(${traceRGB}, ${traceAlphaOf(cfg)})`
	/* 字体粗细（A1）：normal 400 / bold 700，与屏幕 / 打印同源 */
	const fontWeight = FONT_WEIGHT_NUM[cfg.FontWeight] || 400;
	/* 笔画加粗（C-c）：字形描边宽度 = 字号 × InkWidth/1000，与屏幕 / 打印同源（canvas 以 strokeText 模拟） */
	const inkRatio = Math.max(MIN_INK_WIDTH, Math.min(MAX_INK_WIDTH, Number(cfg.InkWidth) || 0)) / 1000;

	/* 行距 = 配置格倍数 × 格宽（精确值，与屏幕 / 打印一致，见 content.js）：
	 * 行区高 = 可用高 − 标题占位；行盒高 = 字格高（拼音格 1.4×格，其余 1.0×格）；
	 * 行块高 = 行数 × 行盒 + (行数 − 1) × 行距；行区垂直对齐按配置
	 * （center 居中 / top 靠顶 / bottom 靠底），行距不变。
	 * 字帖不显示拼音：拼音格仅在格内上区画四线三格占位线。 */
	const { rowBoxMm, gapMm } = layout;
	const rowCount = lines.length;
	const areaMm = layout.usableH - (page.title ? gridMm * 0.9 : 0);
	const blockMm = rowCount * rowBoxMm + (rowCount > 1 ? (rowCount - 1) * gapMm : 0);
	const align = cfg.VerticalAlign === 'top' || cfg.VerticalAlign === 'bottom' ? cfg.VerticalAlign : 'center';
	const blockOffsetMm = align === 'top' ? 0 : align === 'bottom' ? Math.max(0, areaMm - blockMm) : (areaMm - blockMm) / 2;
	const startY = mmPx(layout.margin.top) + titleH + mmPx(blockOffsetMm);
	const pitch = rowBoxMm + gapMm;
	/* 上区型格：拼音格（5，四线三格 0.4 格）与格上拼音条（10，窄条 0.25 格，对齐 z2h「显示拼音」） */
	const hasTopZone = cfg.ZgType === '5' || cfg.ZgType === '10';
	/* 格子高 = 格宽 × 宽高比（版式真源 ratio：拼音格默认 1.4、拼音条 1.25，其余默认 1.0，用户可调） */
	const gridH = gridDevice * layout.ratio;
	/* 上区占位高度（格倍数）：上区 = 宽高比 − 1，字居下区 1.0×格；其余格字居整格 */
	const topPad = hasTopZone ? layout.ratio - 1 : 0;
	/* 格上拼音条：条内居中写拼音（屏幕 / 打印 / PDF 同语义；受「显示拼音」总开关控制） */
	const showBarPy = cfg.ZgType === '10' && cfg.ShowPinyin && !isControl;
	/* 字体在格内的水平 / 垂直偏移（格倍数），与屏幕 / 打印一致 */
	const dx = Number(cfg.CharOffsetX) || 0;
	const dy = Number(cfg.CharOffsetY) || 0;
	lines.forEach((line, r) => {
		const y = startY + r * mmPx(pitch);
		/* english：词单元行——词内字母连续（步距 < 1 格）、词间空 1 格，整词一个角色 */
		if (line.eng) {
			for (let c = 0; c < layout.cols; c++) {
				ctx.drawImage(gridImg, startX + c * gridDevice * pitchFactor, y, gridDevice, gridH);
			}
			const step = gridDevice * (layout.letterStep || 0.62) * pitchFactor;
			line.words.forEach((word) => {
				const x0 = startX + word.offset * gridDevice * pitchFactor;
				if (word.role !== 'blank') {
					ctx.font = `${fontWeight} ${Math.round(mmPx(gridMm * (Number(cfg.CharScale) || 0.725)))}px ${charFontStack()}`;
					ctx.fillStyle = word.role === 'trace' ? traceColor : modelColor;
					if (inkRatio > 0) { ctx.lineWidth = mmPx(gridMm * (Number(cfg.CharScale) || 0.725)) * inkRatio; ctx.strokeStyle = ctx.fillStyle; }
					word.chars.forEach((ch, i) => {
						const cx = x0 + i * step + step / 2 + gridDevice * dx;
						const cy = y + gridDevice * (topPad + 0.53125) + gridDevice * dy;
						if (inkRatio > 0) ctx.strokeText(ch, cx, cy);
						ctx.fillText(ch, cx, cy);
					});
				}
				/* 标点：附在词内字母右下角（与屏幕 / 打印同源） */
				(word.marks || []).forEach((mk, i) => {
					if (!mk) return;
					ctx.font = `${fontWeight} ${Math.round(mmPx(gridMm * 0.3))}px ${charFontStack()}`;
					ctx.fillStyle = word.role === 'trace' ? traceColor : modelColor;
					ctx.fillText(mk, x0 + i * step + step * 0.82 + gridDevice * dx, y + gridDevice * (topPad + 0.82) + gridDevice * dy);
				});
			});
			return;
		}
		/* 行级语境取音：多音字按词定音（与屏幕 / 打印同源） */
		const linePy = getLinePinyins(line.cells);
		line.cells.forEach((item, c) => {
			const { char, role } = item;
			const x = startX + c * gridDevice * pitchFactor;

			/* 字格：空临格与有字格同一套字格样式（仅无字）；拼音格上区四线三格占位 */
			ctx.drawImage(gridImg, x, y, gridDevice, gridH);

			/* 汉字（与 CSS 的 line-height / font-size 对齐；拼音格居下区 1.0×格）；空临格不画字。
			 * 控笔（C1）：改画图案（范字深色实线 / 描红浅色虚线），与屏幕 / 打印同源。 */
			if (role !== 'blank') {
			if (isControl) {
				/* 逐行序列：每格按 cell.char（图案 key）取图，未知 key 跳过 */
				const ci = controlImgs && controlImgs[char];
				if (ci) ctx.drawImage(role === 'trace' ? ci.trace : ci.model, x, y, gridDevice, gridDevice);
			} else if (isStroke) {
					/* 笔画：按角色取色剪影（与屏幕背景 / 打印同源），未知 key 跳过 */
					const s = strokeImgs && strokeImgs[char];
					if (s) ctx.drawImage(role === 'trace' ? s.trace : s.model, x, y, gridDevice, gridDevice);
				} else {
					/* 字占格比例（A2）：默认 0.725，与屏幕 / 打印同源 */
					ctx.font = `${fontWeight} ${Math.round(mmPx(gridMm * (Number(cfg.CharScale) || 0.725)))}px ${charFontStack()}`;
					ctx.fillStyle = role === 'trace' ? traceColor : modelColor;
					const charSize = mmPx(gridMm * (Number(cfg.CharScale) || 0.725));
					const charX = x + gridDevice / 2 + gridDevice * dx;
					const charY = y + gridDevice * (topPad + 0.53125) + gridDevice * dy;
					if (inkRatio > 0) { ctx.lineWidth = charSize * inkRatio; ctx.strokeStyle = ctx.fillStyle; ctx.strokeText(char, charX, charY); }
					ctx.fillText(char, charX, charY);
					/* 格上拼音条（type10）：拼音写在顶部窄条中央，不随字形偏移（与屏幕 / 打印同源） */
					if (showBarPy) {
						ctx.font = `${Math.round(mmPx(gridMm * 0.13))}px ${pinyinFontStack()}`;
						ctx.fillStyle = `rgba(${rgb}, ${cfg.InkAlpha * 0.9})`;
						ctx.fillText(linePy[c], x + gridDevice / 2, y + gridDevice * topPad / 2);
					}
					/* 静态笔顺（B4）：每笔中点标 1..n；几何与屏幕同源（medians 0..1，按 CharScale 居中） */
					if (strokeMarks && strokeMarks[char]) {
						const scale = Number(cfg.CharScale) || 0.725;
						ctx.font = `${Math.round(mmPx(gridMm * 0.16))}px ${pinyinFontStack()}`;
						ctx.fillStyle = `rgba(${rgb}, ${cfg.InkAlpha * 0.55})`;
						strokeMarks[char].forEach((m, i) => {
							const px = x + gridDevice * ((1 - scale) / 2 + m.x * scale) + gridDevice * dx;
							/* medians 为 y 向上坐标系，canvas y 向下，需翻转（与屏幕同源） */
							const py = y + gridH * ((1 - scale) / 2 + (1 - m.y) * scale) + gridDevice * dy;
							ctx.fillText(String(i + 1), px, py);
						});
					}
				}
			}

			/* 标点：不占格，字格右下角（T0.8）；空临格也照画；控笔 / 笔画无标点 */
			if (item.mark && !isControl && !isStroke) {
				ctx.font = `${fontWeight} ${Math.round(mmPx(gridMm * 0.3))}px ${charFontStack()}`;
				ctx.fillStyle = role === 'trace' ? traceColor : modelColor;
				ctx.fillText(item.mark, x + gridDevice * 0.82 + gridDevice * dx, y + gridDevice * (topPad + 0.82) + gridDevice * dy);
			}
		});
	});

	/* 元信息与页码（T2.2）：底部边距内，屏幕 / 打印 / PDF 共用同一份配置 */
	const metaSize = Math.round(mmPx(2.2));
	const metaY = canvas.height - mmPx(Math.max(layout.margin.bottom, 2.5)) * 0.5;
	/* 开启得分栏时信息重组：左侧「姓名　日期」合并一行，右侧单独「得分」，页码仍居中，避免相互压盖 */
	if (cfg.ShowMeta || cfg.ShowScore) {
		ctx.font = `${metaSize}px ${pinyinFontStack()}`;
		ctx.fillStyle = 'rgba(107, 114, 128, .9)';
		if (cfg.ShowMeta) {
			const leftText = `姓名：${cfg.Name || '＿＿＿＿'}` + (cfg.ShowScore ? `　日期：${dateStamp()}` : '');
			ctx.textAlign = 'left';
			ctx.fillText(leftText, mmPx(layout.margin.left), metaY);
			if (!cfg.ShowScore) {
				ctx.textAlign = 'right';
				ctx.fillText(`日期：${dateStamp()}`, mmPx(pageSize.width - layout.margin.right), metaY);
			}
		}
	}
	if (cfg.ShowPageNo) {
		ctx.font = `${metaSize}px ${pinyinFontStack()}`;
		ctx.fillStyle = 'rgba(107, 114, 128, .9)';
		ctx.textAlign = 'center';
		ctx.fillText(`第 ${pageIndex + 1} / ${pageCount} 页`, mmPx(pageSize.width / 2), metaY);
	}
	if (cfg.ShowScore) {
		ctx.font = `${metaSize}px ${pinyinFontStack()}`;
		ctx.fillStyle = 'rgba(107, 114, 128, .9)';
		ctx.textAlign = 'right';
		ctx.fillText('得分：＿＿＿＿', mmPx(pageSize.width - layout.margin.right), metaY);
	}

	/* 落款行（B4）：每页右下角、页脚信息之上；字号 / 颜色与屏幕 .sheet-signature 同源
	 * （格高 × 0.36、--ink-soft 观感的灰色、楷体栈），文本留空不绘。 */
	if (cfg.ShowSignature && cfg.SignatureText) {
		ctx.font = `${Math.round(mmPx(gridMm * 0.36))}px ${charFontStack()}`;
		ctx.fillStyle = 'rgba(107, 114, 128, .9)';
		ctx.textAlign = 'right';
		const sigY = canvas.height - mmPx(layout.margin.bottom) - mmPx(2.8);
		ctx.fillText(cfg.SignatureText, mmPx(pageSize.width - layout.margin.right), sigY);
	}

	return canvas;
};

const fileStamp = () => {
	const d = new Date();
	const pad = (n) => (n < 10 ? '0' : '') + n;
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
};

/* 导出文件名（与旧 jsPDF 版本一致，便于用户识别） */
export const pdfFilename = () => `墨帖-${fileStamp()}.pdf`;

/* PNG 导出文件名：墨帖[-标题]-时间戳[-pN].png（多页带页码后缀；标题清洗非法字符） */
export const pngFilename = (title, pageIndex, total) => {
	const clean = String(title || '').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
	return `墨帖${clean ? '-' + clean : ''}-${fileStamp()}${total > 1 ? '-p' + (pageIndex + 1) : ''}.png`;
};

/* canvas → 图片 Blob：mimeType 'image/jpeg'（PDF，质量 0.92）或 'image/png'（PNG 导出）；
 * 老浏览器无 toBlob 时回落 dataURL。 */
const canvasToImage = (canvas, mimeType, quality) => new Promise((resolve, reject) => {
	const fallback = () => {
		try {
			const bin = atob(canvas.toDataURL(mimeType, quality).split(',')[1]);
			const bytes = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
			resolve(new Blob([bytes], { type: mimeType }));
		} catch (e) { reject(e); }
	};
	if (canvas.toBlob) {
		canvas.toBlob((blob) => {
			if (blob) resolve(blob); else fallback();
		}, mimeType, quality);
	} else {
		fallback();
	}
});

const canvasToJPEG = (canvas) => canvasToImage(canvas, 'image/jpeg', 0.92);

/* 渲染导出页面序列：config 显式传入（Redux 唯一状态源）；缺省回退默认配置（便于调试）。
 * 返回 { pages: Blob[], widthMM, heightMM }（页序 = 版面页序；JPEG 0.92 或 PNG）。
 * opts.format：'image/jpeg'（默认，PDF 组装用）| 'image/png'（PNG 导出用）。
 * opts.onProgress?(done, total)：每完成一页回调，供界面显示进度。
 * 单块画布逐页复用 + 页间让出主线程：压住内存峰值，进度可回灌界面。 */
export const renderPages = async (config, opts) => {
	const cfg = config || {};
	const isControl = cfg.Mode === 'control';
	const isStroke = cfg.Mode === 'stroke';
	/* 空内容前置校验与导出按钮、打印共用同一判定（U3） */
	if (!hasExportableContent(cfg)) {
		throw new Error('请先输入字帖内容');
	}
	const layout = SheetLayout.compute({ config: cfg });
	await loadPinyin();
	/* 自定义字体可能仍在加载：等字体就绪再绘制，避免 canvas 回落默认字体 */
	if (document.fonts && document.fonts.ready) await document.fonts.ready;
	/* 字格参数必须经 resolveZgOptions 派生（面板缩略图 / 预览同源）：旧的位置参数调用会被当对象读，
	 * 颜色 / 线型静默回退默认（F 修复）。 */
	const gridUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildZgSvg(resolveZgOptions(cfg)));
	const gridImg = await loadImage(gridUri);
	/* 纸张纹理（C-d）：启用时预载一张平铺单元，逐页复用 */
	const paperUri = paperTextureUri(cfg);
	const paperImg = paperUri ? await loadImage(paperUri) : null;
	/* 主色 / 描红色（控笔、笔画共用；与屏幕 / 打印同源） */
	const rgb = inkRGB(cfg);
	const modelColor = `rgba(${rgb}, ${cfg.InkAlpha})`;
	const traceRGB = cfg.TraceColor === 'auto' ? rgb : (INK_RGB[cfg.TraceColor] || rgb);
	const traceColor = `rgba(${traceRGB}, ${cfg.TraceColor === 'auto' ? cfg.InkAlpha * 0.5 : cfg.InkAlpha})`;
	/* 控笔（C1）：按版面唯一图案 key 预加载范字 / 描红剪影（逐行序列下每格可不同），与屏幕 / 打印同色同源 */
	let controlImgs = null;
	if (isControl) {
		const controlUri = (key, color, role) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildControlSvg(key, color, role));
		const keys = [];
		const seen = {};
		layout.pages.forEach((p) => p.lines.forEach((line) => {
			if (line.eng) return;
			line.cells.forEach((c) => {
				if (c.role === 'blank' || !c.char) return;
				if (!seen[c.char]) { seen[c.char] = 1; keys.push(c.char); }
			});
		}));
		controlImgs = {};
		await Promise.all(keys.map(async (k) => {
			controlImgs[k] = {
				model: await loadImage(controlUri(k, modelColor, 'model')),
				trace: await loadImage(controlUri(k, traceColor, 'trace'))
			};
		}));
	}
	/* 笔画：按版面唯一笔画 key 预加载范字 / 描红剪影（每格可不同），与屏幕 / 打印同色同源 */
	let strokeImgs = null;
	if (isStroke) {
		const keys = [];
		const seen = {};
		layout.pages.forEach((p) => p.lines.forEach((line) => {
			if (line.eng) return;
			line.cells.forEach((c) => {
				if (c.role === 'blank' || !c.char) return;
				if (!seen[c.char]) { seen[c.char] = 1; keys.push(c.char); }
			});
		}));
		strokeImgs = {};
		await Promise.all(keys.map(async (k) => {
			strokeImgs[k] = {
				model: await loadImage(strokeDataUri(k, modelColor, 'model')),
				trace: await loadImage(strokeDataUri(k, traceColor, 'trace'))
			};
		}));
	}
	/* 静态笔顺（B4）：开启时按版面唯一字预加载 medians（stroke-order.js 内部按字缓存） */
	let strokeMarks = null;
	if (cfg.StrokeOrder) {
		const chars = [];
		const seen = {};
		layout.pages.forEach((p) => p.lines.forEach((line) => {
			if (line.eng) {
				line.words.forEach((word) => {
					if (word.role === 'blank') return;
					word.chars.forEach((ch) => {
						if (!seen[ch]) { seen[ch] = 1; chars.push(ch); }
					});
				});
					return;
			}
			line.cells.forEach((c) => {
				if (c.role === 'blank' || !c.char) return;
				if (!seen[c.char]) { seen[c.char] = 1; chars.push(c.char); }
			});
		}));
		const pairs = await Promise.all(chars.map((ch) => getStrokeMedians(ch).then((m) => [ch, m])));
		strokeMarks = {};
		pairs.forEach(([ch, m]) => { if (m) strokeMarks[ch] = m; });
	}
	const pageSize = layout.page || PAGE;
	const canvas = document.createElement('canvas');
	const total = layout.pages.length;
	const pages = [];
	/* 分辨率（C-e）：PNG 读配置 PngDpi（可用 opts.dpi 覆盖，供测试 / 调用方）；PDF 保持 1.5× 基准。 */
	const dpi = Number(opts && opts.dpi) || ((opts && opts.format === 'image/png') ? (Number(cfg.PngDpi) || 144) : BASE_DPI);
	const pxPerMm = dpi / 25.4;
	const mime = opts && opts.format === 'image/png' ? 'image/png' : 'image/jpeg';
	for (let i = 0; i < total; i++) {
		drawPage(canvas, layout.pages[i], layout, gridImg, paperImg, cfg, i, total, strokeMarks, controlImgs, strokeImgs, pxPerMm);
		pages.push(await canvasToImage(canvas, mime, 0.92));
		if (opts && typeof opts.onProgress === 'function') opts.onProgress(i + 1, total);
		/* 让出主线程：进度提示得以绘制，界面不再被整版导出阻塞 */
		if (i + 1 < total) await new Promise(function (resolve) { setTimeout(resolve, 0); });
	}
	return { pages: pages, widthMM: pageSize.width, heightMM: pageSize.height };
};
