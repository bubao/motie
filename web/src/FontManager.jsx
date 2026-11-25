/**
 * 字体管理器（T3.3）：本地字体导入 / 预览 / 重命名 / 启用禁用 / 删除 / 应用，
 * 并保留网络字体地址与系统默认字体。
 * - 浏览器模式：二进制存 IndexedDB（FontStore），元数据存 localStorage（zitie.fonts）；
 * - 桌面模式：字体库在 Go 内核（fonts 服务，落盘应用数据目录），本组件全部走 IPC，
 *   二进制经 /api/fonts/file/<id> 取回注入（见 font.js setLocalResolver）；
 * - 应用状态写 Redux（FontSource），实际注入由 App 订阅调 Font.use；
 * - 预览为每个本地字体注入独立 family（ziti-prev-<id>），卸载时移除。
 */
import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { pushToast, setField, setFontSource, store } from './store.js';
import { FontStore, Font, loadLocalBuffer, sanitizeFontURL, FONT_WEIGHT_NUM } from './core/index.js';
import { sharedClient, isDesktopEnv } from './ipc/client.ts';

const FONT_EXT_RE = /\.(ttf|otf|woff2?)$/i;
const MAX_FONT_SIZE = 20 * 1024 * 1024;
const MAX_NAME = 30;

