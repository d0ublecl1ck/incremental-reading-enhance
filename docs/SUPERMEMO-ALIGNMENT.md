# SuperMemo workflow alignment

Incremental Reading Toolkit is inspired by [SuperMemo's incremental reading](https://help.supermemo.org/wiki/Incremental_reading) workflow and by bjsi's [Incremental Writing plugin for Obsidian](https://github.com/bjsi/incremental-writing). It is an independent implementation for Obsidian, not a port of SuperMemo and not affiliated with or endorsed by either project.

## Summary

The plugin is aligned with SuperMemo at the workflow level:

1. Bring sources into a managed reading collection.
2. Revisit many sources in small, prioritized portions.
3. Preserve a read point between visits.
4. Extract the important parts while retaining their source relationship.
5. Turn selected knowledge into cloze or question-and-answer cards.
6. Review topics and cards over time while managing inevitable overload.

SuperMemo describes incremental reading as importing electronic articles, reading them in small portions, extracting important fragments, converting those fragments into questions and answers, and reviewing them with spaced repetition. Incremental Reading Toolkit supports the same progression using Markdown notes and Obsidian links.

## Feature comparison

| SuperMemo concept | Incremental Reading Toolkit equivalent | Alignment |
| --- | --- | --- |
| Imported articles and topics | Source notes, clipping import, PDF/EPUB paths, images, and YouTube source notes | Strong |
| Reading many sources in small portions | Priority-aware topic queue, `Next element`, postponement, and manual scheduling | Strong |
| Read points | Markdown read-point markers plus PDF page and media timestamp progress | Strong |
| Extracts linked to their source | Extract notes with `parent` and `source` links | Strong |
| Topics and items | Sources/extracts are reading topics; flashcards use Toolkit FSRS, Anki, or Spaced Repetition | Strong |
| Cloze and question-answer generation | Basic, bidirectional, cloze, image, and image-occlusion cards | Strong |
| A-Factor topic scheduling | Progress-aware A-Factor intervals for sources and extracts | Similar, not algorithm-identical |
| Prioritization | Numeric priority, boost/set-priority commands, and urgency-based queue ordering | Strong |
| Knowledge tree and categories | Editable source/extract hierarchy and category notes | Strong |
| Subset review | Filtered subset review by folder, tag, type, or priority | Strong |
| Auto-postpone and overload management | Postpone, subtree postponement, and Mercy spreading of overdue topics | Partial |
| Article decomposition | Extracts, split-on-heading, and split-book commands | Strong |
| Source references | Obsidian links and source/parent frontmatter retained through extraction and card creation | Similar |
| Incremental video and images | Timestamped video sources, image extracts, image cards, and image occlusion | Partial |
| One unified learning process | Mixed topic/card stream for locally reviewable cards, with Anki cards reviewed externally | Strong |

## Intentional differences

### Card scheduling and review

SuperMemo presents topics and memory items through one learning system. Incremental Reading Toolkit mirrors that presentation with a mixed daily stream for reading topics and locally reviewable card notes. Users can keep cards in-house with FSRS or delegate them to Reuseman's [Flashcards](https://github.com/reuseman/flashcards-obsidian) plugin for Anki, or to [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition).

As a result, `Build today's session queue` creates an interleaved topic/card session and `Next element` performs lightweight saved-path navigation before starting the correct Toolkit or Spaced Repetition reviewer. Anki-owned cards stay in Anki's queue.

### Scheduling algorithms

The topic scheduler is inspired by SuperMemo's A-Factor-based topic repetition, but it does not claim to reproduce any SuperMemo algorithm. It combines an A-Factor with priority, progress, read-point changes, postponement, and configurable queue rules. Toolkit-owned cards use the built-in FSRS scheduler; Anki and Spaced Repetition cards retain externally owned intervals.

### Overload tools

SuperMemo documents auto-sort, auto-postpone, and priority-queue mechanisms for large overloaded collections. Incremental Reading Toolkit provides explicit priority controls, filtered subset review, bulk postponement, and the `Mercy` command for distributing overdue topics. These serve the same practical goal but are not exact equivalents of SuperMemo's automatic behavior.

### Incremental writing

The [Incremental Writing plugin](https://github.com/bjsi/incremental-writing) inspired the use of prioritized queues, note/block review, manual scheduling, and A-Factor-style intervals in Obsidian. Incremental Reading Toolkit applies those ideas primarily to reading, extraction, and knowledge capture. It does not replace Incremental Writing's dedicated workflow for repeatedly revising drafts and blocks.

## Design target

The target is functional kinship with the core SuperMemo incremental-reading loop while preserving Obsidian-native files and links:

- keep source material inspectable as ordinary Markdown;
- make partial progress and provenance durable;
- let priority decide what deserves attention;
- support decomposition from source to extract to card;
- provide practical tools when the queue becomes overloaded;
- let users keep memory-item review in-house or delegate it to Anki or Spaced Repetition.

Features that depend on SuperMemo's proprietary application, data model, or algorithms are outside the compatibility claim.

## Sources

- [SuperMemo: Incremental reading](https://help.supermemo.org/wiki/Incremental_reading)
- [SuperMemo: Incremental learning](https://help.supermemo.org/wiki/Incremental_learning)
- [SuperMemo: Incremental writing](https://help.supermemo.org/wiki/Incremental_writing)
- [Incremental Writing plugin for Obsidian](https://github.com/bjsi/incremental-writing)
