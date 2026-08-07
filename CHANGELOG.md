# Incremental Reading Toolkit changelog

## Unreleased

### Added
- Newly extracted source passages stay highlighted, and extract notes receive a matching configurable background accent in editing and reading views. The colour picker is under General settings.
- The Knowledge Tree now supports checkbox and Shift-click multi-selection with bulk **Done** and **Reset** actions, plus matching actions on individual rows.
- Cards can now be marked done. Completion clears future Toolkit scheduling, removes cards from the Spaced Repetition deck, and removes completed items from the active tree; resetting starts their scheduling over.

### Fixed
- Card completion now retires the deck tag stored on that card, even after the configured deck changes, and legacy migration preserves completed cards instead of reactivating them.
- Hidden completed parents no longer remain as visible tree rows; active descendants are promoted to the nearest visible level.
- Filtering or collapsing the tree now drops selections that are no longer visible before a bulk action can use them.

## 1.1.7 — 2026-07-19

### Changed
- Reduced the command palette from 38 Toolkit entries to 9. The daily loop is **Build today's session
  queue**, **Next element**, and **Grade current reading topic**; less frequent operations are grouped
  under **Capture or create…**, **Current element actions…**, **Open Toolkit view…**, and
  **Advanced tools…**. Global and per-note card review remain owned by Spaced Repetition.
- **Next element** now opens the saved note first and automatically starts per-note Spaced Repetition
  review for cards. A completed SR review removes the card note from the session automatically.

### Fixed
- Note switching no longer performs synchronous queue-timeline rendering or forced DOM visibility
  checks for stale dashboard, queue, and knowledge-tree views.
- Follow-up read-point/card-review actions run after the note paints, while Toolkit view refreshes remain
  suppressed through Spaced Repetition's leaf changes.
- Session consumption is persisted with a short debounce, preventing plugin-data writes from competing
  with grading and the next note open.

## 1.1.6 — 2026-07-13

### Changed
- Split **Grade and advance** into independent **Grade current element** and **Next element** commands.
- **Next element** now only opens the following path in the saved session queue. Queue calculation is
  handled explicitly by **Build today's session queue**, and direct navigation suppresses collection-view
  refreshes.
- Single-note Spaced Repetition reviews now close their review tab or modal when grading finishes and
  the dependency returns to its deck menu. Active multi-card reviews remain open.

### Fixed
- Spaced Repetition answer writes now invalidate cached due state without rebuilding the Reading Queue
  or analytics dashboard during grading. Hidden queue tabs also defer row rendering until visible.
- Collection create, delete, rename, and card-modify listeners now ignore files outside configured
  Toolkit folders.
- Starting a mixed session opens the first saved item even when that note was already active.
- Card queue entries can only be finished after a verified Spaced Repetition scheduling update, and
  completed reviews outside configured Toolkit folders can still close correctly.
- Building a session is the explicit refresh boundary for views left stale by lightweight grading.
- Overlapping **Next element** calls keep navigation refresh suppression active until every open finishes.
- Updated the documentation website to match the separate build, grade, and navigation commands.

## 1.1.5 — 2026-07-13

### Fixed
- Switching between notes no longer rebuilds the entire Reading Queue. Navigation refreshes only the
  active timeline, while queue rows and card due-state checks remain cached until relevant data changes.
- Hidden dashboard and knowledge-tree tabs defer metadata-driven rendering until they become visible.
- Queue, dashboard, tree, due-item, and subtree operations now share one cached collection index instead
  of repeatedly walking every toolkit folder and rereading the same metadata.
- Large queue sections render in batches, and body-only or unrelated vault edits no longer invalidate
  collection views and derived indexes.
- Grading advances immediately after updating the in-memory session, persists session state in the
  background, appends the review log asynchronously, completes topic scheduling with a single
  frontmatter write, and coalesces collection-view refreshes until the next learning item is open.

### Added
- Added a **Performance diagnostics** command that reports folder-scan, metadata, tree-index, and due-pool
  timings in a notice and the developer console.

## 1.1.4 — 2026-07-13

### Added
- Replaced the temporary **Stats** notice with a responsive analytics dashboard showing 14-day review
  activity, queue workload, collection mix, seven-day activity, and lifetime totals.
- Refreshed the project README with clearer workflows, feature and command tables, installation paths,
  and privacy documentation.

### Changed
- Dashboard, reading-queue, and knowledge-tree views now ignore body-only metadata updates instead of
  rebuilding the full collection while a note is being edited.
- Spaced Repetition card due checks now use bounded concurrent reads, speeding up dashboard and mixed
  session loading in larger collections.

