/**
 * 后端探测单测（U6）：detectBackend 的候选顺序、探针判定与端口记忆。
 * 路由级对照见 test/api-contract.test.mjs；此处验证「web 打开时如何找到 Go 内核」。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectBackend, probeBackendPort, readBackendPort, writeBackendPort, clearBackendPort, DEFAULT_BACKEND_PORT, BACKEND_APP_NAME, BACKEND_PORT_KEY } from '../web/src/ipc/client.ts';

const PORT_KEY = 'zitie.backend.port';

function okFetch(body) {
	return { ok: true, json: async function () { return body; } };
}

beforeEach(() => {
	window.localStorage.clear();
	delete window.__MOTIE_DESKTOP__;
	delete window.__MOTIE_BASE_URL__;
	vi.unstubAllGlobals();
});

afterEach(function () {
	vi.unstubAllGlobals();
	delete window.__MOTIE_DESKTOP__;
	delete window.__MOTIE_BASE_URL__;
});

describe('ipc/client：detectBackend', function () {
	it('壳注入最高优先：直接返回注入基址，不做网络探测', async function () {
		window.__MOTIE_DESKTOP__ = true;
		window.__MOTIE_BASE_URL__ = 'http://127.0.0.1:45123';
		const fetchMock = vi.fn(async function () { throw new Error('不应发起探测'); });
		vi.stubGlobal('fetch', fetchMock);

		expect(await detectBackend()).toBe('http://127.0.0.1:45123');
		expect(fetchMock).toHaveBeenCalledTimes(0);
	});

	it('壳注入但缺省基址：返回空串（同源相对路径），不探测', async function () {
		window.__MOTIE_DESKTOP__ = true;
		const fetchMock = vi.fn(async function () { throw new Error('不应发起探测'); });
		vi.stubGlobal('fetch', fetchMock);

		expect(await detectBackend()).toBe('');
		expect(fetchMock).toHaveBeenCalledTimes(0);
	});

	it('探针必须校验 app 字段：可达但非 motie 不算命中', async function () {
		vi.stubGlobal('location', { protocol: 'http:', origin: 'http://127.0.0.1:46001' });
		const fetchMock = vi.fn(async function () { return okFetch({ app: 'other-app', version: 'x' }); });
		vi.stubGlobal('fetch', fetchMock);

		expect(await detectBackend(100)).toBeNull();
		expect(window.localStorage.getItem(PORT_KEY)).toBeNull();
	});

	it('非 2xx 响应不算命中', async function () {
		vi.stubGlobal('location', { protocol: 'http:', origin: 'http://127.0.0.1:46002' });
		vi.stubGlobal('fetch', vi.fn(async function () { return { ok: false, status: 500, json: async function () { return {}; } }; }));

		expect(await detectBackend(100)).toBeNull();
	});

	it('location.origin 命中：返回 origin 并写回端口记忆', async function () {
		vi.stubGlobal('location', { protocol: 'http:', origin: 'http://127.0.0.1:46003' });
		const fetchMock = vi.fn(async function (url) {
			if (url === 'http://127.0.0.1:46003/api/config') return okFetch({ app: BACKEND_APP_NAME });
			throw new Error('unexpected ' + url);
		});
		vi.stubGlobal('fetch', fetchMock);

		expect(await detectBackend(100)).toBe('http://127.0.0.1:46003');
		expect(window.localStorage.getItem(PORT_KEY)).toBe('46003');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('URL ?port= 候选优先于记忆端口与默认端口', async function () {
		window.localStorage.setItem(PORT_KEY, '46099');
		/* file:// 直开（协议非 http(s)）不产生 origin 候选，URL 端口成为首个候选 */
		vi.stubGlobal('location', { protocol: 'file:', origin: 'null', search: '?port=46011', hash: '' });
		const fetchMock = vi.fn(async function (url) {
			if (url === 'http://127.0.0.1:46011/api/config') return okFetch({ app: BACKEND_APP_NAME });
			throw new Error('unexpected ' + url);
		});
		vi.stubGlobal('fetch', fetchMock);

		expect(await detectBackend(100)).toBe('http://127.0.0.1:46011');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		/* 命中后端口记忆被更新为本次实际可用端口 */
		expect(window.localStorage.getItem(PORT_KEY)).toBe('46011');
	});

	it('记忆端口作为回退候选，仍要求探针确认', async function () {
		window.localStorage.setItem(PORT_KEY, '46022');
		vi.stubGlobal('location', { protocol: 'file:', origin: 'null', search: '', hash: '' });
		const seen = [];
		const fetchMock = vi.fn(async function (url) {
			seen.push(url);
			return url === 'http://127.0.0.1:46022/api/config'
				? okFetch({ app: BACKEND_APP_NAME })
				: { ok: false, status: 404, json: async function () { return {}; } };
		});
		vi.stubGlobal('fetch', fetchMock);

		expect(await detectBackend(100)).toBe('http://127.0.0.1:46022');
		expect(seen).toEqual(['http://127.0.0.1:46022/api/config']);
	});

	it('全部候选不可达 → null（本地模式），且不污染端口记忆', async function () {
		window.localStorage.setItem(PORT_KEY, '46033');
		vi.stubGlobal('location', { protocol: 'file:', origin: 'null', search: '', hash: '' });
		vi.stubGlobal('fetch', vi.fn(async function () { return { ok: false, status: 503, json: async function () { return {}; } }; }));

		expect(await detectBackend(100)).toBeNull();
		expect(window.localStorage.getItem(PORT_KEY)).toBe('46033');
	});

	it('重复候选只探测一次（同源 origin 与默认端口相同地址）', async function () {
		vi.stubGlobal('location', { protocol: 'http:', origin: 'http://127.0.0.1:' + DEFAULT_BACKEND_PORT, search: '', hash: '' });
		const fetchMock = vi.fn(async function () { return okFetch({ app: BACKEND_APP_NAME }); });
		vi.stubGlobal('fetch', fetchMock);

		expect(await detectBackend(100)).toBe('http://127.0.0.1:' + DEFAULT_BACKEND_PORT);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	/* 超时（U6 候选）：fetch 挂起时必须由 AbortController 在上限内中止，
	 * 既不能无限期挂住启动，也不能把挂起误判为命中。 */
	function hangingFetch(signals) {
		return vi.fn(function (_url, init) {
			signals.push(init && init.signal);
			return new Promise(function (_resolve, reject) {
				if (init && init.signal) {
					init.signal.addEventListener('abort', function () { reject(new Error('aborted')); });
				}
			});
		});
	}

	it('全部候选超时：按上限中止并回落 null，不改写端口记忆', async function () {
		window.localStorage.setItem(PORT_KEY, '46055');
		vi.stubGlobal('location', { protocol: 'file:', origin: 'null', search: '', hash: '' });
		const signals = [];
		vi.stubGlobal('fetch', hangingFetch(signals));
		const t0 = Date.now();

		expect(await detectBackend(80)).toBeNull();
		const cost = Date.now() - t0;
			/* 两个候选（记忆端口 + 默认端口）各等 80ms；上限 2s 容纳调度开销 */
		expect(cost).toBeLessThan(2000);
		expect(signals.length).toBe(2);
		expect(signals.every(function (s) { return s && s.aborted; })).toBe(true);
		expect(window.localStorage.getItem(PORT_KEY)).toBe('46055');
	});

	it('前一候选超时后继续尝试后续候选并命中，记忆更新为实际可用端口', async function () {
		window.localStorage.setItem(PORT_KEY, '46056');
		vi.stubGlobal('location', { protocol: 'file:', origin: 'null', search: '', hash: '' });
		const signals = [];
		vi.stubGlobal('fetch', vi.fn(function (url, init) {
			if (String(url).indexOf(':46056/') !== -1) return hangingFetch(signals)(url, init);
			return okFetch({ app: BACKEND_APP_NAME });
		}));

		expect(await detectBackend(80)).toBe('http://127.0.0.1:' + DEFAULT_BACKEND_PORT);
		expect(window.localStorage.getItem(PORT_KEY)).toBe(String(DEFAULT_BACKEND_PORT));
	});
});

