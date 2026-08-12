'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('tree actions stop pointer propagation and expose an explicit move action', () => {
  const method = main.match(/_attachActions\(row, page\) \{([\s\S]*?)\n  \}\n\}/)?.[1] || '';
  assert.match(method, /pointerdown/);
  assert.match(method, /reparentPath\(page\.path\)/);
  assert.match(method, /preventDefault/);
});

test('tree navigation uses a separate reusable content leaf', () => {
  const method = main.match(/async _openPage\(page\) \{([\s\S]*?)\n  \}\n\n  _attachDrag/)?.[1] || '';
  assert.match(method, /this\.contentLeaf/);
  assert.match(method, /getLeaf\('tab'\)/);
  assert.doesNotMatch(method, /getLeaf\(false\)/);
});

test('extract navigation does not call the source-only read-point command', () => {
  const method = main.match(/async _openPage\(page\) \{([\s\S]*?)\n  \}\n\n  _attachDrag/)?.[1] || '';
  assert.match(method, /page\.fm\.type === 'source'/);
  assert.doesNotMatch(method, /source' \|\| page\.fm\.type === 'extract/);
});

test('main knowledge tree exposes persistent multi-selection and bulk status actions', () => {
  const treeClass = main.match(/class KnowledgeTreeView extends ItemView \{([\s\S]*?)\n\}\n\nclass IncrementalReadingPlugin/)?.[1] || '';
  assert.match(treeClass, /this\.selectedPaths = new Set\(\)/);
  assert.match(treeClass, /type: 'checkbox'/);
  assert.match(treeClass, /Select visible/);
  assert.match(treeClass, /_runBulkAction\('done'\)/);
  assert.match(treeClass, /_runBulkAction\('reset'\)/);
  assert.match(treeClass, /event\.shiftKey/);
});

test('tree rows allow cards to be marked done or reset', () => {
  const method = main.match(/_attachActions\(row, page\) \{([\s\S]*?)\n  \}\n\}/)?.[1] || '';
  assert.match(method, /\['source', 'extract', 'card'\]/);
  assert.match(method, /markPathsDone\(\[page\.path\]\)/);
  assert.match(method, /resetPaths\(\[page\.path\]\)/);
});

test('bulk completion clears schedules and card reset clears SR comments', () => {
  const complete = main.match(/async markPathsDone\(paths,[\s\S]*?\n  \}/)?.[0] || '';
  const reset = main.match(/async resetPaths\(paths,[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(complete, /completeItemFrontmatter/);
  assert.match(complete, /consumeSessionItem/);
  assert.match(reset, /resetItemFrontmatter/);
  assert.match(reset, /clearSpacedRepetitionSchedule/);
});

test('tree hides completed ancestors by promoting their visible descendants', () => {
  const treeClass = main.match(/class KnowledgeTreeView extends ItemView \{([\s\S]*?)\n\}\n\nclass IncrementalReadingPlugin/)?.[1] || '';
  assert.match(treeClass, /hiddenCompleted/);
  assert.match(treeClass, /flattenedVisibleChildren/);
});

test('tree prunes selections that are no longer rendered', () => {
  const renderBody = main.match(/_renderBody\(\) \{([\s\S]*?)\n  \}\n\n  _computeFilter/)?.[1] || '';
  assert.match(renderBody, /new Set\(this\.renderedSelectablePaths\)/);
  assert.match(renderBody, /this\.selectedPaths\.delete\(path\)/);
});

test('legacy migration preserves done state and records the managed deck tag', () => {
  const migration = main.match(/async migrateLegacyCards\(\) \{([\s\S]*?)\n  \}\n\n  async reviewCards/)?.[1] || '';
  assert.match(migration, /const wasDone = next\.status === 'done'/);
  assert.match(migration, /ir_spaced_repetition_deck_tag/);
  assert.match(migration, /wasDone \? \[\] : \['status'\]/);
});
