/**
 * 预设分享（需求编号 P-a）。
 * 把「具名预设」打包成 URL hash（#p=…）或 JSON 文件，换机 / 分享给朋友后原样导入。
 *
 * 复用 share.js 的 base64url 编码（JSON → UTF-8 字节 → base64url 无填充），版本化 v1，
 * 损坏 / 版本不符一律返回 null，由调用方提示。预设只含版式白名单字段（PRESET_KEYS），
 * 编码前逐字段按 Schema 归一化，导入的数据同样过滤，避免脏键污染配置。
 */
import { encodeBase64Url, decodeBase64Url, MAX_SHARE_URL_CHARS } from './share.js';
import { PRESET_KEYS, normalizeField } from './config.js';

export const PRESET_VERSION = 1;
export const PRESET_HASH_KEY = 'p';
export const PRESETS_KIND = 'zitie.presets';
export const MAX_PRESET_NAME = 30;

/* 单个预设数据归一化：只保留白名单键，逐字段走 Schema 归一化 */
export function normalizePresetData(data) {
	var src = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
	var out = {};
	PRESET_KEYS.forEach(function (k) { out[k] = normalizeField(k, src[k]); });
	return out;
}

/* 整包归一化：丢弃非对象条目与空名称，返回新对象（保持插入顺序） */
function normalizeBundle(input) {
	var src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
	var out = {};
	Object.keys(src).forEach(function (name) {
		var key = String(name == null ? '' : name).trim().slice(0, MAX_PRESET_NAME);
		if (!key) return;
		out[key] = normalizePresetData(src[name]);
	});
	return out;
}

function countOf(presets) {
	return Object.keys(presets || {}).length;
}

/* 当前文档地址（去掉旧 hash），与 share.js 同口径 */
function shareLocationBase() {
	var loc = window.location;
	return loc.protocol + '//' + loc.host + loc.pathname;
}

/**
 * 生成预设分享链接。
 * 成功：{ ok:true, url, hash, count }；超长：{ ok:false, reason:'too-long', urlLength, count }。
 */
export function encodePresetShare(presets) {
	var clean = normalizeBundle(presets);
	var payload = { v: PRESET_VERSION, d: clean };
	var hash = '#' + PRESET_HASH_KEY + '=' + encodeBase64Url(JSON.stringify(payload));
	var url = shareLocationBase() + hash;
	var count = countOf(clean);
	if (url.length > MAX_SHARE_URL_CHARS) return { ok: false, reason: 'too-long', urlLength: url.length, count: count };
	return { ok: true, url: url, hash: hash, count: count };
}

/**
 * 解析预设链接 / hash / base64 文本，返回归一化后的 { presets, count }；无法识别时返回 null。
 * 接受形态：`#p=…`、`p=…`、完整 URL（截取 `#p=` 之后）、纯 base64。
 */
export function decodePresetShare(text) {
	try {
		var raw = String(text == null ? '' : text).trim();
		if (!raw) return null;
		var idx = raw.indexOf('#' + PRESET_HASH_KEY + '=');
		if (idx >= 0) raw = raw.slice(idx + 2 + PRESET_HASH_KEY.length);
		else if (raw.indexOf(PRESET_HASH_KEY + '=') === 0) raw = raw.slice(PRESET_HASH_KEY.length + 1);
		var payload = JSON.parse(decodeBase64Url(raw));
		if (!payload || payload.v !== PRESET_VERSION) return null;
		var presets = normalizeBundle(payload.d);
		return { presets: presets, count: countOf(presets) };
	} catch (err) {
		return null;
	}
}

/* 导出 JSON 文本（带版本与类型标记，便于和设置备份区分） */
export function presetsToJson(presets) {
	return JSON.stringify({ v: PRESET_VERSION, kind: PRESETS_KIND, presets: normalizeBundle(presets) }, null, 2);
}

/**
 * 解析导出的 JSON 文本。
 * 兼容两种形态：标准包 { v, kind, presets } 与裸对象 { 名称: 数据 }。
 * 返回 { presets, count }；不是 JSON / 无任何合法条目时返回 null。
 */
export function parsePresetsJson(text) {
	var data;
	try { data = JSON.parse(String(text == null ? '' : text)); } catch (err) { return null; }
	if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
	var bundle = data.presets && typeof data.presets === 'object' && !Array.isArray(data.presets) ? data.presets : data;
	var presets = normalizeBundle(bundle);
	if (countOf(presets) === 0) return null;
	return { presets: presets, count: countOf(presets) };
}

/* 计算导入合并结果：同名跳过（不覆盖本机已有预设），返回 { added, skipped, merged } */
export function mergePresets(existing, incoming) {
	var base = normalizeBundle(existing);
	var inc = normalizeBundle(incoming);
	var merged = {};
	var added = 0;
	var skipped = 0;
	Object.keys(base).forEach(function (k) { merged[k] = base[k]; });
	Object.keys(inc).forEach(function (k) {
		if (Object.prototype.hasOwnProperty.call(merged, k)) { skipped++; return; }
		merged[k] = inc[k];
		added++;
	});
	return { added: added, skipped: skipped, merged: merged };
}
