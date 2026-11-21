# 技术说明

## 框架与构建

- **完整版**：React 18 + Redux Toolkit（设置状态单一 store），Vite 构建；`npm run build` 用 `vite-plugin-singlefile` 产出单文件 `dist/index.html`（CSS / JS 全部内联），`file://` 直开可用；`npm run build:react` 保留多文件产物，便于 http 部署。
- **练字版**：ES5 + 常规 CSS，esbuild 打包为单文件 IIFE，离线可用。
- **版本号**：构建时从 `package.json` 注入产物——完整版 head 带 `<meta name="zitie-version">`、面板底部显示版本；练字版同 meta。

## 共享核心

`js/config.js`（配置读写、模板/颜色常量、字体清洗）、`js/content.js`（内容解析 / 分页 / 模板角色）、`js/zg-bg.js`（字格 SVG，7 种样式）、`js/sheet-layout.js`（版式真源：折行 / 分页 / 标题占位）是框架无关代码；`js/core.js` 是 ESM 命名导出层，供完整版 `import`，练字版由构建打包内联（`lite-src/main.js` 顶部 import）——两版共用内容解析、字格渲染与字体加载实现；练字版固定整页描红，不使用模板 / 拼音 / 颜色相关逻辑。

**排版模板**由 `Z.SheetLayout.compute()` 统一计算，屏幕预览（`web/src/Preview.jsx`）、PDF 导出（`js/pdf.js`）与打印（`css/main.css` 的 `@media print`）三处同源。

## 模块清单

- `js/config.js`：常量、默认值、模板/颜色定义与 localStorage 配置读写
- `js/content.js`：内容模型（换行分段、空行分页、页数估算）与排版模板角色
- `js/sheet-layout.js`：版式真源（`Z.SheetLayout.compute()`）
- `js/assets.js`：HanziWriter / 拼音的 CDN 与本地 vendor 来源管理（按需注入）
- `js/zg-bg.js`：字格 SVG 背景生成与缓存
- `js/pinyin.js`：拼音标注与状态提示
- `js/stroke.js`：笔顺动画封装（HanziWriter 按需注入与降级）
- `js/pdf.js`：A4 PDF 导出（jsPDF 由完整版构建时编译绑定，经 `Z.Pdf.setJsPdf` 注入）

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
│   └── src/          # main.jsx / App.jsx / Panel.jsx / Preview.jsx / BigPreview.jsx / store.js / styles.css
├── css/main.css      # 字格 / 分页 / 打印样式（两版共用）
├── js/               # 共享核心（classic script + core.js ESM 层）
├── dist/             # 完整版构建产物（单文件；核心离线，拼音 / 笔顺走 CDN；gitignore）
├── dist-react/       # 完整版多文件产物（gitignore）
├── lite/             # 练字版构建产物（gitignore）
│   └── index.html    # 单文件（离线可用）
├── lite-src/         # 练字版源码（构建输入）
│   ├── main.js       # ES5 主逻辑（import 共享核心）
│   ├── style.css
│   └── template.html
├── tools/
│   ├── build.js      # 产物构建：dist/（完整版单文件 + 练字版，可选 vendor）
│   ├── build-lite.js # 练字版单文件打包（esbuild）
│   └── vendor.js     # 下载第三方库到 vendor/
├── doc/              # 设计文档
└── README.md
```
