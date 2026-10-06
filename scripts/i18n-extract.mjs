// 抽取 main.js 中所有可能面向用户的字符串字面量，生成稳定的索引清单。
// 用法: node scripts/i18n-extract.mjs [source] [outDir]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const BS = String.fromCharCode(92);
const BT = String.fromCharCode(96);
const SQ = String.fromCharCode(39);
const DQ = String.fromCharCode(34);
const NLCH = String.fromCharCode(10);

function readTemplateExpr(src, i) {
  let depth = 1;
  let j = i;
  while (j < src.length) {
    const ch = src[j];
    if (ch === BS) { j += 2; continue; }
    if (ch === '{') { depth++; j++; continue; }
    if (ch === '}') { depth--; j++; if (depth === 0) return j; continue; }
    if (ch === SQ || ch === DQ || ch === BT) {
      const end = readString(src, j);
      if (end < 0) return -1;
      j = end;
      continue;
    }
    j++;
  }
  return -1;
}

function readString(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === BS) { j += 2; continue; }
    if (ch === q) return j + 1;
    if (q === BT) {
      if (ch === '$' && src[j + 1] === '{') {
        const end = readTemplateExpr(src, j + 2);
        if (end < 0) return -1;
        j = end;
        continue;
      }
    } else if (ch === NLCH) {
      return -1;
    }
    j++;
  }
  return -1;
}

export function scanStrings(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== NLCH) i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (ch === SQ || ch === DQ || ch === BT) {
      const end = readString(src, i);
      if (end < 0) { i++; continue; }
      out.push({ start: i, end, quote: ch, raw: src.slice(i + 1, end - 1) });
      i = end;
      continue;
    }
    i++;
  }
  return out;
}

const IDENT_LIKE = /^[a-z0-9_.,:*#%()$+=<>|&!?^~; -]+$/;

export function isCandidate(tok) {
  const raw = tok.raw;
  if (raw.length < 3) return false;
  if (!/[A-Za-z]/.test(raw)) return false;
  if (tok.quote === BT) {
    if (!/ /.test(raw)) return false;
    if (/[<>]/.test(raw)) return false;
    return true;
  }
  if (IDENT_LIKE.test(raw)) return false;
  return true;
}

// main.js 内联了若干 core 文件（`// >>> xxx-functions` ... `// <<< xxx-functions`），
// 这些区间必须与独立 core 文件逐字节一致（由 test/inline-sync.test.js 校验），因此禁止汉化。
const VERBATIM_RE = /\/\/ >>> ([\w-]+)-functions[\s\S]*?\/\/ <<< \1-functions/g;

export function verbatimRanges(src) {
  const ranges = [];
  VERBATIM_RE.lastIndex = 0;
  let match;
  while ((match = VERBATIM_RE.exec(src))) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

export function lineOf(src, index) {
  return src.slice(0, index).split(NLCH).length;
}

export function buildKeys(src) {
  const seen = new Map();
  const keys = [];
  const ranges = verbatimRanges(src);
  const inVerbatim = (pos) => ranges.some(([from, to]) => pos >= from && pos < to);
  for (const tok of scanStrings(src)) {
    if (inVerbatim(tok.start)) continue;
    if (!isCandidate(tok)) continue;
    const existing = seen.get(tok.raw);
    if (existing) { existing.count++; continue; }
    const entry = { i: keys.length, line: lineOf(src, tok.start), quote: tok.quote, raw: tok.raw, count: 1 };
    seen.set(tok.raw, entry);
    keys.push(entry);
  }
  return keys;
}

function main() {
  const source = resolve(process.argv[2] || 'main.js');
  const outPath = resolve(process.argv[3] || 'i18n/keys.json');
  const src = readFileSync(source, 'utf8');
  const keys = buildKeys(src);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(keys, null, 1) + NLCH);
  console.log('keys: ' + keys.length + ' -> ' + outPath);
}

if (process.argv[1] && process.argv[1].endsWith('i18n-extract.mjs')) main();