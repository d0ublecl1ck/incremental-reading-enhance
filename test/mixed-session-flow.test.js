'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function functionSource(name) {
  const match = main.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} must exist`);
  return match[0];
}

test('topic grading consumes the current item without navigating', () => {
  const method = main.match(/async gradeCurrent\(\) \{([\s\S]*?)\n  \}\n\n  \/\/ ---- End Session/)?.[1] || '';
  assert.match(method, /this\.consumeSessionItem\(active\.path, \{ background: true \}\)/);
  assert.doesNotMatch(method, /nextElement/);
  assert.doesNotMatch(method, /reviewCardsInNote/);
  assert.match(method, /当 Spaced Repetition 接受复习后，卡片会自动完成/);
});

test('opening any learning item uses the shared suppressed navigation path', () => {
  const method = main.match(/async openLearningItem\(item\) \{([\s\S]*?)\n  \}\n\n  async _openLearningFile/)?.[1] || '';
  assert.match(method, /this\._openLearningFile\(item\.tfile, item\.fm\.type, item\.fm\.read_point_line\)/);
  assert.doesNotMatch(method, /consumeSessionItem/);
});

test('grade current does not consume a topic when grading is cancelled', () => {
  const method = main.match(/async gradeCurrent\(\) \{([\s\S]*?)\n  \}\n\n  \/\/ ---- End Session/)?.[1] || '';
  assert.match(method, /const graded = await this\.endSession\(\)/);
  assert.match(method, /if \(graded\) \{[\s\S]*?consumeSessionItem/);
});

test('grading coalesces session persistence and writes topic scheduling once', () => {
  const consume = main.match(/async consumeSessionItem\(path,[\s\S]*?\n  \}\n\n  _scheduleSessionSave/)?.[0] || '';
  const grade = main.match(/async _gradeTopic\(file, fm, today\) \{([\s\S]*?)\n  \}\n\n  \/\/ Adaptive A-Factor/)?.[1] || '';
  assert.match(consume, /this\._scheduleSessionSave\(\)/);
  assert.match(consume, /if \(!background\) return this\.saveSettings\(\)/);
  assert.doesNotMatch(consume, /processFrontMatter|dashboardPath/);
  assert.equal((grade.match(/processFrontMatter\(file/g) || []).length, 1);
  assert.doesNotMatch(grade, /await this\.app\.vault\.append\(logFile/);
});

test('next element resolves only the saved queue and shared open path', () => {
  const method = main.match(/async nextElement\(\{ fromStart = false \} = \{\}\) \{([\s\S]*?)\n  \}\n\n  async randomDue/)?.[1] || '';
  assert.match(method, /this\.settings\.session/);
  assert.match(method, /getAbstractFileByPath/);
  assert.match(method, /this\._openLearningFile\(next, nextType, readPointLine\)/);
  assert.doesNotMatch(method, /readSessionSnapshot|buildDuePool|persistSessionSnapshot|openLearningItem/);
});

test('shared navigation opens first and defers follow-up work beyond note paint', () => {
  const method = main.match(/async _openLearningFile\(file, type, readPointLine = 0\) \{([\s\S]*?)\n  \}\n\n  async buildSessionQueue/)?.[1] || '';
  assert.match(method, /await this\.app\.workspace\.getLeaf\(false\)\.openFile\(file\)/);
  assert.match(method, /window\.setTimeout\(\(\) => \{[\s\S]*?_reviewCardFile\(file\)[\s\S]*?\}, 60\)/);
  assert.match(method, /Number\(readPointLine\) > 0/);
  assert.doesNotMatch(method, /cachedRead|jumpToReadPoint/);
  assert.match(method, /this\.directQueueNavigationDepth\+\+/);
  assert.match(method, /this\.directQueueNavigationDepth > 0/);
  assert.match(method, /\}, 1000\)/);
});

test('session queue construction persists item types for constant-time dispatch', () => {
  const method = main.match(/async persistSessionSnapshot\(queue\) \{([\s\S]*?)\n  \}\n\n  buildInterleavedQueue/)?.[1] || '';
  assert.match(method, /const types = Object\.fromEntries/);
  assert.match(method, /const readPoints = Object\.fromEntries/);
  assert.match(method, /this\.settings\.session = \{ date: todayDateString\(this\.settings\), paths, types, readPoints \}/);
  assert.match(main, /nextElement\(\{ fromStart: true \}\)/);
});

test('session start retains the first item even when it is already active', () => {
  const factory = new Function(`${functionSource('savedQueueCandidates')}; return savedQueueCandidates;`);
  const candidates = factory();
  assert.deepEqual(candidates(['first.md', 'second.md'], 'first.md', true), ['first.md', 'second.md']);
  assert.deepEqual(candidates(['first.md', 'second.md'], 'first.md', false), ['second.md']);
});

test('card completion is automatic only after SR returns to its deck menu', () => {
  const confirm = main.match(/async _confirmSpacedRepetitionReview\(file, pending\) \{([\s\S]*?)\n  \}\n\n  _closeSpacedRepetitionDeckMenuWhenReady/)?.[1] || '';
  const close = main.match(/_closeSpacedRepetitionDeckMenuWhenReady\(generation\) \{([\s\S]*?)\n  \}\n\n  openUserGuide/)?.[1] || '';
  assert.match(confirm, /pending\.reviewed = true/);
  assert.doesNotMatch(confirm, /consumeSessionItem/);
  assert.match(close, /\.sr-deck-container:not\(\.sr-is-hidden\)/);
  assert.match(close, /if \(pending\?\.reviewed\) this\.consumeSessionItem\(pending\.path/);
});

test('random due cards retain the same automatic handoff internally', () => {
  const method = main.match(/async randomDue\(\) \{([\s\S]*?)\n  \}\n\n  async gradeCurrent/)?.[1] || '';
  assert.match(method, /await this\.openLearningItem\(pick\)/);
});

test('completed single-note card review closes the Spaced Repetition deck menu', () => {
  assert.match(main, /SPACED_REPETITION_TAB_VIEW = 'spaced-repetition-tab-view'/);
  assert.match(main, /getLeavesOfType\(SPACED_REPETITION_TAB_VIEW\)/);
  assert.match(main, /leaf\.detach\(\)/);
  assert.match(main, /modal-close-button/);
});

test('the Toolkit registers three core commands and twenty commands total', () => {
  assert.match(main, /cmd\('build-session-queue'/);
  assert.match(main, /cmd\('next-element'/);
  assert.match(main, /cmd\('end-session',\s*'为当前阅读主题评级'/);
  assert.doesNotMatch(main, /cmd\('random-due'|cmd\('review-cards'|cmd\('review-cards-in-note'/);
  assert.equal((main.match(/\bcmd\('/g) || []).length, 20);
  for (const id of ['capture-more', 'current-actions', 'open-toolkit-view', 'advanced-tools']) {
    assert.match(main, new RegExp(`cmd\\('${id}'`));
  }
});

test('enhance adds hotkeyable commands for the current element and read point', () => {
  for (const id of ['read-point-set', 'read-point-jump', 'mark-done-current', 'dismiss-current', 'postpone-current', 'trash-ir-item', 'remove-from-ir', 'source-clipboard', 'epub-import', 'activate-ir-item', 'split-source-chapters']) {
    assert.match(main, new RegExp(`cmd\\('${id}'`));
  }
  assert.match(main, /async setReadPointAtCursor\(\)/);
  assert.match(main, /async trashCurrentIRItem\(\)/);
  assert.match(main, /async removeCurrentFromIR\(\)/);
  assert.match(main, /trashFile\(active\)/);
  assert.match(main, /async newSourceFromClipboard\(\)/);
  assert.match(main, /label: '从剪贴板新建来源（文章）'/);
  assert.match(main, /async importFromEpub\(\)/);
  assert.match(main, /_epubReadZip\(/);
  assert.match(main, /_confirmEpubPreview\(/);
  assert.match(main, /async activateCurrentIRItem\(\)/);
  assert.match(main, /async splitSourceIntoChapters\(file\)/);
  assert.ok(main.includes('skipTitles'), 'split must skip structural headings like the book title and 目录');
  assert.ok(main.includes('for (const level of [2, 1])'), 'split must pick the chapter level, preferring H2 then H1');
  assert.ok(main.includes('while (used.has(noteTitle))'), 'split must de-duplicate filenames instead of skipping sections');
  assert.ok(main.includes("'status: inbox\\n' +"), 'split children must land in the inbox, not the queue');
  assert.ok(main.includes('还没有记录记忆状态，留在这一篇。'), 'nextElement must refuse to advance with no memory state today');
  assert.ok(main.includes('今天不算做完'), 'end-of-queue notice must distinguish unfinished items');
  assert.ok(!main.includes("if (!next) { new Notice('✨ 已全部跟上。'); return; }"), 'nextElement must not claim completion unconditionally');
  assert.ok(main.includes('const settled = !!activeFm'), 'nextElement must gate on a settled memory state');
  assert.ok(main.includes('今日队列是空的'), 'empty queue must say so instead of 已全部跟上');
  assert.match(main, /if \(cfg.autoSplit && h2 > 0\)/, 'epub import must auto-split after creating the source');
  assert.ok(main.includes('!\\[[^\\]]*\\]\\(epubimg:'), 'epub image replacement must match the whole markdown image');
  assert.match(main, /label: '设为活跃（加入今日队列）'/);
});