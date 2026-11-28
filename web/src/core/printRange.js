/**
 * 打印范围解析（web-features.md · D3「仅打印选中页」）：
 * 文本 → 页码集合（0-based），打印前隐藏未选中页。
 * 语法：逗号分隔的「n」或「a-b」（a ≤ b，1-based，不超过总页数）。
 * 空串 = 全部页；任何非法项（非数字 / 越界 / 倒序区间）→ invalid。
 */

/* 「2」「2-4」；连字符允许 - / – / —（中文输入习惯） */
var ITEM_RE = /^(\d+)(?:\s*[-–—]\s*(\d+))?$/;

/**
 * @param {string} text 用户输入的范围文本
 * @param {number} total 总页数（版式真源页数）
 * @returns {{all: boolean, set: Set<number>|null, invalid: boolean}}
 */
export function parsePageRange(text, total) {
	var t = String(text == null ? '' : text).trim();
	if (!t || !total || total < 1) return { all: true, set: null, invalid: false };
	var set = new Set();
	var parts = t.split(',');
	for (var i = 0; i < parts.length; i++) {
		var m = parts[i].trim().match(ITEM_RE);
		if (!m) return { all: false, set: null, invalid: true };
		var a = Number(m[1]);
		var b = m[2] ? Number(m[2]) : a;
		if (a < 1 || b < a || b > total) return { all: false, set: null, invalid: true };
		for (var p = a; p <= b; p++) set.add(p - 1);
	}
	if (!set.size) return { all: false, set: null, invalid: true };
	return { all: false, set: set, invalid: false };
}

/* 打印前把未选中页临时隐藏（CSS @media print 已有 .no-print 规则）；afterprint 移除 */
export function applyPrintRange(set) {
	var nodes = document.querySelectorAll('.rp-page');
	for (var i = 0; i < nodes.length; i++) {
		var idx = Number(nodes[i].getAttribute('data-page'));
		nodes[i].classList.toggle('no-print', !!(set && !set.has(idx)));
	}
}

export function clearPrintRange() {
	var nodes = document.querySelectorAll('.rp-page.no-print');
	for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('no-print');
}
