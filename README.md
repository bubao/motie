# 墨帖（motie）

一款纯前端字帖工具，两个版本定位不同：**完整版**（React + Vite，构建为 `dist/index.html` 单文件）用来**做字帖**（现代浏览器；含拼音标注、笔顺动画与 PDF 导出，`file://` 直开可用）；**练字版** `lite/index.html` 用来**练字**（单文件、离线，专为 Kindle 等黑白墨水屏精简：固定整页描红，设置收进弹窗，点击字格放大）。两版共享内容解析与字格 / 字体等核心实现，但练字版不读完整版的模板 / 颜色 / 拼音等偏好，行为固定、产物约 28 KB。

## 版本选择

| 功能 | 完整版 `dist/index.html` | 练字版 `lite/index.html` |
| --- | --- | --- |
| 适用环境 | 现代浏览器（Chrome / Edge / Firefox / Safari） | Kindle 实验浏览器及其他老式浏览器 |
| 定位 | 做字帖（生成 / 打印 / 导出 PDF），也可练字 | 练字（离线，黑白屏精简） |
| 排版模板 | ✓（正常 / 整页描红 / 一字三描红 / 首字范字 / 空临格） | ✗（固定整页描红） |
| 字格渲染（完整版 7 种样式 / 3 种颜色 / 大小） | ✓ | ✓（其中 4 种样式，固定灰色 80px） |
| 拼音标注 | ✓（pinyin-pro，联网按需加载） | ✗ |
| 笔顺动画 | ✓ | ✗（墨水屏无动画，老式浏览器负荷大） |
| 文字颜色 / 深浅 | ✓（朱砂 / 墨色 / 赭石，深浅可调） | ✗（固定墨色描红） |
| 版式微调（每行格数 / 行距 / 字距 / 标题） | ✓ | ✗（固定版式，无标题） |
| 自定义字体 | ✓（本地字体库 + 网络地址） | ✓（地址 + 服务字体列表） |
| 换行与分页 | ✓（换行分段，空行分页） | ✓（同左） |
| 导出 PDF | ✓（A4，jsPDF，已编译绑定） | ✗ |
| 字数上限 | 5000 | 5000 |
| 外部依赖 | PDF 已打进产物；笔顺 / 拼音默认走 CDN（jsDelivr），`npm run build -- --vendor` 可构建离线部署包（仅笔顺笔画数据除外） | 无，单文件自包含 |
| JS / CSS | React 18 + Redux Toolkit，构建为单文件 | ES5 + 常规 CSS |
| 设置持久化 | localStorage（键 `zitie.config`，两版共用） | localStorage（仅内容 / 字格样式 / 字体地址，其余固定；不可用时自动忽略） |

两个版本都能练字：练字版固定「整页描红」（汉字浅色、字格灰色），打印后照着练；完整版可在「版式」里切换模板，效果一致。做字帖、需要笔顺演示或导出 PDF 时请用完整版。

### 自动识别浏览器

打开 `dist/index.html` 时，入口内联的检测脚本（原 `js/detect.js`，已迁移）会在页面加载前完成检测并自动选择版本：

1. **能力探测**：检测 CSS 变量（`var()`）、Promise、`URL` 构造器、`Array.from`、`Object.assign`、`replaceChildren`、动态 `import()`、Unicode 属性转义（`\p{Script=Han}`）；
2. **UA 特征**：`kindle / silk / netfront / kobo / nook / pocketbook / boox / onyx / ireader / tolino / bookeen / storytel` 等墨水屏 / 老式阅读设备（即使探测通过也优先用练字版）；
3. 命中任一条件 → 自动跳转到 `lite/index.html`；否则留在完整版。

可用 URL 参数手动覆盖：`?force=modern` 强制留在完整版、`?force=lite` 强制去练字版、`?nodetect=1` 关闭自动跳转（调试用）。

## 功能特性

- **排版模板**：正常（全深色范字）、整页描红、一字三描红（每行前 N 格深色范字 + 其余浅色）、首字范字（每行首字深色 + 其余浅色）、空临格（只有字格，供对照临写）；完整版用缩略图点选（练字版固定整页描红）
- **字格**：完整版 7 种样式（田字格 / 米字格 / 米字格加回字框 / 回字格 / 拼音格 / 作文格 / 数字格）× 3 种颜色（绿 / 灰 / 红），大小 56–120 px；练字版为其中 4 种（田 / 米 / 米字回 / 回），固定灰色 80px
- **文字样式**：颜色（朱砂 / 墨色 / 赭石）与深浅（15%–100%）独立于字格颜色（练字版固定墨色、不可调）
- **版式**：每行格数（0 = 按纸张自适应，锁定后整行居中）、行距、字距、内容标题（居中，打印与 PDF 同步；练字版固定版式、无标题）
- **拼音标注**：字格上方显示带声调拼音（完整版按需加载 pinyin-pro；练字版不提供）
- **笔顺动画**：点击字格放大单字并逐笔演示（HanziWriter，笔画数据按字从 CDN 加载，加载失败自动降级为静态放大；支持 Esc / 点击遮罩关闭）
- **默认楷体字形**：字帖正文默认使用系统楷体（Kaiti SC / 楷体），更贴近书写练习
- **设置持久化**：内容、模板、字格、文字自动保存到浏览器本地（统一键 `zitie.config`，兼容旧键 `zitie-lite.config`）；练字版只保存内容 / 字格样式 / 字体地址，其余固定
- **一键打印 / 导出 PDF**：自动隐藏操作面板与装饰，仅输出字帖内容；完整版还可按当前设置直接生成 A4 PDF 文件
- **零图片请求**：字格背景由代码动态生成 SVG data URI，不依赖静态图片资源

