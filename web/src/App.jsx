import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Panel } from './Panel.jsx';
import { Preview } from './Preview.jsx';
import { ToastHost } from './ToastHost.jsx';
	import { usePdfExport } from './usePdfExport.js';
import { useImageExport } from './useImageExport.js';
	import { usePrint } from './usePrint.js';
import { pushToast, setField } from './store.js';
import { Font, loadPinyin, setResourceMode, applyAssets } from './core/index.js';

const THEME_NAMES = { light: '浅色', dark: '深色', system: '跟随系统' };
const THEME_KEYS = ['light', 'dark', 'system'];

export default function App() {
	const [pinyinReady, setPinyinReady] = useState(false);
	/* 打印范围（D3）：'' = 全部页；文本传给 Preview 解析并在打印时隐藏未选中页 */
	const [printRange, setPrintRange] = useState('');
	const fontSource = useSelector(function (s) { return s.config.FontSource; });
	const fontWeight = useSelector(function (s) { return s.config.FontWeight; });
	const resourceMode = useSelector(function (s) { return s.config.ResourceMode; });
	const theme = useSelector(function (s) { return s.config.Theme; });
	/* 接入模式（U6）：mock = 本地模式，顶栏明示数据仅存本机、管理功能不可用 */
	const backend = useSelector(function (s) { return s.ui && s.ui.backend ? s.ui.backend : 'init'; });
	const dispatch = useDispatch();
	const { busy, progress, exportPdf } = usePdfExport();
	const { busy: imgBusy, progress: imgProgress, exportPng } = useImageExport();
	const print = usePrint();

	/* 外观：light / dark / system。system 时跟随系统并监听变化（打印仍白底，见 css/main.css） */
	useEffect(function () {
		function apply() {
			var dark = theme === 'dark' ||
				(theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
			document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
		}
		apply();
		if (theme !== 'system' || !window.matchMedia) return undefined;
		var mq = window.matchMedia('(prefers-color-scheme: dark)');
		var onChange = function () { apply(); };
		if (mq.addEventListener) mq.addEventListener('change', onChange);
		else if (mq.addListener) mq.addListener(onChange);
		return function () {
			if (mq.removeEventListener) mq.removeEventListener('change', onChange);
			else if (mq.removeListener) mq.removeListener(onChange);
		};
	}, [theme]);

	/* 自定义字体：配置真源在 Redux，按来源注入 / 移除（屏幕与 PDF 同步）；字重随 FontWeight 变化。
	 * 系统字体不可用时 Font.use 内部回退默认字体（clear），这里补一条提示（同名字体不重复提示）。 */
	var warnedSystemRef = useRef(null);
	useEffect(function () {
		var src = fontSource || { type: 'default' };
		if (src.type !== 'system') {
			warnedSystemRef.current = null;
			Font.use(src, { weight: fontWeight });
			return undefined;
		}
		Font.use(src, { weight: fontWeight }).then(function (ok) {
			if (ok || warnedSystemRef.current === src.name) return;
			warnedSystemRef.current = src.name;
			dispatch(pushToast({ type: 'error', text: '系统字体「' + src.name + '」不可用，已回退默认字体。' }));
		});
		return undefined;
	}, [fontSource, fontWeight, dispatch]);

	/* 第三方资源来源：CDN / 本地 vendor 为全局单例，切换后重新加载并刷新状态行 */
	useEffect(function () {
		setResourceMode(resourceMode);
		applyAssets();
	}, [resourceMode]);

	/* 拼音库不可用（离线 / CDN 被拦）时明确告知：功能降级为「不显示拼音」，不影响打印与导出。
	 * 只提示一次（该 effect 仅挂载时运行），避免每个字重复弹提示。 */
	useEffect(function () {
		let alive = true;
		loadPinyin()
			.then(function () { if (alive) setPinyinReady(true); })
			.catch(function () {
				if (!alive) return;
				dispatch(pushToast({
					type: 'info',
					text: '拼音库加载失败（可能处于离线状态）：已省略拼音，字帖内容仍可正常打印与导出。'
				}));
			});
		return function () { alive = false; };
	}, [dispatch]);

	return (
		<div className="rp">
			{/* 跳转链接（U1）：键盘用户首 Tab 即达字帖预览区 */}
			<a href="#rp-main" className="rp-skip-link">跳到字帖预览</a>
			<header className="rp-topbar no-print">
				<div className="rp-brand">
					<span className="rp-seal" aria-hidden="true">帖</span>
					<span className="rp-brand-name">墨帖</span>
					<span className="rp-brand-version">v{__ZITIE_VERSION__}</span>
				</div>
				{/* 输出动作已移入「输出」页（P2-7）：顶栏只留品牌与主题 */}
				<div className="rp-top-actions">
					{backend === 'mock' ? (
						<span className="rp-backend-chip" title="未检测到桌面内核：配置 / 字体 / 字帖仅保存在本机浏览器存储中——刷新仍在，但不跟随账号、换设备不保留。">本地模式</span>
					) : null}
					<div className="rp-theme" role="group" aria-label="主题">
						{THEME_KEYS.map(function (k) {
							return (
								<button
									type="button"
									key={k}
									className={theme === k ? 'is-active' : ''}
									aria-pressed={theme === k}
									onClick={function () { dispatch(setField({ key: 'Theme', value: k })); }}
								>
									{THEME_NAMES[k]}
								</button>
							);
						})}
					</div>
				</div>
			</header>
			<div className="rp-body">
				<Panel
					pdfBusy={busy}
					pdfProgress={progress}
					onExportPdf={exportPdf}
					pngBusy={imgBusy}
					pngProgress={imgProgress}
					onExportPng={exportPng}
					onPrint={print}
					printRangeValue={printRange}
					onPrintRangeChange={setPrintRange}
				/>
				<Preview pinyinReady={pinyinReady} printRange={printRange} />
			</div>
			<ToastHost />
		</div>
	);
}
