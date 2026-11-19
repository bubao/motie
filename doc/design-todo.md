# 墨帖（motie）设计 TODO 与改进规划

> 本文档是项目的下一阶段设计清单，按「断裂点诊断 → 目标设计 → 分阶段 TODO」组织。
> 约定：每项给出**目标 / 改动文件 / 验收命令**；实现顺序按 P0 → P3，逐项推进，做完一项更新状态再进下一项。
> 代码风格延续现状：classic script + `Zitie` 全局命名空间；共享核心保持 ES5 框架无关。

---

## 1. 现状回顾

已经完成（第一阶段至第三阶段）：

- 双版本：完整版 `index.html`（做字帖）+ 练字版 `lite/index.html`（Kindle/老浏览器，单文件离线）。
- 设备/能力检测与自动跳转：`js/detect.js`。
- 共享核心：`js/config.js`（配置）、`js/content.js`（内容模型 / 分页 / 模板角色）、`js/zg-bg.js`（字格 SVG），两版同源。
- 5 种排版模板：正常 / 整页描红 / 一字三描红 / 首字范字 / 空临格。
- 文字样式：颜色（朱砂/墨色/赭石）× 深浅，独立于字格颜色。
- 版式：每行格数（0=自适应，锁定居中）、行距、字距、内容标题。
- 输出：打印（`@page` + `no-print`）、PDF（jsPDF，A4）。
- 拼音（完整版 pinyin-pro / 练字版 pinyin-util）、笔顺动画、本地字体导入（IndexedDB）。
- 改名：产品名「墨帖 / motie」，目录仍 `zitie`。

当前问题不在"缺功能"，而在**几处真源没有贯通**：配置字段、版式计算、设置面板在两版/三端各自重复实现，已经出现过单位换算错误这类漂移。下一步的重点是**收敛真源**，再扩展能力。

---

## 2. 设计原则

1. **单一真源**：同一个概念只定义一次。配置字段走 schema，版式走 layout，模板角色走 `cellRole`。
2. **共享核心框架无关**：共享代码保持 ES5、无依赖，完整版 `<script>` 引入、练字版 esbuild 打包，两版同口径。
3. **可用性优先于炫技**：老浏览器保证"能练字"，现代浏览器再增强（动画、PDF）。
4. **设置可迁移**：偏好不仅能存本机，还能导出/导入、做预设。
5. **可验证**：共享纯函数有测试；构建产物可冒烟。

---

## 3. 断裂点诊断

| # | 断裂点 | 证据（现状） | 影响 | 优先级 |
| --- | --- | --- | --- | --- |
| D1 | **配置字段无 schema**：字段的默认值、范围、读写、UI 同步分散在 `config.js`、`app.js`、`lite-src/main.js`、`index.html` | 新增一个版式字段要改 5 处；行距/字距/深浅曾出现"滑杆值未除 100"的漂移（`app.js` 事件处理） | 易漏易错，两版行为可能不一致 | P0 |
| D2 | **版式计算三套**：屏幕（CSS 变量 + `is-fixed-cols max-content`）、打印（`@page` + `break-after`）、PDF（`pdf.js` 手算 `pageLayout`/`paginate`） | 标题占位、行距、锁定列数、分页在多处各算一次；PDF 标题仅第一页、打印标题分页行为未统一 | 三端输出可能不一致，改一处要同步三处 | P0 |
| D3 | **设置层两版重复**：`app.js` 与 `lite-src/main.js` 各自 `syncControls` + 事件绑定 + 模板/颜色选择 | 同一段"配置 → 控件"逻辑写两遍 | 维护成本翻倍，已出现 lite 下拉匹配问题 | P1 |
| D4 | **模板只是枚举**：`TEMPLATE_ROLE` 只表达"范字/描红/空临"，无法表达"几描几临"、"是否笔顺"、"红黑格" | `normal/trace/trace3/lead/blank` 五个固定项 | 专业字帖所需组合（3 描 2 临、逐字递减、红黑格）无法表达 | P2 |
| D5 | **可访问性缺口**：`#previewOverlay` 无焦点管理（打开不聚焦、Esc 不关、焦点不返还）；滑杆无 `aria-valuetext` | `render.js` BigPreview；`index.html` range 控件 | 键盘/读屏用户不可用 | P1 |
| D6 | **无自动化测试**：共享核心是纯函数（`parse/paginate/pageLayout/cellRole/normalize*`）却无测试 | 项目无 `test/`，`package.json` 无 `test` 脚本 | 重构无回归保障 | P0 |
| D7 | **内容生产能力弱**：仅一个 textarea，无导入/导出、无例文、无重复字统计、无字音/笔顺预览 | `index.html` 字帖内容区 | 做字帖效率低 | P1 |
| D8 | **设置不可移植**：只存 `localStorage`，无法备份/分享，无多套预设 | `js/config.js` | 换设备/换浏览器即丢；无法保存"硬笔/软笔"方案 | P1 |
| D9 | **PDF 质量与元信息**：位图 2×、无页码/无文档标题、字体未嵌入（依赖系统楷体） | `js/pdf.js` | 跨设备打开字体可能替换；正式感不足 | P2 |
| D10 | **大字量性能**：5000 字一次性建满 DOM；PDF 全量 canvas | `render.js` `replaceChildren` | 输入大段内容时卡顿 | P2 |
| D11 | **错误反馈原始**：PDF/字体失败用 `alert`，拼音失败仅一行状态文字 | `app.js` | 体验割裂，无法重试 | P2 |
| D12 | **构建产物无版本标记**：CDN 版本写死、产物无 hash/版本号 | `tools/vendor.js`、`tools/build.js` | 缓存/排查困难 | P3 |

---

## 4. 架构选型：完整版 React，Kindle 原生

### 4.1 决策

- **完整版（普通浏览器）迁移到 React + Redux**（Vite 构建）：React 负责设置面板、模板/参数、内容工具等交互密集部分；Redux（Redux Toolkit）作为唯一状态层，集中管理内容 / 设置 / 预览参数，组件只订阅与派发 action，避免 props 层层传递与多处本地 state 失同步。
- **练字版（Kindle / 老浏览器）保持原生 ES5 单文件**，不迁移、不引入运行时；定位为纯练字，不含打印 / 导出。
- **共享核心保持框架无关**（ES5 语法 + ESM 导出），React 版与原生版共用同一份 `config / content / zg-bg / sheet-layout`。

### 4.2 为什么不用「React 转 ES5」支持 Kindle

- React 18+ 运行时依赖 `Promise / Map / Set / Symbol / Proxy` 等现代内置，`esbuild target=es5` 只转换语法、**不做 polyfill**；要跑起来得再塞 core-js，体积与风险失控。
- Kindle 实验浏览器 / 墨水屏刷新慢，虚拟 DOM 的频繁 diff 与重排不适合「静态、低负荷、可打印」的练字场景。
- 现有练字版已验证可用（单文件、离线、内置拼音），重写收益为负。

### 4.3 目标分层

```text
web/（React 18 + Redux + Vite）   设置面板 / 模板参数 / 内容工具 / 交互预览
        │ 订阅 store + import
js/（共享核心，ESM + ES5 语法）   config / content / zg-bg / sheet-layout
        │ esbuild 打包
lite/index.html（原生 ES5 单文件） Kindle / 老浏览器，零依赖
```

- 共享核心保持「IIFE 挂 `window.Zitie`」普通脚本（普通 `<script>`、lite 打包、`file://` 均不受影响），新增 ESM 包装层 `js/core.js` 副作用加载后命名导出，React 直接 `import { Config, SheetLayout } from '../js/core.js`。
- 构建产物 `dist/index.html` 用 `vite-plugin-singlefile` 内联 JS/CSS，**保持 `file://` 直开可用**。
- 开发期 `npm run dev` 改为 Vite dev server（React 热更新）；`npm run build` 同时产出 React 版与原生 lite 版。

### 4.4 迁移阶段（与 P0 并行，P0 完成后启动）

- **M1 共享核心 ESM 化 + Schema**：`js/*.js` 增 ESM 导出，lite 打包验证不受影响。（已完成：包装层 `js/core.js`）
- **M2 React + Redux 设置面板**：用 React 重写左侧面板（分组 / 滑杆 / 缩略图 / 下拉）；Redux store 承载配置，控件为受控组件 + dispatch，版式预览先用现有 `render.js`。
- **M3 React 预览与输出**：预览、模板参数、PDF / 打印接入 Redux 状态（store 变更 → 重算 `SheetLayout` → 渲染）。
- **M4 构建切换**：`dist` 改为 Vite 单文件产物 + lite，保留 file:// 直开。（已完成：`vite-plugin-singlefile`，见第 6 章 M4）
- 回退策略：原计划 M1–M3 期间保留 `index.html` 原生版兜底；React 版功能追平后**已提前移除原生入口**（见 M4 完成说明），当前仅有 React 完整版 + lite 练字版。

## 5. 目标设计

### 5.1 配置 Schema（解决 D1、D3）

在 `js/config.js` 增加 `Z.ConfigSchema`，把字段元数据集中：

```js
Z.ConfigSchema = {
	Content:    { type: 'text', max: Z.MAX_CONTENT_LENGTH, group: 'content' },
	Title:      { type: 'string', max: Z.MAX_TITLE_LENGTH, group: 'content' },
	Template:   { type: 'enum', values: Z.TEMPLATE_KEYS, group: 'layout' },
	TraceCount: { type: 'int', min: 1, max: 6, group: 'layout' },
	Cols:       { type: 'int', min: 0, max: 20, group: 'layout', allowZero: true, zeroLabel: '自适应' },
	RowGap:     { type: 'percent', min: 0, max: 1, group: 'layout' },   // 内部存 0–1，UI 用 0–100
	CellGap:    { type: 'percent', min: 0, max: 1, group: 'layout' },
	InkColor:   { type: 'enum', values: Z.INK_COLOR_KEYS, group: 'text' },
	InkAlpha:   { type: 'percent', min: 0.15, max: 1, group: 'text' },
	GridSize:   { type: 'int', min: 56, max: 120, step: 2, group: 'grid' },
	ZgType:     { type: 'enum', values: Z.ZG_TYPES, group: 'grid' },
	ZgColor:    { type: 'enum', values: Z.ZG_COLORS, group: 'grid' },
	ShowPinyin: { type: 'bool', group: 'text' },
	StrokeAnim: { type: 'bool', group: 'layout' }
};
```

