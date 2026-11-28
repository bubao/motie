/**
 * 字帖页（M1–M3）：本机字帖的打开 / 另存 / 重命名 / 删除 / 搜索。
 * - 数据来自 library 服务（SQLite documents 表）；内容本身仍是 workspace/*.md|txt（files 服务）；
 * - 进入页面时先把最近文件列表并入索引（幂等），再拉列表；保存/删除后立即并入并刷新；
 * - 「打开…」选择本机 txt/md：读回内容写入 Content 并同步到工作区；
 * - 「另存为…」把当前内容写为工作区字帖（同名需确认覆盖）；
 * - 「重命名」只改列表标题（不动文件名）；「删除」= 移除内容文件 + 索引条目（二次确认）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { pushToast, setContent, setField } from './store.js';
import { sharedClient } from './ipc/client.ts';

const TEXT_EXT_RE = /\.(md|markdown|txt)$/i;

/* 文件名清洗：与 Panel.sanitizeFileName / Go pdf.SafeFilename 同口径 */
function sanitizeFileName(name) {
	return String(name || '').replace(/[\\/:*?"<>|]+/g, '_').trim() || '未命名';
}

/* 保存路径：已带 .txt/.md 后缀则尊重，否则补 .txt（字帖默认纯文本） */
function savePathOf(rawName) {
	var name = sanitizeFileName(rawName);
	if (!TEXT_EXT_RE.test(name)) name += '.txt';
	return 'workspace/' + name;
}

function formatTime(iso) {
	if (!iso) return '';
	var d = new Date(iso);
	if (isNaN(d.getTime())) return '';
	return d.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function DocsPage() {
	const dispatch = useDispatch();
	const config = useSelector(function (s) { return s.config; });
	const [docs, setDocs] = useState([]);
	const [loading, setLoading] = useState(false);
	/* 列表加载失败（U3）：与「还没有字帖」区分开，避免把错误显示成空态 */
	const [loadError, setLoadError] = useState(false);
	const [openingId, setOpeningId] = useState(null);
	const [query, setQuery] = useState('');
	/* 另存为表单：null=收起；{ name, confirm } confirm=true 表示同名待确认覆盖 */
	const [saveBox, setSaveBox] = useState(null);
	/* 行内管理态：renamingId/renameValue 为重命名；deletingId 为待确认删除 */
	const [renamingId, setRenamingId] = useState(null);
	const [renameValue, setRenameValue] = useState('');
	const [deletingId, setDeletingId] = useState(null);
	const openFileRef = useRef(null);

	/* 列表刷新：先把最近文件并入索引，再读取库列表（reindex 失败不阻断展示） */
	var refresh = useCallback(function (q) {
		setLoading(true);
		setLoadError(false);
		var client = sharedClient();
		client.listRecent()
			.then(function (paths) { return client.reindexLibrary(paths || []).catch(function () { return 0; }); })
			.catch(function () { /* 无最近列表也可继续 */ })
			.then(function () { return client.listDocuments(q && q.trim() ? q.trim() : undefined); })
			.then(function (list) { setDocs(Array.isArray(list) ? list : []); })
		.catch(function (err) {
			setLoadError(true);
			dispatch(pushToast({ type: 'error', text: '字帖列表加载失败：' + (err && err.message ? err.message : err) }));
		})
			.then(function () { setLoading(false); });
	}, [dispatch]);

	useEffect(function () { refresh(query); }, [query, refresh]);

	/* 打开：读回内容写入 Content（标题同步为文件名，内容以文件为准） */
	function onOpen(doc) {
		if (openingId) return;
		setOpeningId(doc.id);
		sharedClient().readFile(doc.path)
			.then(function (f) {
				applyContent(f.content, doc.title);
			})
			.catch(function (err) {
				dispatch(pushToast({ type: 'error', text: '打开失败：' + (err && err.message ? err.message : err) }));
			})
			.then(function () { setOpeningId(null); });
	}

	function applyContent(content, title) {
		dispatch(setContent(String(content == null ? '' : content)));
		if (title) dispatch(setField({ key: 'Title', value: title }));
		dispatch(pushToast({ type: 'success', text: title ? '已打开「' + title + '」。' : '已打开字帖。' }));
	}

	/* 打开…：本机文件选择器（与内容页「导入 txt」同链路，桌面端落盘工作区并入库） */
	function onPickFile(e) {
		var file = e.target.files && e.target.files[0];
		e.target.value = ''; /* 允许再次选择同一文件 */
		if (!file) return;
		var reader = new FileReader();
		reader.onload = function () {
			var text = String(reader.result || '');
			applyContent(text, sanitizeFileName(file.name).replace(TEXT_EXT_RE, ''));
			/* 桌面端：落盘到受控 workspace/ 并立即入库（失败不阻断内容载入） */
			sharedClient().writeFile({ path: savePathOf(file.name), content: text })
				.then(function () { refresh(query); })
				.catch(function () { /* 浏览器 mock 之外的环境忽略 */ });
		};
		reader.onerror = function () {
			dispatch(pushToast({ type: 'error', text: '打开失败：无法读取文件。' }));
		};
		reader.readAsText(file, 'utf-8');
	}

	/* 另存为…：写入工作区（同路径已存在 → 二次确认覆盖） */
	function doSave() {
		var name = String(saveBox.name || '');
		if (!sanitizeFileName(name)) {
			dispatch(pushToast({ type: 'info', text: '请先填写字帖名。' }));
			return;
		}
		var path = savePathOf(name);
		var exists = docs.some(function (d) { return d.path === path; });
		if (exists && !saveBox.confirm) {
			setSaveBox({ name: name, confirm: true });
			return;
		}
		sharedClient().writeFile({ path: path, content: String(config.Content == null ? '' : config.Content) })
			.then(function () {
				dispatch(setField({ key: 'Title', value: sanitizeFileName(name).replace(TEXT_EXT_RE, '') }));
				setSaveBox(null);
				dispatch(pushToast({ type: 'success', text: (exists ? '已覆盖' : '已保存') + '「' + sanitizeFileName(name) + '」。' }));
				refresh(query);
			})
			.catch(function (err) {
				dispatch(pushToast({ type: 'error', text: '保存失败：' + (err && err.message ? err.message : err) }));
			});
	}

	/* 重命名：仅改索引标题 */
	function doRename() {
		var title = String(renameValue || '').trim();
		if (!title) {
			dispatch(pushToast({ type: 'info', text: '标题不能为空。' }));
			return;
		}
		var id = renamingId;
		sharedClient().renameDocument(id, title)
			.then(function () {
				dispatch(pushToast({ type: 'success', text: '已重命名为「' + title + '」。' }));
				setRenamingId(null);
				refresh(query);
			})
			.catch(function (err) {
				dispatch(pushToast({ type: 'error', text: '重命名失败：' + (err && err.message ? err.message : err) }));
			});
	}

	/* 收藏切换：收藏项在列表置顶（后端排序，刷新即可见） */
	function onToggleFav(doc) {
		sharedClient().setDocumentFavorite(doc.id, !doc.favorite)
			.then(function () { refresh(query); })
			.catch(function (err) {
				dispatch(pushToast({ type: 'error', text: '收藏失败：' + (err && err.message ? err.message : err) }));
			});
	}

	/* 删除：移除内容文件 + 索引条目（先删文件后删索引，由内核保证） */
	function doDelete() {
		var doc = docs.find(function (d) { return d.id === deletingId; });
		sharedClient().deleteDocument(deletingId)
			.then(function () {
				dispatch(pushToast({ type: 'success', text: '已删除「' + (doc ? doc.title : '') + '」（文件与索引均已移除）。' }));
				setDeletingId(null);
				refresh(query);
			})
			.catch(function (err) {
				dispatch(pushToast({ type: 'error', text: '删除失败：' + (err && err.message ? err.message : err) }));
			});
	}

	return (
		<div className="rp-panel-page">
			<section className="rp-group">
				<h3 className="rp-group-title">我的字帖</h3>
				<div className="rp-field">
					<div className="rp-actions">
						<button type="button" className="rp-btn" onClick={function () { if (openFileRef.current) openFileRef.current.click(); }}
							title="选择本机 txt / md 文件，打开为字帖">
							打开…
						</button>
						<button type="button" className="rp-btn" onClick={function () {
							setSaveBox({ name: config.Title || '', confirm: false });
						}} title="把当前内容保存到工作区（.txt / .md），立即出现在下方列表">
							另存为…
						</button>
						<button type="button" className="rp-btn" disabled={loading} onClick={function () { refresh(query); }} title="把最近文件重新并入索引并刷新列表">
							{loading ? <><span className="rp-spinner" aria-hidden="true" />刷新…</> : '刷新'}
						</button>
						<input
							ref={openFileRef}
							type="file"
							accept=".txt,.md,.markdown,text/plain,text/markdown"
							style={{ display: 'none' }}
							onChange={onPickFile}
						/>
					</div>
					<label htmlFor="docsSearch" className="rp-sr-only">搜索字帖</label>
					<input
						id="docsSearch"
						className="rp-input"
						value={query}
						placeholder="搜索标题 / 路径…"
						onChange={function (e) { setQuery(e.target.value); }}
					/>
					<p className="rp-hint-note">
						内容源为本机 .txt / .md（桌面端存于受控工作区）。点击条目即打开；「重命名」仅改列表标题，「删除」会同时移除文件。
					</p>
					{saveBox ? (
						<div className="rp-docs-savebox">
							<label htmlFor="docSaveName">字帖名（可含 .txt / .md）</label>
							<input
								id="docSaveName"
								className="rp-input"
								value={saveBox.name}
								placeholder="如：春晓 或 春晓.md"
								onChange={function (e) { setSaveBox({ name: e.target.value, confirm: false }); }}
							/>
							{saveBox.confirm ? (
								<p className="rp-hint-note rp-docs-warn">同名「{saveBox.name}」已存在，保存将覆盖其内容。</p>
							) : null}
							<div className="rp-actions">
								<button type="button" className={'rp-btn' + (saveBox.confirm ? ' rp-btn-primary' : '')} onClick={doSave}>
									{saveBox.confirm ? '确认覆盖' : '保存'}
								</button>
								<button type="button" className="rp-btn" onClick={function () { setSaveBox(null); }}>取消</button>
							</div>
						</div>
					) : null}
				</div>
				{docs.length === 0 ? (
					<p className="rp-stats-empty">{loadError
						? '列表加载失败：请确认桌面内核已连接，然后点「刷新」重试。'
						: (query ? '没有匹配的字帖。' : '还没有字帖。点「另存为…」把当前内容存进来，或用「打开…」选本机文件。')}</p>
				) : (
					<ul className="rp-docs-list">
						{docs.map(function (doc) {
							if (renamingId === doc.id) {
								return (
									<li key={doc.id}>
										<div className="rp-docs-row">
											<input
												className="rp-input"
												value={renameValue}
												autoFocus
												placeholder="新的字帖名"
												onChange={function (e) { setRenameValue(e.target.value); }}
											/>
											<div className="rp-docs-actions">
												<button type="button" className="rp-btn rp-btn-primary rp-btn-sm" onClick={doRename}>保存</button>
												<button type="button" className="rp-btn rp-btn-sm" onClick={function () { setRenamingId(null); }}>取消</button>
											</div>
										</div>
									</li>
								);
							}
							if (deletingId === doc.id) {
								return (
									<li key={doc.id}>
										<div className="rp-docs-row rp-docs-deleteline">
											<span className="rp-docs-warn">删除「{doc.title}」后不可恢复（文件一并移除）。</span>
											<div className="rp-docs-actions">
												<button type="button" className="rp-btn rp-btn-primary rp-btn-sm" onClick={doDelete}>确认删除</button>
												<button type="button" className="rp-btn rp-btn-sm" onClick={function () { setDeletingId(null); }}>取消</button>
											</div>
										</div>
									</li>
								);
							}
							return (
								<li key={doc.id}>
									<div className="rp-docs-row">
										<button
											type="button"
											className={'rp-docs-main' + (openingId === doc.id ? ' is-busy' : '')}
											disabled={openingId === doc.id}
											onClick={function () { onOpen(doc); }}
											title={'打开 ' + doc.path}
										>
											<span className="rp-docs-title">{doc.title}</span>
											{openingId === doc.id ? (
												<span className="rp-docs-busy"><span className="rp-spinner" aria-hidden="true" />打开中…</span>
											) : null}
											<span className="rp-docs-meta">
												{doc.chars > 0 ? doc.chars + ' 字 · ' : ''}{formatTime(doc.updated_at)}
											</span>
											<span className="rp-docs-path">{doc.path}</span>
										</button>
									<div className="rp-docs-actions">
										<button
											type="button"
											className={'rp-btn rp-btn-sm rp-star' + (doc.favorite ? ' is-on' : '')}
											title={doc.favorite ? '取消收藏（收藏置顶）' : '收藏（置顶显示）'}
											aria-pressed={!!doc.favorite}
											onClick={function () { onToggleFav(doc); }}
										>
											{doc.favorite ? '★' : '☆'}
										</button>
										<button type="button" className="rp-btn rp-btn-sm" title="重命名（仅改列表标题，不动文件名）"
											onClick={function () { setRenamingId(doc.id); setRenameValue(doc.title); }}>
											改名
										</button>
										<button type="button" className="rp-btn rp-btn-sm" title="删除字帖（移除文件与索引，需确认）"
											onClick={function () { setDeletingId(doc.id); }}>
											删除
										</button>
									</div>
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</section>
		</div>
	);
}