/* 手动固定内核端口（设置页真源）：写入 / 读回 / 清除与探针。 */
describe('ipc/client：手动内核端口', function () {
	it('writeBackendPort 写合法端口，readBackendPort 读回并落地 localStorage', function () {
		window.localStorage.removeItem(PORT_KEY);
		expect(writeBackendPort(46077)).toBe(true);
		expect(readBackendPort()).toBe(46077);
		expect(window.localStorage.getItem(BACKEND_PORT_KEY)).toBe('46077');
	});

	it('非法端口拒绝写入（0 / 65536 / 负数 / 非数字），不产生脏值', function () {
		window.localStorage.removeItem(PORT_KEY);
		[0, 65536, -1, NaN, 'abc'].forEach(function (bad) {
			expect(writeBackendPort(bad)).toBe(false);
		});
		expect(window.localStorage.getItem(PORT_KEY)).toBeNull();
		expect(readBackendPort()).toBeNull();
	});

	it('clearBackendPort 移除后 read 返回 null', function () {
		writeBackendPort(46078);
		clearBackendPort();
		expect(readBackendPort()).toBeNull();
	});

	it('probeBackendPort 请求该端口的 /api/config 并校验 app= motie', async function () {
		const fetchMock = vi.fn(async function (url) {
			expect(String(url)).toBe('http://127.0.0.1:46079/api/config');
			return okFetch({ app: BACKEND_APP_NAME });
		});
		vi.stubGlobal('fetch', fetchMock);
		expect(await probeBackendPort(46079, 100)).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('probeBackendPort 非法端口直接 false，不发请求', async function () {
		const fetchMock = vi.fn(async function () { return okFetch({ app: BACKEND_APP_NAME }); });
		vi.stubGlobal('fetch', fetchMock);
		expect(await probeBackendPort(70000, 100)).toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(0);
	});
});

/* initSharedClient：探测结果决定共享实例的 transport，并有模块级缓存（每例重置模块）。 */
describe('ipc/client：initSharedClient / backendKind', function () {
	async function freshModule() {
		vi.resetModules();
		return await import('../web/src/ipc/client.ts');
	}

	it('探测命中 → http 模式，isBackendOnline=true，客户端走 HTTP', async function () {
		vi.stubGlobal('location', { protocol: 'http:', origin: 'http://127.0.0.1:46044', search: '', hash: '' });
		let configCalls = 0;
		vi.stubGlobal('fetch', vi.fn(async function (url) {
			if (String(url).indexOf('/api/config') !== -1) {
				configCalls++;
				return okFetch({ app: BACKEND_APP_NAME, version: 'x', port: 46044, config: {} });
			}
			throw new Error('unexpected ' + url);
		}));
		const m = await freshModule();

		const client = await m.initSharedClient(100);
		expect(m.backendKind()).toBe('http');
		expect(client).toBe(await m.initSharedClient(100)); /* 幂等：返回同一实例 */
		await client.getConfig();
		expect(configCalls).toBeGreaterThanOrEqual(1); /* 第二个 /api/config 来自 getConfig */
	});

	it('全部不可达 → mock 模式，isBackendOnline=false，getConfig 读本地默认', async function () {
		vi.stubGlobal('location', { protocol: 'file:', origin: 'null', search: '', hash: '' });
		const fetchMock = vi.fn(async function () { return { ok: false, status: 503, json: async function () { return {}; } }; });
		vi.stubGlobal('fetch', fetchMock);
		const m = await freshModule();

		const client = await m.initSharedClient(100);
		expect(m.backendKind()).toBe('mock');
		const cfg = await client.getConfig();
		expect(cfg.Theme).toBeTypeOf('string'); /* MockTransport 的内存默认配置 */
	});
});