- `Config.load/save` 改为按 schema 校验（归一化函数也按 `type` 派发，消除 `normalizeInt` / `normalizeFloat` 混用）。
- 新增字段只改 schema + UI 声明，不动读写逻辑。
- 两版的 `syncControls` 都从 schema 派生（见 5.3）。

### 5.2 版式真源（解决 D2）

新增 `js/sheet-layout.js`（共享核心），作为**唯一**版式计算入口：

- 输入：`{ content, title, gridPx, cols, rowGap, cellGap, page, margin, template, traceCount }`
- 输出：`{ pages: [{ rows: [{ index, chars: [{char, role, x, y}] }], titleH }], gridMm, pitchMm, ... }`
- 屏幕渲染：按输出注入 CSS 变量（`--row-gap/--cell-gap/--cols`），容器用 `max-content` 居中；**不再各自算**。
- PDF：直接消费同一输出，只负责画。
- 打印：`@page` 与分页由同一输出推导（标题区高度、每页行数），避免"屏幕/PDF 一致但打印错位"。

这样 D2 的三套计算收敛为一套，`content.js` 的 `pageLayout/paginate` 作为底层原语保留。

### 5.3 设置层共享（解决 D3）

在共享核心增加 `Z.Settings.sync(schema)`：

- 输入 schema + 控件选择器约定（`[data-cfg="RowGap"]`），输出"配置 → 控件"的同步与"控件 → 配置"的绑定。
- 完整版：控件外壳更丰富（缩略图/滑杆），但值读写走 `Settings.sync`。
- 练字版：原生 `select/radio` 由 schema 生成选项，读写走同一 `Settings.sync`。
- 目标：两版不再各写一份 `syncControls`。

### 5.4 模板参数化（解决 D4）

把 `Template` 从枚举升级为**参数对象**（向后兼容旧枚举）：

```js
{ model: 3, trace: 2, blank: 3, repeat: 1, variant: 'red-black' | 'light' }
```

- 保留 `normal/trace/trace3/lead/blank` 作为预设别名，配置里仍可存字符串。
- 新增"逐字递减"（如 3 描 2 临）、"红黑格"（范字朱砂、临写墨色）、"每页重复"。
- UI：模板缩略图保留点选，展开"高级参数"区（范字/描红/临格数）。

### 5.5 测试底座（解决 D6）

- 新增 `test/shared.test.js`，用 `node:assert` 直接 require 共享核心（config/content/zg-bg/sheet-layout）。
- 覆盖：`parse` 换行/空行/代理对；`paginate` 折行/强制分页；`pageLayout` 锁定列数与行距；`cellRole` 全模板；`normalize*` 边界；旧键 `TraceMode → Template` 迁移。
- `package.json` 加 `"test": "node test/shared.test.js"`，构建后自动跑一次冒烟。

---

## 6. 分阶段 TODO

### P0：收敛真源（架构底座）

- [x] **T0.1 配置 Schema**：`js/config.js` 增 `Z.ConfigSchema`，`load/save` 按 schema 校验。
  - 验收：`grep -n "ConfigSchema" js/config.js` 有定义；node 断言新增字段只改 schema。
- [x] **T0.2 版式真源**：新增 `js/sheet-layout.js`，`js/render.js` 与 `js/pdf.js` 改为消费它。
  - 验收：`grep -n "SheetLayout" js/render.js js/pdf.js` 命中；`npm run build` 通过；浏览器实测三模板屏幕/PDF 一致。
  - 已完成（2026-11-19）：`Z.SheetLayout.compute()` 统一折行 / 分页 / 标题占位 / 角色；屏幕与 PDF 同源。实测 96 字 / 10 列 → 2 页（8+2 行），normal / trace / trace3 / lead / blank 角色分布正确，PDF 与 Chrome 打印均为 2 页且版式一致。
- [x] **T0.3 共享核心测试**：`test/shared.test.js` + `npm test`。
  - 验收：`npm test` 全绿；覆盖 `cellRole/pageLayout/parse`。
  - 已完成（2026-11-19）：18 项全绿，覆盖 `normalize* / 旧键迁移 / parse / paginate / pageLayout / cellRole / SheetLayout`。
- [x] **T0.4 清理重复归一化**：删除 `app.js`/`lite-src/main.js` 中与 schema 重复的常量与手写校验。
  - 验收：`grep -n "normalizeFloat(.*value" js/app.js` 无未除 100 的调用。
  - 已完成（2026-11-19）：两版控件统一走 `Z.normalizeField(key, value)`；percent 字段仅在控件侧 `/100`。实测 rowGap 25→0.25、inkAlpha 30→0.3、cols 10 正确；lite 无打印入口且练字渲染正常。

### P1：体验与可维护

- [x] **T1.1 设置层共享**：`Z.Settings.sync`，两版 `syncControls` 合并。
  - 验收：`lite-src/main.js` 与 `js/app.js` 不再各写一份字段同步。
  - 已完成（2026-11-19，由 T0.6 + T1.8 落地）：未新增 `Z.Settings` 模块，而是把「字段同步」统一到 schema——React 侧 Redux 为唯一可变状态（`store.subscribe` 只镜像 + 防抖 save），lite 侧 `syncControls` 更名 `syncForm`（只做表单 ↔ `Z.Config` 读写），选项由 `ConfigSchema` 生成、写入走 `Z.normalizeField`。原生版 `js/app.js` 已删除（不再有第三份同步）。验收：`grep -n "syncControls" lite-src/main.js` 无。
- [x] **T1.2 可访问性**：overlay 焦点管理（打开聚焦、Esc 关闭、关闭返还）、range `aria-valuetext`、`prefers-reduced-motion` 自动关笔顺。
  - 验收：键盘可完成"打开预览→关闭"；`grep -n "aria-valuetext" index.html` 命中。
  - 已完成（2026-11-19，由 T1.9 落地；交互分配见 T1.10：Enter = 编辑、Space = 预览）：`BigPreview.jsx` 新增焦点陷阱（overlay 内 Tab / Shift+Tab 循环）与关闭后焦点返还触发字格；`Preview.jsx` 字格补 `role="button"` / `tabindex=0` / `aria-label`，支持键盘打开预览；`controls.jsx` 两个滑杆工厂接收 Panel 传入的 `aria-valuetext`；`prefers-reduced-motion: reduce` 时不播笔顺（降级为静态单字，重播按钮禁用）。
  - 验收：浏览器实测字格可聚焦（`tabindex=0`）、Space 打开后焦点在关闭按钮，Tab 在「关闭 ↔ 重播」间循环，Esc 关闭后焦点回到字格；六个滑杆 `aria-valuetext` 分别为「3 格 / 4 列 / 12% / 100% / 62% / 80 像素」；模拟 `prefers-reduced-motion: reduce` 后 overlay 无 SVG、显示静态字、重播按钮禁用。
- [x] **T1.3 内容工具**：导入/导出 txt、示例库、重复字统计。
  - 验收：`index.html` 新增入口；导入后 `charCount` 正确。
  - 已完成（2026-11-19，落完整版 Panel；lite 定位只练字不含导入导出，不做）：`js/content.js` 新增 `ContentModel.hanStats(text)`（只计汉字，返回 `[{char,count}]`，count>1，按次数降序、同次数按首现顺序）；`js/config.js` 新增 `Z.SAMPLES` 示例库（千字文 / 三字经 / 静夜思 / 登鹳雀楼 / 春晓 / 论语·学而，含标点走 T0.8 规则）；`web/src/Panel.jsx` 新增 `ContentTools` 组件（示例库 select、「示例 / 导出 txt / 导入 txt / 清空」按钮、重复字统计标签），导入走 FileReader + 隐藏 file input，导出走 Blob 下载（文件名取标题或「墨帖内容」）；`web/src/styles.css` 加 `.rp-stats` 系列样式。
  - 验收：`npm test` 27 项全绿（新增 `hanStats` 四断言）；`npm run build` 通过。浏览器实测：示例库 7 项（占位 + 6 示例），选「静夜思」→ 内容更新、统计 `明×2 月×2 头×2`、`20 个汉字 · 共 1 页`；导出 Blob 内容 = 当前文本（24 字）；导入「天地玄黄，宇宙洪荒。\n天地玄黄」→ 内容同步、统计 `天×2 地×2 玄×2 黄×2`、`12 个汉字`；清空 → 空内容 + 「无重复字」。
- [x] **T1.4 设置导出/导入与预设**：JSON 导出/导入；预设保存（如"硬笔/软笔"）。
  - 验收：导出文件含 `Template/GridSize/...`；导入后控件同步。
  - 已完成（2026-11-19）：`js/config.js` 新增 `Z.PRESETS_KEY`（`zitie.presets`）与 `Config.snapshot / loadPresets / savePreset / deletePreset`（`save` 改为复用 `snapshot`）；`web/src/Panel.jsx` 新增 `SettingsGroup`（导出 JSON / 导入 JSON、预设名输入 + 保存、预设列表加载 / 删除）。预设只存偏好（排除 `Content` / `Title`），导出 JSON 为完整 18 字段快照；导入 / 加载时未提供的字段保留当前值，避免内容被重置。`web/src/styles.css` 加 `.rp-presets` / `.rp-link`。
  - 验收：`npm test` 28 项全绿（新增 snapshot / 预设存取删）；`npm run build` 通过。浏览器实测：导出 JSON 含 18 字段（`Template/GridSize/Content` 等）；保存预设「硬笔」→ 列表与 `zitie.presets` 同步；改 `GridSize` 64 后加载预设恢复 80；预设不含 `Content`；导入 `{"Template":"trace3","GridSize":96}` → 控件同步、内容「天地玄」保留；导入完整导出文件→内容随文件；删除预设 → 列表清空、`zitie.presets={}`。

### P2：能力扩展

