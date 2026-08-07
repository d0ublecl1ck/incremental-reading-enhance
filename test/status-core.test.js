'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  completeItemFrontmatter,
  resetItemFrontmatter,
  clearSpacedRepetitionSchedule,
} = require('../status-core.js');

test('done topics retain history but no longer retain a future review', () => {
  const fm = {
    type: 'extract', status: 'active', next_review: '10-08-2026', interval: 8,
    review_count: 4, a_factor: 1.3,
  };
  completeItemFrontmatter(fm, '07-08-2026', 'flashcards/incremental-reading');
  assert.equal(fm.status, 'done');
  assert.equal(fm.date_done, '07-08-2026');
  assert.equal(fm.last_reviewed, '07-08-2026');
  assert.equal(fm.next_review, undefined);
  assert.equal(fm.interval, undefined);
  assert.equal(fm.review_count, 4);
  assert.equal(fm.a_factor, 1.3);
});

test('done cards leave the Spaced Repetition deck while retaining their other tags', () => {
  const fm = {
    type: 'card', ir_spaced_repetition: true,
    tags: ['incremental-reading', 'ir/card', '#flashcards/incremental-reading', 'topic/example'],
  };
  completeItemFrontmatter(fm, '07-08-2026', 'flashcards/incremental-reading');
  assert.deepEqual(fm.tags, ['incremental-reading', 'ir/card', 'topic/example']);
  assert.equal(fm.ir_completed_deck_tag, 'flashcards/incremental-reading');
});

test('reset restores active state, clears scheduling, and returns cards to their deck', () => {
  const fm = {
    type: 'card', ir_spaced_repetition: true, status: 'done', date_done: '07-08-2026', last_reviewed: '07-08-2026',
    review_count: 9, ir_completed_deck_tag: 'flashcards/custom', tags: ['ir/card'],
  };
  resetItemFrontmatter(fm, 'flashcards/incremental-reading');
  assert.equal(fm.status, 'active');
  assert.equal(fm.date_done, undefined);
  assert.equal(fm.last_reviewed, undefined);
  assert.equal(fm.review_count, undefined);
  assert.equal(fm.ir_completed_deck_tag, undefined);
  assert.deepEqual(fm.tags, ['ir/card', 'flashcards/custom']);
});

test('done cards retire the deck tag stored when the card was created', () => {
  const fm = {
    type: 'card', ir_spaced_repetition: true,
    ir_spaced_repetition_deck_tag: 'flashcards/old',
    tags: ['ir/card', 'flashcards/old', 'topic/example'],
  };
  completeItemFrontmatter(fm, '07-08-2026', 'flashcards/new');
  assert.deepEqual(fm.tags, ['ir/card', 'topic/example']);
  assert.equal(fm.ir_completed_deck_tag, 'flashcards/old');
});

test('legacy card reset does not add an SR deck tag before migration', () => {
  const fm = { type: 'card', ir_spaced_repetition: false, status: 'done', tags: ['ir/card'] };
  resetItemFrontmatter(fm, 'flashcards/incremental-reading');
  assert.equal(fm.status, 'active');
  assert.deepEqual(fm.tags, ['ir/card']);
});

test('active card reset keeps its stored deck when the configured tag changes', () => {
  const fm = {
    type: 'card', ir_spaced_repetition: true, status: 'active',
    ir_spaced_repetition_deck_tag: 'flashcards/old',
    tags: ['ir/card', 'flashcards/old'],
  };
  resetItemFrontmatter(fm, 'flashcards/new');
  assert.deepEqual(fm.tags, ['ir/card', 'flashcards/old']);
  assert.equal(fm.ir_spaced_repetition_deck_tag, 'flashcards/old');
});

test('card reset removes every Spaced Repetition scheduling comment', () => {
  const content = 'Question\n?\nAnswer <!--SR:!2026-08-10,3,250-->\n<!--SR:2026-09-01,20,250-->\n';
  assert.equal(clearSpacedRepetitionSchedule(content), 'Question\n?\nAnswer\n\n');
});
