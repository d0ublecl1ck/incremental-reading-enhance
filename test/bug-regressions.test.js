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

test('Spaced Repetition scheduling comments control whether a card is due', () => {
  const factory = new Function(`${functionSource('spacedRepetitionCardIsDue')}; return spacedRepetitionCardIsDue;`);
  const isDue = factory();
  const today = new Date(2026, 6, 13);
  assert.equal(isDue('new card', today), true);
  assert.equal(isDue('<!--SR:!2026-07-12,2,250-->', today), true);
  assert.equal(isDue('<!--SR:!2026-07-13,2,250-->', today), true);
  assert.equal(isDue('<!--SR:!2026-07-14,2,250-->', today), false);
});

test('Spaced Repetition completion detects scheduling changes rather than arbitrary edits', () => {
  const factory = new Function(`${functionSource('spacedRepetitionScheduleSignature')}; return spacedRepetitionScheduleSignature;`);
  const signature = factory();
  assert.equal(signature('question\nanswer'), '');
  assert.equal(signature('<!--SR:!2026-07-14,2,250-->'), '<!--SR:!2026-07-14,2,250-->');
  assert.equal(
    signature('<!--SR:!2026-07-14,2,250-->\ntext\n<!--SR:2026-07-15,3,260-->'),
    '<!--SR:!2026-07-14,2,250-->\n<!--SR:2026-07-15,3,260-->',
  );
});

test('tree completion filtering does not force branches open', () => {
  assert.match(main, /this\._match = \{ keep, forceExpand: !!f \|\| this\.typeFilter !== 'all' \}/);
  assert.match(main, /const expanded = !!this\._match\?\.forceExpand \|\| this\.plugin\.isExpanded\(key\)/);
});

test('invalid clock components are rejected', () => {
  const factory = new Function(`${functionSource('parseTimeInput')}; return parseTimeInput;`);
  const parse = factory();
  assert.equal(parse('1:59'), 119);
  assert.equal(parse('1:60'), null);
  assert.equal(parse('2:59:59'), 10799);
  assert.equal(parse('2:60:00'), null);
  assert.equal(parse('2:00:60'), null);
});

test('extract creation distinguishes cancellation from an automatic interval', () => {
  assert.match(main, /if \(customStr === null\) return false;/);
  assert.match(main, /Invalid interval — enter a positive whole number of days/);
});