## 1.1.3 — 2026-07-13

### Fixed
- Knowledge-tree branches can now be collapsed while completed items are hidden.
- Mixed sessions now read Spaced Repetition scheduling comments and include only cards that are new or
  actually due, while preserving card/topic interleaving.
- Inbox topics appear in the queue's New section, and asynchronous refreshes cannot overwrite newer
  queue results.
- **Import clipping** creates a unique destination on filename collisions instead of leaving a converted
  source outside the managed folder.
- **Split book** rejects empty, reversed, overlapping, unordered, and out-of-bounds chapter ranges.
- Cancelling extract creation stops the operation, and page, priority, interval, duration, and timestamp
  prompts now reject malformed or partially numeric values.
- Invalid inline-card regular expressions produce an actionable setup/export error instead of crashing.
- Daily and weekly review statistics include topics completed or dismissed during the measured period.

## 1.1.2 — 2026-07-13

### Fixed
- Knowledge-tree action buttons now stop drag/row events from swallowing clicks and remain visible.
- Reordering resolves nodes by full path, so duplicate basenames no longer target the wrong node.
- Boundary reorder actions show feedback instead of silently doing nothing.
- Opening a tree node keeps the tree open and reuses a dedicated content tab; extracts no longer invoke
  the source-only read-point command.

### Added
- Added an explicit **Move** action, a **Refresh** toolbar button, clickable type-summary filters, and
  keyboard navigation for opening and expanding tree rows.

## 1.1.1 — 2026-07-13

### Fixed
- After a Spaced Repetition card is answered, **Grade and advance** now consumes that card's daily
  session row and continues to the next card or reading topic instead of reopening the same review.
- Opening a card no longer removes it from the mixed session before it has been answered.
- Mixed-session state is now stored in plugin data, so advancing works even when the optional legacy
  Dashboard Markdown note is missing.
- Completed empty sessions remain complete instead of rebuilding and resurfacing answered cards.
- Cancelling topic grading no longer advances, and **Random due element** now launches card review
  through the same Spaced Repetition handoff as the main session.

## 1.1.0 — 2026-07-13

### Added
- Added a native main dashboard with due, overdue, reviewed, card, active-topic, session-order, and
  collection-health summaries.
- Added an integrated PDF reader for vault and external PDFs with page navigation and persisted read
  points, replacing the runtime dependency on Sioyek.
- Added knowledge-tree collection totals, type filtering, status badges, due-date tooltips, and an
  option to hide or show completed material.

### Changed
- Daily learning sessions now alternate reading topics and card notes whenever both are available.
  Spaced Repetition remains responsible for card grading and intervals.
- New PDF/book sources store `pdf_path`; existing `sioyek_path` fields remain readable for backward
  compatibility and require no migration.
- Removed the Sioyek shell launcher and all `child_process` usage. Release validation now rejects
  shell-execution imports so the plugin cannot regress to that permission.

## 1.0.4 — 2026-07-12

### Added
- Added an embedded quickstart, hotkey guide, daily workflow, and troubleshooting page available from
  the command palette and plugin settings.
- Added a direct manifest Help link to the repository README, avoiding the unavailable Community
  directory search while the plugin awaits listing approval.
- Added a setup check for the Spaced Repetition dependency, folder conflicts, scheduling bounds, card
  separators, and optional Sioyek configuration.

### Changed
- Reorganized settings around user workflows with clearer names and explanations, validated numeric
  controls, dependency status, wider text fields, and every plugin-managed folder/file path with a
  reset-to-default action.
- Added the knowledge-tree branch warning threshold to settings.

## 1.0.3 — 2026-07-12

### Added
- Added an easy user guide with a five-minute quickstart, recommended keybindings, everyday workflows,
  date-format guidance, and troubleshooting.
- Added `DD-MM-YYYY`, `MM-DD-YYYY`, and `YYYY-MM-DD` date conventions with migration of existing
  scheduling fields, checkpoints, dashboard metadata, and review-log entries.
- Added signed GitHub artifact attestations for release assets.

### Fixed
- Corrected invalid YAML emitted by extract, article-split, and book-split commands.
- Markdown read-point movement now counts as progress for the stall guard.
- Progress-aware scheduling uses the newly entered page or timestamp and respects chapter boundaries.
- Knowledge-tree duplicate basenames remain visible and cannot be selected as ambiguous parents.
- Due-date sorting now compares calendar dates instead of formatted strings.
- Vault enumeration is scoped to configured plugin folders.
- Connected the extract-bump setting, removed inactive auto-postpone controls, and made extract numbering
  resilient to deleted files.

