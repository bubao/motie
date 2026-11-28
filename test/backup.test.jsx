/**
 * 数据备份（E3）单测：编码 / 解析校验 / 合并语义。
 * 快照结构对齐 MockTransport.persist 写出的 zitie.mock.v1。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	MOCK_STATE_KEY,
	encodeBackup,
	parseBackup,
	mergeBackup,
	readSnapshot
} from '../web/src/core/backup.ts';

function writeSnapshot(snap) {
	window.localStorage.setItem(MOCK_STATE_KEY, JSON.stringify(snap));
}

beforeEach(function () {
	window.localStorage.clear();
});

describe('core/backup：导出与解析', function () {
	it('无持久化快照时导出返回 null（无可信备份源）', function () {
		expect(encodeBackup()).toBeNull();
	});

	it('encode → parse 往返：字段齐全、summary 计数正确', function () {
		writeSnapshot({
			config: { Theme: 'dark', Content: '天地玄黄' },
			files: { 'workspace/春晓.txt': { path: 'workspace/春晓.txt', content: '春眠不觉晓' } },
			recent: ['workspace/春晓.txt'],
			documents: [{ id: 1, path: 'workspace/春晓.txt', title: '春晓', chars: 5, favorite: false, archived: false }],
			nextDocId: 2,
			presets: { 横版: { Template: '横版' } }
		});
		var text = encodeBackup(new Date('2026-11-27T10:00:00.000Z'));
		expect(typeof text).toBe('string');
		var parsed = parseBackup(text);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.payload.app).toBe('motie');
		expect(parsed.payload.kind).toBe('zitie-backup');
		expect(parsed.payload.version).toBe(1);
		expect(parsed.payload.exportedAt).toBe('2026-11-27T10:00:00.000Z');
		expect(parsed.summary).toEqual({ configFields: 2, presets: 1, files: 1, documents: 1, recent: 1 });
		expect(parsed.payload.config.Theme).toBe('dark');
	});

	it('解析拒绝：非法 JSON / 非本应用 / 类型不符 / 版本不符 / 容器损坏', function () {
		expect(parseBackup('not json').ok).toBe(false);
		var base = {
			app: 'motie', kind: 'zitie-backup', version: 1, exportedAt: '',
			config: {}, files: {}, recent: [], documents: [], nextDocId: 1, presets: {}
		};
		expect(parseBackup(JSON.stringify(Object.assign({}, base, { app: 'other' }))).ok).toBe(false);
		expect(parseBackup(JSON.stringify(Object.assign({}, base, { kind: 'other' }))).ok).toBe(false);
		expect(parseBackup(JSON.stringify(Object.assign({}, base, { version: 2 }))).ok).toBe(false);
		expect(parseBackup(JSON.stringify(Object.assign({}, base, { documents: {} }))).ok).toBe(false);
		expect(parseBackup(JSON.stringify(Object.assign({}, base, { recent: 'x' }))).ok).toBe(false);
		expect(parseBackup(JSON.stringify(Object.assign({}, base, { config: [] }))).ok).toBe(false); /* 数组不是对象容器 */
		expect(parseBackup(JSON.stringify(Object.assign({}, base, { files: [] }))).ok).toBe(false);
		/* 合法但缺省：补默认容器 */
		var ok = parseBackup(JSON.stringify({ app: 'motie', kind: 'zitie-backup', version: 1 }));
		expect(ok.ok).toBe(true);
	});
});

