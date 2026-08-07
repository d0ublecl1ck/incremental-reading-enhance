'use strict';
// Guard the pure functions inlined into main.js because Obsidian's loader cannot
// resolve local requires. Tests fail if shipped and directly-tested copies drift.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function extractBlock(file, start, end) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const s = src.indexOf(start);
  const e = src.indexOf(end);
  assert.ok(s !== -1, `${file} missing start marker ${start}`);
  assert.ok(e !== -1, `${file} missing end marker ${end}`);
  // Take everything after the start-marker line up to the end marker.
  const afterStart = src.indexOf('\n', s) + 1;
  return src.slice(afterStart, e).trim();
}

test('main.js inlined tree-core block is identical to tree-core.js', () => {
  assert.equal(
    extractBlock('main.js', '// >>> tree-core-functions', '// <<< tree-core-functions'),
    extractBlock('tree-core.js', '// >>> tree-core-functions', '// <<< tree-core-functions')
  );
});

test('main.js inlined spaced-repetition block is identical to its tested core', () => {
  assert.equal(
    extractBlock('main.js', '// >>> spaced-repetition-core-functions', '// <<< spaced-repetition-core-functions'),
    extractBlock('spaced-repetition-core.js', '// >>> spaced-repetition-core-functions', '// <<< spaced-repetition-core-functions')
  );
});

test('main.js inlined status-core block is identical to status-core.js', () => {
  assert.equal(
    extractBlock('main.js', '// >>> status-core-functions', '// <<< status-core-functions'),
    extractBlock('status-core.js', '// >>> status-core-functions', '// <<< status-core-functions')
  );
});

test('main.js inlined date-core block is identical to date-core.js', () => {
  assert.equal(
    extractBlock('main.js', '// >>> date-core-functions', '// <<< date-core-functions'),
    extractBlock('date-core.js', '// >>> date-core-functions', '// <<< date-core-functions')
  );
});

test('main.js inlined topic-core block is identical to topic-core.js', () => {
  assert.equal(
    extractBlock('main.js', '// >>> topic-core-functions', '// <<< topic-core-functions'),
    extractBlock('topic-core.js', '// >>> topic-core-functions', '// <<< topic-core-functions')
  );
});
