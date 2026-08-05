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

Incremental Reading Toolkit helps you read long sources a little at a time, revisit them on a useful schedule, extract the parts that matter, and turn those extracts into flashcards. It works with Markdown notes, PDFs, clipboard content, and images.

Topic scheduling uses a progress-aware **A-Factor**. Flashcard scheduling and grading are handled by the actively maintained [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) community plugin.

> [!IMPORTANT]
> This plugin is desktop-only. Its integrated reader uses Electron and Node APIs to open vault PDFs and local external PDF paths; those APIs are unavailable on mobile.

## At a glance

| Material | Role in the workflow | Scheduling |
|:--|:--|:--|
| 📖 **Sources** | Articles, books, videos, and long notes you revisit in portions | Reading queue + A-Factor |
| ✂️ **Extracts** | Focused passages linked back to their parent source | Reading queue + A-Factor |
| 🃏 **Cards** | Native Markdown flashcards in `#flashcards/incremental-reading` | Spaced Repetition plugin |

```text
Source → Read a portion → Extract the useful part → Make a card → Review
   ↑              A-Factor schedules topics              Spaced Repetition ↑
```

## Highlights

| | Feature | What it gives you |
|:--:|:--|:--|
| 🔀 | **Mixed learning queue** | Alternates priority-aware reading topics with Spaced Repetition card notes. |
| 🧠 | **Progress-aware scheduling** | Recomputes topic intervals from remaining pages or seconds, with pace controls and a stall guard. |
| ✂️ | **Fast capture** | Creates extracts from selected text, the clipboard, or a PDF and links them to their parent. |
| 🃏 | **Flexible flashcards** | Creates cards from text, images, inline syntax, and image occlusion. |
| 🌳 | **Knowledge tree** | Shows source and extract relationships with filtering, ordering, and drag-to-reparent. |
| 📋 | **Reading queue** | Keeps today’s session, overdue work, new material, and active topics visible in the sidebar. |
| 📊 | **Analytics dashboard** | Shows session health, a 14-day review graph, queue workload, collection mix, and lifetime totals. |
| 📄 | **Integrated PDF reader** | Opens vault or external PDFs with page navigation and saved read points. |

Inline-card export understands `Q:: … ::A::`, `{{c1::…}}`, and `==highlight==` syntax and converts it into native Spaced Repetition card notes.

## Installation

### Community Plugins

1. Open **Settings → Community plugins** in Obsidian.
2. Install and enable **Spaced Repetition**.
3. Search for **Incremental Reading Toolkit**, then install and enable it.
4. Run **Incremental Reading Toolkit: Run setup check** from the plugin settings.

Card creation writes Spaced Repetition-compatible Markdown. Topic scheduling remains available if Spaced Repetition is missing, and card-review commands will show an installation reminder.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [release](https://github.com/kja140/incremental-reading/releases).
2. Copy them into `<vault>/.obsidian/plugins/incremental-reading-toolkit/`.
3. Install and enable **Spaced Repetition**.
4. Reload Obsidian, then enable **Incremental Reading Toolkit**.

## Five-minute workflow

1. **Capture a source.** Open **Capture or create…**, then choose **Import clipping (active note)** or **New source**.
2. **Build the queue.** Run **Build today's session queue** once, then run **Next element**.
3. **Keep the valuable parts.** Select important text and run **Extract selection**.
4. **Schedule the return.** Leave the cursor where you stopped, then run **Grade current reading topic**.
5. **Create recall material.** Run **Flashcard from clipboard**. When **Next element** opens a card note, Spaced Repetition starts automatically and the accepted review finishes that queue entry.

For recommended keybindings and complete note, PDF, card, queue, and date workflows, open the [user guide](docs/USER-GUIDE.md). You can also run **Open user guide** inside Obsidian.

> [!NOTE]
> Upgrading from a pre-release development build? Open **Advanced tools…** and run **Migrate legacy cards to Spaced Repetition** once. It preserves card content and source links while replacing legacy scheduling fields.

## Command reference

| Command | Purpose |
|:--|:--|
| **Build today's session queue** | Explicitly calculate and save today's scheduled queue. |
| **Next element** | Open the following saved queue path without recalculating collection views; automatically start SR when it is a card. |
| **Grade current reading topic** | Grade and schedule the current source or extract without navigating. Cards finish automatically in SR. |
| **Extract selection** | Turn selected source text into a linked extract. |
| **Flashcard from clipboard** | Create a native Spaced Repetition card from clipboard text. |
| **Capture or create…** | New/imported sources, PDF-aware extracts, image cards, image extracts, and occlusions. |
| **Current element actions…** | Done, dismiss, postpone, schedule, priority, parent/PDF navigation, read points, and checkpoints. |
| **Open Toolkit view…** | Dashboard, analytics, queue, knowledge tree, or user guide. |
| **Advanced tools…** | Subset/overload tools, splits, tree editing, migration, inline-card export, and diagnostics. |

## Settings

Settings are grouped by workflow and include plain-language descriptions.

| Section | Configure |
|:--|:--|
| **Scheduling** | Reading intervals, progress awareness, A-Factor bounds, pace adjustments, and the stall guard. |
| **Queue** | Mixed-card behaviour, ordering, filters, and session display. |
| **Inline cards** | Question/answer and cloze parsing patterns. |
| **Spaced Repetition** | Dependency status, deck tag, and multiline card separators. |
| **Knowledge tree** | Branch warnings, completion visibility, and expansion state. |
| **Paths** | Every plugin-managed source, extract, card, category, attachment, dashboard, and log path. |
| **General** | Date convention, extract highlight colour, and diagnostic logging. |

Use **Run setup check** at the top of the settings page to verify the Spaced Repetition dependency, folder separation, A-Factor bounds, and card separators. Each path setting has a reset-to-default button. Configure card algorithms and review behaviour in Spaced Repetition itself.

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
