# AGENTS

## 项目定位

`incremental-reading-zh` 是 [kja140/incremental-reading](https://github.com/kja140/incremental-reading)（Obsidian 插件 Incremental Reading Toolkit，MIT）的简体中文汉化 fork。只替换面向用户的字符串，不改上游逻辑；插件 id 为 `incremental-reading-zh`，与上游英文版可并存。

## 运行与验证

- `npm run check` —— 必跑门禁：`node --check` + 发布元数据校验 + 译文校验 + 95 项单测。
- `npm test` —— 仅跑单测。
- `npm run i18n:check` —— 校验 `i18n/zh-CN.jsonl` 格式，并确认每条译文都已落到 `main.js`。

## 技术栈

纯 JavaScript（Node ≥ 18），无构建步骤：Obsidian 直接加载 `main.js`、`manifest.json`、`styles.css`。单测用 `node --test`，源码即产物。

## 目录与约定

- `main.js` —— 插件唯一源文件，也是汉化产物；不要手工零散改文案，走 i18n 流水线。
- `i18n/GLOSSARY.md` —— 术语表、跳过规则、工具链说明（汉化前必读）。
- `i18n/keys.json` —— 由 `scripts/i18n-extract.mjs` 从英文 `main.js` 抽取的候选字符串索引。
- `i18n/zh-CN.jsonl` —— `{"i":N,"zh":"…"}` 译文，按 `keys.json` 的索引对齐。
- `scripts/i18n-*` —— extract / remap / apply 三步流水线；合并上游后：`git checkout upstream/main -- main.js && npm run i18n:remap && npm run i18n:apply`。
- `docs/USER-GUIDE.zh-CN.md` —— 中文使用指南，命令名必须与 `main.js` 中的实际文案逐字一致。

## 硬约束

- **MUST NOT** 汉化 `main.js` 中 `// >>> xxx-functions` 与 `// <<< xxx-functions` 之间的内联代码块：它们必须与 `tree-core.js` 等独立 core 文件逐字节一致，`test/inline-utils`/`test/inline-sync.test.js` 会校验漂移。抽取脚本已自动跳过。
- **MUST NOT** 改 frontmatter 键值、标签、文件夹路径、日期格式 token、正则与 CSS class：这些是数据格式，改了会与上游笔记不兼容。
- **AFTER** 修改任何用户可见文案 -> **MUST** 跑 `npm run check`，并同步 `docs/USER-GUIDE.zh-CN.md` 中引用的命令名。
- **IF** 单测断言了被翻译的文案 -> **MUST** 同步更新该断言，**MUST NOT** 用跳过或降低断言强度绕过。

## 当前状态

v1.1.8 汉化完成：557 条译文，`npm run check` 全绿（95 项测试通过）。上游英文文档 `docs/USER-GUIDE.md`、`docs-site/` 保持原样。
