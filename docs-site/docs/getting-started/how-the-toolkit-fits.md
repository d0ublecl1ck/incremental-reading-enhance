---
title: How the Toolkit fits together
sidebar_position: 2
---

# How the Toolkit fits together

Incremental Reading Toolkit is a desktop Obsidian plugin that manages **reading topics** and connects them to ordinary Markdown flashcards.

| Layer | What it contains | Who schedules it |
|---|---|---|
| Sources | Original notes, clippings, PDFs, and video source notes | Incremental Reading Toolkit |
| Extracts | Useful passages promoted into separate reading topics | Incremental Reading Toolkit |
| Cards | Question/answer, cloze, image, or occlusion notes | Toolkit FSRS, Anki, or Spaced Repetition |

The Toolkit can own card review with built-in FSRS or delegate it to Anki or Spaced Repetition. The backend is recorded per note so these workflows can coexist.

## Main surfaces

- **Build today's session queue** chooses due topics and locally reviewable cards; **Next element** opens the following saved path and starts its stored reviewer.
- **Reading queue** shows upcoming and due topics.
- **Dashboard** summarizes sessions, workload, and collection health.
- **Knowledge tree** shows parent/child relationships between categories, sources, and extracts.
- **Integrated PDF reader** opens vault PDFs and local external PDF paths, with saved page positions.

The plugin is local-first: it has no account, telemetry, ads, or update service. It is desktop-only because the PDF integration uses Electron and Node capabilities unavailable on Obsidian mobile.
