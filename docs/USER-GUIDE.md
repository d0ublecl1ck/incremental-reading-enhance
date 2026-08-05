# Incremental Reading Toolkit user guide

This guide starts with a small daily workflow. You do not need to configure every command before using the plugin.

## Before you begin

1. Install and enable **Spaced Repetition**.
2. Install and enable **Incremental Reading Toolkit**.
3. Open **Settings -> Incremental Reading Toolkit** and select **Run setup check**.
4. Confirm the managed vault paths, then choose a date format under **General**. Available formats are `DD-MM-YYYY`, `MM-DD-YYYY`, and `YYYY-MM-DD`.

Changing the date format migrates existing scheduling fields, checkpoints, dashboard dates, and review-log dates.

Select **Open user guide** at the top of the settings page, or choose **User guide** from **Open Toolkit view…**, whenever you want the quickstart and recommended hotkeys inside Obsidian. The plugin's **Help** action opens the project README directly.

## Five-minute quickstart

1. Open **Capture or create…**, then choose **Import clipping (active note)** or **New source** to create a book, PDF, article, or video source.
2. Run **Build today's session queue**, then use **Next element** to open the next saved item.
3. Read a useful portion rather than trying to finish the source.
4. Select an important passage and run **Extract selection**. For a PDF, copy the passage, open **Capture or create…**, and choose **Extract from clipboard (PDF-aware)**.
5. Leave the cursor where you stopped. Run **Grade current reading topic**, choose whether to update the read point, then choose the topic pace. Run **Next element** separately when ready.
6. When a passage should become durable memory, copy it and run **Flashcard from clipboard**.
7. Continue with **Next element** for a mixed topic/card session. When it opens a card note, the Toolkit starts Spaced Repetition automatically. Answering the review finishes that queue item; press **Next element** when ready. Use Spaced Repetition's own global review command for card-only study.

The learning queue alternates sources/extracts with card notes. **Next element** opens the next saved path first, then starts per-note card review when needed. Topic scheduling uses the Toolkit A-Factor model; card grading and intervals remain owned by Spaced Repetition.

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

Cards are ordinary Markdown notes tagged for Spaced Repetition. Configure review intervals, algorithms, and card statistics inside Spaced Repetition.

## Manage a busy queue

Use **Current element actions…** for one-note actions and **Advanced tools…** for subtree and backlog actions.

- **Set priority**: lower numbers receive more attention.
- **Postpone**: move one topic to a later date.
- **Postpone subtree**: move a source and its descendants together.
- **Mercy (spread overdue)**: distribute overdue topics across a selected window.
- **Subset review**: choose a due descendant from the active source.
- **Done**: keep the note but remove it from future reading sessions.
- **Dismiss**: exclude material you no longer want to process.

## Organize the knowledge tree

Choose **Knowledge tree** from **Open Toolkit view…** to create categories, drag material under a parent, reorder siblings, or rename nodes. Files with duplicate basenames remain visible but cannot be used as parents until they are given unique names; this prevents ambiguous links from changing the wrong note.

## Date formats

Select a format in **Settings -> Incremental Reading Toolkit -> General -> Date format**:

- `DD-MM-YYYY`, for example `12-07-2026`;
- `MM-DD-YYYY`, for example `07-12-2026`;
- `YYYY-MM-DD`, for example `2026-07-12`.

The **Schedule (manual date)** action expects the selected format. Relative values such as `+3d`, `7d`, or `-1d` work with every convention.

## Troubleshooting

**Cards do not appear in review**

Confirm Spaced Repetition is enabled and that its flashcard tags include `#flashcards`. Toolkit cards use the `#flashcards/incremental-reading` subtag by default.

**The review command says Spaced Repetition is starting**

Reload Obsidian, then run **Next element** again for a queued card or use Spaced Repetition's own review command.

**A PDF does not open in the Toolkit viewer**

Confirm `pdf_path` is a valid vault-relative or absolute path, or set `pdf_vault_path` to the vault file. EPUB is not supported.

**A knowledge-tree parent is ambiguous**

Rename one of the files sharing the same basename, then reparent the child.

**A date is rejected**

Check the selected date format in the plugin's General settings, or enter a relative value such as `+1d`.
