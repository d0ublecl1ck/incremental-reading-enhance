// 把 i18n/zh-CN.jsonl 的译文按索引写回 main.js。
// 用法: node scripts/i18n-apply.mjs [--write|--check] [source] [keys] [translation]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { scanStrings, verbatimRanges } from './i18n-extract.mjs';

const BT = String.fromCharCode(96);
const BS = String.fromCharCode(92);
const DQ = String.fromCharCode(34);

const args = process.argv.slice(2);
const mode = args.includes('--write') ? 'write' : 'check';
const positional = args.filter((a) => !a.startsWith('--'));
const source = resolve(positional[0] || 'main.js');
const keysPath = resolve(positional[1] || 'i18n/keys.json');
const zhPath = resolve(positional[2] || 'i18n/zh-CN.jsonl');

const problems = [];
const warnings = [];

if (!existsSync(zhPath)) {
  console.error('missing translation file: ' + zhPath);
  process.exit(1);
}

const keys = JSON.parse(readFileSync(keysPath, 'utf8'));
const byIndex = new Map(keys.map((k) => [k.i, k]));
const translations = new Map();
let lineNo = 0;
for (const line of readFileSync(zhPath, 'utf8').split(String.fromCharCode(10))) {
  lineNo++;
  const text = line.trim();
  if (!text) continue;
  let entry;
  try {
    entry = JSON.parse(text);
  } catch (error) {
    problems.push('zh-CN.jsonl:' + lineNo + ' 不是合法 JSON: ' + error.message);
    continue;
  }
  if (typeof entry.i !== 'number' || typeof entry.zh !== 'string' || !entry.zh.length) {
    problems.push('zh-CN.jsonl:' + lineNo + ' 缺少合法的 i / zh');
    continue;
  }
  if (translations.has(entry.i)) {
    problems.push('zh-CN.jsonl:' + lineNo + ' 索引 ' + entry.i + ' 重复');
    continue;
  }
  const key = byIndex.get(entry.i);
  if (!key) {
    problems.push('zh-CN.jsonl:' + lineNo + ' 索引 ' + entry.i + ' 不在 keys.json 中');
    continue;
  }
  const zh = entry.zh;
  const withoutNewlineEscapes = zh.split(BS + 'n').join('');
  for (const [label, ch] of [['双引号', DQ], ['反引号', BT], ['反斜杠', BS]]) {
    const haystack = label === '反斜杠' ? withoutNewlineEscapes : zh;
    if (haystack.includes(ch)) problems.push('索引 ' + entry.i + ' 译文含' + label + '：' + JSON.stringify(zh));
  }
  if (zh === key.raw) {
    warnings.push('索引 ' + entry.i + ' 译文与原文相同，已忽略');
    continue;
  }
  translations.set(entry.i, zh);
}

const src = readFileSync(source, 'utf8');
const tokens = scanStrings(src);
const rawToIndex = new Map();
for (const key of keys) if (!rawToIndex.has(key.raw)) rawToIndex.set(key.raw, key.i);

const ranges = verbatimRanges(src);
const inVerbatim = (pos) => ranges.some(([from, to]) => pos >= from && pos < to);

const used = new Set();
const replacements = [];
for (const tok of tokens) {
  if (inVerbatim(tok.start)) continue;
  const index = rawToIndex.get(tok.raw);
  if (index === undefined) continue;
  const zh = translations.get(index);
  if (!zh) continue;
  used.add(index);
  replacements.push({ ...tok, zh, index });
}

for (const [index, zh] of translations) {
  if (used.has(index)) continue;
  if (src.includes(zh)) continue;
  warnings.push('索引 ' + index + ' 的译文既未命中英文原文，也未出现在源文件中：' + JSON.stringify(byIndex.get(index).raw));
}

let output = src;
for (const item of replacements.slice().sort((a, b) => b.start - a.start)) {
  output = output.slice(0, item.start) + item.quote + item.zh + item.quote + output.slice(item.end);
}

const applied = new Set(replacements.map((r) => r.index));
const untouched = tokens.filter((tok) => {
  const index = rawToIndex.get(tok.raw);
  return index !== undefined && !applied.has(index);
});

if (mode === 'write') {
  writeFileSync(source, output);
  console.log('applied ' + replacements.length + ' replacements to ' + source);
} else {
  for (const [index, zh] of translations) {
    if (!src.includes(zh)) problems.push('索引 ' + index + ' 的译文未出现在 main.js 中（可能忘了 --write）');
  }
  console.log('check: ' + translations.size + ' entries, ' + replacements.length + ' token hits, ' + untouched.length + ' candidate tokens left in English');
}

for (const warning of warnings) console.warn('warn: ' + warning);
for (const problem of problems) console.error('error: ' + problem);
if (problems.length) process.exit(1);