## 1.0.2 — 2026-07-12

### Fixed
- Renamed the Community Plugins display name to **Incremental Reading Toolkit** because
  **Incremental Reading** is already published by another developer.

## 1.0.1 — 2026-07-12

### Fixed
- Changed the technical plugin ID to `incremental-reading-toolkit` because `incremental-reading` was
  already reserved in the Obsidian Community Plugins submission portal.
- Internal command dispatch now derives the command prefix from the manifest instead of hard-coding
  the plugin ID.

## 1.0.0 — 2026-07-12

### Changed
- **Renamed to Incremental Reading.** The release ID and folder name are now `incremental-reading`.
- Documented the project's inspiration from SuperMemo incremental reading and the Incremental Writing
  plugin, including a feature-by-feature alignment guide and the intentional scheduling differences.
- **Spaced Repetition powers card review.** Card review commands delegate to its Obsidian commands.
- New card notes use native Spaced Repetition markdown and the `#flashcards/incremental-reading` deck.
  Basic, bidirectional, cloze, image, inline-export, and image-occlusion paths are covered.
- Incremental Reading's queue and statistics now own sources/extracts only. Spaced Repetition owns all card
  scheduling, review history, and card statistics.
- Added **Migrate legacy cards to Spaced Repetition** for pre-0.4 card notes. Existing inline cards
  can be materialized with **Export inline cards to Spaced Repetition**.

### Fixed
- All editable source, extract, card, review-log, and Sioyek paths are now used at runtime. The
  unused daily-note setting was removed.
- Moving an extract or card to the knowledge-tree root now persists an explicit `tree_root: true`
  override instead of falling back to its `source` link.
- User-entered source titles and derived extract/card/chapter filenames are sanitized before vault
  creation. User-entered YAML string values are safely quoted.

## v0.3.0 — 2026-05-26

### New
- **Knowledge tree (SuperMemo "Contents window").** A navigable, editable hierarchy of every
  collection element, available as a main-pane tab (`Open knowledge tree`) and a sidebar dock
  (`Open knowledge tree (sidebar)`).
  - New `category` element type (`type: category`, files in `Categories/`) — container nodes that
    group material and are excluded from scheduling.
  - Tree edge = `parent` link, falling back to `source` for legacy extracts/cards (no migration).
  - Loose/uncategorized elements collect under a synthetic **Unfiled** node; dangling-parent
    elements show a ⚠ badge.
  - **Full editing:** create category, drag-drop reparent (cycle-guarded, cards rejected as drop
    targets), reorder siblings (`tree_order`, gap-spaced), rename (backlink-safe), dismiss.
  - Expand/collapse state persists to `data.json` (`tree.expanded`). Child-count badge warns above
    `tree.child_warn_threshold` (default 100).
- **Unit tests.** New `tree-core.js` (parent resolution, indexing, cycle detection, reorder math)
  with `node --test` coverage. Obsidian's plugin loader cannot resolve a relative `require`, so the
  tree logic is inlined into `main.js`; `test/inline-sync.test.js` enforces the inlined copy stays
  byte-identical to `tree-core.js`.

### Known limitations
- **Create-child-in-tree is deferred.** Categories are created in-tree; sources/extracts/cards are
  still created via the existing extract/flashcard/new-source commands, then placed by drag-drop.
- **Duplicate basenames collide.** The tree keys nodes by basename, so two IR files sharing a
  basename in different folders resolve to one node. Path-based resolution is a future follow-up.

## v0.2.1 — 2026-05-22

### Fixed
- **Sidebar queue order now matches the dashboard.** The sidebar reads `today_session_paths` from the dashboard frontmatter (or builds a fresh interleaved queue if no snapshot is present) and renders that as "Today's Session" — same order as the dashboard's "Today's Session" table. Items not in the session (overdue, new, active-no-due) appear in supplementary sections below.
- `fsrs.fuzz` toggle now applies ±5% jitter to the next interval.
- `queue.sidebar_enabled = false` now suppresses the sidebar (command shows a Notice and refuses to open).
- Inline-card review modal renders the card's own question/answer (or cloze-masked line) instead of the entire parent source body.
- Inline-card stable id no longer includes line number — edits to surrounding lines don't strand FSRS state.
- Sidebar `_render` is debounced (250 ms) on vault modify events to avoid thrash during heavy typing.

### Migration notes
- The inline-card id change (Patch 6 above) breaks existing inline-card FSRS state. The first `Seed inline cards` after the v0.2.1 upgrade may add duplicate entries with new ids; old entries with stale ids remain in frontmatter and can be cleaned up by hand. Future v0.2.2 will add a `prune-inline-cards` command.