- [x] **T2.1 模板参数化**：`model/trace/blank/repeat` + 红黑格、逐字递减。
- 验收：`Z.Layout.cellRole` 支持参数对象；旧枚举仍可用。
- 已完成（2026-11-19）：`js/content.js` 新增 `roleFromParams(index, params, rowIndex)`，`Z.Layout.cellRole(index, template, traceCount, rowIndex)` 优先识别对象参数、字符串旧枚举不变。支持原语：`{ model: n }`（前 n 格范字其余描红，等价 trace3）、`{ trace: true }`、`{ blank: true }`、`{ lead: true }`、`{ repeat: ['model','trace','trace'] }`（按行循环，非法角色回退 model）、`{ repeat: [...], decay: k }`（逐字递减：每行从行尾减少 k 格、至少保留 1 格，如 `['model','trace','trace','trace']` + `decay:1` → 1 范 3 描 → 1 范 2 描 → 1 范 1 描 → 全范字）。`js/sheet-layout.js` 给 `cellRole` 传入**跨页累计行号**，使 decay 按练习进程递减。红黑格沿用现有颜色策略（范字 `InkAlpha` 实心、描红 `InkAlpha×0.5`，色相由 `InkColor` 决定），参数对象只负责角色节奏，未新增独立颜色字段。
- 验收：`npm test` 31 项全绿（新增 3 项：参数原语、decay 行收缩边界、compute 跨页递减 + 旧枚举回归）；浏览器实测 `decay` 行角色 `mttt→mttm→mtmt→mmmm`、旧枚举 `trace3` 正常。注：模板 UI 仍以下拉枚举选择（`ConfigSchema.Template` 只收枚举），参数对象供程序化 / 未来模板扩展使用。
- [x] **T2.2 纸张与元信息**：A4/A5/B5/16 开；标题/姓名/日期/页码。
- 验收：打印与 PDF 使用同一纸张参数。
- 已完成（2026-11-19）：`PAGE_PRESETS` 增加「16 开（184 × 260mm）」；`ConfigSchema` / `DEFAULTS` / `Config` 新增 `Name`（text，≤12）、`ShowMeta`（bool，默认 false）、`ShowPageNo`（bool，默认 true），`normalizeField` 类型守卫覆盖；`Panel.jsx` 新增「元信息」组（姓名输入 + 两个开关）写入同一 Redux store；`Preview.jsx` 每页底部按 `ShowMeta` 渲染「姓名 / 日期」行、按 `ShowPageNo` 渲染页码；`styles.css` 打印不再无条件隐藏 `.rp-page-no`（改由配置控制）；`js/pdf.js::drawPage` 增加 `pageIndex / pageCount`，在底部边距内绘制元信息（左姓名 / 右日期）与居中页码，屏幕 / 打印 / PDF 共用同一份配置。
- 验收：`npm test` 全绿（shared 32 项，含新增元信息归一化；vitest 9 项，含新增元信息渲染）；`npm run build` 通过；dev 5173 实测：16 开切换生效（`aspect-ratio: 184 / 260`）、姓名 / 日期渲染正确、页码开关即时生效；PDF 画布像素对照实测——仅开元信息 1271 个非白像素、全关 0、仅开页码 399，证明元信息 / 页码按配置绘制。打印分页与纸张参数同源（`@page` + `layout.page`），未做实体打印输出实测。
- [x] **T2.3 PDF 增强**：文档标题/页码、字体嵌入评估（矢量文字或注册字体）。
- 验收：PDF 元信息含「墨帖」；跨设备打开字形稳定。
- 已完成（2026-11-19）：`js/pdf.js::export` 在 pdf 实例创建后调用 `setProperties`，`title` 固定以「墨帖」开头（有内容标题时为「墨帖 · 标题」）、`subject`「字帖练习」、`creator`「墨帖」、`author` 取练习者姓名。页码已在 T2.2 随画布按 `ShowPageNo` 绘制。
- 字体嵌入评估结论：当前 PDF 为 canvas 栅格化（2× 96dpi）+ PNG 整页嵌入，字形已固化为像素，**跨设备 / 跨平台打开完全一致，无需字体嵌入**；代价是文字不可选中 / 搜索、体积较大。若改矢量文字（jsPDF 直接排版）需嵌入中文字体子集（通常数 MB）并处理字体授权，与「字形稳定」目标相比无收益。结论：维持栅格化方案，不做矢量改造。
- 验收：`npm test` 全绿、`npm run build` 通过；dev 实测假构造器捕获 `setProperties` 参数——有标题时 `title='墨帖 · 静夜思'`、`creator='墨帖'`、`author='李四'`；无标题时 `title='墨帖'`。实体 PDF 属性未直接解析（以 API 捕获参数为准）。
- [x] **T2.4 性能**：大内容分片渲染（`requestIdleCallback`）或按需渲染可见页。
  - 验收：5000 字输入到可交互 < 1s（实测记录）。
- 已完成（2026-11-19）：`Preview.jsx` 改为**按需渲染可见页**（IntersectionObserver，rootMargin 120%），屏外页保留同尺寸占位（`.rp-page` + aspect-ratio 的 sheet + 页码行），页节点 key 稳定、observer 持续有效；打印前（beforeprint，含 Ctrl+P / 打印按钮）全量展开，避免占位页缺失；`focusCell` 聚焦屏外页时先展开再聚焦。基准（dev 5173，5000 字 / A4 / 70 页）：输入到可交互 440ms → **9ms**，`#printContent` 节点 15905 → **436**；滚动按需加载（视口内 hz-line 72 → 360 → 1328）；派发 beforeprint 后全量 5000 字 / 15905 节点。
- 验收：`npm test` 全绿（组件测试 10 项，含新增「按需渲染 + beforeprint 全量」）；`npm run build` 通过；实测记录见上。未做实体打印机输出验证（以 beforeprint 同一钩子派发验证全量）。
- [x] **T2.5 统一提示**：轻 toast 替代 `alert`，失败可重试。
  - 验收：`grep -c "alert(" js/app.js` 为 0。
  - 已完成（2026-11-19）：全仓已无 `alert` / `confirm`（原生版删除后未再出现）。新增 `web/src/toastSlice.mjs`（纯 Redux slice，`pushToast / dismissToast`，payload 支持 `type: success|error|info` 与 `action:{label,onClick}`）与 `web/src/ToastHost.jsx`（右下角浮动、`role=status/alert`、成功 / 信息 3.5s 自动消失、失败常驻 + 「重试」按钮 + 手动关闭、`prefers-reduced-motion` 不播入场动画、`.no-print` 打印隐藏）；`store.js` 接入 `ui` reducer，并改为**仅配置变化才镜像 + 持久化**（toast 不触发写盘）。`Panel.jsx` 的 PDF 导出（成功 / 失败重试）、文本导入导出、设置导入导出、预设保存 / 加载 / 删除、字体应用改走 toast；仅保留字段级校验内联提示（字体地址无效、预设名为空）。`styles.css` 新增 toast 样式并删除已无使用点的 `.rp-hint`。
  - 验收：`npm test` 28 项 + ESM + `test/toast.test.mjs`（7 断言）全绿；`npm run build` 通过。浏览器实测：导出 PDF 成功 → `rp-toast-success`「已导出 PDF。」4s 后自动消失；注入 `Pdf.export` reject → `rp-toast-error`「导出失败：模拟失败」+ 「重试」，恢复后点重试 → 成功 toast；error toast 5s 后仍常驻、可手动关闭；保存 / 删除预设 → success toast；导入无效 JSON → error toast + 「重试」。

### P3：打磨

- [x] **T3.1 深色模式**：跟随系统或手动切换（仅完整版）。
  - 已完成（2026-11-20）：`Theme` 配置（light/dark/system）+ 暗色变量 + 打印恢复亮色；实测切换 / 刷新保持 / 跟随系统即时生效。
- [x] **T3.2 构建增强**：产物注入版本号/hash；`dist` 幂等构建。
  - 已完成（2026-11-20）：版本号取自 `package.json`，注入完整版 meta + 面板底部与练字版 meta；连续两次构建产物字节一致。
- [x] **T3.3 字格扩展**：拼音格 / 作文格 / 数字格（按需）。
  - 已完成（2026-11-20）：完整版新增 `ZgType` 5 拼音格 / 6 作文格 / 7 数字格（练字版不涉及）；实测三种样式切换生效、持久化正常。

### P4：架构迁移（React 完整版）

- [x] **M1 共享核心 ESM 化 + Schema**：`js/config.js` 等增 ESM 导出；lite 打包通过。
  - 验收：`npm run build:lite` 通过；`import '../js/config.js'` 在 esbuild 下无警告。
  - 已完成（2026-11-19）：共享核心保持 IIFE 普通脚本，新增 `js/core.js` 命名导出层；`npm test` 新增 ESM 打包验证（0 警告）；`npm run build:lite` 与完整构建均通过；浏览器实测原生版无回归。
- [x] **M2 React + Redux 设置面板**：`web/`（Vite + React 18 + Redux Toolkit），重写左侧面板。
  - 验收：`npm run dev:react` 起 Vite；面板控件与预览联动；配置变更走单一 store。
  - 已完成（2026-11-19）：`web/src/store.js`（configSlice + 订阅同步 `Z.Config` 并防抖 `Config.save()`）、`Panel.jsx`（Schema 驱动分组控件）、`Preview.jsx`（SheetLayout 预览 + 拼音）、`App.jsx`、`styles.css`；浏览器实测 96 字/10 列 → 2 页、模板角色（正常全范字 / 一字三描红前 3 范字）、`zitie.config` 持久化（Cols/Template）均正确。
