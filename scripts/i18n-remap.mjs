import { readFileSync, writeFileSync } from 'node:fs';
import { buildKeys } from './i18n-extract.mjs';
const oldKeys = JSON.parse(readFileSync('i18n/keys.json', 'utf8'));
const oldByI = new Map(oldKeys.map((k) => [k.i, k.raw]));
const rawToZh = new Map();
const conflicts = [];
for (const line of readFileSync('i18n/zh-CN.jsonl', 'utf8').split(String.fromCharCode(10))) {
  if (!line.trim()) continue;
  const e = JSON.parse(line);
  const raw = oldByI.get(e.i);
  if (raw === undefined) { conflicts.push('missing raw for ' + e.i); continue; }
  if (rawToZh.has(raw) && rawToZh.get(raw) !== e.zh) conflicts.push('conflicting zh for ' + e.i);
  rawToZh.set(raw, e.zh);
}
const src = readFileSync('main.js', 'utf8');
const keys = buildKeys(src);
const newIByRaw = new Map(keys.map((k) => [k.raw, k.i]));
const unmatched = [];
const out = [];
for (const [raw, zh] of rawToZh) {
  const i = newIByRaw.get(raw);
  if (i === undefined) { unmatched.push(JSON.stringify(raw).slice(0, 90)); continue; }
  out.push({ i, zh });
}
out.sort((a, b) => a.i - b.i);
writeFileSync('i18n/keys.json', JSON.stringify(keys, null, 1) + String.fromCharCode(10));
writeFileSync('i18n/zh-CN.jsonl', out.map((e) => JSON.stringify(e)).join(String.fromCharCode(10)) + String.fromCharCode(10));
console.log('old keys ' + oldKeys.length + ' -> new keys ' + keys.length);
console.log('translations kept: ' + out.length + ' / ' + rawToZh.size);
console.log('conflicts: ' + JSON.stringify(conflicts.slice(0, 5)));
console.log('unmatched (dropped): ' + unmatched.length);
unmatched.slice(0, 20).forEach((u) => console.log('  ' + u));