/**
 * 墨帖 · 练字版（Kindle / 老式浏览器）
 * - 定位练字：整页描红，黑白屏优先；设置收进弹窗（内容 / 字体 / 字格），不占预览位置
 * - 预览区：点击字格放大（← / → 切换）；↑ / ↓ 逐字移动并高亮当前字
 * - ES5 语法、无外部网络请求、无动画；不依赖 CSS 变量（老浏览器兼容）
 * - 配置 / 内容模型 / 字格背景与完整版共享（见 js/config.js、js/content.js、js/zg-bg.js）
 */
import '../js/config.js';
import '../js/content.js';
import '../js/zg-bg.js';
import '../js/font.js';

(function () {
	'use strict';

	var Z = window.Zitie;

	/* Kindle 黑白屏固定参数（不读用户残留配置，保证行为确定） */
	var FIXED = {
		template: 'trace',     /* 整页描红 */
		inkRgb: '35,38,43',    /* 深灰，黑白屏对比清晰 */
		inkAlpha: 0.62,        /* 文字深浅（范字实、描红浅） */
		gridSize: 80,          /* 格子边长 px */
		traceCount: 3,
		zgColor: '2',          /* 字格颜色：灰（黑白屏） */
		rowGap: 0.12,
		cellGap: 0.05
	};

	/* ==================== 自定义字体（注入 / 持久化收敛到 js/font.js） ==================== */
	function applyFont(url) {
		Z.Font.apply(url);
	}

	function formatSize(bytes) {
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / 1024 / 1024).toFixed(1) + ' MB';
	}

	/* 服务模式下拉取网络字体清单；file:// / 无服务 / 老浏览器无 XHR 时隐藏 */
	function loadFontList() {
		var box = byId('fontList');
		if (!box) return;
		if (!window.XMLHttpRequest) { box.style.display = 'none'; return; }
		var xhr = new XMLHttpRequest();
		xhr.open('GET', '/api/fonts', true);
		xhr.onreadystatechange = function () {
			if (xhr.readyState !== 4) return;
			if (xhr.status !== 200) { box.style.display = 'none'; return; }
			var data;
			try { data = JSON.parse(xhr.responseText); } catch (e) { box.style.display = 'none'; return; }
			var fonts = data && data.fonts ? data.fonts : [];
			if (!fonts.length) { box.style.display = 'none'; return; }
			renderFontList(box, fonts);
			box.style.display = '';
		};
		xhr.onerror = function () { box.style.display = 'none'; };
		try { xhr.send(); } catch (e) { box.style.display = 'none'; }
	}

	function renderFontList(box, fonts) {
		while (box.firstChild) box.removeChild(box.firstChild);
		for (var i = 0; i < fonts.length; i++) {
			(function (f) {
				var btn = document.createElement('button');
				btn.type = 'button';
				btn.className = 'font-item';
				btn.setAttribute('data-url', f.url);
				setText(btn, f.name + '（' + formatSize(f.size) + '）');
				on(btn, 'click', function () {
					var input = byId('fontURL');
					if (input) input.value = f.url;
					applyFont(f.url);
					var hint = byId('fontHint');
					if (hint) { setText(hint, '已应用网络字体：' + f.name + '。'); hint.className = 'hint'; }
				});
				box.appendChild(btn);
			})(fonts[i]);
		}
	}

	function handleFontApply() {
		var input = byId('fontURL');
		var hint = byId('fontHint');
		var url = input ? input.value : '';
		var clean = Z.sanitizeFontURL(url);
		if (url && !clean) {
			if (hint) {
				setText(hint, '字体地址无效：仅支持 http(s) 字体或相对路径（如 font/5.woff）。');
				hint.className = 'hint hint-error';
			}
			return;
		}
		applyFont(clean);
		if (hint) {
			setText(hint, clean ? '已应用自定义字体。' : '已恢复默认字体。');
			hint.className = 'hint';
		}
	}

	/* ==================== 基础工具 ==================== */
	function byId(id) {
		return document.getElementById(id);
	}

	function setText(el, text) {
		if (!el) return;
		if (typeof text === 'number') text = String(text);
		try {
			el.textContent = text;
		} catch (e) {
			el.innerText = text;
		}
	}

	function on(el, type, fn) {
		if (!el) return;
		if (el.addEventListener) el.addEventListener(type, fn, false);
		else if (el.attachEvent) el.attachEvent('on' + type, fn);
	}

	/* ==================== 渲染 ==================== */
	function applyBoxStyle(box) {
		var size = FIXED.gridSize;
		box.style.width = size + 'px';
		box.style.height = size + 'px';
		box.style.lineHeight = Math.round(size * 1.06) + 'px';
		box.style.fontSize = Math.round(size * 0.725) + 'px';
		box.style.backgroundImage = Z.getZgBackground(Z.Config.ZgType, FIXED.zgColor);
		box.style.backgroundSize = size + 'px ' + size + 'px';
	}

	function buildCell(char, role, mark, idx) {
		var cell = document.createElement('span');
		cell.className = 'cell';
		cell.setAttribute('data-idx', String(idx));
		cell.style.marginRight = Math.round(FIXED.gridSize * FIXED.cellGap) + 'px';

		var box = document.createElement('span');
		box.className = 'hz-line';
		if (role !== 'blank') {
			setText(box, char);
			/* 直接内联颜色（不依赖 CSS 变量，兼容老浏览器） */
			var a = role === 'trace' ? Math.round(FIXED.inkAlpha * 50) / 100 : FIXED.inkAlpha;
			box.style.color = 'rgba(' + FIXED.inkRgb + ', ' + a + ')';
		}
		applyBoxStyle(box);

		/* 标点：不占格，附在字格右下角（T0.8） */
		if (mark) {
			var mk = document.createElement('span');
			mk.className = 'hz-mark';
			setText(mk, mark);
			box.appendChild(mk);
		}

		cell.appendChild(box);
		return cell;
	}

	function render() {
		var container = byId('printContent');
		if (!container) return;
		container.innerHTML = '';

		var blocks = Z.ContentModel.parse(Z.Config.Content).blocks;
		var count = 0;
		for (var i = 0; i < blocks.length; i++) {
			var block = blocks[i];
			if (block.type === 'page') {
				/* 空行 = 分页（仅打印时生效） */
				var br = document.createElement('div');
				br.className = 'page-break';
				container.appendChild(br);
				continue;
			}
			var row = document.createElement('div');
			row.className = 'row';
			row.style.marginBottom = Math.round(FIXED.gridSize * FIXED.rowGap) + 'px';
			for (var j = 0; j < block.chars.length; j++) {
				row.appendChild(buildCell(
					block.chars[j],
					Z.Layout.cellRole(j, FIXED.template, FIXED.traceCount),
					(block.marks || [])[j] || '',
					count
				));
				if (block.chars[j] !== '') count++; /* 占位空临格不计入字数 */
			}
			container.appendChild(row);
		}
		setText(byId('charCount'), count);
		setText(byId('pageCount'), Z.ContentModel.estimatePages(
			Z.Config.Content, FIXED.gridSize, Z.Config.Cols, FIXED.rowGap
		));
		currentIdx = 0;
	}

	/* ==================== 控件 ==================== */
	function getRadioValue(name) {
		var nodes = document.getElementsByName(name);
		for (var i = 0; i < nodes.length; i++) {
			if (nodes[i].checked) return nodes[i].value;
		}
		return null;
	}

	function setRadioValue(name, value) {
		var nodes = document.getElementsByName(name);
		for (var i = 0; i < nodes.length; i++) {
			nodes[i].checked = nodes[i].value === value;
		}
	}

	function handleTextInput() {
		/* 输入时只保存，不重排（Kindle 弱性能）；点「完成」才渲染 */
		var textarea = byId('content');
		Z.Config.Content = textarea.value;
		Z.Config.save();
	}

	function applySample() {
		var textarea = byId('content');
		textarea.value = Z.SAMPLE_TEXT;
		Z.Config.Content = Z.SAMPLE_TEXT;
		Z.Config.save();
		render();
	}

	function applyClear() {
		var textarea = byId('content');
		textarea.value = '';
		Z.Config.Content = '';
		Z.Config.save();
		render();
	}

		/* ==================== 预览：逐字移动 + 点击放大 ==================== */
	var currentIdx = 0;
	var zoomOpen = false;
	var zoomIdx = 0;

	function previewCells() {
		var box = byId('printContent');
		return box ? box.querySelectorAll('.cell') : [];
	}

	function scrollToCell(el) {
		var vh = window.innerHeight || document.documentElement.clientHeight || 600;
		var ph = Math.round(vh * 0.8);
		var rect = el.getBoundingClientRect();
		var scrollY = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
		var y = scrollY + rect.top - Math.round(ph / 2);
		if (y < 0) y = 0;
		if (window.scrollTo) window.scrollTo(0, y);
	}

	function highlightCell(el) {
		var cells = previewCells();
		for (var i = 0; i < cells.length; i++) {
			if (cells[i].className.indexOf('is-current') >= 0) {
				cells[i].className = cells[i].className.replace(' is-current', '');
			}
		}
		if (el && el.className.indexOf('is-current') < 0) el.className += ' is-current';
	}

	function gotoChar(idx) {
		var cells = previewCells();
		if (!cells.length) return;
		if (idx < 0) idx = 0;
		if (idx >= cells.length) idx = cells.length - 1;
		currentIdx = idx;
		var el = cells[idx];
		highlightCell(el);
		scrollToCell(el);
	}

	/* ---------- 放大层：点击字格显示大字，← / → 切换 ---------- */
	function openZoom(idx) {
		var cells = previewCells();
		if (!cells.length) return;
		if (idx < 0) idx = 0;
		if (idx >= cells.length) idx = cells.length - 1;
		zoomIdx = idx;
		zoomOpen = true;
		renderZoom();
		byId('zoomOverlay').style.display = 'block';
		document.body.style.overflow = 'hidden';
	}

	function closeZoom() {
		zoomOpen = false;
		byId('zoomOverlay').style.display = 'none';
		document.body.style.overflow = '';
	}

	function stepZoom(delta) {
		var cells = previewCells();
		if (!cells.length) return;
		var next = zoomIdx + delta;
		if (next < 0) next = 0;
		if (next >= cells.length) next = cells.length - 1;
		if (next !== zoomIdx) {
			zoomIdx = next;
			renderZoom();
		}
	}

	function renderZoom() {
		var cells = previewCells();
		var cell = cells[zoomIdx];
		if (!cell) return;
		var line = cell.querySelector('.hz-line');
		var ch = line && line.firstChild ? (line.firstChild.nodeValue || '') : '';
		var size = Math.round(Math.min(window.innerWidth || 800, window.innerHeight || 600) * 0.6);
		if (size < 120) size = 120;
		var box = byId('zoomCell');
		if (!box) return;
		box.style.width = size + 'px';
		box.style.height = size + 'px';
		box.style.lineHeight = Math.round(size * 1.06) + 'px';
		box.style.fontSize = Math.round(size * 0.72) + 'px';
		box.style.backgroundImage = Z.getZgBackground(Z.Config.ZgType, FIXED.zgColor);
		box.style.backgroundSize = size + 'px ' + size + 'px';
		box.style.color = 'rgba(' + FIXED.inkRgb + ', ' + FIXED.inkAlpha + ')';
		setText(box, ch);
	}

	function initZoom() {
		/* 无按钮：点中间（含字格）退出，点左右各 15% 边缘切换 */
		on(byId('zoomOverlay'), 'click', function (e) {
			var ev = e || window.event;
			var w = window.innerWidth || 800;
			var x = ev.clientX || 0;
			if (x < w * 0.15) { stepZoom(-1); return; }
			if (x > w * 0.85) { stepZoom(1); return; }
			closeZoom();
		});
	}

	/* 点击预览区的字格 → 放大；↑ / ↓ 逐字移动 */
	function cellFromEvent(e) {
		var t = e.target || e.srcElement;
		var preview = byId('printContent');
		while (t && t !== preview) {
			var cn = t.className ? String(t.className) : '';
			if (cn.indexOf('cell') >= 0) return t;
			t = t.parentNode;
		}
		return null;
	}

	function initPreviewZoom() {
		var preview = byId('printContent');
		if (preview) on(preview, 'click', function (e) {
			var cell = cellFromEvent(e || window.event);
			if (!cell) return;
			var idx = Number(cell.getAttribute('data-idx'));
			if (!isNaN(idx)) openZoom(idx);
		});
		on(document, 'keydown', function (e) {
			var ev = e || window.event;
			var key = ev.keyCode || ev.which;
			if (zoomOpen) {
				if (key === 27) { closeZoom(); if (ev.preventDefault) ev.preventDefault(); return; }
				if (key === 37) { stepZoom(-1); if (ev.preventDefault) ev.preventDefault(); return; }
				if (key === 39) { stepZoom(1); if (ev.preventDefault) ev.preventDefault(); return; }
				return;
			}
			if (anyModalOpen()) {
				if (key === 27) { closeAllModals(); if (ev.preventDefault) ev.preventDefault(); }
				return;
			}
			var tag = document.activeElement && document.activeElement.tagName;
			if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
			if (key === 38) { gotoChar(currentIdx - 1); if (ev.preventDefault) ev.preventDefault(); }
			else if (key === 40) { gotoChar(currentIdx + 1); if (ev.preventDefault) ev.preventDefault(); }
		});
	}

	/* ---------- 弹窗：内容 / 字体 / 字格样式 ---------- */
	function modalIds() {
		return ['modalContent', 'modalFont', 'modalZg'];
	}

	function anyModalOpen() {
		var ids = modalIds();
		for (var i = 0; i < ids.length; i++) {
			var m = byId(ids[i]);
			if (m && m.style.display === 'block') return true;
		}
		return false;
	}

	function closeAllModals() {
		var ids = modalIds();
		for (var i = 0; i < ids.length; i++) {
			var m = byId(ids[i]);
			if (m) m.style.display = 'none';
		}
	}

	function openModal(id) {
		closeZoom();
		closeAllModals();
		var m = byId(id);
		if (!m) return;
		if (id === 'modalContent') {
			var textarea = byId('content');
			if (textarea) textarea.value = Z.Config.Content;
		}
		m.style.display = 'block';
	}

	function closeModal(m) {
		if (m) m.style.display = 'none';
	}

	function initModals() {
		on(byId('contentBtn'), 'click', function () { openModal('modalContent'); });
		on(byId('fontBtn'), 'click', function () { openModal('modalFont'); });
		on(byId('zgBtn'), 'click', function () { openModal('modalZg'); });

		var cancels = document.querySelectorAll('.modal-cancel');
		for (var i = 0; i < cancels.length; i++) {
			(function (btn) {
				on(btn, 'click', function () {
					var m = btn.parentNode;
					while (m && !(m.className && String(m.className).indexOf('modal') >= 0)) m = m.parentNode;
					closeModal(m);
					if (m && m.id === 'modalContent') {
						var textarea = byId('content');
						if (textarea) textarea.value = Z.Config.Content;
					}
				});
			})(cancels[i]);
		}

		var modals = document.querySelectorAll('.modal');
		for (var j = 0; j < modals.length; j++) {
			(function (m) {
				on(m, 'click', function (e) {
					var ev = e || window.event;
					if ((ev.target || ev.srcElement) === m) m.style.display = 'none';
				});
			})(modals[j]);
		}

		on(byId('contentDone'), 'click', function () {
			var textarea = byId('content');
			Z.Config.Content = textarea.value;
			Z.Config.save();
			render();
			closeModal(byId('modalContent'));
		});
	}

	function initControls() {
		var textarea = byId('content');
		on(textarea, 'input', handleTextInput);
		on(textarea, 'change', handleTextInput);

		var typeNodes = document.getElementsByName('zgType');
		for (var j = 0; j < typeNodes.length; j++) {
			on(typeNodes[j], 'change', function () {
				var value = getRadioValue('zgType');
				if (value) {
					Z.Config.ZgType = value;
					Z.Config.save();
					render();
				}
			});
		}

		on(byId('applyFontBtn'), 'click', handleFontApply);
		on(byId('sampleBtn'), 'click', applySample);
		on(byId('clearBtn'), 'click', applyClear);
		initModals();
		initZoom();
		initPreviewZoom();
	}

/* 把 Config 同步到表单 */
	function syncForm() {
		var textarea = byId('content');
		textarea.value = Z.Config.Content;
		textarea.maxLength = Z.MAX_CONTENT_LENGTH;
		setRadioValue('zgType', Z.Config.ZgType);

		var fontInput = byId('fontURL');
		if (fontInput) fontInput.value = Z.Config.fontURL;
		applyFont(Z.Config.fontURL);
	}

	function init() {
		Z.Config.load();
		syncForm();
		initControls();
		render();
		loadFontList();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
