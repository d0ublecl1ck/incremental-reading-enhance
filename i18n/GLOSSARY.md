# 汉化术语表与规则（incremental-reading-enhance）

本文件是 `incremental-reading-enhance` 的汉化规范。`i18n/keys.json` 是 `scripts/i18n-extract.mjs` 从英文 `main.js` 抽取出的候选字符串索引；`i18n/zh-CN.jsonl` 是按索引存放的译文。

## 工具链

| 命令 | 作用 |
| --- | --- |
| `npm run i18n:extract` | 从当前 `main.js` 重建 `i18n/keys.json`（索引会变化，需配合 `i18n:remap`） |
| `npm run i18n:remap` | 依据旧 `keys.json` 的原文，把 `zh-CN.jsonl` 的译文重新对齐到重建后的索引 |
| `npm run i18n:apply` | 按索引把译文写回 `main.js`（`--write`），未收录的字符串保持英文 |
| `npm run i18n:check` | 校验译文文件格式，并确认每条译文都已落到 `main.js`；已接入 `npm run check` |

`scripts/i18n-extract.mjs` 会跳过 `main.js` 里 `// >>> xxx-functions` 与 `// <<< xxx-functions` 之间的内联代码块：这些区间必须与独立 core 文件逐字节一致（`test/inline-sync.test.js` 会校验），因此禁止汉化。

## 术语表（必须一致）

| 英文 | 中文 |
| --- | --- |
| incremental reading | 渐进阅读 |
| source | 来源 |
| extract | 摘录 |
| topic | 主题 |
| card | 卡片 |
| review | 复习 |
| reading queue | 阅读队列 |
| knowledge tree | 知识树 |
| dashboard | 仪表盘 |
| session | 会话 |
| schedule / reschedule | 排期 |
| overdue | 逾期 |
| due | 到期 |
| postpone | 推迟 |
| dismiss | 搁置 |
| done | 已完成 |
| reset | 重置 |
| checkpoint | 检查点 |
| read point | 阅读位置 |
| A-Factor | A 因子 |
| stall guard | 停滞保护 |
| progress-aware | 进度感知 |
| inline card | 行内卡片 |
| occlusion | 遮挡 |
| cloze deletion | 填空删除 |
| grade | 评级 |
| boost | 提升 |
| subtree | 子树 |
| category | 分类 |
| attachment | 附件 |
| setup check | 配置检查 |
| mercy | 宽限 |
| split article / split book | 拆分文章 / 拆分书籍 |
| frontmatter | frontmatter（保留原文） |

插件专有名保留英文原文，不翻译：`Flashcards`、`Spaced Repetition`、`Anki`、`AnkiConnect`、`FSRS`、`Toolkit`、`Reuseman`、`PDF++`、`Wozniak`。

## 必须跳过、不得翻译的内容

- 日期格式 token：`DD-MM-YYYY`、`MM-DD-YYYY`、`YYYY-MM-DD`。
- 路径与文件夹名：任何含 `/` 的字符串（如 `Sources/Incremental Reading/Sources`、`Sources/Incremental Reading/Review Log.md`）。
- YAML / frontmatter 片段与键值：形如 `type: card`、`status: pending`、`interval: 1`、`review_count: 0`、`priority: ${priority}`、`tags:`、`ir_card_backend: ...`、`ir_anki: true`、`card_format: ...`、`date_added: ...`、`a_factor: ...` 等。
- 代码标识：CSS class 名、正则表达式、`use strict`、`Cannot find module`、`require(...)`。
- 设置项的内部取值：`urgency`、`priority`、`due_date`、`toolkit`、`anki`、`spaced_repetition`、`book`、`article`、`pdf`、`youtube`、`video`、`all`、`due`、`custom`。
- 键盘按键名：`Enter`、`Escape`、`ArrowRight`、`ArrowLeft`，以及 `Cmd/Ctrl+...` 组合键提示。
- 只写给开发者控制台的调试串：以 `[IR]` 或 `[Incremental Reading Toolkit]` 开头的、以及 `_dbg` / `console` 用的（如 `queue render`、`flashcard: cardFormat =`）。
- 纯插值或无自然语言的模板：如 `${newParentName}`、`${today.getFullYear()}-...`、`  - incremental-reading`、` - [[${noteTitle}]]`。
- 生成笔记时的 frontmatter 模板整段（含 `---` 与 `tags:` 的模板）。
- Markdown 结构片段：`\n<br>\n`、`\n---\n`、`\n- `、`\n> `、`\n?\n`。

## 译文要求

- 一律简体中文，语气与原文一致（设置说明用陈述句，按钮/菜单用短词）。
- 译文里 **不得** 出现英文双引号 `"`、反引号、反斜杠；需要引号时用「」。
- `${...}` 插值表达式必须逐字保留；表达式内部可翻译的英文枚举串（如 `'source/extract/card'`）可以译成中文（`'来源/摘录/卡片'`）。
- 保留 emoji（`📍`、`✨`、`🃏`、`📖`、`📝`、`⤴`）与 `.md`、`N cards` 中的数字。
- 保留专有名词原样：`Nd::`、`Q::A`、`{{c1::答案::提示}}`、`pdf_path`、`pdf_vault_path`、`cards-deck`、`HH:MM` 等。
- 中文标点用全角；完整句子句末加「。」，按钮、菜单项、设置名不加句号。
- 不增删信息，不改数值与单位。