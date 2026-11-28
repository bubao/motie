/**
 * 分享二维码载荷矩阵（web-features.md · D4）：文本 → QR 模块矩阵。
 * 依赖 qrcode-generator（MIT，Kazuhiko Arase）——构建时 bundle 进单文件，产物离线可用。
 * 链接为纯 ASCII（hash 段是 base64url），编码无多字节问题；超长抛错 → ok:false('too-long')。
 */
import qrcode from 'qrcode-generator';

/**
 * @param {string} text
 * @returns {{ok: true, size: number, cells: number[]}|{ok: false, reason: string}}
 *   cells 按行展开（size×size，1=深色模块）
 */
export function buildQrMatrix(text) {
	var t = String(text == null ? '' : text).trim();
	if (!t) return { ok: false, reason: 'empty' };
	try {
		var qr = qrcode(0, 'M'); /* typeNumber 0 = 自动（1..40），纠错级 M */
		qr.addData(t, 'Byte');
		qr.make();
		var n = qr.getModuleCount();
		var cells = [];
		for (var r = 0; r < n; r++) {
			for (var c = 0; c < n; c++) cells.push(qr.isDark(r, c) ? 1 : 0);
		}
		return { ok: true, size: n, cells: cells };
	} catch (e) {
		return { ok: false, reason: 'too-long' };
	}
}

/* 画进 canvas（面板浮层用）；jsdom / 无 2d 上下文环境静默跳过 */
export function drawQrCanvas(canvas, matrix, quietModules) {
	if (!canvas || !matrix || !matrix.ok) return;
	var ctx = canvas.getContext && canvas.getContext('2d');
	if (!ctx) return;
	var n = matrix.size;
	var quiet = quietModules || 4;
	var cssSize = canvas.clientWidth || canvas.width || 260;
	canvas.width = cssSize * (window.devicePixelRatio || 1);
	canvas.height = cssSize * (window.devicePixelRatio || 1);
	var unit = canvas.width / (n + quiet * 2);
	ctx.fillStyle = '#FFFFFF';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = '#1C1A16';
	for (var r = 0; r < n; r++) {
		for (var c = 0; c < n; c++) {
			if (matrix.cells[r * n + c]) {
				ctx.fillRect((c + quiet) * unit, (r + quiet) * unit, Math.ceil(unit), Math.ceil(unit));
			}
		}
	}
}