describe('core/backup：合并语义', function () {
	it('配置覆盖但保留本机草稿；预设 / 文件 / 字帖同名跳过；字帖 id 冲突重分配；recent 并集去重', function () {
		writeSnapshot({
			config: { Theme: 'dark', Title: '本机标题', Content: '本机草稿' },
			files: { 'a.txt': { path: 'a.txt', content: 'AAA' } },
			recent: ['a.txt'],
			documents: [{ id: 1, path: 'd1.txt', title: 'D1', chars: 2, favorite: true, archived: false }],
			nextDocId: 5,
			presets: { A: { Template: '横版' } }
		});
		var payload = {
			app: 'motie', kind: 'zitie-backup', version: 1, exportedAt: '',
			config: { Theme: 'light', Title: '包标题', Content: '包内容' },
			files: {
				'a.txt': { path: 'a.txt', content: '包内同路径' },
				'b.txt': { path: 'b.txt', content: 'BBB' }
			},
			recent: ['b.txt', 'a.txt'],
			documents: [
				{ id: 1, path: 'd2.txt', title: 'D2', chars: 3, favorite: false, archived: false },
				{ id: 7, path: 'd1.txt', title: '包内同路径', chars: 2, favorite: false, archived: false }
			],
			nextDocId: 6,
			presets: { A: { Template: '竖版' }, B: { Template: '横版' } }
		};

		var result = mergeBackup(payload);
		expect(result).not.toBeNull();
		if (!result) return;
		expect(result.addedPresets).toBe(1);      /* B */
		expect(result.skippedPresets).toBe(1);    /* A 同名 */
		expect(result.addedFiles).toBe(1);        /* b.txt */
		expect(result.skippedFiles).toBe(1);      /* a.txt 已存在 */
		expect(result.addedDocuments).toBe(1);    /* d2.txt（id 冲突重分配） */
		expect(result.skippedDocuments).toBe(1);  /* d1.txt 已存在 */
		expect(result.mergedRecent).toBe(2);

		var snap = readSnapshot();
		/* 配置：包内字段覆盖本机，但当前草稿（Content / Title）保留本机——与 SettingsIO 同策略 */
		expect(snap.config.Theme).toBe('light');
		expect(snap.config.Title).toBe('本机标题');
		expect(snap.config.Content).toBe('本机草稿');
		/* 预设：A 不被包内值覆盖，B 新增 */
		expect(snap.presets.A.Template).toBe('横版');
		expect(snap.presets.B.Template).toBe('横版');
		/* 文件：a.txt 内容不被覆盖，b.txt 新增 */
		expect(snap.files['a.txt'].content).toBe('AAA');
		expect(snap.files['b.txt'].content).toBe('BBB');
		/* 字帖：d2 获得不与既有 id 冲突的新 id */
		var d2 = snap.documents.filter(function (d) { return d.path === 'd2.txt'; })[0];
		expect(d2).toBeTruthy();
		expect(Number(d2.id)).not.toBe(1);
		expect(snap.documents).toHaveLength(2);
		/* recent：包内顺序前置并去重 */
		expect(snap.recent.slice(0, 2)).toEqual(['b.txt', 'a.txt']);
		expect(result.nextDocId).toBeGreaterThanOrEqual(Number(d2.id) + 1);
	});

	it('空快照上合并：全部按新增处理，字帖 id 原样保留', function () {
		var payload = {
			app: 'motie', kind: 'zitie-backup', version: 1, exportedAt: '',
			config: { Theme: 'light', Title: '包标题', Content: '包内容' },
			files: { 'x.txt': { path: 'x.txt', content: 'X' } },
			recent: ['x.txt'],
			documents: [{ id: 3, path: 'x.txt', title: 'X', chars: 1, favorite: false, archived: false }],
			nextDocId: 4,
			presets: { P: { Template: '横版' } }
		};
		var result = mergeBackup(payload);
		expect(result).not.toBeNull();
		if (!result) return;
		expect(result.addedFiles).toBe(1);
		expect(result.addedDocuments).toBe(1);
		var snap = readSnapshot();
		expect(snap.config.Theme).toBe('light');
		/* 本机无草稿时，包内 Content / Title 原样生效 */
		expect(snap.config.Content).toBe('包内容');
		expect(snap.config.Title).toBe('包标题');
		expect(snap.documents[0].id).toBe(3);
		expect(result.nextDocId).toBe(4);
	});
});