## 使用方法

1. 构建后直接把 `dist/index.html` 拖进浏览器打开即可（`file://` 也能正常工作；PDF 已编译绑定，笔顺 / 拼音默认走 CDN）。
2. 或在项目目录执行 `npm run dev`，访问 <http://localhost:5173/> 预览（Vite 开发服务器）。
3. 在左侧输入汉字内容、选模板、调字格与版式，右侧实时预览。
4. 点击「打印字帖」，或使用 `Ctrl / Cmd + P`；在打印对话框中选择「另存为 PDF」也可以。完整版可直接点击「导出 PDF」生成 A4 PDF 文件。

## 练字版（Kindle）说明

- **定位练字**：为 Kindle 等黑白墨水屏精简——固定「整页描红」，汉字浅色、字格灰色；没有颜色 / 深浅 / 模板 / 拼音 / 标题等控件。做字帖（笔顺演示、导出 PDF）请使用完整版。
- **设置收进弹窗**：顶栏「内容 / 字体 / 字格」三个按钮各自打开弹窗（内容输入、字体地址 + 服务字体列表、字格样式 田 / 米 / 米字回 / 回），预览区不被占用。
- **预览交互**：点击字格 → 遮罩放大该字；点中间字格退出，点左 / 右边缘（各约 15%）切换上一个 / 下一个字（← / → 键后备，Esc 也可退出）；按 ↑ / ↓ 逐字移动并高亮当前字（`.cell.is-current`）；输入框聚焦时不拦截按键。
- **目标环境**：Kindle 实验浏览器（WebKit / NetFront 内核，仅支持 ES5 与常规 CSS，可能禁用 localStorage）。
- **产物**：`lite/index.html`——CSS 与 JS 全部内联，约 28 KB，**无需联网、可离线打开**，也可复制这一个文件单独分发。
- **固定参数**：整页描红、墨色 `35,38,43`、描红深浅 0.62、格子 80 px、字格灰色，不读取完整版的配置残留（内容 / 字格样式 / 字体地址除外）。

### 服务模式（Kindle 可用字体）

Kindle 实验浏览器不支持 IndexedDB，无法用完整版的本地字体库。执行 `npm run serve` 后：

- 标准版 <http://127.0.0.1:8080/index.html>：字体管理器里点「发布」，把本地字体上传到服务端 `dist/font/`（仅 http 服务模式下显示该按钮）。
- Kindle 打开 <http://127.0.0.1:8080/lite/index.html>（或启动时打印的局域网地址）：字体区会列出服务端字体，点击即通过网络加载应用；`file://` 直开时无服务，列表自动隐藏。
- 服务端文件名限 ASCII（老浏览器 `@font-face` 对中文路径支持差），中文显示名由发布时一并上传并在列表展示。

### 本地运行与构建

```bash
npm install          # 安装构建依赖（Vite / React / esbuild 等）
npm run dev          # Vite 开发服务器（http://localhost:5173）
npm run build        # 生成 dist/（完整版单文件 + 练字版）；加 -- --vendor 构建离线部署包
npm run build:react  # 仅完整版多文件产物（dist-react/，http 部署）
npm run build:lite   # 仅重新生成 lite/index.html（练字版）
npm run vendor       # 下载 hanzi-writer / pinyin-pro 到 vendor/
npm run serve        # 启动本地服务（dist/，0.0.0.0:8080），供 Kindle 等访问字体
```

`dist/` 与 `lite/` 均已 gitignore，由构建生成；`lite/index.html` 是唯一需要分发给 Kindle 的文件。

## 技术说明