### Bug-audit verification
v0.2.0's bug-audit commit (`779d8d7`) reported six items audited but only fixed `forget-card`. Re-confirming the other five as already-correct:
- `postpone-subtree`: traversal uses `walkSubtree` with a frontier queue, depth 6 — transitive extracts handled.
- `mercy`: spread weighted by `urgency` which dominates by priority — higher-priority items get smaller delays.
- `OcclusionModal`: `onClose` removes both stored `mousemove`/`mouseup` handlers.
- `gradeAndAdvance` on PDFs: `endSession` early-returns when the active file isn't markdown or fm isn't source/extract/card.
- `parseDMY` callers: every `new Date(...)` site uses no-arg or numeric input — no string from frontmatter bypasses regex validation.

## v0.2.0 — 2026-05-22

### New
- **Progress-aware A-Factor** for sources and extracts. The per-rep `a_factor` is recomputed from remaining pages or seconds, so long unfinished material stays in active rotation (small a_factor → short intervals) and short almost-done material exits quickly (large a_factor → growing intervals).
- **Stall guard**: interval cannot grow while `read_point` is unchanged between consecutive reps. Prevents books drifting into long intervals without progress.
- **FSRS-6 card scheduler**. Matches the canonical `open-spaced-repetition/ts-fsrs` v6 implementation: exponential initial difficulty `D0(G) = w4 - exp(w5*(G-1)) + 1`, linear-damped difficulty update with mean reversion toward `D0(Easy)`, personalized forgetting curve via `decay` (w20), independent hard (w15) and easy (w16) multipliers, same-day short-term stability path. 19-weight vector (w0..w18) replaces the old 17-weight FSRS-4.5 array.
- **Settings tab** covering Scheduling, FSRS, Queue, Inline cards, Paths, and Misc. All previously hard-coded constants are now editable from Obsidian's settings UI. Persists to `data.json` in the plugin directory.
- **Sidebar review queue** (`Open reading queue sidebar` command). Groups items into Overdue / Due Today / New / Active. Live filter input matches against tags or title substring. Configurable sort key (urgency / priority / due_date). Clicking a row opens the file and jumps to its read-point. Auto-refreshes on file modify + 30-second timer for midnight rollover.
- **Inline cards.** `Q:: ... ::A:: ...`, `{{c1::cloze}}`, and optional `==highlight==` forms parse out of source/extract bodies and surface in the sidebar's New / Due Today / Overdue sections. FSRS-6 state lives in the source file's `inline_cards[]` frontmatter array — no card files created. New `Seed inline cards from current file body` command scans the active file and appends new entries with `status: pending`. Click an inline card in the sidebar to grade it.
- **Timeline checkpoints.** New `Add timeline checkpoint` command (also accessible from an input box in the sidebar Timeline panel) appends to a `checkpoints[]` array in the source's frontmatter. Optional `Nd::` prefix overrides `next_review` to `today + N days`. Clicking a checkpoint in the sidebar scrolls the editor to the checkpoint's saved line.

### Changed
- Manifest version 0.1.2 → 0.2.0.
- `_bumpAFactor` no longer fires on postpone, advance, schedule-later, or schedule-earlier. The progress-aware recompute supersedes those signals. The extract-creation bump still fires (creating an extract is a discrete processing signal).
- `pickFromList` quality factors now read from settings (`quality_hold`, `quality_speed_up`, `quality_slow_down`) instead of hard-coded `[1.0, 0.95, 1.05]`.
- All A-Factor and FSRS helpers now take a context object (`ctx` for FSRS, `settings` for A-Factor) as first argument, so weight edits in the settings tab take effect on the next review without a plugin reload.

### Fixed
- `forget-card` now deletes the FSRS frontmatter fields (`stability`, `difficulty`, `last_grade`, `last_retrievability`, `review_count`) instead of setting them to `null`, and sets `next_review` based on the file's `priority` rather than always one day out.

### Known limitations
- Inline-card review modal currently displays the parent source body as the question/answer rather than the inline card's text. State persistence works correctly; UI follow-up planned for v0.2.1.
- Inline-card stable id includes line number, so editing surrounding lines strands existing FSRS state and re-seeding creates new entries. Follow-up: switch to literal-only hash or add a prune command.
- Sidebar does not auto-seed inline cards from source bodies on file modify (cost would be O(n) reads per render across 800+ sources). Use the `Seed inline cards from current file body` command per file.
