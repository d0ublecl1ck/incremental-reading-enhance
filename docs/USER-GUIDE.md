# Incremental Reading Toolkit user guide

This guide starts with a small daily workflow. You do not need to configure every command before using the plugin.

## Before you begin

1. Install and enable **Incremental Reading Toolkit**.
2. Under **Flashcards**, choose **Toolkit (in-house)** or **Anki via Flashcards**. **Spaced Repetition** remains available for existing workflows.
3. If using Anki, install Flashcards by Reuseman and AnkiConnect, then grant permission in Flashcards settings; if using SR, install Spaced Repetition.
4. Select **Run setup check**, confirm the managed paths, and choose a date format under **General**.

Changing the date format migrates existing scheduling fields, checkpoints, dashboard dates, and review-log dates.

Select **Open user guide** at the top of the settings page, or choose **User guide** from **Open Toolkit view…**, whenever you want the quickstart and recommended hotkeys inside Obsidian. The plugin's **Help** action opens the project README directly.

## Five-minute quickstart

1. Open **Capture or create…**, then choose **Import clipping (active note)** or **New source** to create a book, PDF, article, or video source.
2. Run **Build today's session queue**, then use **Next element** to open the next saved item.
3. Read a useful portion rather than trying to finish the source.
4. Select an important passage and run **Extract selection**. For a PDF, copy the passage, open **Capture or create…**, and choose **Extract from clipboard (PDF-aware)**.
5. Leave the cursor where you stopped. Run **Grade current reading topic**, choose whether to update the read point, then choose the topic pace. Run **Next element** separately when ready.
6. When a passage should become durable memory, copy it and run **Flashcard from clipboard**.
7. Continue with **Next element** for a mixed topic/card session. Toolkit cards open the in-house review window; existing SR cards open Spaced Repetition. Anki cards are synced and reviewed in Anki rather than added to the Toolkit queue.

The learning queue alternates sources/extracts with locally reviewable card notes. Topic scheduling uses A-Factors. Toolkit cards use built-in FSRS; Anki and Spaced Repetition own the schedules for cards exported to them.

## Set up keybindings

Obsidian calls keyboard shortcuts **hotkeys**.

1. Open **Settings -> Hotkeys**.
2. Search for `Incremental Reading Toolkit`.
3. Select the plus button beside a command.
4. Press the key combination you want. Obsidian warns when another command already uses it.

The plugin does not assign default hotkeys. This avoids overwriting shortcuts already used in your vault. The following set is a practical starting point; `Cmd` on macOS corresponds to `Ctrl` on Windows and Linux.

| Workflow | Command | Suggested hotkey |
| --- | --- | --- |
| Start or continue reading | Next element | `Cmd/Ctrl+Shift+J` |
| Finish the current portion | Grade current reading topic | `Cmd/Ctrl+Shift+Enter` |
| Save selected text | Extract selection | `Cmd/Ctrl+Shift+E` |
| Create a card | Flashcard from clipboard | `Cmd/Ctrl+Shift+F` |
| Scheduling and read-point actions | Current element actions… | `Cmd/Ctrl+Shift+A` |

Start with **Build today's session queue**, **Next element**, **Grade current reading topic**, and **Extract selection**. Add the others only when the workflow feels familiar.

## Read notes and articles

Choose **Import clipping (active note)** from **Capture or create…** on an existing Markdown note. The plugin adds scheduling frontmatter and moves the note into the configured sources folder when the destination is available.

During each visit:

1. Choose **Jump to read-point** from **Current element actions…** to return to the marker.
2. Read until attention drops or you reach a useful stopping point.
3. Create extracts from passages worth revisiting.
4. Run **Grade current reading topic** and update the marker to the cursor position.

Moving the marker counts as progress. When the stall guard is enabled, an unchanged marker prevents the interval from growing.

## Read PDFs and books

Choose **New source** from **Capture or create…**, select **PDF** or **Book**, and enter a vault-relative or absolute PDF path. Use:

- **Open PDF (Toolkit viewer)** from **Current element actions…** for PDFs stored inside or outside the vault. Enter a page in the toolbar and use **Save read point** to update the source.
- **Split book into chapters** from **Advanced tools…** to schedule chapters independently from a pasted page-range list.

When grading, enter the page where you stopped. Chapter scheduling uses the chapter end page rather than the total length of the book.

