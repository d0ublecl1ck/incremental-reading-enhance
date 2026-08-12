---
title: Spaced Repetition integration
---

# Spaced Repetition integration

Incremental Reading Toolkit retains **Spaced Repetition** as a compatibility backend. Select it under **Flashcards → Create cards with** when you want that plugin to own newly created cards.

When you create a card, the Toolkit:

1. writes a Markdown card in the configured cards folder;
2. applies the configured incremental-reading deck tag;
3. uses the configured question/answer or cloze form;
4. preserves a link back to the relevant source where applicable.

Spaced Repetition then owns card scheduling, grading, review UI, and card statistics. If it is unavailable, Toolkit-owned cards and topic scheduling still work.

The card note stores `ir_card_backend: spaced_repetition`, so changing the creation setting later does not alter its schedule or reviewer.