- [x] **M3 React 预览与输出**：预览 / 模板参数 / PDF / 打印接入 Redux 状态。
  - 验收：浏览器实测各模板、PDF、打印与现状一致。
  - 已完成（2026-11-19）：`Panel.jsx` 新增「输出」组（导出 PDF / 打印），`Preview.jsx` 补 `is-fixed-cols` 居中，`main.jsx` 接入 `Z.Pdf`；PDF 走同一 `Z.Pdf.export()`（与原生同源，读 `Z.Config`）；打印复用 `main.css` 打印规则 + `styles.css` 容器适配。
  - 依赖决策：专业版改用 **npm 包 jspdf**（`Z.Pdf.setJsPdf(jsPDF)` 注入），不再依赖 CDN；原生版仍回退 assets（CDN / vendor），lite 不含 PDF。
  - 附带修复：`web/index.html` 的 `../css/main.css` link 在 Vite 下被解析为 SPA fallback（返回 HTML），main.css 从未真正加载（屏幕样式一度裸奔、打印分页失效）；改为 `main.jsx` 中 `import '../../css/main.css'` 交给 Vite 打包。
  - 实测：导出 PDF 返回 2 页且 `window.jspdf` 为 undefined（npm 路径）；headless 打印 96 字 / 10 列 → 2 页，normal / trace3 / blank 角色与面板隐藏均正确；`npm test` 18 项全绿；`npm run build:react` 通过。
  - 补齐点击字格放大预览 / 笔顺动画（M3.6）：新增 `web/src/BigPreview.jsx`（复用 `main.css` 的 `.overlay` 系列样式 + `Z.Stroke`，失败降级静态单字，Esc / 点击遮罩关闭、打开聚焦关闭按钮）；`Preview.jsx` 事件委托点击 `.hz-line`（跳过 `is-blank`）；`main.jsx` 补引 `js/stroke.js`。
  - 修复配套缺口：`Z.Assets` 未暴露 `loadHanziWriter`（React 入口拿不到），且 `loadHanziWriter` 由 fire-and-forget 改为返回带缓存的 Promise（原生 `apply()` 忽略返回值，行为不变）。
  - 实测（M3.7）：React 版点击范字 → overlay 打开、拼音 yǒng、SVG 30 条笔画路径、重播可用；Esc / 遮罩点击关闭有效；空临格模板点击不弹窗；原生版回归正常；PDF 仍 2 页；`npm test` 18 项 + ESM 全绿；`npm run build:react` 通过。
- [x] **M4 构建切换**：`dist/index.html` 为 Vite 单文件产物，`file://` 直开可用。
  - 验收：`npm run build` 后直接双击 `dist/index.html` 可用；无控制台错误。
  - 已完成（2026-11-19）：`vite-plugin-singlefile` 产出单文件（CSS / JS 全内联，920.7 KB / gzip 295 KB）；`vite.config.mjs` 用 `ZITIE_SINGLEFILE` 切换两种产物——`npm run build` → `dist/`（单文件，file://），`npm run build:react` → `dist-react/`（多文件，http 部署）；`base: './'`。
  - 移除原生版：删除 `index.html`、`js/app.js`、`js/render.js`、`js/detect.js`、`js/font.js`、`tools/serve.js`（均为原生版专属，React 版不使用）；浏览器检测逻辑内联迁移到 `web/index.html`（保留 Kindle 自动跳练字版能力）；`package.json` 的 `dev` 改为 `vite`。
  - PDF 组件收敛：`js/pdf.js` 去掉 assets（CDN / vendor）回退，只保留构建时注入（npm 包 jspdf 编译绑定）；`js/assets.js` 同步删除 `loadJsPdf` 与 bootstrap 相关分支（原生版遗留），只留 HanziWriter / 拼音；`tools/vendor.js` 不再下载 jspdf / bootstrap。
  - `tools/build.js` 重写：Vite 单文件构建 → lite → 复制 font / lite /（可选）vendor；`--vendor` 时向 `dist/index.html` 注入 `window.ZITIE_BOOT={ResourceMode:"local"}`。
  - 实测：`npm run build` 生成 dist（单文件 + lite + font）；`file://` 直开 dist/index.html 渲染正常，点击笔顺弹窗（SVG 30 条笔画）、导出 PDF（1 页、`window.jspdf` 为 undefined）均正常；`npm run build:react` 通过；`npm run dev`（Vite）可用；`npm test` 18 项 + ESM 全绿。

---

## 7. 暂缓 / 不做（避免范围膨胀）

- 不做账号、云同步、多端协同（与"纯静态、本机保存"定位冲突）。
- 不做社交分享、海报生成（非核心）。
- 暂不做繁体/日文假名等专项字帖（除非有明确需求）。
- 练字版不追求与完整版功能对等：只练字，不含打印 / 导出 PDF、笔顺演示等做字帖功能（已移除打印入口）。

---

## 8. 当前状态

- 状态：**P0 完成，P4 完成（M1–M4 全部完成）**。T0.1–T0.4 均已实测；`Z.SheetLayout.compute()` 统一折行 / 分页 / 标题占位，屏幕、PDF、打印三处同源；控件归一化统一走 `Z.normalizeField`；**M1 已完成**（`js/core.js` ESM 包装层，`npm test` 全绿）；**M2 已完成**（`web/` React + Redux 面板与预览，配置变更走单一 store）；**M3 已完成**（PDF / 打印 / 点击笔顺弹窗接入 React，实测各模板与交互正确）；**M4 已完成**（`dist/index.html` 为 Vite 单文件，file:// 直开实测渲染 / 笔顺 / PDF 均正常；原生版入口与专属文件已移除，浏览器检测内联迁移；PDF 组件编译绑定 npm 包，assets 收敛为 HanziWriter / 拼音）。
- 范围确认（2026-11-19）：练字版只练字、不含打印 / 导出（已移除打印入口）；完整版为 React + Redux 架构；PDF 组件只用 npm 包编译绑定（无 CDN / vendor 回退），HanziWriter / 拼音走 CDN（可选 vendor）；除 Kindle 练字版外全部现代化编写。
- 下一步（2026-11-19 更新）：P0 / P4 / P1 / **P2 清单全部完成**（T2.1 模板参数化、T2.2 纸张与元信息、T2.3 PDF 增强、T2.4 性能、T2.5 统一提示、T2.6 组件与产物测试），并按需修复字体链路（见 10.3-5）；**字体管理器已完成**（见第 11 章，子任务编号 T3.1–T3.6）。
- **第二轮评审（2026-11-19）**：全量走查 + 边界实测，新增 D13–D20 / T0.5–T2.6，见第 9 章。结论：核心计算层已收敛，UI / 样式 / 状态层仍是双轨；P0 待补「列数联约束」与「配置真源归并」，并先处理字体功能虚标。
- **产品反馈（2026-11-19）**：直接编辑 / 模板生效性 / 纸张配置 / 标点不占格，见第 10 章（D21–D24 / T0.8、T1.10–T1.12）。其中模板已实测生效（`is-trace`→`is-model`），其余为真实缺口。
- 每完成一项更新本节状态。

---

## 9. 第二轮代码评审补充（2026-11-19）

> 来源：全量走查 `js/ web/ lite-src/ css/ tools/ test/`；`npm test` 18 项全绿；版式边界实测；全文检索。
> 编号续第 3 章：新断裂点 D13–D20，新 TODO T0.5–T2.6，不重复已列项。

### 9.1 本轮新断裂点

| # | 断裂点 | 证据 | 影响 | 优先级 |
| --- | --- | --- | --- | --- |
| D13 | **固定列数 × 格子大小无联约束** | `js/content.js::pageLayout` 对 `colsOverride > 0` 直接采用，不校验纸宽。实测：cols=14 / 80px → 行宽 296mm（A4 可用 178mm）；cols=20 / 120px → 635mm；屏幕 1120–2400px 超出 820px 容器 | PDF 右侧字被 canvas 裁掉；屏幕横向溢出，与 PDF 不一致 | P0 |
| D14 | **配置真源分裂** | `Z.Config`（mutable 全局）与 `web/src/store.js`（Redux）双状态，靠 subscribe 单向同步；`SheetLayout.compute()` / `Pdf.export()` 不传参时隐式读全局；`fontURL / fontLocalName / ResourceMode` 在 `ConfigSchema` 之外（靠 save 手写白名单） | 「schema 唯一真源」不成立；核心函数隐式依赖全局；绕过 dispatch 的写入会失同步 | P0 |
| D15 | **IndexedDB 本地字体虚标** | 全仓检索：`fontLocalName` 仅在 `js/config.js` / `web/src/store.js` 定义与持久化，无任何 IndexedDB 读写；README 第 20 / 46 行声称「本地字体导入（IndexedDB）」已完成 | 功能虚标；React 无字体入口，`setFontMeta` 无消费者；PDF 读 `body.custom-font` 但 React 永不加该 class | P0 |
| D16 | **样式双真源** | `css/main.css` 约 400 行为原生版遗留类（`.topbar / .panel / .field / .btn / .template-thumb / .form-control / .swatch / .range / .layout / .sheet / .preview`），React 仅消费变量 / 正文 / overlay / `@page`；`@media print` 分散两处（main.css 那半对 React 无效） | 改样式要判断归属；React 面板无响应式（固定 340px） | P1 |
| D17 | **屏幕分页不可视** | `web/src/Preview.jsx` 把 `layout.pages` 顺序渲染进同一 `.rp-sheet`，`.page-break` 高 0、仅打印时 `break-after` | 看不到分页边界与每页行数，空行分页不可预期，只有「约 N 页」 | P1 |
| D18 | **schema 未真正驱动 UI** | `web/src/Panel.jsx::Range` 手工传 min/max，`Cols` 写死 `max={14}` 而 `schema.Cols.max = MAX_COLS = 20`（UI / schema 漂移）；lite `syncControls / initControls` 392 行手写 | 新增字段仍改多处；两版控件逻辑重复（D3 / T1.1 未闭环） | P1 |
| D19 | **React 版功能回退** | lite 有「示例 / 清空 / 自定义字体」；`web/src/Panel.jsx` 无对应入口 | 重写后丢功能，两版能力不对等 | P1 |
| D20 | **测试只覆盖核心纯函数** | `test/` 仅 shared / esm；无 React 组件、PDF、打印、产物冒烟 | 重构无回归保障（D6 只做一半） | P2 |

已列但未闭环（本轮确认仍开放）：D3、D5、D9、D10、D12。D7 / D8 / D19 已由 T1.3 / T1.4 / T1.7 闭环；D13–D18 由 T0.5–T1.8 闭环；D20 由 T2.6 闭环（2026-11-19）。

### 9.2 新增 TODO

#### P0：功能与架构底座

- [x] **T0.5 列数联约束**
  - 目标：锁定列数不得超过纸宽可容纳的列数，屏幕 / 打印 / PDF 三端一致。
  - 改动：`js/content.js::pageLayout`（`cols = Math.min(colsOverride, autoCols)`，或在 `SheetLayout.compute` 输出溢出标记）；`web/src/Panel.jsx` Cols 上限改为按 `usableW / gridMm` 动态计算。
  - 验收：`test/shared.test.js` 增断言 `pageLayout(80, A4, M, 14).cols <= pageLayout(80, A4, M, 0).cols`；浏览器实测 cols=14 / 120px 时屏幕与 PDF 均不溢纸。
  - 已完成（2026-11-19）：`pageLayout` 锁定列数改为 `Math.min(colsOverride, autoCols)`，并把**字距计入列数上限**（`autoCols = floor((usableW + gapMm) / (gridMm + gapMm))`，新增 `gapMm / maxCols` 输出；`estimatePages`、`SheetLayout.compute` 同步传 `cellGap`）；`Panel.jsx` Cols 上限改为 `SheetLayout.compute({ cols: 0 }).cols` 动态计算，显示值同步 clamp。
  - 实测：`npm test` 20 项全绿（含「联约束」「列数上限计入字距」断言）；浏览器 80px / 14 列 → 上限 8、行宽 668px ≤ A4 可用 673px；120px → 上限 5、PDF 4 页不裁切；字距 100% → 上限收缩为 4、行宽 560px 不溢纸。