function formatSize(bytes) {
	var n = Number(bytes) || 0;
	if (n < 1024) return n + ' B';
	if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
	return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function makeId() {
	return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function storeReady() {
	return !!(FontStore && FontStore.available && FontStore.available());
}

function previewCapable() {
	return typeof FontFace !== 'undefined' && !!(document.fonts && document.fonts.add);
}

/* 仅 http(s) 服务模式下才可发布到服务端 font/（file:// 无服务可写；桌面端不需要） */
var isHttp = typeof window !== 'undefined' && !!window.location &&
	(window.location.protocol === 'http:' || window.location.protocol === 'https:');

var FONT_TYPE_EXT = { 'font/ttf': '.ttf', 'font/otf': '.otf', 'font/woff': '.woff', 'font/woff2': '.woff2' };

export function FontManager() {
	const dispatch = useDispatch();
	const config = useSelector(function (s) { return s.config; });
	const desktop = isDesktopEnv();
	const [fonts, setFonts] = useState(function () {
		return !desktop && storeReady() ? FontStore.loadMeta() : [];
	});
	const [systemFonts, setSystemFonts] = useState([]);
	const [urlValue, setUrlValue] = useState(config.fontURL || '');
	const [hint, setHint] = useState('');
	const [busy, setBusy] = useState(false);
	const [renamingId, setRenamingId] = useState(null);
	const [renameValue, setRenameValue] = useState('');
	const fileRef = useRef(null);
	/* toast 的「重试」可能晚于多次渲染才被点击，需调用最新闭包 */
	const applyUrlRef = useRef(null);

	var current = config.FontSource || { type: 'default' };
	var ready = storeReady();

	/* 初始加载：桌面从内核取字体库；浏览器读 localStorage 元数据 */
	useEffect(function () {
		var alive = true;
		if (desktop) {
			sharedClient().listFonts()
				.then(function (lib) {
					if (!alive) return;
					setFonts(lib.user || []);
					setSystemFonts(lib.system || []);
				})
				.catch(function () { /* 内核不可达时保持空列表 */ });
		} else {
			setFonts(storeReady() ? FontStore.loadMeta() : []);
		}
		return function () { alive = false; };
	}, [desktop]);

	function refreshFonts(next) {
		setFonts(next || []);
	}

	function currentName() {
		if (current.type === 'local') {
			var hit = fonts.filter(function (f) { return f.id === current.id; })[0];
			return hit ? hit.name : '本地字体';
		}
		if (current.type === 'system') return current.name || '系统字体';
		if (current.type === 'url') return '网络字体';
		return '系统默认字体';
	}

	function currentTag() {
		if (current.type === 'local') return '本地';
		if (current.type === 'system') return '系统';
		if (current.type === 'url') return '网络';
		return '系统';
	}

	/* 预览字样输入框用当前生效字体渲染：默认系统楷体，网络 / 本地 / 系统走注入 */
	function previewFontStack() {
		var s = config.FontSource || { type: 'default' };
		if (s.type === 'system' && s.name) return "'" + s.name + "', var(--font-kai)";
		return s.type === 'default' ? 'var(--font-kai)' : "'ziti', var(--font-kai)";
	}

	/* 预览：为每个本地字体注入独立 family（浏览器 IndexedDB / 桌面内核文件），卸载时移除 */
	useEffect(function () {
		if (!previewCapable()) return undefined;
		var faces = [];
		var alive = true;
		fonts.forEach(function (f) {
			if (!f || !f.id) return undefined;
			Promise.resolve(loadLocalBuffer(f.id)).then(function (buffer) {
				if (!alive || !buffer) return undefined;
				try {
					var face = new FontFace('ziti-prev-' + f.id, buffer, { style: 'normal', weight: String(FONT_WEIGHT_NUM[config.FontWeight] || 400) });
					document.fonts.add(face);
					faces.push(face);
					return face.load();
				} catch (e) {
					return undefined;
				}
			}).catch(function () { /* 单个字体不可读时仅该预览降级 */ });
		});
		return function () {
			alive = false;
			faces.forEach(function (face) {
				try { document.fonts.delete(face); } catch (e) { /* 忽略 */ }
			});
		};
	}, [fonts, config.FontWeight]);

	/* 失败时恢复当前生效来源（App 订阅也会再注入一次，幂等） */
	function restoreCurrent() {
		Font.use(store.getState().config.FontSource || { type: 'default' }, { weight: store.getState().config.FontWeight });
	}

	function applyUrl() {
		var clean = sanitizeFontURL(urlValue);
		if (urlValue.trim() && !clean) {
			setHint('字体地址无效：仅支持 http(s) 字体或相对路径。');
			return;
		}
		if (!clean) {
			resetDefault();
			return;
		}
		setHint('正在验证字体…');
		Font.use({ type: 'url', url: clean }, { weight: config.FontWeight }).then(function (ok) {
			if (ok) {
				dispatch(setFontSource({ type: 'url', url: clean }));
				setHint('');
				dispatch(pushToast({ type: 'success', text: '已应用网络字体。' }));
			} else {
				restoreCurrent();
				setHint('字体加载失败：地址无效或文件不可达。');
				dispatch(pushToast({
					type: 'error',
					text: '字体加载失败：地址无效或文件不可达。',
					action: { label: '重试', onClick: function () { applyUrlRef.current(); } }
				}));
			}
		});
	}
	applyUrlRef.current = applyUrl;

	function resetDefault() {
		dispatch(setFontSource({ type: 'default' }));
		setUrlValue('');
		setHint('');
		dispatch(pushToast({ type: 'success', text: '已恢复默认字体。' }));
	}

	/* 系统字体（桌面扫描结果）：CSS 层直接生效 */
	function applySystem(name) {
		if (!name || busy) return;
		Font.use({ type: 'system', name: name }, { weight: config.FontWeight }).then(function (ok) {
			if (ok) {
				dispatch(setFontSource({ type: 'system', name: name }));
				dispatch(pushToast({ type: 'success', text: '已应用系统字体「' + name + '」。' }));
			} else {
				restoreCurrent();
				dispatch(pushToast({ type: 'error', text: '系统字体「' + name + '」不可用。' }));
			}
		});
	}

	function onImport(e) {
		var files = Array.prototype.slice.call((e.target && e.target.files) || []);
		e.target.value = ''; /* 允许再次选择同一文件 */
		if (!files.length) return;
		if (desktop) {
			if (!files.length) return;
			setBusy(true);
			var tasks = files.map(function (file) {
				var name = String(file.name || '');
				if (!FONT_EXT_RE.test(name)) return Promise.resolve({ ok: false, name: name, reason: '格式不支持' });
				if (file.size > MAX_FONT_SIZE) return Promise.resolve({ ok: false, name: name, reason: '超过 20MB' });
				var label = name.replace(/\.[^.]+$/, '') || '未命名字体';
				return sharedClient().addFont(file, name, label)
					.then(function (entry) { return { ok: true, entry: entry }; })
					.catch(function () { return { ok: false, name: name, reason: '内核导入失败' }; });
			});
			Promise.all(tasks).then(function (results) {
				setBusy(false);
				var failed = results.filter(function (r) { return !r.ok; });
				if (failed.length) {
					dispatch(pushToast({
						type: 'error',
						text: '导入失败：' + failed.map(function (r) { return r.name + '（' + r.reason + '）'; }).join('、') + '。'
					}));
				}
				sharedClient().listFonts().then(function (lib) {
					refreshFonts(lib.user || []);
					if (results.some(function (r) { return r.ok; })) {
						dispatch(pushToast({ type: 'success', text: '已导入 ' + results.filter(function (r) { return r.ok; }).length + ' 个字体。' }));
					}
				});
			});
			return;
		}
		if (!ready) {
			setHint('当前环境不支持本地字体存储，可使用网络字体或系统字体。');
			return;
		}
		setBusy(true);
		var browserTasks = files.map(function (file) {
			var name = String(file.name || '');
			if (!FONT_EXT_RE.test(name)) return Promise.resolve({ ok: false, name: name, reason: '格式不支持' });
			if (file.size > MAX_FONT_SIZE) return Promise.resolve({ ok: false, name: name, reason: '超过 20MB' });
			var id = makeId();
			var meta = { id: id, name: name.replace(/\.[^.]+$/, '') || '未命名字体', size: file.size };
			return FontStore.put({ id: id, name: meta.name, size: file.size, blob: file })
				.then(function () { return { ok: true, meta: meta }; })
				.catch(function () { return { ok: false, name: name, reason: '存储失败' }; });
		});
		Promise.all(browserTasks).then(function (results) {
			var added = results.filter(function (r) { return r.ok; });
			if (added.length) {
				var meta = FontStore.loadMeta().concat(added.map(function (r) { return r.meta; }));
				FontStore.saveMeta(meta);
				setFonts(meta);
			}
			var failed = results.filter(function (r) { return !r.ok; });
			if (failed.length) {
				dispatch(pushToast({
					type: 'error',
					text: '导入失败：' + failed.map(function (r) { return r.name + '（' + r.reason + '）'; }).join('、') + '。'
				}));
			}
			if (added.length) {
				dispatch(pushToast({ type: 'success', text: '已导入 ' + added.length + ' 个字体。' }));
			}
			setBusy(false);
		});
	}

	function applyLocal(f) {
		if (!f || f.disabled || busy) return;
		setBusy(true);
		Font.use({ type: 'local', id: f.id }, { weight: config.FontWeight }).then(function (ok) {
			setBusy(false);
			if (ok) {
				dispatch(setFontSource({ type: 'local', id: f.id }));
				setHint('');
				dispatch(pushToast({ type: 'success', text: '已应用字体「' + f.name + '」。' }));
			} else {
				restoreCurrent();
				dispatch(pushToast({ type: 'error', text: '字体「' + f.name + '」加载失败，已回退。' }));
			}
		});
	}

	function toggleEnabled(f) {
		var meta = fonts.map(function (x) {
			return x.id === f.id ? Object.assign({}, x, { disabled: !x.disabled }) : x;
		});
		FontStore.saveMeta(meta);
		setFonts(meta);
		/* 停用正被应用的字体时恢复默认 */
		if (!f.disabled && current.type === 'local' && current.id === f.id) {
			dispatch(setFontSource({ type: 'default' }));
		}
		dispatch(pushToast({ type: 'success', text: f.disabled ? '已启用字体「' + f.name + '」。' : '已停用字体「' + f.name + '」。' }));
	}

	function removeFont(f) {
		if (desktop) {
			sharedClient().removeFont(f.id).then(function () {
				sharedClient().listFonts().then(function (lib) { refreshFonts(lib.user || []); });
				if (current.type === 'local' && current.id === f.id) {
					dispatch(setFontSource({ type: 'default' }));
				}
				dispatch(pushToast({ type: 'success', text: '已删除字体「' + f.name + '」。' }));
			}).catch(function () {
				dispatch(pushToast({ type: 'error', text: '删除失败：' + f.name + '。' }));
			});
			return;
		}
		FontStore.remove(f.id).then(function () {
			var meta = fonts.filter(function (x) { return x.id !== f.id; });
			FontStore.saveMeta(meta);
			setFonts(meta);
			if (current.type === 'local' && current.id === f.id) {
				dispatch(setFontSource({ type: 'default' }));
			}
			dispatch(pushToast({ type: 'success', text: '已删除字体「' + f.name + '」。' }));
		}).catch(function () {
			dispatch(pushToast({ type: 'error', text: '删除失败：' + f.name + '。' }));
		});
	}

	/* 发布到服务端 font/，供 Kindle / lite 版网络获取（仅浏览器 http 服务模式） */
	function publishFont(f) {
		if (!isHttp || desktop || busy) return;
		setBusy(true);
		FontStore.get(f.id).then(function (entry) {
			if (!entry || !entry.blob) throw new Error('字体二进制不可读');
			var ext = entry.blob.type && FONT_TYPE_EXT[entry.blob.type] ? FONT_TYPE_EXT[entry.blob.type] : '.ttf';
			var fromName = String(f.name || '').trim().replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.[A-Za-z0-9]+$/, '');
			if (!fromName || /^_+$/.test(fromName)) fromName = String(f.id || 'font').replace(/[^A-Za-z0-9._-]/g, '');
			var base = (fromName || 'font').slice(0, 40);
			var name = base + ext;
			return fetch('/api/fonts', {
				method: 'POST',
				headers: { 'X-Filename': encodeURIComponent(name), 'X-Label': encodeURIComponent(f.name || name) },
				body: entry.blob
			}).then(function (res) {
				if (!res.ok) throw new Error(res.status === 413 ? '超过服务 20MB 上限' : '服务返回 ' + res.status);
				return res.json();
			});
		}).then(function () {
			setBusy(false);
			dispatch(pushToast({ type: 'success', text: '已发布「' + f.name + '」，Kindle 版刷新后可见。' }));
		}).catch(function (e) {
			setBusy(false);
			dispatch(pushToast({ type: 'error', text: '发布失败：' + f.name + '（' + (e && e.message ? e.message : '服务不可用') + '）。' }));
		});
	}

	function startRename(f) {
		setRenamingId(f.id);
		setRenameValue(f.name);
	}

	function commitRename(f) {
		var name = renameValue.trim().slice(0, MAX_NAME);
		setRenamingId(null);
		if (!name || name === f.name) return;
		if (desktop) {
			sharedClient().renameFont(f.id, name).then(function () {
				sharedClient().listFonts().then(function (lib) { refreshFonts(lib.user || []); });
				dispatch(pushToast({ type: 'success', text: '已重命名为「' + name + '」。' }));
			}).catch(function () {
				dispatch(pushToast({ type: 'error', text: '重命名失败：' + f.name + '。' }));
			});
			return;
		}
		var meta = fonts.map(function (x) { return x.id === f.id ? Object.assign({}, x, { name: name }) : x; });
		FontStore.saveMeta(meta);
		setFonts(meta);
		dispatch(pushToast({ type: 'success', text: '已重命名为「' + name + '」。' }));
	}

	function onPreviewText(e) {
		dispatch(setField({ key: 'PreviewText', value: e.target.value }));
	}

	return (
		<section className="rp-group">
			<h3 className="rp-group-title">字体管理</h3>

			<div className="rp-field">
				<label htmlFor="currentFont">当前字体</label>
				<p className="rp-font-current" id="currentFont">
					<span className="rp-font-current-name">{currentName()}</span>
					<span className="rp-font-current-tag">{currentTag()}</span>
				</p>
				{current.type !== 'default' && (
					<div className="rp-actions">
						<button type="button" className="rp-btn" onClick={resetDefault}>恢复默认字体</button>
					</div>
				)}
			</div>

			<div className="rp-field">
				<label htmlFor="previewText">预览字样</label>
				<input
					id="previewText"
					className="rp-input rp-font-preview-input"
					style={{ fontFamily: previewFontStack(), fontWeight: FONT_WEIGHT_NUM[config.FontWeight] || 400 }}
					maxLength={40}
					placeholder="天地玄黄，宇宙洪荒"
					value={config.PreviewText}
					onChange={onPreviewText}
				/>
				<p className="rp-hint-note">字样同步用于下方字体预览；留空显示「永」。</p>
			</div>

			{desktop && (
				<div className="rp-field">
					<label htmlFor="systemFont">系统字体</label>
					<div className="rp-row">
						<select
							id="systemFont"
							className="rp-input"
							value=""
							onChange={function (e) { if (e.target.value) applySystem(e.target.value); }}
						>
							<option value="">选择系统字体…</option>
							{systemFonts.map(function (f) {
								return <option key={f.name} value={f.name}>{f.name}</option>;
							})}
						</select>
						<button
							type="button"
							className="rp-btn rp-btn-primary"
							disabled={busy}
							onClick={function () {
								var sel = document.getElementById('systemFont');
								if (sel && sel.value) applySystem(sel.value);
							}}
						>
							应用
						</button>
					</div>
					<p className="rp-hint-note">来自 macOS 系统字体扫描（仅名称）；屏幕 / 打印 / PDF 同源生效。</p>
				</div>
			)}

			{ready || desktop ? (
				<div className="rp-field">
					<label>本地字体</label>
					<div className="rp-actions">
						<button type="button" className="rp-btn rp-btn-primary" disabled={busy} onClick={function () { if (fileRef.current) fileRef.current.click(); }}>
							导入字体
						</button>
					</div>
					<input
						ref={fileRef}
						type="file"
						accept=".ttf,.otf,.woff,.woff2"
						multiple
						style={{ display: 'none' }}
						onChange={onImport}
					/>
					{fonts.length === 0 ? (
						<p className="rp-hint-note">
							{desktop ? '尚未导入本地字体。导入后字体文件保存在本机应用数据目录，预览与导出均可用。' : '尚未导入本地字体。导入后字体文件保存在本机浏览器存储中，刷新仍可用。'}
						</p>
					) : (
						<ul className="rp-font-list">
							{fonts.map(function (f) {
								var isActive = current.type === 'local' && current.id === f.id;
								return (
									<li key={f.id} className={'rp-font-item' + (f.disabled ? ' is-disabled' : '') + (isActive ? ' is-active' : '')}>
										<span className="rp-font-preview" style={{ fontFamily: "'ziti-prev-" + f.id + "'" }}>
											{config.PreviewText || '永'}
										</span>
										<span className="rp-font-info">
											<span className="rp-font-name">{f.name}</span>
											<span className="rp-font-meta">{formatSize(f.size)}{f.disabled ? ' · 已停用' : ''}</span>
										</span>
										{renamingId === f.id ? (
											<span className="rp-font-ops">
												<input
													id={'font-name-' + f.id}
													className="rp-input"
													maxLength={MAX_NAME}
													value={renameValue}
													onChange={function (e) { setRenameValue(e.target.value); }}
												/>
												<button type="button" className="rp-btn" onClick={function () { commitRename(f); }}>确定</button>
												<button type="button" className="rp-btn" onClick={function () { setRenamingId(null); }}>取消</button>
											</span>
										) : (
											<span className="rp-font-ops">
												<button
													type="button"
													className="rp-btn"
													disabled={isActive || busy || f.disabled}
													onClick={function () { applyLocal(f); }}
												>
													{isActive ? '使用中' : '应用'}
												</button>
												<button type="button" className="rp-btn" onClick={function () { startRename(f); }}>改名</button>
												{isHttp && !desktop && (
													<button
														type="button"
														className="rp-btn"
														disabled={busy || f.disabled}
														title="发布到服务字体目录，Kindle 版刷新后可获取"
														onClick={function () { publishFont(f); }}
													>
														发布
													</button>
												)}
												{!desktop && (
													<button type="button" className="rp-btn" onClick={function () { toggleEnabled(f); }}>
														{f.disabled ? '启用' : '停用'}
													</button>
												)}
												<button type="button" className="rp-btn" onClick={function () { removeFont(f); }}>删除</button>
											</span>
										)}
									</li>
								);
							})}
						</ul>
					)}
				</div>
			) : (
				<div className="rp-field">
					<label>本地字体</label>
					<p className="rp-hint-note">当前环境不支持本地字体存储，可使用网络字体或系统字体。</p>
				</div>
			)}

			<div className="rp-field">
				<label htmlFor="fontURL">网络字体地址（可选）</label>
				<input
					id="fontURL"
					className="rp-input"
					value={urlValue}
					placeholder="https://…/kaiti.woff2"
					onChange={function (e) { setUrlValue(e.target.value); }}
				/>
				<div className="rp-actions">
					<button type="button" className="rp-btn rp-btn-primary" onClick={applyUrl}>应用字体</button>
					<button type="button" className="rp-btn" onClick={resetDefault}>恢复默认</button>
				</div>
				{hint && <p className="rp-hint-note">{hint}</p>}
			</div>
		</section>
	);
}
