/**
 * 第三方资源来源管理：CDN（默认，file:// 直开可用）与本地 vendor（可选）。
 * 本地模式需先运行 `npm run vendor` 下载资源，并且页面需由 http 服务托管
 * （file:// 下浏览器会拦截本地 ESM 的动态 import，届时自动回退 CDN）。
 * 本地文件缺失时自动回退 CDN，并把状态显示到 #assetStatus。
 *
 * 资源来源是全局单例（动态注入只加载一次），由 setResourceMode 切换；
 * 调用方（App）在 config.ResourceMode 变化时同步。
 */

const CDN_URLS = {
	hanziWriter: 'https://cdn.jsdelivr.net/npm/hanzi-writer@2.2.2/dist/hanzi-writer.min.js',
	pinyin: 'https://cdn.jsdelivr.net/npm/pinyin-pro@3.29.5/+esm'
};
/* 注意：动态 import() 在 classic script 中按「脚本自身 URL」解析相对路径，
   因此本地资源统一按 document.baseURI 解析为绝对路径，避免 /vendor/… 404 */
const LOCAL_PATHS = {
	hanziWriter: 'vendor/hanzi-writer.min.js',
	pinyin: 'vendor/pinyin-pro.esm.js'
};
/* 惰性解析：模块在 node（测试打包）中执行时没有 document，避免顶层访问 */
let LOCAL_URLS = null;
const localUrls = () => {
	if (!LOCAL_URLS) {
		LOCAL_URLS = {};
		Object.keys(LOCAL_PATHS).forEach((name) => {
			LOCAL_URLS[name] = new URL(LOCAL_PATHS[name], document.baseURI).href;
		});
	}
	return LOCAL_URLS;
};
const LABELS = { hanziWriter: 'HanziWriter', pinyin: '拼音库' };

let mode = 'cdn';
/* 本地模式下失败（已回退 CDN）的资源 */
let failed = {};
/* 已注入的 HanziWriter 地址，避免重复注入 */
let writerUrl = null;

export const setResourceMode = (next) => {
	mode = next === 'local' ? 'local' : 'cdn';
	failed = {};
};

const isLocal = () => mode === 'local';

const urlOf = (name) => (isLocal() ? localUrls()[name] : CDN_URLS[name]);

const statusEl = () => document.getElementById('assetStatus');

export const renderStatus = () => {
	const el = statusEl();
	if (!el) return;
	const local = isLocal();
	const list = ['hanziWriter', 'pinyin'].filter((name) => failed[name]).map((name) => LABELS[name]);
	if (list.length) {
		/* 失败可见（U3 离线降级）：CDN 模式失败多为离线 / 被拦；本地模式失败会自动回退 CDN */
		el.textContent = local
			? `本地模式：${list.join('、')} 缺失，已回退 CDN。`
			: `CDN 资源加载失败（可能离线）：${list.join('、')}；可切到本地 vendor 或恢复网络后重试。`;
		el.className = 'field-hint field-hint-error';
	} else if (local) {
		el.textContent = '本地 vendor 模式（http 托管可用）；未通过 npm run vendor 下载时会自动回退 CDN。';
		el.className = 'field-hint';
	} else {
		el.textContent = 'CDN 模式（jsDelivr），file:// 直开可用；笔画数据按字从 CDN 加载。';
		el.className = 'field-hint';
	}
};

const markFailed = (name) => {
	failed[name] = true;
	renderStatus();
};

/* 动态注入 <script>，成功 resolve、失败 reject */
const injectScript = (url) => new Promise((resolve, reject) => {
	const script = document.createElement('script');
	script.src = url;
	script.async = true;
	script.onload = () => {
		if (url === urlOf('hanziWriter')) writerUrl = url;
		resolve(url);
	};
	script.onerror = () => {
		if (url === urlOf('hanziWriter')) writerUrl = null;
		reject(new Error(`脚本加载失败：${url}`));
	};
	(document.head || document.documentElement).appendChild(script);
});

/* HanziWriter：动态注入 <script>；本地缺失时回退 CDN。返回 Promise 供调用方等待。
 * 并发调用必须共享同一个加载 Promise：若只在 writerUrl 命中时返回字符串，
 * 后到的调用方（如静态笔顺批量加载多字）会绕过等待，在脚本就绪前误判不可用。 */
let loadingHanzi = null;
export const loadHanziWriter = async () => {
	const target = urlOf('hanziWriter');
	if (writerUrl !== target) {
		writerUrl = target;
		loadingHanzi = null;
	}
	if (!loadingHanzi) {
		loadingHanzi = (async () => {
			try {
				return await injectScript(target);
			} catch {
				markFailed('hanziWriter');
				if (target === CDN_URLS.hanziWriter) return null;
				writerUrl = null;
				try {
					return await injectScript(CDN_URLS.hanziWriter);
				} catch {
					markFailed('hanziWriter');
					return null;
				}
			}
		})();
	}
	return loadingHanzi;
};

/* 切换资源来源后重置 HanziWriter 注入状态（下次按需重新加载） */
export const resetHanziWriter = () => {
	loadingHanzi = null;
	writerUrl = null;
};

/* 拼音库（pinyin-pro）：动态 import；本地缺失时回退 CDN，均失败返回 null */
export const loadPinyinLib = async () => {
	const target = urlOf('pinyin');
	try {
		return await import(/* @vite-ignore */ target);
	} catch {
		if (target === CDN_URLS.pinyin) {
			markFailed('pinyin'); /* CDN 也失败：状态行提示离线降级（U3） */
			return null;
		}
		markFailed('pinyin');
		try {
			return await import(/* @vite-ignore */ CDN_URLS.pinyin);
		} catch {
			markFailed('pinyin');
			return null;
		}
	}
};

/* 外部资源统一出口 */
export const applyAssets = () => {
	failed = {};
	loadHanziWriter();
	renderStatus();
};

/* 供调试：查看当前生效的资源地址 */
export const describeAssets = () => ({
	mode: isLocal() ? 'local' : 'cdn',
	hanziWriter: urlOf('hanziWriter'),
	pinyin: urlOf('pinyin'),
	failed: Object.keys(failed)
});

export { CDN_URLS, LOCAL_PATHS };