- [x] **T0.6 配置真源归并**
  - 目标：Redux 为唯一可变状态；`Z.Config` 只做持久化适配；核心函数显式接收配置。
  - 改动：`SheetLayout.compute(config?)` / `Pdf.export(config?)` 传参化；`store.subscribe` 只负责 save；`fontURL / fontLocalName / ResourceMode / Page / Margin` 纳入 `ConfigSchema`。
  - 验收：`grep -rn "Z.Config\." web/src js/pdf.js` 无隐式读取（`config.js` 自身除外）；`npm test` 全绿。
  - 已完成（2026-11-19）：`ConfigSchema` 扩至 18 字段（新增 `Page / Margin / fontURL / ResourceMode`；`fontLocalName` 于 T0.7 移除），`normalizeField` 支持 `object`（Page/Margin 逐键校验）与 `fontURL` 消毒；`Config` 字面量与 `load/save` 全按 Schema 派发（删除手写特殊字段）。`SheetLayout.compute(options)` 新增 `options.config`（缺省回退 `Z.Config`），`resolvePage` 读 `cfg.Page / cfg.Margin`；`Pdf.export(config)` 参数化，`inkRGB / drawPage` 显式接收 cfg，纸张用 `layout.page`（`format: [width, height]`）。`store.subscribe` 只镜像 + 防抖 `Config.save()`；`BigPreview` 改 props 接收 `strokeAnim`，`Preview` 传 `config` 与 `strokeAnim`，`Panel` 的 `colsMax` 与 `Z.Pdf.export` 均显式传 config。
  - 验收：`grep -rn "Z\.Config\." web/src js/pdf.js` 无隐式读取；`npm test` 21 项全绿（新增 Page/Margin/fontURL/ResourceMode 归一化断言）；浏览器实测 schema 18 字段、点击字格笔顺 30 笔画、`Pdf.export(config)` 导出 3 页、`colsMax` 随字距收缩（100% 字距 → 4 列）、save 写入全量 Schema 白名单。
- [x] **T0.7 字体功能去虚标**
  - 目标：要么实现 IndexedDB 本地字体导入，要么从 README 删除「已完成」表述，使文档与实现一致。
  - 改动：`js/config.js`、`web/src/Panel.jsx`、`README.md`。
  - 验收：`grep -rn "IndexedDB\|fontLocalName" js web README.md` 要么命中真实读写，要么 README 不再声称。
  - 已完成（2026-11-19，走「去虚标」路径）：删除 `fontLocalName` 全链路（`ConfigSchema` / `Config` 字面量 / `store.js`）及「内容存 IndexedDB」注释；`store.js` 的 `setFontMeta` 收敛为 `setFontURL`（只写 `fontURL`，走 schema 消毒）。`fontURL` 保留：练字版有真实实现（`lite-src/main.js::applyFont` 注入 `@font-face` + 输入框 + `sanitizeFontURL`），完整版入口留待 T1.7。README 对比表改为「规划中（地址 / base64，入口未做）」。
  - 验收：`grep -rn "IndexedDB\|fontLocalName" js web README.md lite-src css` 无命中；`npm test` 21 项全绿。

#### P1：体验与可维护

- [x] **T1.5 样式瘦身**
  - 目标：`css/main.css` 只留两版共用（变量 / 正文 / overlay / `@page` / `.page-break`），删原生死类；打印规则单点；React 面板样式独立。
  - 验收：`grep -c "topbar\|panel-group\|template-thumb\|form-control\|grid-swatch" css/main.css` 为 0；`npm run build:react` 通过；浏览器打印分页正常。
  - 已完成（2026-11-19）：`main.css` 724 → 约 330 行，删除原生 UI 死类（`app / layout / topbar / brand / seal / panel / panel-group / field / form-control / template-row / template-thumb / swatch / grid-swatch / color-swatch / range / preview / sheet`）、重复的 `mini-grid` 与 `btn`；保留设计变量、字帖正文（`#printContent / .cell / .row / .page-block / .page-break / .hz-line / .sheet-title`）、overlay、`body.custom-font`、`@page` 与正文打印规则。`web/src/styles.css` 删除与 main.css 重复的 `*` 与 `body`（修复 `body` 背景被 `#f4f5f7` 覆盖、纸色网点丢失的问题）；`BigPreview` 重播按钮由 `btn btn-primary` 改 `rp-btn rp-btn-primary`。打印规则单点：main.css 管字帖正文（隐藏 `.no-print` / overlay、显示 `#printContent`、`.page-break` 分页、`@page` 页边距），styles.css 的 `@media print` 只管 React 布局（隐藏面板）。
  - 验收：`grep -c` 为 0；`npm run build:react` 通过；Chrome headless 打印 96 字 / 4 列配置得 3 页，与 `Pdf.export` 页数一致；浏览器实测 body 背景恢复纸色网点、面板 / overlay / 笔顺（30 路径）无回归。
- [x] **T1.6 屏幕分页可视**
  - 目标：按页渲染（每页一张 A4 比例纸 + 页码），打印 / PDF 复用同一 `pages`。
  - 验收：浏览器实测多页内容每页独立卡片；打印页数与屏幕页数一致。
  - 已完成（2026-11-19）：`Preview.jsx` 由「单纸 + 高 0 的 `.page-break`」改为每页一张 `.rp-page` 卡片（`.rp-page-sheet` 纸面 + `.rp-page-no` 页码「第 N / M 页」），`.rp-count` 改为「共 N 页」；分页仍由 `layout.pages` 驱动，打印 / PDF 复用同一份。`styles.css` 新增 `.rp-page / .rp-page-sheet / .rp-page-no`，打印时隐藏页码并按 `.rp-page` 卡片 `break-after: page` 分页（替换原 `.rp-sheet` 规则）。
  - 验收：浏览器实测 96 字 / 4 列得 3 张卡片 + 页码；Chrome headless 打印同配置 3 页，与屏幕页数一致。
- [x] **T1.7 React 功能补齐**
  - 目标：补齐「示例 / 清空 / 自定义字体」入口，与 lite 对齐。
  - 验收：`grep -n "示例\|清空\|字体" web/src/Panel.jsx` 命中；字体应用后屏幕与 PDF 同步。
  - 已完成（2026-11-19）：新增共享 `js/font.js`（`Z.Font.inject / apply / current`）——注入 / 移除 `@font-face` 与 `body.custom-font`；lite 的 `applyFont` 改为委托（删除重复实现），示例文本提为 `Z.SAMPLE_TEXT` 两版共用。`Panel.jsx` 内容区加「示例 / 清空」，新增「字体」分组（地址输入 + 应用 / 恢复默认 + 提示，地址经 `sanitizeFontURL`）；`App.jsx` 订阅 `config.fontURL` 调 `Z.Font.inject`；`js/pdf.js` 导出前 `await document.fonts.ready`，避免 canvas 回落默认字体。
  - 验收：`grep` 命中；浏览器实测「示例」填充 24 字、「清空」归零、应用 `font/1.ttf` 后 `body.custom-font` + `@font-face` 注入 + `.hz-line` 字体栈含 `ziti`，`Pdf.export` 成功；「恢复默认」移除 class；lite `file://` 冒烟 `Z.Font` / `Z.SAMPLE_TEXT` 正常。
- 补充（2026-11-19，见 10.3-5）：此前记录的 `document.fonts.check('16px ziti')` 为 true **不能证明字体生效**——未注入 `@font-face` 时该 API 对可回退字体族同样返回 true。且 dev 下相对地址会命中 SPA fallback 导致静默失效，已由此条目修复并改用 `fonts.load` + 像素对比验收。
- [x] **T1.8 schema 驱动控件**
  - 目标：抽 `Settings.sync`（即 T1.1）+ Schema 控件工厂（`Range / Select / Swatch` 从 schema 派生 min/max/step/values/zeroLabel）；lite 选项由 schema 生成。
  - 验收：`grep -n "max={14}" web/src/Panel.jsx` 无；`grep -n "syncControls" lite-src/main.js` 无。
  - 已完成（2026-11-19）：新增 `web/src/controls.jsx` 控件工厂——`SchemaRange({ schemaKey, max?, display })` 从 `ConfigSchema` 派生 `min/max/step`（`max` 可覆盖，用于 Cols 动态上限）与 `value` clamp；`SchemaPercentRange` 把 0–1 内部值映射为 0–100 显示。`Panel.jsx` 删除本地 `Range / PercentRange`，六处滑杆改用工厂（`schema.Content.max / schema.Title.max` 仍用于文本域）。lite 侧：`lite-src/main.js` 新增 `fillSelect / templateOptions / intOptions(schemaKey, format) / buildOptions`，`template / traceCount / gridSize` 三个 select 的选项由 `Z.TEMPLATES` 与 `ConfigSchema` 生成；`syncControls` 更名 `syncForm`（职责只剩读写当前表单值）。
  - 验收：`grep -n "max={14}" web/src/Panel.jsx` 无；`grep -n "syncControls" lite-src/main.js` 无；`npm test` 21 项全绿；`npm run build` 通过（dist/index.html 918.5 KB、dist/lite/index.html 129.9 KB）。浏览器实测 React 六个滑杆全部 schema 驱动：`tracecount` 1–6 / 3、`cols` 0–4（动态上限）/ 4、`rowgap` 0–100% / 12%、`cellgap` 0–100% / 100%、`inkalpha` 15–100% / 62%、`gridsize` 56–120px / 80px。lite `file://` 实测三个 select 由 schema 生成：template 5 项、traceCount 1–6 格、gridSize 56–120px（step 2），默认选中 normal / 3 / 80，切换 template 时 `traceCountGroup` 显隐正常（normal 隐藏、trace3 显示）。
