<p align="center">
  <img src="docs-site/static/img/favicon.svg" width="88" height="88" alt="Incremental Reading Toolkit logo">
</p>

<h1 align="center">Incremental Reading Toolkit</h1>

<p align="center">
  Turn long-form reading into scheduled topics, focused extracts, and durable flashcards—without leaving Obsidian.
</p>

<p align="center">
  <a href="https://incremental-reading.kjames.xyz/">Documentation</a>
  · <a href="docs/USER-GUIDE.md">User guide</a>
  · <a href="https://github.com/kja140/incremental-reading/releases">Releases</a>
  · <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <img alt="GitHub release" src="https://img.shields.io/github/v/release/kja140/incremental-reading?style=flat-square">
  <img alt="License" src="https://img.shields.io/github/license/kja140/incremental-reading?style=flat-square">
  <img alt="Desktop only" src="https://img.shields.io/badge/Obsidian-desktop_only-7c3aed?style=flat-square">
</p>

---

<p align="center">
  <b>简体中文汉化版</b> · fork 自 <a href="https://github.com/kja140/incremental-reading">kja140/incremental-reading</a>（MIT）
</p>

## 中文版说明

本仓库是 [d0ublecl1ck/incremental-reading-zh](https://github.com/d0ublecl1ck/incremental-reading-zh)（简体中文汉化 fork）的下游增强分支，插件 id 为 `incremental-reading-enhance`。在纯汉化之外增加本地功能，第一批是把「当前元素操作…」菜单里的常用动作提升为可绑键的 Obsidian 命令，并补上删除材料与移出 IR。增强清单见 [docs/ENHANCE.zh-CN.md](docs/ENHANCE.zh-CN.md)。

- 汉化范围：插件内面向用户的全部文案（命令、设置项、通知、弹窗、侧边栏、仪表盘、内置使用指南）。
- 保持不变：笔记 frontmatter 键值、标签、文件夹路径、日期格式与正则表达式等数据格式与上游一致，因此中英文版本可以共用同一批笔记。
- 与英文版的关系：不改动上游逻辑，只替换字符串；上游发新版本后可按下面的流程重新套用汉化。
- 术语与译文规范见 [`i18n/GLOSSARY.md`](i18n/GLOSSARY.md)，译文存放于 [`i18n/zh-CN.jsonl`](i18n/zh-CN.jsonl)。
- 中文使用指南：[`docs/USER-GUIDE.zh-CN.md`](docs/USER-GUIDE.zh-CN.md)（上游英文原文：[`docs/USER-GUIDE.md`](docs/USER-GUIDE.md)）；插件内「打开使用指南」弹窗也已是中文。

### 安装

1. 取得本仓库的 `main.js`、`manifest.json`、`styles.css`。
2. 放入 `<你的库>/.obsidian/plugins/incremental-reading-enhance/`。
3. 在 Obsidian「设置 → 第三方插件」中启用「渐进阅读工具包（中文版）」。

### 重新套用汉化 / 合并上游

```bash
git fetch upstream
git checkout upstream/main -- main.js   # 取回英文 main.js
npm run i18n:remap                      # 重建 i18n/keys.json，并按原文把译文重新对齐到新索引
npm run i18n:apply                      # 把 i18n/zh-CN.jsonl 的译文写回 main.js
npm run check                           # node --check + 发布元数据 + 译文校验 + 95 项测试
```

`npm run i18n:check` 会校验译文文件格式，并确认每条译文都已落到 `main.js`，已接入 `npm run check`。

---

Incremental Reading Toolkit helps you read long sources a little at a time, revisit them on a useful schedule, extract the parts that matter, and turn those extracts into flashcards. It works with Markdown notes, PDFs, clipboard content, and images.

Topic scheduling uses a progress-aware **A-Factor**. For flashcards, choose the Toolkit's built-in FSRS review, export to Anki through Reuseman's [Flashcards](https://github.com/reuseman/flashcards-obsidian) plugin, or retain the existing [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) integration.

> [!IMPORTANT]
> This plugin is desktop-only. Its integrated reader uses Electron and Node APIs to open vault PDFs and local external PDF paths; those APIs are unavailable on mobile.

## At a glance

| Material | Role in the workflow | Scheduling |
|:--|:--|:--|
| 📖 **Sources** | Articles, books, videos, and long notes you revisit in portions | Reading queue + A-Factor |
| ✂️ **Extracts** | Focused passages linked back to their parent source | Reading queue + A-Factor |
| 🃏 **Cards** | Markdown flashcards linked to their source | Toolkit FSRS, Anki, or Spaced Repetition |

```text
Source → Read a portion → Extract the useful part → Make a card → Review
   ↑              A-Factor schedules topics              chosen card system ↑
```

## Highlights

| | Feature | What it gives you |
|:--:|:--|:--|
| 🔀 | **Mixed learning queue** | Alternates priority-aware reading topics with Toolkit and Spaced Repetition card notes. Anki cards stay in Anki's review queue. |
| 🧠 | **Progress-aware scheduling** | Recomputes topic intervals from remaining pages or seconds, with pace controls and a stall guard. |
| ✂️ | **Fast capture** | Creates extracts from selected text, the clipboard, or a PDF and links them to their parent. |
| 🃏 | **Flexible flashcards** | Creates cards from text, images, inline syntax, and image occlusion. |
| 🌳 | **Knowledge tree** | Shows source and extract relationships with filtering, ordering, and drag-to-reparent. |
| 📋 | **Reading queue** | Keeps today’s session, overdue work, new material, and active topics visible in the sidebar. |
| 📊 | **Analytics dashboard** | Shows session health, a 14-day review graph, queue workload, collection mix, and lifetime totals. |
| 📄 | **Integrated PDF reader** | Opens vault or external PDFs with page navigation and saved read points. |

Inline-card export understands `Q:: … ::A::`, `{{c1::…}}`, and `==highlight==` syntax and sends new cards to the selected card system.

## Installation

### Community Plugins

1. Open **Settings → Community plugins** in Obsidian.
2. Search for **Incremental Reading Toolkit**, then install and enable it.
3. Under **Flashcards → Create cards with**, choose **Toolkit (in-house)** or **Anki via Flashcards**. The compatibility option keeps the existing Spaced Repetition workflow.
4. For Anki, install **Flashcards** by Reuseman and AnkiConnect, grant permission in Flashcards settings, and keep Anki running when syncing. For the SR option, install **Spaced Repetition**.
5. Run the setup check from the Toolkit settings.

The choice applies to newly created cards. Backend ownership is stored on each card, so changing the setting does not silently convert existing material.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [release](https://github.com/kja140/incremental-reading/releases).
2. Copy them into `<vault>/.obsidian/plugins/incremental-reading-toolkit/`.
3. Reload Obsidian, then enable **Incremental Reading Toolkit**.
4. Optionally install Reuseman's **Flashcards** or **Spaced Repetition** for the corresponding external workflow.

## Five-minute workflow

1. **Capture a source.** Open **Capture or create…**, then choose **Import clipping (active note)** or **New source**.
2. **Build the queue.** Run **Build today's session queue** once, then run **Next element**.
3. **Keep the valuable parts.** Select important text and run **Extract selection**.
4. **Schedule the return.** Leave the cursor where you stopped, then run **Grade current reading topic**.
5. **Create recall material.** Run **Flashcard from clipboard**. Toolkit cards open the built-in review window; SR cards open that plugin; Anki cards sync to Anki and are reviewed there.

For recommended keybindings and complete note, PDF, card, queue, and date workflows, open the [user guide](docs/USER-GUIDE.md). You can also run **Open user guide** inside Obsidian.

> [!NOTE]
> Upgrading from a pre-release development build? Open **Advanced tools…** and run **Migrate legacy cards to Spaced Repetition** once. It preserves card content and source links while replacing legacy scheduling fields.

## Command reference

| Command | Purpose |
|:--|:--|
| **Build today's session queue** | Explicitly calculate and save today's scheduled queue. |
| **Next element** | Open the following saved queue path; start the correct in-vault card reviewer when applicable. |
| **Grade current reading topic** | Grade the current source/extract, or an open Toolkit-owned card, without navigating. |
| **Extract selection** | Turn selected source text into a linked extract. |
| **Flashcard from clipboard** | Create a card in the selected Toolkit, Anki, or SR workflow. |
| **Capture or create…** | New/imported sources, PDF-aware extracts, image cards, image extracts, and occlusions. |
| **Current element actions…** | Done/reset (including cards), dismiss, postpone, schedule, priority, parent/PDF navigation, read points, and checkpoints. |
| **Open Toolkit view…** | Dashboard, analytics, queue, knowledge tree, or user guide. |
| **Advanced tools…** | Subset/overload tools, splits, tree editing, migration, inline-card export, and diagnostics. |

## Settings

Settings are grouped by workflow and include plain-language descriptions.

| Section | Configure |
|:--|:--|
| **Scheduling** | Reading intervals, progress awareness, A-Factor bounds, pace adjustments, and the stall guard. |
| **Queue** | Mixed-card behaviour, ordering, filters, and session display. |
| **Flashcards** | Backend used for newly created cards. |
| **Inline cards** | Question/answer and cloze parsing patterns. |
| **Anki via Flashcards** | Reuseman Flashcards status, target deck, card tag, and automatic sync. |
| **Spaced Repetition** | Dependency status, deck tag, and multiline card separators. |
| **Knowledge tree** | Multi-select Done/Reset actions, branch warnings, completion visibility, and expansion state. |
| **Paths** | Every plugin-managed source, extract, card, category, attachment, dashboard, and log path. |
| **General** | Date convention, extract highlight colour, and diagnostic logging. |

Use **Run setup check** to verify the selected card dependency, folder separation, and A-Factor bounds. Toolkit cards use built-in FSRS; Anki and Spaced Repetition retain ownership of their own review algorithms.

## Privacy and permissions

Incremental Reading Toolkit is local-first: no telemetry, advertisements, account requirement, or built-in update mechanism.

| Permission | Behaviour |
|:--|:--|
| **Clipboard** | Reads text or images only after you run a clipboard capture command. |
| **External files** | Reads only the local PDF stored in the active source’s `pdf_path`; it does not modify the PDF. EPUB is not supported. |
| **Network** | Makes no plugin-initiated network requests. Opening a YouTube embed allows Obsidian to connect to YouTube. |
| **Vault** | Enumerates configured toolkit folders and writes only to configured plugin paths. Migrations require an explicit command. |

## Design lineage

The toolkit is inspired by [SuperMemo’s incremental reading](https://help.supermemo.org/wiki/Incremental_reading) workflow and [bjsi’s Incremental Writing plugin](https://github.com/bjsi/incremental-writing) for Obsidian.

SuperMemo established the model of importing sources, revisiting prioritized portions, extracting important material, and turning it into durable question-and-answer knowledge. Incremental Writing demonstrated how prioritized, scheduled queues can feel native inside an Obsidian vault.

This is an independent plugin and is not affiliated with or endorsed by SuperMemo or the Incremental Writing project. See [SuperMemo workflow alignment](docs/SUPERMEMO-ALIGNMENT.md) for a feature-by-feature comparison and the intentional differences.

## Development

```bash
npm install
npm run check
```

`main.js` is the shipped plugin. `tree-core.js` contains the pure, Obsidian-free tree logic that is unit-tested and inlined into `main.js`; a regression test keeps both copies synchronized.

See [RELEASING.md](RELEASING.md) for the release and Community Plugins submission checklist.

## License

Released under the [MIT License](LICENSE).