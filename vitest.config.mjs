import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
/* 与 vite.config.mjs 一致：版本号来自 package.json，供组件渲染与断言 */
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

/**
 * 组件层测试配置（T2.6）。
 * 与 vite.config.mjs 分离：root 用项目根（测试文件在 test/，组件在 web/src/），
 * 环境 jsdom（store.js 顶层读 localStorage、组件用 DOM）。
 * 只扫描 test 下的 .test.jsx，避免命中 node 脚本式测试（shared/esm/toast）。
 */
export default defineConfig({
	plugins: [react()],
	define: { __ZITIE_VERSION__: JSON.stringify(VERSION) },
	test: {
		environment: 'jsdom',
		include: ['test/**/*.test.jsx']
	}
});
