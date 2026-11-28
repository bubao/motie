/**
 * 分享链接（doc/next-features-todo.md · A1 / roadmap D4）。
 * 把「内容 + 当前模式版式」编码进 URL hash（#s=…），收件人打开链接即见同一张字帖。
 *
 * 载荷 = pickModeSnapshot(cfg)：仅当前模式的版式快照（模板 / 字格 / 页边距 / 行距 /
 * 描红 / 控笔 / 内容与标题等，见 MODE_SNAPSHOT_FIELDS），不含 Theme、字体来源与
 * ModeStates——本地导入的字体在对方设备上不存在，主题跟随打开者自己的偏好。
 *
 * 编码：JSON → UTF-8 字节 → base64url（无填充）。版本化 v1，损坏 / 版本不符一律返回 null，
 * 由调用方忽略并提示。整条 URL 超过 MAX_SHARE_URL_CHARS 时判定超长，UI 引导走 JSON 文件分享。
 */
import { pickModeSnapshot } from './config.js';

export const SHARE_VERSION = 1;
export const SHARE_HASH_KEY = 's';
export const MAX_SHARE_URL_CHARS = 8000;

export function encodeBase64Url(text) {
	var bytes = new TextEncoder().encode(text);
	var bin = '';
	/* String.fromCharCode.apply 有参数数量上限，分块转换 */
	for (var i = 0; i < bytes.length; i += 0x8000) {
		var chunk = bytes.subarray(i, i + 0x8000);
		var arr = [];
		for (var j = 0; j < chunk.length; j++) arr.push(chunk[j]);
		bin += String.fromCharCode.apply(null, arr);
	}
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeBase64Url(b64) {
	var s = String(b64).replace(/-/g, '+').replace(/_/g, '/');
	while (s.length % 4 !== 0) s += '=';
	var bin = atob(s);
	var bytes = new Uint8Array(bin.length);
	for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new TextDecoder('utf-8').decode(bytes);
}

/* 当前文档地址（去掉旧 hash）：兼容 http(s) 部署与 file:// 直开 */
/* base64url 编解码同时供预设分享（presetShare.js）复用。 */

function shareLocationBase() {
	var loc = window.location;
	return loc.protocol + '//' + loc.host + loc.pathname;
}

/**
 * 生成分享链接。
 * 成功：{ ok:true, url, hash, chars }；超长：{ ok:false, reason:'too-long', urlLength, chars }。
 */
export function encodeShare(cfg) {
	var contentLen = cfg && typeof cfg.Content === 'string' ? cfg.Content.length : 0;
	var payload = { v: SHARE_VERSION, d: pickModeSnapshot(cfg || {}) };
	var hash = '#' + SHARE_HASH_KEY + '=' + encodeBase64Url(JSON.stringify(payload));
	var url = shareLocationBase() + hash;
	if (url.length > MAX_SHARE_URL_CHARS) {
		return { ok: false, reason: 'too-long', urlLength: url.length, chars: contentLen };
	}
	return { ok: true, url: url, hash: hash, chars: contentLen };
}

/**
 * 解析 hash / 完整 URL 中的分享载荷，返回可喂给 applyFields 的字段对象（含 Mode）；
 * 无分享标记、载荷损坏或版本不符时返回 null。
 */
export function decodeShare(text) {
	try {
		var raw = String(text == null ? '' : text).trim();
		if (raw.charAt(0) === '#') raw = raw.slice(1);
		if (raw.indexOf(SHARE_HASH_KEY + '=') === 0) raw = raw.slice(SHARE_HASH_KEY.length + 1);
		var payload = JSON.parse(decodeBase64Url(raw));
		if (!payload || payload.v !== SHARE_VERSION) return null;
		var fields = payload.d;
		if (!fields || typeof fields !== 'object' || typeof fields.Mode !== 'string') return null;
		return fields;
	} catch (err) {
		return null;
	}
}

/* 从 location（{ hash }）提取分享字段；无标记或损坏时返回 null */
export function shareFromLocation(loc) {
	var hash = (loc && loc.hash != null ? String(loc.hash) : '') ||
		(typeof window !== 'undefined' && window.location && window.location.hash) || '';
	if (hash.indexOf('#' + SHARE_HASH_KEY + '=') !== 0) return null;
	return decodeShare(hash);
}

/* 复制到剪贴板：优先 Clipboard API，降级 execCommand；返回 Promise<boolean> */
export function copyText(text) {
	return new Promise(function (resolve) {
		if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).then(
				function () { resolve(true); },
				function () { resolve(fallbackCopy(text)); }
			);
			return;
		}
		resolve(fallbackCopy(text));
	});
}

function fallbackCopy(text) {
	try {
		var ta = document.createElement('textarea');
		ta.value = text;
		ta.setAttribute('readonly', '');
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		var ok = document.execCommand && document.execCommand('copy');
		document.body.removeChild(ta);
		return !!ok;
	} catch (err) {
		return false;
	}
}