- **完整版**：React 18 + Redux Toolkit（设置状态单一 store），Vite 构建；`npm run build` 用 `vite-plugin-singlefile` 产出单文件 `dist/index.html`（CSS / JS 全部内联），`file://` 直开可用；`npm run build:react` 保留多文件产物，便于 http 部署。
- **练字版**：ES5 + 常规 CSS，esbuild 打包为单文件 IIFE，离线可用。
- **版本号**：构建时从 `package.json` 注入产物——完整版 head 带 `<meta name="zitie-version">`、面板底部显示版本；练字版同 meta。
- **共享核心**：`js/config.js`（配置读写、模板/颜色常量、字体清洗）、`js/content.js`（内容解析 / 分页 / 模板角色）、`js/zg-bg.js`（字格 SVG，7 种样式）、`js/sheet-layout.js`（版式真源：折行 / 分页 / 标题占位）是框架无关代码；`js/core.js` 是 ESM 命名导出层，供完整版 `import`，练字版由构建打包内联（`lite-src/main.js` 顶部 import）——两版共用内容解析、字格渲染与字体加载实现；练字版固定整页描红，不使用模板 / 拼音 / 颜色相关逻辑。
- **排版模板**：由 `Z.SheetLayout.compute()` 统一计算，屏幕预览（`web/src/Preview.jsx`）、PDF 导出（`js/pdf.js`）与打印（`css/main.css` 的 `@media print`）三处同源。
- **模块**：
  - `js/config.js`：常量、默认值、模板/颜色定义与 localStorage 配置读写
  - `js/content.js`：内容模型（换行分段、空行分页、页数估算）与排版模板角色
  - `js/sheet-layout.js`：版式真源（`Z.SheetLayout.compute()`）
  - `js/assets.js`：HanziWriter / 拼音的 CDN 与本地 vendor 来源管理（按需注入）
  - `js/zg-bg.js`：字格 SVG 背景生成与缓存
  - `js/pinyin.js`：拼音标注与状态提示
  - `js/stroke.js`：笔顺动画封装（HanziWriter 按需注入与降级）
  - `js/pdf.js`：A4 PDF 导出（jsPDF 由完整版构建时编译绑定，经 `Z.Pdf.setJsPdf` 注入）
- **第三方库**：jsPDF 2.5.1（npm，编译绑定进完整版产物）、HanziWriter 2.2.2（笔顺，CDN / vendor）、pinyin-pro 3.29.5（拼音，CDN / vendor）。`pinyin-util` 曾为练字版内联依赖，T5 精简后已不再使用（保留在 package.json 未清理）。
- **打印**：`@page` 设置 A4 边距；预览界面（`.no-print`）在打印时隐藏，只输出字帖内容；分页用 `break-after: page`，文字颜色用 `print-color-adjust: exact` 保留。

## 目录结构

```text
zitie/
├── web/              # 完整版源码（React + Redux，Vite root）
│   ├── index.html    # 入口（内联浏览器检测，老设备自动跳练字版）
│   └── src/          # main.jsx / App.jsx / Panel.jsx / Preview.jsx / BigPreview.jsx / store.js / styles.css
├── css/main.css      # 字格 / 分页 / 打印样式（两版共用）
├── js/               # 共享核心（classic script + core.js ESM 层）
├── dist/             # 完整版构建产物（单文件，gitignore）
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

## 常见问题

**Q：字格为什么不是图片？**
A：字格背景由代码生成 SVG data URI（7 种样式 × 3 种颜色，同组合缓存复用；练字版使用其中 4 种），零图片请求、任意缩放清晰。

**Q：支持哪些汉字？**
A：渲染支持全部汉字（含生僻字，按 Unicode 汉字判定与代理对拆分）；拼音仅完整版提供（pinyin-pro，覆盖广，超出范围的字不显示拼音、字格照常），练字版不提供拼音。

**Q：如何生成 PDF？**
A：完整版点击「导出 PDF」，按当前设置（内容 / 模板 / 文字 / 字格 / 版式）逐页渲染为 A4；也可直接打印后「另存为 PDF」。

**Q：Kindle 上应该用哪个版本？**
A：默认自动跳转（能力探测 + 墨水屏 UA 特征）；也可用 `?force=lite` 强制。练字版为单文件、离线，专为老式 / 墨水屏浏览器精简（无动画、无拼音、无外部请求）。

**Q：练字用哪个版本？描红怎么开？**
A：两个版本都能练字。完整版在「版式」里点选 5 种模板（含整页描红）；练字版为墨水屏精简，固定「整页描红」、不可切换模板，只保留内容 / 字体 / 字格样式。内容、字格样式与字体地址保存在统一配置键 `zitie.config`，其余偏好练字版固定。做字帖、导出 PDF 用完整版。

**Q：练字版能导出 PDF 吗？**
A：不能。练字版为离线单文件设计；PDF 导出请在完整版使用。

## 安全 / 许可

- 纯静态工具，无后端、无遥测；所有偏好均保存在本机浏览器。
- 自定义字体地址仅接受 http(s) 或相对路径，避免 CSS 注入；本地字体走 IndexedDB 导入。
- 第三方库均来自公开 CDN（jsDelivr），也可用 `npm run vendor` 本地化；PDF 组件已编译绑定进产物。
