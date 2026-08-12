'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scheduleFsrsReview } = require('../fsrs-core.js');

test('first Toolkit review seeds FSRS and returns a due interval', () => {
  const next = scheduleFsrsReview({}, 3, 0);
  assert.equal(next.stability, 3.2602);
  assert.ok(next.difficulty >= 1 && next.difficulty <= 10);
  assert.ok(next.interval >= 1);
});

test('a lapse reduces established stability', () => {
  const next = scheduleFsrsReview({ stability: 20, difficulty: 5 }, 1, 10);
  assert.ok(next.stability < 20);
  assert.ok(next.interval >= 1);
});