test('extract notes receive a configurable highlight in editor and reading views', () => {
  assert.match(main, /extract_highlight_color: DEFAULT_EXTRACT_HIGHLIGHT_COLOR/);
  assert.match(main, /setName\('Extract highlight colour'\)/);
  assert.match(main, /getFm\(this\.app, view\.file\)\?\.type === 'extract'/);
  assert.match(main, /toggleClass\('ir-extract-view', isExtract\)/);
  assert.match(main, /editor\.replaceRange\(excerptHighlightMarkup\(editor\.getRange\(from, to\)\), from, to\)/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.match(css, /\.ir-extract-view \.markdown-preview-sizer/);
  assert.match(css, /\.ir-extract-view \.cm-content/);
  assert.match(css, /\.ir-excerpt-text/);
});

test('asynchronous queue refreshes discard stale results', () => {
  assert.match(main, /const generation = \+\+this\.rowsGeneration/);
  assert.match(main, /generation !== this\.rowsGeneration/);
});

test('collection views ignore body-only metadata refreshes', () => {
  assert.match(main, /if \(next === previous\) return;/);
  assert.match(main, /this\.irMetadataSignatures\.set\(file\.path, next\)/);
  assert.match(main, /IR_VIEW_FRONTMATTER_FIELDS/);
});

test('due card reads use bounded concurrency', () => {
  assert.match(main, /async function filterAsyncConcurrent/);
  assert.match(main, /return filterAsyncConcurrent\(candidates, async item =>/);
  assert.match(main, /Math\.min\(Math\.max\(1, concurrency\), items\.length\)/);
});

test('stats command opens the visual analytics dashboard', () => {
  const method = main.match(/async stats\(\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.match(method, /openDashboard\('stats'\)/);
  assert.doesNotMatch(method, /new Notice/);
  assert.match(main, /_activityChart\(parent, days\)/);
  assert.match(main, /_distributionChart\(parent, rows\)/);
  assert.match(main, /Learning analytics/);
});

test('note navigation defers timeline work and skips forced view visibility checks', () => {
  const queueOpen = main.slice(main.indexOf('class IRQueueView'), main.indexOf('//  Settings Tab'));
  assert.match(queueOpen, /workspace\.on\('file-open',[\s\S]*?this\._scheduleTimelineRefresh\(file\)/);
  assert.match(queueOpen, /_scheduleTimelineRefresh\(file\)[\s\S]*?\}, 120\)/);
  assert.doesNotMatch(queueOpen, /active-leaf-change',[\s\S]{0,300}?isViewVisible\(this\)/);
  assert.doesNotMatch(queueOpen, /active-leaf-change', \(\) => this\._render\(\)/);
});

test('queue rows and card due checks are cached with precise invalidation', () => {
  assert.match(main, /async _getQueueModel\(\)/);
  assert.match(main, /this\.queueModel\?\.date === date/);
  assert.match(main, /const key = `\$\{dateKey\}:\$\{file\.stat\?\.mtime \|\| 0\}:\$\{file\.stat\?\.size \|\| 0\}`/);
  assert.match(main, /vault\.on\('modify', file => \{[\s\S]*?this\.cardDueCache\.delete\(file\.path\)/);
  assert.doesNotMatch(main, /setInterval\(\(\) => this\._render\(\), 30000\)/);
});

test('hidden collection views defer metadata renders', () => {
  assert.match(main, /function isViewVisible\(view\)/);
  assert.match(main, /if \(!isViewVisible\(this\)\) \{ this\.needsRender = true; return; \}/);
});

test('vault structure and card-body listeners are scoped and defer expensive card renders', () => {
  const queue = main.slice(main.indexOf('class IRQueueView'), main.indexOf('//  Settings Tab'));
  const dashboard = main.slice(main.indexOf('class MainDashboardView'), main.indexOf('class KnowledgeTreeView'));
  assert.match(queue, /isPathInIRCollection\(this\.plugin\.settings, file\?\.path\)/);
  assert.match(queue, /this\.needsRowsRender = true/);
  assert.doesNotMatch(queue, /_scheduleRowsRender\('card-modify'\)/);
  assert.match(dashboard, /this\.needsRender = true/);
  assert.match(main, /vault\.on\('create', file => \{[\s\S]*?isPathInIRCollection/);
  assert.match(main, /isPathInIRCollection\(this\.settings, oldPath\)[\s\S]*?isPathInIRCollection\(this\.settings, file\?\.path\)/);
});

test('collection-heavy features share one cached file and metadata index', () => {
  assert.match(main, /getIRFiles\(\) \{/);
  assert.match(main, /getIRRows\(\) \{/);
  assert.match(main, /if \(!this\.irFilesCache\)/);
  assert.match(main, /if \(!this\.irRowsCache\)/);
  assert.match(main, /for \(const \{ tfile: file, fm \} of this\.plugin\.getIRRows\(\)\)/);
  assert.match(main, /for \(const \{ tfile: f, fm \} of this\.getIRRows\(\)\)/);
});

test('large queue sections render incrementally and diagnostics are available', () => {
  assert.match(main, /rows\.slice\(0, limit\)/);
  assert.match(main, /Show \$\{Math\.min\(100, rows\.length - limit\)\} more/);
  assert.match(main, /label: 'Performance diagnostics', run: \(\) => this\.performanceDiagnostics\(\)/);
  assert.match(main, /async performanceDiagnostics\(\)/);
});

test('page, priority, and boost prompts reject partially numeric input', () => {
  assert.doesNotMatch(main, /const p = parseInt\(raw, 10\)/);
  assert.match(main, /Enter a positive whole page number/);
  assert.match(main, /Invalid duration — use mm:ss or hh:mm:ss/);
});

test('split book validates chapter ordering before creating files', () => {
  const start = main.indexOf('  async splitBook() {');
  const end = main.indexOf('\n// ============================================================================', start);
  const split = main.slice(start, end);
  assert.match(split, /if \(!lines\.length\)/);
  assert.match(split, /chapter\.end < chapter\.start/);
  assert.match(split, /chapter\.start <= previous\.end/);
  assert.match(split, /chapter\.end > totalPages/);
});
