# AGENTS

## 项目定位

`incremental-reading-enhance` 是 kja140/incremental-reading（Obsidian 插件 Incremental Reading Toolkit，MIT）简体中文汉化版的下游增强分支，在 d0ublecl1ck/incremental-reading-zh 的汉化基础上增加本地功能。插件 id 为 `incremental-reading-enhance`。三个 id 互不相同，但会扫描同一批 IR 笔记，同一时间只应启用一个。

## 运行与验证

- `npm run check`：必跑门禁，内容为 `node --check` + 发布元数据校验 + 译文校验 + 单测。
- `npm test`：仅跑单测。
- `npm run i18n:check`：校验 i18n/zh-CN.jsonl 格式，并确认每条译文都已落到 main.js。

## 技术栈

纯 JavaScript，Node ≥ 18，无构建步骤；Obsidian 直接加载 main.js、manifest.json、styles.css。单测用 `node --test`，源码即产物。

## 目录与约定

- main.js：插件唯一源文件，同时承载汉化产物与本地增强，不要手工零散改文案，走 i18n 流水线。
- main.js 中 `// ===== ENHANCE BEGIN =====` 与 `// ===== ENHANCE END =====` 之间、以及 `// ---- 增强：把常用菜单项提升为可绑键的命令 ----` 之后是本地增强；合并上游后必须重新套用，清单与步骤见 docs/ENHANCE.zh-CN.md。
- docs/ENHANCE.zh-CN.md：本地增强的命令、行为与重新套用步骤。
- i18n/GLOSSARY.md：术语表、跳过规则与工具链说明，汉化前必读。
- scripts/i18n-*：extract / remap / apply 三步流水线。合并上游时先 `git checkout upstream/main -- main.js`，再 `npm run i18n:remap`、`npm run i18n:apply`，最后按 docs/ENHANCE.zh-CN.md 重贴增强块。
- docs/USER-GUIDE.zh-CN.md：中文使用指南，命令名必须与 main.js 实际文案逐字一致。

## 增强命令

在纯汉化版的 9 条命令之外新增 9 条，均可在 Obsidian「设置 → 快捷键」绑定：阅读点：设到光标、阅读点：跳转到阅读位置、当前元素：已完成、当前元素：搁置、当前元素：推迟、删除当前 IR 材料…、移出 IR（保留笔记）…、从剪贴板新建来源（文章）、从 EPUB 导入来源…。

## 硬约束

- 禁止汉化 main.js 中 `// >>> xxx-functions` 与 `// <<< xxx-functions` 之间的内联代码块，它们必须与 tree-core.js 等独立 core 文件逐字节一致，`test/inline-sync.test.js` 会校验漂移，抽取脚本已自动跳过。
- 禁止改 frontmatter 键值、标签、文件夹路径、日期格式 token、正则与 CSS Class，这些是数据格式，改了会与上游笔记不兼容。
- 修改任何用户可见文案后，必须跑 `npm run check`，并同步 docs/USER-GUIDE.zh-CN.md 中引用的命令名。
- 单测断言了被翻译的文案或命令数量时，必须同步更新该断言，禁止用跳过或降低断言强度绕过。

## 当前状态

v1.1.8 + 首批增强：18 条命令（9 条原有 + 9 条增强），`npm run check` 全绿。