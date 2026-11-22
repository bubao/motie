# 自动识别浏览器

打开 `dist/index.html` 时，入口内联的检测脚本（独立 detect 逻辑，已内联）会在页面加载前完成检测并自动选择版本：

1. **能力探测**：检测 CSS 变量（`var()`）、Promise、`URL` 构造器、`Array.from`、`Object.assign`、`replaceChildren`、动态 `import()`、Unicode 属性转义（`\p{Script=Han}`）；
2. **UA 特征**：`kindle / silk / netfront / kobo / nook / pocketbook / boox / onyx / ireader / tolino / bookeen / storytel` 等墨水屏 / 老式阅读设备（即使探测通过也优先用练字版）；
3. 命中任一条件 → 自动跳转到 `lite/index.html`；否则留在完整版。

## 手动覆盖

URL 参数：

- `?force=modern`：强制留在完整版
- `?force=lite`：强制去练字版
- `?nodetect=1`：关闭自动跳转（调试用）
