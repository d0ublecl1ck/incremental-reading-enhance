---
title: Installation and setup
sidebar_position: 3
---

# Installation and setup

:::tip Update to version 1.1.7
Version 1.1.7 greatly speeds up switching notes and grading. It removes dashboard and queue refresh work
from navigation—the source of reported freezes and crashes—and simplifies the daily command flow.
[Read the performance update](../releases/version-1-1-7.md).
:::

## Community Plugins

1. In Obsidian, open **Settings → Community plugins**.
2. Search for **Incremental Reading Toolkit**, install it, and enable it.
3. Under **Flashcards**, choose the in-house Toolkit reviewer or Anki via Flashcards by Reuseman. Spaced Repetition remains an optional compatibility backend.
4. Install the external plugin required by your selection, then run **Run setup check**.

## Manual installation

Download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub release. Place them in:

```text
<vault>/.obsidian/plugins/incremental-reading-toolkit/
```

Reload Obsidian, then enable the Toolkit and any external card backend you selected.

## Recommended first setup

Keep the default folders initially. Add convenient hotkeys for:

- **Next element**
- **Build today's session queue**
- **Grade current reading topic**
- **Extract selection**
- **Flashcard from clipboard**
- **Current element actions…**
- **Open Toolkit view…**

Configure source/extract scheduling and in-house FSRS cards in the Toolkit. Anki and Spaced Repetition retain their own review settings when selected.

:::caution Upgrading an early development build
Open **Advanced tools…** and run **Migrate legacy cards to Spaced Repetition** once. It preserves the card content and source links, adds the configured deck tag, and removes obsolete card-scheduling fields.
:::
