import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Panel } from './Panel.jsx';
import { Preview } from './Preview.jsx';
import { ToastHost } from './ToastHost.jsx';
import { usePdfExport } from './usePdfExport.js';
import { setField } from './store.js';

const THEME_NAMES = { light: '浅色', dark: '深色', system: '跟随系统' };
const THEME_KEYS = ['light', 'dark', 'system'];

export default function App() {
	const [pinyinReady, setPinyinReady] = useState(false);
	const fontSource = useSelector(function (s) { return s.config.FontSource; });
	const theme = useSelector(function (s) { return s.config.Theme; });
	const dispatch = useDispatch();
	const { busy, exportPdf } = usePdfExport();

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

	/* 自定义字体：配置真源在 Redux，按来源注入 / 移除（屏幕与 PDF 同步） */
	useEffect(function () {
		window.Zitie.Font.use(fontSource || { type: 'default' });
	}, [fontSource]);

	useEffect(function () {
		let alive = true;
		window.Zitie.loadPinyin()
			.then(function () { if (alive) setPinyinReady(true); })
			.catch(function () { /* 拼音库不可用时格子仍可用，仅无拼音 */ });
		return function () { alive = false; };
	}, []);

	return (
		<div className="rp">
			<header className="rp-topbar no-print">
				<div className="rp-brand">
					<span className="rp-seal" aria-hidden="true">帖</span>
					<span className="rp-brand-name">墨帖</span>
					<span className="rp-brand-version">v{__ZITIE_VERSION__}</span>
				</div>
				<div className="rp-top-actions">
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
					<button type="button" className="rp-btn" disabled={busy} onClick={exportPdf}>
						{busy ? '正在生成 PDF…' : '导出 PDF'}
					</button>
					<button type="button" className="rp-btn rp-btn-primary" onClick={function () { window.print(); }}>
						打印
					</button>
				</div>
			</header>
			<div className="rp-body">
				<Panel />
				<Preview pinyinReady={pinyinReady} />
			</div>
			<ToastHost />
		</div>
	);
}
