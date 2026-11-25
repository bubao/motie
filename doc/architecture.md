# 技术说明

## 框架与构建

- **完整版**：React 18 + Redux Toolkit（设置状态单一 store），Vite 构建；`npm run build` 用 `vite-plugin-singlefile` 产出单文件 `dist/index.html`（CSS / JS 全部内联），`file://` 直开可用；`npm run build:react` 保留多文件产物，便于 http 部署。
- **练字版**：ES5 + 常规 CSS，esbuild 打包为单文件 IIFE，离线可用。
- **版本号**：构建时从 `package.json` 注入产物——完整版 head 带 `<meta name="zitie-version">`、面板底部显示版本；练字版同 meta。

## 共享核心

标准版核心全部在 `web/src/core/`（纯逻辑 ESM，无全局命名空间）：`config.js`（配置读写、模板/颜色常量、字体清洗）、`content.js`（内容解析 / 分页 / 模板角色）、`zg-bg.js`（字格 SVG，7 种样式）、`sheet-layout.js`（版式真源：折行 / 分页 / 标题占位）、`font-store.js` / `font.js`（字体仓库与注入）、`assets.js`（HanziWriter / 拼音的 CDN 与本地 vendor 来源管理）、`pinyin.js`（拼音标注）、`stroke-order.js`（笔顺动画与字形数据封装；与 `stroke-library.js` 的笔画剪影图案库区分）、`pdf.js`（A4 PDF 导出）。组件与 hooks 一律通过 `web/src/core/index.js` 显式 `import`。

练字版不引用 `web/src/core/`，而是在 `lite-src/vendor/` 保留四个独立副本（config / content / zg-bg / font），由 `lite-src/main.js` 顶部 import；两版共用内容解析、字格渲染与字体加载实现，练字版固定整页描红，不使用模板 / 拼音 / 颜色相关逻辑。

**排版模板**由 `SheetLayout.compute()` 统一计算，屏幕预览（`web/src/Preview.jsx`）、PDF 导出（`web/src/core/pdf.js`）与打印（`css/main.css` 的 `@media print`）三处同源。

## 模块清单

- `web/src/core/config.js`：常量、默认值、模板/颜色定义与 localStorage 配置读写（`loadConfig` / `saveConfig` / 预设函数）
- `web/src/core/content.js`：内容模型（换行分段、空行分页、页数估算）与排版模板角色
- `web/src/core/sheet-layout.js`：版式真源（`SheetLayout.compute()`）
- `web/src/core/zg-bg.js`：字格 SVG 背景生成与缓存
- `web/src/core/font-store.js` / `font.js`：本地字体仓库（IndexedDB）与三种来源注入
- `web/src/core/assets.js`：HanziWriter / 拼音的 CDN 与本地 vendor 来源管理（按需注入）
- `web/src/core/pinyin.js`：拼音标注与状态
- `web/src/core/stroke-order.js`：笔顺动画封装（HanziWriter 按需注入与降级）
- `web/src/core/stroke-library.js`：17 种基本笔画矢量剪影库（笔画字帖模式，非汉字字形数据）
- `web/src/core/pdf.js`：A4 PDF 导出（jsPDF 构建时编译绑定，经 `initPdf` 注入）
- `web/src/hooks/useSheetLayout.js` / `useZgBackground.js`：版式与字格背景的 React 封装

## 第三方库

jsPDF 2.5.1（npm，编译绑定进完整版产物）、HanziWriter 2.2.2（笔顺，CDN / vendor）、pinyin-pro 3.29.5（拼音，CDN / vendor）。`pinyin-util` 曾为练字版内联依赖，T5 精简后已不再使用，依赖已从 `package.json` 移除。

## 打印

`@page` 设置 A4 边距；预览界面（`.no-print`）在打印时隐藏，只输出字帖内容；分页用 `break-after: page`，文字颜色用 `print-color-adjust: exact` 保留。

屏幕预览纸张按 96dpi 真实像素显示（宽 `Page.width`、页边距 `Margin` 均按 mm→px 内联），窄区横向滚动；打印时宽度 / 内边距交还 `@page`，保证屏幕 / 打印 / PDF 三端一致。

## 目录结构

```text
zitie/
├── web/              # 完整版源码（React + Redux，Vite root）
│   ├── index.html    # 入口（内联浏览器检测，老设备自动跳练字版）
│   └── src/
│       ├── core/     # 纯逻辑 ESM 核心（config / content / sheet-layout / zg-bg / font / assets / pinyin / stroke-order / stroke-library / pdf）
│       ├── hooks/    # useSheetLayout / useZgBackground
│       └── *.jsx      # main.jsx / App.jsx / Panel.jsx / Preview.jsx / BigPreview.jsx / store.js / styles.css
├── css/main.css      # 字格 / 分页 / 打印样式（两版共用）
├── dist/             # 完整版构建产物（单文件；核心离线，拼音 / 笔顺走 CDN；gitignore）
├── dist-react/       # 完整版多文件产物（gitignore）
├── lite/             # 练字版构建产物（gitignore）
│   └── index.html    # 单文件（离线可用）
├── lite-src/         # 练字版源码（构建输入）
│   ├── main.js       # ES5 主逻辑（import ./vendor/ 独立副本）
│   ├── vendor/       # 与 web/src/core 同源的四个独立副本（config / content / zg-bg / font）
│   ├── style.css
│   └── template.html
├── tools/
│   ├── build.js      # 产物构建：dist/（完整版单文件 + 练字版，可选 vendor）
│   ├── build-lite.js # 练字版单文件打包（esbuild）
│   └── vendor.js     # 下载第三方库到 vendor/
├── doc/              # 设计文档
└── README.md
```
