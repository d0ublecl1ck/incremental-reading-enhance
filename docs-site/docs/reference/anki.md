---
title: Anki integration
---

# Anki integration

Select **Anki via Flashcards** under **Flashcards → Create cards with**. The Toolkit writes each new card using Reuseman Flashcards' native `#card`, `#card-reverse`, or highlighted-cloze syntax, adds `cards-deck` frontmatter, and records `ir_card_backend: anki` on the note.

## Requirements

- Enable [**Flashcards** by Reuseman](https://github.com/reuseman/flashcards-obsidian).
- Install **AnkiConnect** in Anki.
- Keep Anki open on the desired profile when syncing.
- Open Flashcards settings while Anki is running and select **Grant Permission**.

Configure the target deck and card tag in the Toolkit's **Anki via Flashcards** settings. The tag must match Flashcards' configured flashcard tag, which defaults to `card`. With **Sync after creating cards** enabled, the Toolkit briefly activates each new card note, runs **Flashcards: Generate for the current file**, and restores the previously active note. See the [Flashcards wiki](https://github.com/reuseman/flashcards-obsidian/wiki) for its AnkiConnect setup and supported card syntax.

Anki cards do not enter the Toolkit's mixed review queue because Anki owns their due state, grading, and intervals. The Markdown note remains in the knowledge tree and retains its source link.

Basic, reversed, cloze, and image-naming cards export to Anki. Toolkit image-occlusion blocks depend on an Obsidian renderer that Anki does not provide, so those cards automatically use the in-house backend and the Toolkit shows a notice.