- [x] **T1.9 可访问性**
  - 目标：overlay 焦点陷阱与关闭返还；range 补 `aria-valuetext`（并入 T1.2）。
  - 验收：`grep -n "aria-valuetext" web/src/Panel.jsx` 命中；键盘可完成「打开预览 → 关闭」且焦点返还。
  - 已完成（2026-11-19）：`BigPreview.jsx` 加 overlay `ref` + `onKeyDown` 焦点陷阱（`Tab` 在 overlay 内可聚焦元素间循环，焦点逃出时拉回）；`useEffect` 打开时记录 `document.activeElement`，卸载 / 切字时 focus 返还（T1.2 的关闭返还）。overlay 补 `aria-modal="true"`（替换原无意义的 `aria-hidden="false"`）。`Preview.jsx` 的 `.hz-line`（非空临格）补 `role="button"` / `tabIndex=0` / `aria-label="放大查看 X"` 与键盘激活，使键盘用户也能打开预览（否则「打开预览」仅鼠标可达）。`main.css` 补 `.hz-line:focus-visible` 轮廓。`controls.jsx` 的 `SchemaRange / SchemaPercentRange` 新增 `aria-valuetext` 入参（由 Panel 传具体文案，未传时回退 display / 百分比）。同时完成 T1.2 剩余项：`prefers-reduced-motion: reduce` 时 BigPreview 不播笔顺。
  - 交互调整（T1.10 后）：单击字格已用于编辑，键盘打开预览改由 **Space** 触发（Enter 用于进入编辑）；双击仍为鼠标预览入口。
  - 验收：`grep -n "aria-valuetext" web/src/Panel.jsx` 命中 6 处；`npm test` 21 项全绿；`npm run build` 通过。浏览器实测：字格 `role=button` / `tabindex=0` / `aria-label="放大查看 天"`；Space 打开 → 焦点在关闭按钮 → Tab 到「重播笔顺」→ Tab 回关闭按钮（循环）→ Shift+Tab 反向正常 → Esc 关闭后焦点回到字格「天」；六个滑杆 `aria-valuetext` 为「3 格 / 4 列 / 12% / 100% / 62% / 80 像素」；模拟 reduce-motion 后 overlay 无 SVG、textContent=天、重播禁用。`file://` 直开 dist 产物冒烟：range aria 与字格 role 正常。

#### P2：质量与回归

- [x] **T2.6 组件与产物测试**
- 目标：补 React 组件层测试与 `file://` 产物冒烟，覆盖 PDF 页数与打印分页。
- 验收：`npm test` 含组件测试脚本；`npm run build` 后 `dist/index.html` 直接打开冒烟通过。
- 已完成（2026-11-19）：新增 devDependency `vitest@^2.1.9`（兼容现有 vite 5）/ `jsdom` / `@testing-library/react` + `@testing-library/dom`；`vitest.config.mjs`（root=项目根、`environment: 'jsdom'`、只扫 `test` 下 `.test.jsx`，避免命中 node 脚本式测试）。`test/components.test.jsx` 共 8 项：ToastHost（成功 3.5s 自动消失；error 常驻、点「重试」先 dismiss 再执行回调）、Preview（用 `Z.SheetLayout.compute` 作期望值断言 `.rp-page` 数 / 页码 / 计数 / `is-model↔is-trace` 角色切换 / `.hz-mark` 标点）、Panel（模板按钮写入 store、预设写入 `zitie.presets`、字体成功 → `fontURL` 保留 + 成功 toast、字体失败 → 回退空 + 失败提示）。`test/smoke.test.mjs`：静态检查（`dist/index.html` / `dist/lite/index.html` / `dist/font/1.ttf`，单文件含 `printContent` / `zitie-font-face` / 「墨帖」）+ Chrome headless 直开 `file://` 产物断言渲染出 `#printContent` 与面板；无 Chrome 时跳过 DOM 冒烟并打印说明（不伪装通过）。`store.js` 对 `ui.toasts` 关闭 `serializableCheck`（`action.onClick` 为函数，属有意存放）。`package.json` 的 `test` 串联为 shared → esm → toast → `vitest run` → smoke，另加 `test:unit` / `test:smoke`。
- 验收：`npm test` 全绿（shared 28 + ESM + toast 7 断言 + 组件 8 项 + 冒烟 8 项）；`npm run build` 后 Chrome headless 直开 `dist/index.html` 渲染出预览容器与面板；dev 5173 回归面板 / 预览 / 模板标注 / 字体输入正常。注：PDF 页数与打印分页由 `SheetLayout.compute` 的纯函数断言覆盖（组件测试断言渲染页数与之一致），打印 CSS 分页无法自动化断言，仍以 Chrome headless 打印实测为准。

### 9.3 建议推进顺序

1. **P0**：T0.5（改动小、修功能 bug）→ T0.6（架构底座）→ T0.7（消除虚标）。
2. **P1**：T1.5 / T1.6 / T1.7 / T1.8 / T1.9（体验与可维护，可并行）。
3. **P2**：T2.1 ✅、T2.2 ✅、T2.3 ✅、T2.4 ✅、T2.5 ✅、T2.6 ✅（2026-11-19）——P2 清单全部完成。

---

## 10. 产品反馈与交互改进（2026-11-19）

> 来源：用户反馈四条 + 浏览器实测。续第 3 / 9 章编号。

### 10.1 断裂点

| # | 反馈 | 核实结论 | 优先级 |
| --- | --- | --- | --- |
| D21 | 「为什么字帖内容不是直接在字帖里编辑？」 | 现状内容源是左侧 `textarea`，预览**只读**（点击仅放大 / 笔顺），编辑与排版分离 | P1 |
| D22 | 「排版模板好像没生效」 | **实测生效**：整页描红→正常，`.hz-line` 由 `is-trace`（`rgba(176,58,44,.31)`）变 `is-model`（`.62`）。感知差的原因：内容仅 1 字时 `normal / trace3(前3) / lead(首字)` 结果相同；且模板缩略图仅 4 格，与「按行内 index」规律不对应 | P2 |
| D23 | 「纸张选择不应该在这里直接配置预览吗？」 | `config.js` 已有 `Page{width,height}` / `Margin{四向}`，`SheetLayout.compute` 也读取，但**面板无任何控件**；屏幕 `.rp-sheet` 固定 `max-width:820px`，不随纸型比例变化 | P1 |
| D24 | 「符号不应该占用单独格子，可以借用字的右下角放标点符号」 | `ContentModel.parse` 以 `isHan` 过滤，**标点被静默丢弃**；内容模型无「不占格附加符号」表达 | P1 |

### 10.2 新增 TODO

#### P1：内容模型与配置

- [x] **T0.8 标点不占格（内容模型增强）**
  - 目标：标点不占格，借前字格子右下角显示；屏幕 / 打印 / PDF 同源。
  - 改动：`js/content.js`（`parse` 输出 cell 增加 `mark`；定义 CJK / 西文标点集与行首规则）、`js/sheet-layout.js`（透传 `mark`）、`web/src/Preview.jsx`（`.hz-line` 右下角小号标点）、`js/pdf.js`（字格右下角绘制）。
  - 验收：输入「天地玄黄，宇宙洪荒」→ 逗号显示在「黄」右下角、不占格；`npm test` 增断言「含标点内容与纯汉字内容格子数相同」；PDF 与屏幕一致。
  - 已完成（2026-11-19）：`content.js` 新增标点集（CJK 符号区 `\u3001-\u303F`、全角 `\uFF01-\uFF0F` 等、常见西文 `,.;:!?()[]'"-`），`parse` 输出 `chars` + 平行 `marks`（标点追加到前字，行首标点忽略，连续标点依次累加）；`paginate` 行元素改为 `{char, mark}`（`chars` 数组本身保持字符串，`total` 只计汉字）；`sheet-layout` cell 输出 `mark`；`Preview.jsx` 渲染 `.hz-mark`，`css/main.css` 新增 `.hz-mark`（绝对定位右下角、字号 0.3×格、颜色继承字格）；`pdf.js` 在字格右下角 0.3×格字号绘制 `item.mark`（空临格也画）；lite `buildCell(char, role, mark)` 同步。
  - 验收：`npm test` 24 项全绿（新增「标点不占格」「连续标点/行首忽略」「paginate 携带 mark」，并更新原 paginate 断言为按 `char` 取值）；浏览器实测「天地玄黄，宇宙洪荒」→ 8 格、`.hz-mark` 文本「，」位于「黄」格右下角（`right≈1.6px`、`bottom=0`、字号 24px、颜色继承 `rgba(176,58,44,.62)`）；拦截 canvas `fillText` 记录 PDF 绘制文本含且仅含一个「，」；lite `file://` 实测 8 格 + 1 标点、`charCount=8`；`npm run build` 通过。
- [x] **T1.10 点击格子编辑单字**
  - 目标：预览字格可单点编辑，与左侧 `textarea` 双向同源；保留 textarea 批量输入。
  - 改动：`web/src/Preview.jsx`（点击非空格子进入 input，写回 `Content`）、`web/src/store.js`（按位置替换字符的 action）。
  - 验收：点击「永」改为「水」→ textarea 同步、预览 / 重算生效；Esc 取消、失焦提交。
  - 已完成（2026-11-19）：`content.js` 新增 `replaceHanAt(text, index, newChar)`（按「第 n 个汉字」写回，标点不参与编号；newChar 空串删除，非单个汉字忽略）与 `splitChars / isHan` 导出；`store.js` 新增 `replaceHan` reducer。`Preview.jsx` 单击非空字格进入内联编辑（`.hz-edit` 绝对定位覆盖、字体 / 颜色继承、自动聚焦全选），Enter 提交并聚焦下一格、Esc 取消、失焦提交；用 `editingRef` 规避 Enter / blur 竞态重复提交。交互分配：**单击 = 编辑，双击 / Space = 放大预览**（否则单击只能二选一），字格 `data-key` / `data-char` 供定位与双击取字。
  - 验收：`npm test` 25 项全绿（新增 `replaceHanAt` 断言）；`npm run build` 通过。浏览器实测：单击「黄」出现 `.hz-edit` 值「黄」→ 输入「水」→ Enter 后 textarea 变「天地玄水，宇宙洪荒」、预览第 4 格为「水」、编辑关闭；Esc 取消（内容不变）；失焦提交（点击面板后 textarea 变「天二玄黄…」）；双击「玄」打开 overlay（拼音 xuán）；Enter 进入编辑、Space 打开预览（宇 / yǔ）。`file://` 直开 dist 产物：Enter 进入编辑正常。