## Create extracts and cards

An extract is another reading topic. It is useful when a passage still needs editing, context, or thought.
Newly extracted passages stay marked in their source, and extract notes have a matching background accent in editing and reading views. Change the colour under **Settings -> Incremental Reading Toolkit -> General -> Extract highlight colour**.

A card is ready for recall practice. Card options include:

- basic question and answer;
- bidirectional vocabulary pairs;
- `==highlighted cloze==` deletions;
- image naming cards;
- image occlusion cards.

Cards are ordinary Markdown notes with a stored backend. Choose the backend under **Settings -> Incremental Reading Toolkit -> Flashcards**:

- **Toolkit (in-house)** stores scheduling fields in frontmatter and reviews with the built-in FSRS window.
- **Anki via Flashcards** writes `cards-deck` frontmatter plus `#card`/`#card-reverse` or highlighted cloze syntax, then runs **Flashcards: Generate for the current file**. Configure the deck and Flashcards tag in the **Anki via Flashcards** section. Keep Anki and AnkiConnect running when syncing.
- **Spaced Repetition (compatibility)** creates the existing tagged SR Markdown cards.

The selection affects new cards only; existing cards retain their backend.
Image-occlusion blocks require Obsidian's Toolkit renderer, so when Anki is selected those cards are saved with the in-house backend. Basic, reversed, cloze, and image-naming cards export to Anki normally.

## Manage a busy queue

Use **Current element actions…** for one-note actions and **Advanced tools…** for subtree and backlog actions.

- **Set priority**: lower numbers receive more attention.
- **Postpone**: move one topic to a later date.
- **Postpone subtree**: move a source and its descendants together.
- **Mercy (spread overdue)**: distribute overdue topics across a selected window.
- **Subset review**: choose a due descendant from the active source.
- **Done**: keep the note, clear its future Toolkit review date, and remove it from future sessions. SR cards also leave their SR deck.
- **Reset**: make an item active again and clear Toolkit scheduling history. SR cards return to their SR deck as new cards.
- **Dismiss**: exclude material you no longer want to process.

## Organize the knowledge tree

Choose **Knowledge tree** from **Open Toolkit view…** to create categories, drag material under a parent, reorder siblings, or rename nodes. Use the checkboxes to select multiple sources, extracts, or cards, then choose **Done** or **Reset** in the bulk-action bar. **Select visible** operates on the currently rendered rows, and Shift-click selects a range. Each row also has its own Done and Reset buttons.

Completed items disappear when **Show completed material** is off. Their notes remain in the vault, but future Toolkit scheduling is cleared; SR cards are additionally removed from their configured deck.

Files with duplicate basenames remain visible but cannot be used as parents until they are given unique names; this prevents ambiguous links from changing the wrong note.

## Date formats

Select a format in **Settings -> Incremental Reading Toolkit -> General -> Date format**:

- `DD-MM-YYYY`, for example `12-07-2026`;
- `MM-DD-YYYY`, for example `07-12-2026`;
- `YYYY-MM-DD`, for example `2026-07-12`.

The **Schedule (manual date)** action expects the selected format. Relative values such as `+3d`, `7d`, or `-1d` work with every convention.

## Troubleshooting

**Cards do not appear in review**

Confirm the card's `ir_card_backend`. Toolkit cards need a due `next_review`; Anki cards are reviewed in Anki and do not enter the Toolkit queue; SR cards require Spaced Repetition and the configured flashcard tag.

**Anki cards do not sync**

Confirm Flashcards by Reuseman is enabled, Anki is open, AnkiConnect is installed, and permission was granted from Flashcards settings. Then open the card note and run **Flashcards: Generate for the current file**, or choose **Sync Anki cards with Flashcards** from the Toolkit's advanced tools.

**The review command says Spaced Repetition is starting**

Reload Obsidian, then run **Next element** again for a queued card or use Spaced Repetition's own review command.

**A PDF does not open in the Toolkit viewer**

Confirm `pdf_path` is a valid vault-relative or absolute path, or set `pdf_vault_path` to the vault file. EPUB is not supported.

**A knowledge-tree parent is ambiguous**

Rename one of the files sharing the same basename, then reparent the child.

**A date is rejected**

Check the selected date format in the plugin's General settings, or enter a relative value such as `+1d`.
