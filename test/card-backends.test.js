'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('settings let users choose Toolkit, Anki, or the existing SR compatibility path', () => {
  assert.match(main, /backend: 'toolkit'/);
  assert.match(main, /addOption\('toolkit', '工具包（内置）'\)/);
  assert.match(main, /addOption\('anki', '通过 Flashcards 使用 Anki'\)/);
  assert.match(main, /addOption\('spaced_repetition', 'Spaced Repetition（兼容）'\)/);
});

test('card creation dispatches to the selected backend and stores ownership per card', () => {
  const dispatch = main.match(/async _createCard\(parentFile, spec\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.match(dispatch, /_createFlashcardsAnkiCard/);
  assert.match(dispatch, /_createSpacedRepetitionCard/);
  assert.match(dispatch, /_createToolkitCard/);
  for (const backend of ['toolkit', 'anki', 'spaced_repetition']) {
    assert.match(main, new RegExp(`ir_card_backend: ${backend}`));
  }
});

test('Anki integration writes Flashcards syntax and invokes its public per-file command', () => {
  assert.match(main, /FLASHCARDS_GENERATE_COMMAND = `\$\{FLASHCARDS_PLUGIN_ID\}:generate-flashcard-current-file`/);
  assert.match(main, /cardProviderCore\.flashcardsPluginBody/);
  assert.match(main, /executeCommandById\(FLASHCARDS_GENERATE_COMMAND\)/);
  assert.match(main, /`cards-deck: \$\{deck\}`/);
  assert.doesNotMatch(main, /`cards-deck: \$\{JSON\.stringify/);
});

test('Flashcards sync activates generated files and restores the previous note', () => {
  const sync = main.match(/async syncAnki\(\{ quiet = false, paths = null \} = \{\}\) \{([\s\S]*?)\n  \}\n\n  async _createSpacedRepetitionCard/)?.[1] || '';
  assert.match(sync, /await leaf\.openFile\(file\)/);
  assert.match(sync, /executeCommandById\(FLASHCARDS_GENERATE_COMMAND\)/);
  assert.match(sync, /await leaf\.openFile\(original\)/);
});

test('mixed sessions review local and SR cards but leave Anki scheduling to Anki', () => {
  const eligibility = main.match(/_cardCanJoinQueue\(frontmatter\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.match(eligibility, /backend === 'anki'\) return false/);
  assert.match(main, /backend === 'toolkit'\) return isDue/);
  assert.match(main, /backend === 'spaced_repetition'\) return this\._cardIsDue/);
});

test('Toolkit reviews schedule FSRS and consume the saved session item', () => {
  const review = main.match(/async _gradeToolkitCard\(file, frontmatter\) \{([\s\S]*?)\n  \}\n\n  async reviewCardsInNote/)?.[1] || '';
  assert.match(review, /reviewCard\(this\.app/);
  assert.match(review, /fsrsCore\.scheduleFsrsReview/);
  assert.match(review, /consumeSessionItem\(file\.path/);
});

test('Anki selection falls back to Toolkit for custom image occlusion rendering', () => {
  assert.match(main, /const useToolkitForOcclusion = this\.cardBackend\(\) === 'anki'/);
  assert.match(main, /if \(useToolkitForOcclusion\) await this\._createToolkitCard/);
});
