'use strict';
// 行为测试：nextElement 必须在今天没有记忆状态时先弹出评级，且不选不前进。
const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const stub = require('./obsidian-stub.cjs');

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'obsidian') return stub;
  return originalLoad.call(this, request, ...rest);
};
const IncrementalReadingPlugin = require('../main.js');
Module._load = originalLoad;

const dateCore = require('../date-core.js');
const today = dateCore.formatDate(new Date(), dateCore.normalizeDateFormat(undefined));

function mdFile(path) {
  const f = new stub.TFile(path);
  f.extension = 'md';
  return f;
}

function build({ sessionPaths, activePath, frontmatter, gradeResult, exists = true }) {
  const files = new Map();
  if (exists) for (const p of sessionPaths) files.set(p, mdFile(p));
  const active = activePath ? mdFile(activePath) : null;
  const app = {
    workspace: { getActiveFile: () => active },
    vault: { getAbstractFileByPath: (p) => files.get(p) || null },
    metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatter?.[f.path] ?? null }) },
  };
  const plugin = Object.create(IncrementalReadingPlugin.prototype);
  plugin.app = app;
  plugin.settings = { session: { date: today, paths: sessionPaths.slice() }, misc: {} };
  const calls = { grade: 0, opened: [] };
  plugin.gradeCurrent = async () => { calls.grade += 1; return gradeResult; };
  plugin._openLearningFile = async (file) => { calls.opened.push(file.path); };
  plugin.consumeSessionItem = async () => {};
  return { plugin, calls };
}

test('未评级不前进：gradeCurrent 被调用，评级取消则停在原处', async () => {
  stub.__notices.length = 0;
  const a = 'IR/Sources/B/一.md';
  const b = 'IR/Sources/B/二.md';
  const { plugin, calls } = build({
    sessionPaths: [a, b], activePath: a,
    frontmatter: { [a]: { type: 'source', status: 'active', last_reviewed: null } },
    gradeResult: false,
  });
  await plugin.nextElement();
  assert.equal(calls.grade, 1, '应当先弹出评级');
  assert.deepEqual(calls.opened, [], '评级取消后不得前进');
  assert.ok(stub.__notices.includes('还没有记录记忆状态，留在这一篇。'), '应给出明确的停留提示');
});

test('评级完成后才前进到下一项', async () => {
  stub.__notices.length = 0;
  const a = 'IR/Sources/B/一.md';
  const b = 'IR/Sources/B/二.md';
  const { plugin, calls } = build({
    sessionPaths: [a, b], activePath: a,
    frontmatter: { [a]: { type: 'source', status: 'active', last_reviewed: null } },
    gradeResult: true,
  });
  await plugin.nextElement();
  assert.equal(calls.grade, 1);
  assert.deepEqual(calls.opened, [b], '评级完成后应打开下一项');
});

test('已有记忆状态不拦截：直接前进', async () => {
  stub.__notices.length = 0;
  const a = 'IR/Sources/B/一.md';
  const b = 'IR/Sources/B/二.md';
  const { plugin, calls } = build({
    sessionPaths: [a, b], activePath: a,
    frontmatter: { [a]: { type: 'source', status: 'done' } },
    gradeResult: false,
  });
  await plugin.nextElement();
  assert.equal(calls.grade, 0, '已完成项不应再要求评级');
  assert.deepEqual(calls.opened, [b]);
});

test('队列外的普通笔记不拦截', async () => {
  stub.__notices.length = 0;
  const a = 'IR/Sources/B/一.md';
  const outside = '随便/一篇笔记.md';
  const { plugin, calls } = build({
    sessionPaths: [a], activePath: outside,
    frontmatter: { [outside]: { type: 'note' } },
    gradeResult: false,
  });
  await plugin.nextElement();
  assert.equal(calls.grade, 0, '非 IR 笔记不该被要求评级');
  assert.deepEqual(calls.opened, [a]);
});

test('队列外的 IR 来源同样要拦截', async () => {
  stub.__notices.length = 0;
  const a = 'IR/Sources/B/一.md';
  const standalone = 'IR/Sources/B/未入队.md';
  const { plugin, calls } = build({
    sessionPaths: [a], activePath: standalone,
    frontmatter: {
      [a]: { type: 'source', status: 'active', last_reviewed: null },
      [standalone]: { type: 'source', status: 'inbox', last_reviewed: null },
    },
    gradeResult: false,
  });
  await plugin.nextElement();
  assert.equal(calls.grade, 1, '只要打开着未评级的 IR 来源，就该先弹出评级');
  assert.deepEqual(calls.opened, [], '不选则不前进');
});

test('空队列 + 未评级来源：先评级，不谎报队列为空', async () => {
  stub.__notices.length = 0;
  const a = 'IR/Sources/B/一.md';
  const { plugin, calls } = build({
    sessionPaths: [], activePath: a,
    frontmatter: { [a]: { type: 'source', status: 'inbox', last_reviewed: null } },
    gradeResult: false,
  });
  await plugin.nextElement();
  assert.equal(calls.grade, 1, '队列为空也要先要记忆状态');
  assert.ok(!stub.__notices.some(m => m.includes('今日队列是空的')), '不该在被拦截时谎报队列为空');
});

test('空队列 + 非 IR 笔记：说明队列为空', async () => {
  stub.__notices.length = 0;
  const outside = '随便/一篇笔记.md';
  const { plugin, calls } = build({
    sessionPaths: [], activePath: outside,
    frontmatter: { [outside]: { type: 'note' } },
    gradeResult: false,
  });
  await plugin.nextElement();
  assert.equal(calls.grade, 0);
  assert.ok(stub.__notices.some(m => m.includes('今日队列是空的')), '空队列应说明原因');
  assert.ok(!stub.__notices.includes('✨ 已全部跟上。'), '空队列不该说已全部跟上');
});