- [x] **T1.11 纸张 / 边距配置 + 预览比例**
  - 目标：面板可改纸张与四向边距，屏幕预览按纸型比例，PDF / 打印已按 `Page` 走。
  - 改动：`web/src/Panel.jsx`（纸张组：A4 / A5 / B5 / Letter 预设 + 自定义宽高 + 四向边距）、`web/src/Preview.jsx`（`.rp-page-sheet` 用 `aspect-ratio = Page.width / Page.height`）、`web/src/styles.css`（`.rp-margin-grid`、打印时 `aspect-ratio:auto`）。
  - 验收：切 A5 → 屏幕纸比例变化、`cols` 上限随之变化；PDF 页面尺寸 = 所选纸。
  - 已完成（2026-11-19）：`Panel.jsx` 新增 `PAGE_PRESETS` / `MARGIN_KEYS` 与 `PageGroup()`（预设 select、宽 / 高 number input 50–600 step 0.1、2×2 四向边距 0–60 step 0.5），改任一值即 `Object.assign` 合并后 dispatch `setField`；`Preview.jsx` 的 `.rp-page-sheet` 用 `style={{ aspectRatio: config.Page.width + ' / ' + config.Page.height }}` 按纸型比例；`styles.css` 打印规则改 `aspect-ratio:auto` 避免打印按屏幕比例撑高。`js/pdf.js` 早已用 `layout.page` 作为 `format`，无需改动。
  - 验收：`npm test` 26 项全绿（新增「A5 可用宽高更小，列数上限随之收缩」）；`npm run build` 通过。浏览器实测（视口 1440×900）：A4 时 `preset=A4 / 210×297 / margins=[5,5,16,16]`、`.rp-page-sheet` 尺寸 820×1160（ratio 0.71 = 210/297）、`colsMax=4`；切 A5 后 `ratio 0.70 = 148/210`、`colsMax` 由 4 → 3 且 `cols` 值 clamp 到 3、`SheetLayout.compute({config}).page = {148,210}`；改宽 200 → 预设自动切 `custom`，恢复 A4 后 `page={210,297}`。PDF 页面尺寸沿用 `layout.page`，即所选纸。

#### P2：感知与示意

- [x] **T1.12 模板示意与感知优化**
  - 目标：模板差异在少字内容下也可感知，缩略图与行内规律一致。
  - 改动：`web/src/Panel.jsx`（缩略图按行内规律画足列数或标注「每行」）、可选默认示例内容。
  - 验收：内容 1 字时切换 `normal / trace` / `blank` 颜色差异可见；缩略图与预览角色一致。
  - 已完成（2026-11-19）：删除写死的 `TPL_THUMB` 四格映射，改为 `tplCells(template, cols, traceCount)`——直接调用与预览同一套 `Z.Layout.cellRole(index, template, traceCount)` 生成角色（`model→on / trace→soft / blank→empty`），按「实际生效列数」`activeCols`（`Cols=0` 时取 `colsMax`）画足一行，超过 `TPL_MAX_CELLS=8` 截断避免缩略图过宽；字段头用 `.rp-field-head` + `.rp-tpl-note` 标注「每行 N 格」。默认内容保留单字「永」，少字感知无需额外默认示例（示例按钮仍在）。
  - 验收：`npm test` 26 项全绿（补 `trace3` 在 `traceCount=1/6` 的角色边界）；`npm run build` 通过。浏览器实测：A4 / 80px / 自适应时缩略图 8 格且 `每行 8 格`，`normal=8×on`、`trace=8×soft`、`trace3=3×on+5×soft`、`lead=1×on+7×soft`、`blank=8×empty`；`traceCount` 1→2 时 `trace3` 缩略图 1×on → 2×on；`cols=3` 时缩略图 3 格、`每行 3 格`、`trace3=on,on,soft`，内容「天地玄」预览行角色 `is-model,is-model,is-trace` 与缩略图逐一对应；`GridSize=56` + 自适应时 `colsMax=11`、缩略图截断为 8 格而标注仍为 `每行 11 格`；内容 1 字时 `normal` 色 `rgba(176,58,44,.62)`、`trace` 色 `.31`（差一倍，可见）、`blank` 无字。

### 10.3 建议推进顺序

1. **T0.8 标点不占格**（跨模块内容模型，先定规则：标点跟随前字、允许行末悬挂）。✅ 已完成（2026-11-19）
2. **T1.10 点击格子编辑**（体验提升明显，改动集中在 Preview）。✅ 已完成（2026-11-19；交互：单击编辑、双击 / Space 预览）
3. **T1.11 纸张 / 边距配置**（配置 + 预览比例联动）。✅ 已完成（2026-11-19；实测 A4→A5 比例与 cols 联动、PDF 用 layout.page）
4. **T1.12 模板示意**（感知优化）。✅ 已完成（2026-11-19；缩略图改用 cellRole 生成、画足生效列数并标注「每行 N 格」）
5. **字体链路修复**（用户反馈「自定义字体没生效」）。✅ 已完成（2026-11-19）
   - 根因：dev（`vite root=web`）下相对地址 `font/1.ttf` 被 SPA fallback 成 `index.html`（200 + `text/html`，性能面板亦显示 200，具迷惑性），`@font-face` 加载失败但**静默回退**默认楷体，无任何提示；dist 单文件 `file://` 场景本身可加载。
   - 改动：① `vite.config.mjs` 新增 `fontStaticPlugin`，dev 下把项目根 `font/` 服务到 `/font/*`（含目录穿越防护与 MIME），使 dev 与产物路径语义一致；② `Panel.jsx::FontGroup` 应用时先 `Z.Font.inject` 再 `document.fonts.load('16px ziti')` 验证——成功 toast「已应用自定义字体。」，失败 toast error「字体加载失败：地址无效或文件不可达。」+ 内联说明并**回退**默认字体（`setFontURL('')`）；③ 修复 toast「重试」捕获旧闭包导致改地址后重试仍读旧值：`FontGroup` / `OutputActions` 改用 ref 保存最新函数（`applyRef` / `exportRef`）。
   - 验收：`npm test` 28 项 + ESM + toast 7 断言全绿；`npm run build` 通过。dev 实测 `curl -I /font/1.ttf` → `Content-Type: font/ttf`；应用 `font/1.ttf` → `document.fonts.load` 返回 1 个 face、`body.custom-font`、离屏 canvas 绘制「天」非透明像素 1688（ziti）vs 1100（默认楷体），字形确实切换；`font/nope.ttf` → error toast + 内联提示 + 配置回退空 + `body.custom-font` 移除；改回有效地址点「重试」→ 成功。dist `file://` 复测同样生效（1688 vs 1100）。注：`document.fonts.check` 对未注入的字体族也返回 true，**不可作为加载成功判据**，须用 `fonts.load` + 像素对比。

---

## 11. 字体管理器（2026-11-19）

> 需求：完整字体管理器（本地字体文件导入 + 库管理：导入 / 预览字样 / 重命名 / 启用禁用 / 删除 / 应用），字体二进制本地持久化；纯 Web 产物支持 mac / linux / win（子任务编号 T3.1–T3.6，与 P3 的 T3.x 无关）。

- [x] **字体来源统一为 `FontSource`**（`{type:'default'|'url'|'local'}`）：`js/config.js` 新增 `Z.FONTS_KEY` / `DEFAULTS.FontSource` / `DEFAULTS.PreviewText` / Schema 两项 / `Z.normalizeFontSource`；旧 `fontURL` 仅在**未保存过来源**时迁移为 `{type:'url'}`；`store.js::setFontSource` 镜像 `fontURL` 兼容旧路径与设置导出。
- [x] **本地字体库**：`js/font-store.js`（IndexedDB `zitie-fonts` 存二进制 + localStorage `zitie.fonts` 存元数据）；`js/font.js::Z.Font.use(source)` 统一注入（local 分支**转 ArrayBuffer** 构造 `FontFace('ziti')` + `document.fonts.add` + `body.custom-font`；`clear()` 恢复默认）；`web/src/FontManager.jsx` 替换 FontGroup（当前字体 / 预览字样 / 多选导入 / 列表 / 应用 / 改名 / 停用启用 / 删除 + 网络地址区）；`App.jsx` 订阅 `FontSource`。
- [x] **测试与实测**：shared 34 项 + 组件 13 项（导入→应用、改名/停用回退/删除、网络成功/失败、存储不可用降级）；dev 5173 + dist `file://` 双场景实测——导入刷新仍在；应用 1.ttf 后 `ziti:loaded` + `body.custom-font`，canvas alpha 位图 ziti 802 vs 默认 706（相异）；应用字体 vs 默认两次导出 PDF 哈希不同；改名 / 停用（正应用时恢复默认）/ 删除（列表 + 二进制同步）生效；无效文件（.txt/.json）拒绝。
- 关键结论：Chrome `FontFace` 构造不接受 Blob 源（报 `could not be parsed as a value list`），必须转 ArrayBuffer；`document.fonts.check` 不可作为加载成功判据（须 `fonts.load` + 像素对比）。
- 验收：`npm test` 全绿（shared 34 + ESM + toast 7 + 组件 13 + 冒烟 8）、`npm run build` 通过（dist 单文件 949.5 KB）。

---

## 12. Kindle 服务模式（2026-11-20）

> 需求：Kindle 实验浏览器不支持 IndexedDB，标准版（React）跑不起来；Kindle 走 lite 版（ES5）。字体改为**网络获取**：启动本地服务后 lite 列出服务端 `font/` 字体；标准版把 IndexedDB 里管理好的字体**发布**到该目录，实现「标准版管理 → Kindle 可见」（T4.1–T4.6）。

- [x] **服务 `tools/serve.js`**（零依赖 Node http，CJS + ES6+ 语法）：静态根 `dist/`，默认 `0.0.0.0:8080`（`--port` / `PORT`），启动打印局域网 IP 与标准版 / lite 入口。
  - `GET /api/fonts` → `dist/font/` 清单 `[{name,file,size,url:'/font/<file>'}]`；`POST /api/fonts`（`X-Filename` + 可选 `X-Label`，raw body）写入；`DELETE /api/fonts/<file>` 删除。
  - 安全：文件名去路径、限 `[A-Za-z0-9._-]`、扩展名白名单（ttf/otf/woff/woff2）、≤20MB、路径前缀校验防穿越；删除同步清理 `<file>.label`。
