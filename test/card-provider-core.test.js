'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { storedCardBackend, flashcardsPluginBody } = require('../card-provider-core.js');

test('card backend detection preserves existing integrations', () => {
  assert.equal(storedCardBackend({ ir_spaced_repetition: true }), 'spaced_repetition');
  assert.equal(storedCardBackend({ ir_anki: true }), 'anki');
  assert.equal(storedCardBackend({}), 'toolkit');
});

test('Flashcards basic cards use the plugin hashtag syntax', () => {
  const body = flashcardsPluginBody('basic', 'Question', 'Answer');
  assert.equal(body, 'Question #card\nAnswer\n');
});

test('Flashcards reversed cards use the reverse hashtag', () => {
  const body = flashcardsPluginBody('reverse', 'Question', 'Answer', { flashcardsTag: 'memory' });
  assert.equal(body, 'Question #memory-reverse\nAnswer\n');
});

test('Flashcards cloze cards preserve Obsidian highlight syntax', () => {
  const body = flashcardsPluginBody('cloze', '==One== and ==two==', '', {});
  assert.equal(body, '==One== and ==two==\n');
});
