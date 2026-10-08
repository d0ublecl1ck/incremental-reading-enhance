'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('manifest Help action opens the repository README', () => {
  assert.equal(manifest.helpUrl, 'https://github.com/d0ublecl1ck/incremental-reading-enhance#readme');
});

test('in-app guide is exposed through the grouped view command and settings', () => {
  assert.match(source, /cmd\('open-toolkit-view',\s+'打开工具包视图…'/);
  assert.match(source, /label: '用户指南', run: \(\) => this\.openUserGuide\(\)/);
  assert.match(source, /setButtonText\('打开用户指南'\)/);
  assert.match(source, /class UserGuideModal extends Modal/);
});

test('every plugin-managed path has a default and a settings control', () => {
  for (const key of [
    'sources', 'extracts', 'cards', 'attachments', 'categories', 'dashboard', 'review_log',
  ]) {
    assert.match(source, new RegExp(`\\b${key}: ['\"]`), `missing default for ${key}`);
    assert.match(source, new RegExp(`\\['${key}',`), `missing settings control for ${key}`);
  }
});