- [x] **标准版发布**（`web/src/FontManager.jsx`）：仅 `location.protocol` 为 http(s) 时列表项显示「发布」；`POST /api/fonts` 上传 IndexedDB blob，成功 toast「已发布「<名>」，Kindle 版刷新后可见。」，失败提示原因。`file://` 无发布入口。
- [x] **lite 网络字体列表**（`lite-src/main.js` + `template.html`）：字体区新增 `#fontList`；启动用 **XHR**（非 fetch，兼容老浏览器）拉 `/api/fonts` 渲染条目（label + 大小），点击写地址并 `Z.Font.apply(url)`；`file://` / 无服务时隐藏，仅保留地址框。
- **关键结论**：实测 Chrome `@font-face` 对 percent-encoded 非 ASCII 路径（`/font/%E6%B5%8B…ttf`）**加载失败**（curl 200，ASCII 路径正常），故服务端文件名一律 ASCII；中文显示名经 `X-Label` 存 sidecar，`GET /api/fonts` 返回 label 作 `name`，lite 列表展示中文。发布文件名优先取字体 id（如 `fzz01.woff`），中文名全转下划线时回退 id。
- 验收：`npm test` 全绿（serve 7 + 组件 15 + shared/ESM/toast/冒烟）、`npm run build` 通过；http 实测发布「测试楷体」→ 服务端 `fzz01.woff` + 中文 label → lite 列表显示中文 → 点击注入 `body.custom-font` + `@font-face /font/fzz01.woff` → canvas 黑色像素 ziti 530 vs 默认 1045（字形切换）；`file://` 标准版发布按钮隐藏、lite 列表隐藏；非 ASCII / `.txt` / 空 body 400、超限 413、穿越删除 404。

---

## 13. lite 黑白屏精简重设计（2026-11-20）

> 反馈：Kindle 是黑白屏，原 lite 按彩色桌面逻辑设计，控件无意义、操作不合理。方向：**能换字体、能输入文字即可**；面板只留「内容 / 字体 / 字格样式」；预览区支持点击翻下一批、↑/↓ 逐字移动（T5.1–T5.5）。

- [x] **精简面板**（`lite-src/template.html`）：删除显示拼音 / 排版模板 / 范字格数 / 文字颜色 / 文字深浅 / 标题 / 字格颜色 / 格子大小与底部说明；保留内容输入、字体（地址 + 服务列表）、字格样式（田 / 米 / 米字回 / 回）。
- [x] **固定渲染参数**（`lite-src/main.js` 的 `FIXED`）：整页描红、深灰 `35,38,43`、文字深浅 0.62（描红 0.31）、格子 80px、`TraceCount=3`、字格灰色；不再读用户残留的模板 / 颜色 / 拼音 / 大小配置，行为确定。移除内联 `pinyin-util`。
- [x] **竖排布局**（`lite-src/style.css`）：预览区在上、设置区在下（Kindle 竖屏优先看字）；面板自适应宽度；字格样式横排；字号加大到 16px；黑白高对比。
- [x] **预览交互**：字格带 `data-idx`；点击预览 → 翻到下一批（按窗口可视高度 80% 计算，跳到视口底部之后的首字）；`keydown` ↑/↓ → 逐字高亮（`.cell.is-current`）并滚动到视口中部；输入框聚焦时不拦截按键；重渲染后 `currentIdx` 归零。
- 验收：`npm run build` 通过，`dist/lite/index.html` 135.4 KB → **23.9 KB**；`npm test` 全绿（serve 7 + 组件 15 + shared/ESM/toast/冒烟）；实测派发 keydown 40/38 → `data-idx` 2→1，派发 click → 240 字中 idx 0→32 且滚动 406px，字格样式切田字格生效。

---

## 14. lite 点击放大 + 弹窗设置（2026-11-20）

> 反馈：点击字应是「把字放大」；内容输入等设置不要占预览位置，收进弹窗。用户确认：点击字格 → 遮罩大字 + 左右切换；顶栏三个按钮（内容 / 字体 / 字格）分别开弹窗（T6.1–T6.5）。

- [x] **结构**（`lite-src/template.html`）：删除 `.panel`；顶栏 5 按钮（内容 / 字体 / 字格 / 示例 / 清空）；新增 3 个 `.modal`（内容 textarea + 完成/取消、字体地址 + 应用 + 服务列表、字格 4 radio）与 `#zoomOverlay`（大字 + 底部提示，无按钮）。
- [x] **放大层**（`lite-src/main.js`）：点击预览区字格（事件委托 `data-idx`）→ 打开遮罩，尺寸 `min(innerWidth, innerHeight) * 0.6`（下限 120px，不用 vmin/min()），字格背景沿用当前样式；**无按钮**——点中间（含字格）退出，点左 / 右各 15% 边缘切换上 / 下一个字；Esc 与 ←/→ 键后备；打开时 `body overflow:hidden`；点预览空白不触发。
- [x] **弹窗**：内容「完成」才渲染（输入时只保存，避免 Kindle 弱性能频繁重排），「取消」还原；字格 radio change 即时渲染；字体应用 + 服务列表点击；点遮罩空白 / 关闭按钮 / Esc 关闭；打开任一项前先关放大层。
- [x] **删除点击翻批**：点击手势让位给放大；浏览用滚动 + ↑/↓ 逐字（保留），放大层 ←/→ 覆盖「看下一个字」。
- 验收：`npm run build` 通过，lite 27.9 KB；`npm test` 全绿；实测点击字格 → 「永」放大 254px、←/→ 天→地→玄→地、点边缘切换、中点退出（`display:none`）、空白不放大；overlay 内按钮数 0；三弹窗各自功能正常；↑/↓ 逐字仍生效。

---

## 15. 标准版图标分类左栏 + 文房视觉（2026-11-20）

> 反馈：左侧设置面板应「分类出来，点击图标切换功能」；视觉走「文房强化」方向（概念稿 `doc/concept-wenfang-nav.html` 确认后落地）。

- [x] **顶栏**（`web/src/App.jsx`）：品牌（朱砂印章「帖」+ 墨帖 + v版本）、主题分段（浅色 / 深色 / 跟随系统）、导出 PDF、打印；主题切换从面板移到顶栏。
- [x] **rail 分类**（`web/src/Panel.jsx`）：60px 图标 rail——内容 / 版式 / 字格 / 文字 / 输出 + 底部「关于」；272px 面板按页切换（默认「内容」），每页含 page-head（标题 + 当前生效值副标题）。
- [x] **导出 PDF 复用**（`web/src/usePdfExport.js`）：抽出 `usePdfExport`，顶栏与「输出」页共用同一份逻辑。
- [x] **视觉**（`web/src/styles.css`）：米白纸面 + 朱砂点缀、印章 logo、低对比分隔、rail 图标激活态、`.rp-page-head` / `.rp-page-note` / `.rp-about-text`；滑块 `accent-color` 朱砂；主体 `100vh`，面板与预览各自滚动。
- [x] **分类映射**：内容（输入 / 工具 / 标题 / 统计）、版式（排版 / 纸张 / 元信息）、字格（样式 / 颜色 / 大小）、文字（颜色 / 深浅 / 拼音 / 笔顺 / 字体）、输出（导出打印 / 设置预设）、关于（版本）。
- 验收：`npm run build` 通过（dist 960.2 KB / lite 28.6 KB）；`npm test` 全绿（组件 16 + serve 7 + shared / ESM / toast / 冒烟）；浏览器实测 rail 切换（版式副标题「每行 8 格 · 210 × 297 mm · 80px」、关于页版本、字格 7 样式 3 色、文字页字体入口、输出页导出 JSON）、点击「浅色」→ `data-theme=light`。

---

## 16. 空格子：空格占位 + 行尾补满（2026-11-20）

> 反馈：「我想插入空的格子」。已确认方案：行保持左对齐；内容里的空格即空临格；每行末尾自动补满空临格到整行格数。

- [x] **空格占位**（`js/content.js`）：半角 / 全角 / Tab 空格解析为占位空临格（`chars.push('')`），计入格子、不计入 `total` 与 `hanStats`；标点前是空格占位时忽略（不附到空格）。**空行语义区分**：真空行 = 分页（保留手动分页）；只含空格的行 = 占位空临格行（行尾补满到整行格数），不再被 `trim()` 吞成分页。
- [x] **行尾补满**（`paginate`）：每行（非空行）末尾补 `''` 到 `cols`；折行每段同样补满；分页标记不补。
- [x] **空临格角色**（`js/sheet-layout.js`）：`char === ''` 一律 `role: 'blank'`，屏幕 / 打印 / PDF 三端只画格不画字。
- [x] **点击编辑索引**（`web/src/Preview.jsx`）：`cellKeys` 只对非 blank 格递增汉字序号，与 `replaceHanAt` 对齐；回车跳过 blank 格聚焦下一个可编辑格。
- [x] **插入空格按钮**（`web/src/Panel.jsx`）：内容页工具区在 textarea 光标处插入半角空格，保持焦点与光标；副标题提示「空格即空临格」。
- [x] **预览真实尺寸**（`web/src/Preview.jsx` + `styles.css`）：预览纸张按 96dpi 真实像素显示（`Page.width * 96 / 25.4`），页边距同样按配置 `Margin`（mm→px）内联，窄区横向滚动；打印时 `width / padding: auto / 0 !important` 交还 `@page`。避免补满后格子换行，并修正「预览固定 20px padding ≠ 配置 16mm」导致的左右边距不对称。
- [x] **lite**：共享 `parse`，空格占位生效；字数统计跳过占位格（`lite-src/main.js`）。
- 验收：`npm run build` 通过（dist 961.0 KB / lite 28.8 KB）；`npm test` 全绿（shared 39 + serve 7 + 组件 16 + ESM / toast / 冒烟）；浏览器实测「天 地」→ 首行 8 格（2 字 + 6 空临格）、行高 107px 不换行、纸张 794px、点击第 3 格「地」改为「水」→ 内容 `天 水`（空格占位保留、不错位）、「插入空格」按钮在光标处插入、PDF 导出 85KB 成功。
