---
title: Settings reference
---

# Settings reference

Settings are grouped by workflow rather than by internal implementation.

## Reading intervals and progress

Controls define the initial and growing return intervals, A-Factor bounds, and whether remaining pages/seconds influence future scheduling. Pace adjustments help the queue reflect how much source material remains.

## Queue display and ordering

Choose how reading topics are surfaced and ordered. Priority and due state remain distinct signals: an important item can be not-yet-due, and an overdue item can still be low priority.

## Inline cards

Configure the patterns used when exporting inline questions, answers, clozes, and highlights into card notes.

## Flashcards

Choose the backend for newly created cards:

- **Toolkit (in-house)** uses the built-in FSRS reviewer.
- **Anki via Flashcards** writes Reuseman Flashcards-compatible notes and syncs them to Anki.
- **Spaced Repetition (compatibility)** preserves the existing SR Markdown workflow.

The backend is stored on each card, so changing this setting does not convert existing cards.

## Anki

Shows whether Flashcards by Reuseman is available and configures its target deck, card tag, and automatic per-file generation. Anki and AnkiConnect must be running when a sync occurs.

## Spaced Repetition compatibility

The settings show dependency status, the deck tag (default behavior uses an incremental-reading deck), and separators for card Markdown. Review algorithm settings belong to Spaced Repetition.

## Paths

Separate folders are configurable for sources, extracts, cards, attachments, and categories. The setup check warns when paths overlap. Each path can be reset independently.

## Diagnostics and dates

Date convention and diagnostic logging settings support troubleshooting and migration. **Extract highlight colour** controls both the marker left on newly extracted source passages and the background accent shown on extract notes in editing and reading views. Run **Run setup check** after changing folders, A-Factor bounds, the card backend, card separators, or a dependency.
