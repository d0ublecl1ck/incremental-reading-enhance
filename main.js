'use strict';

const {
  Plugin, Notice, Modal, FuzzySuggestModal, TFile, parseYaml, FileSystemAdapter,
  PluginSettingTab, Setting, ItemView, normalizePath, Component, MarkdownRenderer,
} = require('obsidian');
// Obsidian's plugin loader evaluates this file without a resolvable __dirname, so
// `require('./tree-core.js')` fails ("Cannot find module"). The tree logic is therefore
// inlined here verbatim. tree-core.js remains the unit-tested source of truth; the block
// between the markers below MUST stay byte-identical to it (enforced by test/inline-sync.test.js).
const treeCore = (function () {
// >>> tree-core-functions (verbatim-shared with main.js; drift-checked by test/inline-sync.test.js)
// Extract the target basename from a wikilink value. Strips #headings and |aliases.
// Intentional: if value is not a wikilink, it is returned as-is — frontmatter may store a plain basename.
function linkTargetName(value) {
  if (!value) return null;
  const s = String(value);
  const m = s.match(/\[\[([^\]\|#]+)(?:[#\|][^\]]*)?\]\]/);
  const name = (m ? m[1] : s).trim();
  return name || null;
}

// Effective parent NAME: explicit root wins, then `parent`, then `source` (legacy fallback).
function effectiveParent(fm) {
  if (!fm) return null;
  if (fm.tree_root === true) return null;
  return linkTargetName(fm.parent) || linkTargetName(fm.source) || null;
}

// Comparator: tree_order ascending (missing = Infinity), then basename.
function siblingComparator(a, b) {
  const an = Number(a.fm && a.fm.tree_order);
  const bn = Number(b.fm && b.fm.tree_order);
  const ao = Number.isFinite(an) ? an : Infinity;
  const bo = Number.isFinite(bn) ? bn : Infinity;
  if (ao !== bo) return ao - bo;
  return a.basename.localeCompare(b.basename);
}

// Build index: { byName: Map<lowerBasename,page>, childrenOf: Map<lowerParent,page[]>, roots: page[] }.
// A page is a root when it has no effective parent OR its parent target is absent (dangling).
function buildTreeIndex(pages) {
  const byName = new Map();
  const duplicates = new Set();
  for (const p of pages) {
    const key = p.basename.toLowerCase();
    if (byName.has(key)) duplicates.add(key);
    else byName.set(key, p);
  }
  const childrenOf = new Map();
  const roots = [];
  for (const p of pages) {
    const parentName = effectiveParent(p.fm);
    const key = parentName ? parentName.toLowerCase() : null;
    if (key && byName.has(key) && !duplicates.has(key)) {
      if (!childrenOf.has(key)) childrenOf.set(key, []);
      childrenOf.get(key).push(p);
    } else {
      roots.push(p);
    }
  }
  const cmp = siblingComparator;
  roots.sort(cmp);
  for (const arr of childrenOf.values()) arr.sort(cmp);
  return { pages: pages.slice(), byName, childrenOf, roots, duplicates };
}

function pageByPath(index, path) {
  return index.pages.find(page => page.path === path) || null;
}

// Return a page's visible children, promoting descendants past hidden nodes.
// This keeps active descendants in the tree without rendering completed parents.
function flattenedVisibleChildren(index, page, keep = null, hidden = null, seen = new Set()) {
  if (!page || seen.has(page.path)) return [];
  const nextSeen = new Set(seen);
  nextSeen.add(page.path);
  const children = index.childrenOf.get(page.basename.toLowerCase()) || [];
  const visible = [];
  for (const child of children) {
    if (keep && !keep.has(child.path)) continue;
    if (hidden?.has(child.path)) {
      visible.push(...flattenedVisibleChildren(index, child, keep, hidden, nextSeen));
    } else {
      visible.push(child);
    }
  }
  return visible;
}

// True if moving `childName` under `newParentName` would create a cycle.
// Walks UP from newParentName via effective parents; cycle if childName is reached.
function wouldCreateCycle(index, childName, newParentName) {
  if (!newParentName) return false;
  const child = childName.toLowerCase();
  let cur = newParentName.toLowerCase();
  const seen = new Set();
  while (cur) {
    if (cur === child) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    const page = index.byName.get(cur);
    if (!page) break;
    const up = effectiveParent(page.fm);
    cur = up ? up.toLowerCase() : null;
  }
  return false;
}

// Given current sibling display order [{path, tree_order?}], move `movedPath` to
// targetIndex and renumber all with gap-10 spacing. Returns only changed entries.
function computeReorder(siblings, movedPath, targetIndex) {
  const moved = siblings.find(s => s.path === movedPath);
  if (!moved) return [];
  const rest = siblings.filter(s => s.path !== movedPath);
  const idx = Math.max(0, Math.min(targetIndex, rest.length));
  rest.splice(idx, 0, moved);
  const writes = [];
  rest.forEach((s, i) => {
    const want = (i + 1) * 10;
    if (Number(s.tree_order) !== want) writes.push({ path: s.path, tree_order: want });
  });
  return writes;
}
// <<< tree-core-functions
  return { linkTargetName, effectiveParent, siblingComparator, buildTreeIndex, pageByPath, flattenedVisibleChildren, wouldCreateCycle, computeReorder };
})();

const statusCore = (function () {
// >>> status-core-functions
const RESET_SCHEDULING_FIELDS = [
  'next_review', 'interval', 'review_count', 'last_reviewed', 'a_factor',
  'last_grade', 'last_retrievability', 'stability', 'difficulty', 'ease',
];

function normalizedTagList(tags) {
  if (Array.isArray(tags)) return tags.map(String).filter(Boolean);
  if (typeof tags === 'string') return tags.split(/[\s,]+/).filter(Boolean);
  return [];
}

function sameTag(left, right) {
  return String(left || '').replace(/^#/, '').replace(/\/+$/, '')
    === String(right || '').replace(/^#/, '').replace(/\/+$/, '');
}

function managedCardDeckTag(fm, configuredDeckTag) {
  const normalize = value => String(value || '').replace(/^#/, '').replace(/\/+$/, '');
  const stored = normalize(fm.ir_spaced_repetition_deck_tag);
  const tags = normalizedTagList(fm.tags);
  if (stored && tags.some(tag => sameTag(tag, stored))) return stored;
  const configured = normalize(configuredDeckTag);
  if (configured && tags.some(tag => sameTag(tag, configured))) return configured;
  const likelyDeckTags = tags
    .map(normalize)
    .filter(tag => tag === 'flashcards' || tag.startsWith('flashcards/'));
  return likelyDeckTags.length === 1 ? likelyDeckTags[0] : (stored || configured);
}

function completeItemFrontmatter(fm, today, deckTag) {
  fm.status = 'done';
  fm.date_done = today;
  fm.last_reviewed = today;
  delete fm.next_review;
  delete fm.interval;
  if (fm.type === 'card' && fm.ir_spaced_repetition === true) {
    const managedDeckTag = managedCardDeckTag(fm, deckTag);
    if (managedDeckTag) {
      fm.tags = normalizedTagList(fm.tags).filter(tag => !sameTag(tag, managedDeckTag));
      fm.ir_completed_deck_tag = managedDeckTag;
      fm.ir_spaced_repetition_deck_tag = managedDeckTag;
    }
  }
  return fm;
}

function resetItemFrontmatter(fm, deckTag) {
  fm.status = 'active';
  delete fm.date_done;
  delete fm.date_dismissed;
  for (const field of RESET_SCHEDULING_FIELDS) delete fm[field];
  if (fm.type === 'card' && fm.ir_spaced_repetition === true) {
    const restoreTag = fm.ir_completed_deck_tag || managedCardDeckTag(fm, deckTag);
    const tags = normalizedTagList(fm.tags);
    if (restoreTag && !tags.some(tag => sameTag(tag, restoreTag))) tags.push(String(restoreTag).replace(/^#/, ''));
    fm.tags = tags;
    if (restoreTag) fm.ir_spaced_repetition_deck_tag = String(restoreTag).replace(/^#/, '').replace(/\/+$/, '');
    delete fm.ir_completed_deck_tag;
  }
  return fm;
}

function clearSpacedRepetitionSchedule(content) {
  return String(content || '')
    .replace(/[ \t]*<!--SR:!?[^>]*-->/g, '')
    .replace(/[ \t]+\n/g, '\n');
}
// <<< status-core-functions
  return { RESET_SCHEDULING_FIELDS, normalizedTagList, managedCardDeckTag, completeItemFrontmatter, resetItemFrontmatter, clearSpacedRepetitionSchedule };
})();

const spacedRepetitionCore = (function () {
// >>> spaced-repetition-core-functions
function nativeCardText(value) {
  return String(value ?? '').trim().replace(/\r/g, '').replace(/\n[ \t]*\n+/g, '\n<br>\n');
}

function spacedRepetitionBody(format, question, answer, settings = {}) {
  const q = nativeCardText(question);
  const a = nativeCardText(answer);
  if (format === 'cloze') return q + '\n';
  const separator = format === 'reverse'
    ? (settings.multilineReversedCardSeparator || '??')
    : (settings.multilineCardSeparator || '?');
  return `${q}\n${separator}\n${a}\n`;
}
// <<< spaced-repetition-core-functions
  return { nativeCardText, spacedRepetitionBody };
})();

const fsrsCore = (function () {
// >>> fsrs-core-functions
const DEFAULT_FSRS_SETTINGS = {
  weights: [
    0.2172, 1.1771, 3.2602, 16.1507,
    7.0114, 0.57, 2.0966, 0.0069,
    1.5261, 0.112, 1.0178, 1.849,
    0.1133, 0.3127, 2.2934, 0.2191,
    3.0004, 0.7536, 0.3332, 0.1437, 0.2,
  ],
  decay: 0.2,
  request_retention: 0.9,
  fuzz: false,
  short_term_enabled: true,
};

const fsrsClamp = (value, low, high) => Math.min(Math.max(value, low), high);
const fsrsRound4 = value => Math.round(value * 10000) / 10000;

function fsrsContext(settings) {
  const config = { ...DEFAULT_FSRS_SETTINGS, ...(settings || {}) };
  const weights = Array.isArray(config.weights) && config.weights.length >= 19
    ? config.weights
    : DEFAULT_FSRS_SETTINGS.weights;
  const decay = weights.length > 20 && Number(weights[20]) > 0
    ? Number(weights[20])
    : Number(config.decay) || DEFAULT_FSRS_SETTINGS.decay;
  return {
    weights,
    decay,
    factor: Math.pow(0.9, -1 / decay) - 1,
    retention: Number(config.request_retention) || DEFAULT_FSRS_SETTINGS.request_retention,
    fuzz: config.fuzz === true,
    shortTerm: config.short_term_enabled !== false,
  };
}

function fsrsRetrievability(context, elapsedDays, stability) {
  if (!(Number(stability) > 0)) return 1;
  return Math.pow(1 + context.factor * Math.max(0, elapsedDays) / stability, -context.decay);
}

function fsrsInterval(context, stability) {
  let days = stability / context.factor
    * (Math.pow(context.retention, -1 / context.decay) - 1);
  if (context.fuzz) days *= 0.95 + Math.random() * 0.1;
  return Math.max(1, Math.round(days));
}

function fsrsSeedDifficulty(context, grade) {
  const weights = context.weights;
  return fsrsClamp(weights[4] - Math.exp(weights[5] * (grade - 1)) + 1, 1, 10);
}

function fsrsUpdateDifficulty(context, difficulty, grade) {
  const weights = context.weights;
  const damped = difficulty + (-weights[6] * (grade - 3)) * (10 - difficulty) / 9;
  const target = fsrsSeedDifficulty(context, 4);
  return fsrsClamp(weights[7] * target + (1 - weights[7]) * damped, 1, 10);
}

function fsrsUpdateRecall(context, difficulty, stability, retrievability, grade) {
  const weights = context.weights;
  const hard = grade === 2 ? weights[15] : 1;
  const easy = grade === 4 ? weights[16] : 1;
  const growth = Math.exp(weights[8]) * (11 - difficulty)
    * Math.pow(stability, -weights[9])
    * (Math.exp((1 - retrievability) * weights[10]) - 1)
    * hard * easy;
  return Math.max(0.01, stability * (1 + growth));
}

function fsrsUpdateLapse(context, difficulty, stability, retrievability) {
  const weights = context.weights;
  const next = weights[11] * Math.pow(difficulty, -weights[12])
    * (Math.pow(stability + 1, weights[13]) - 1)
    * Math.exp((1 - retrievability) * weights[14]);
  return Math.max(0.01, Math.min(next, stability));
}

function fsrsUpdateShortTerm(context, stability, grade) {
  const weights = context.weights;
  const exponent = Number.isFinite(weights[19]) ? weights[19] : 0.5;
  const increase = Math.exp(weights[17] * (grade - 3 + weights[18]))
    * Math.pow(stability, -exponent);
  return fsrsClamp(stability * increase, 0.01, 36500);
}

function scheduleFsrsReview(state, grade, elapsedDays, settings) {
  if (![1, 2, 3, 4].includes(grade)) throw new Error('FSRS grade must be 1-4.');
  const context = fsrsContext(settings);
  const firstReview = !(Number(state?.stability) > 0);
  const beforeStability = firstReview ? null : Number(state.stability);
  const beforeDifficulty = firstReview
    ? null
    : (Number(state.difficulty) || context.weights[4]);
  const retrievability = firstReview
    ? 1
    : fsrsRetrievability(context, elapsedDays, beforeStability);
  let stability;
  let difficulty;
  if (firstReview) {
    stability = context.weights[grade - 1];
    difficulty = fsrsSeedDifficulty(context, grade);
  } else {
    stability = elapsedDays < 1 && context.shortTerm
      ? fsrsUpdateShortTerm(context, beforeStability, grade)
      : (grade === 1
        ? fsrsUpdateLapse(context, beforeDifficulty, beforeStability, retrievability)
        : fsrsUpdateRecall(context, beforeDifficulty, beforeStability, retrievability, grade));
    difficulty = fsrsUpdateDifficulty(context, beforeDifficulty, grade);
  }
  return {
    stability: fsrsRound4(stability),
    difficulty: fsrsRound4(difficulty),
    retrievability: fsrsRound4(retrievability),
    interval: fsrsInterval(context, stability),
  };
}
// <<< fsrs-core-functions
  return { DEFAULT_FSRS_SETTINGS, scheduleFsrsReview };
})();

const cardProviderCore = (function () {
// >>> card-provider-core-functions
function normalizeCardBackend(value) {
  return ['toolkit', 'anki', 'spaced_repetition'].includes(value) ? value : 'toolkit';
}

function storedCardBackend(frontmatter) {
  if (frontmatter?.ir_card_backend) return normalizeCardBackend(frontmatter.ir_card_backend);
  if (frontmatter?.ir_anki === true) return 'anki';
  if (frontmatter?.ir_spaced_repetition === true) return 'spaced_repetition';
  return 'toolkit';
}

function compactFlashcardField(value) {
  return String(value || '').replace(/\s*\n\s*/g, ' ').trim();
}

function flashcardsPluginBody(format, question, answer, settings = {}) {
  const tag = String(settings.flashcardsTag || 'card').replace(/^#/, '').trim() || 'card';
  if (format === 'cloze') {
    return `${String(question || '').trim()}\n`;
  }
  const marker = format === 'reverse' ? `#${tag}-reverse` : `#${tag}`;
  return `${compactFlashcardField(question)} ${marker}\n${String(answer || '').trim()}\n`;
}
// <<< card-provider-core-functions
  return { normalizeCardBackend, storedCardBackend, compactFlashcardField, flashcardsPluginBody };
})();

const dateCore = (function () {
// >>> date-core-functions
const SUPPORTED_DATE_FORMATS = ['DD-MM-YYYY', 'MM-DD-YYYY', 'YYYY-MM-DD'];

function normalizeDateFormat(format) {
  return SUPPORTED_DATE_FORMATS.includes(format) ? format : 'DD-MM-YYYY';
}

function parseDateExact(value, format = 'DD-MM-YYYY') {
  if (!value) return null;
  const normalized = normalizeDateFormat(format);
  const match = String(value).trim().match(/^(\d{2}|\d{4})-(\d{2})-(\d{2}|\d{4})$/);
  if (!match) return null;
  const parts = String(value).trim().split('-').map(Number);
  let day, month, year;
  if (normalized === 'DD-MM-YYYY') [day, month, year] = parts;
  else if (normalized === 'MM-DD-YYYY') [month, day, year] = parts;
  else [year, month, day] = parts;
  if (year < 1000 || day < 1 || month < 1 || month > 12) return null;
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function parseDate(value, preferredFormat = 'DD-MM-YYYY') {
  const preferred = normalizeDateFormat(preferredFormat);
  for (const format of [preferred, ...SUPPORTED_DATE_FORMATS.filter(f => f !== preferred)]) {
    const parsed = parseDateExact(value, format);
    if (parsed) return parsed;
  }
  return null;
}

function formatDate(date, format = 'DD-MM-YYYY') {
  const normalized = normalizeDateFormat(format);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).padStart(4, '0');
  if (normalized === 'MM-DD-YYYY') return `${month}-${day}-${year}`;
  if (normalized === 'YYYY-MM-DD') return `${year}-${month}-${day}`;
  return `${day}-${month}-${year}`;
}

function reformatDate(value, fromFormat, toFormat) {
  const parsed = parseDateExact(value, fromFormat);
  return parsed ? formatDate(parsed, toFormat) : value;
}
// <<< date-core-functions
  return { SUPPORTED_DATE_FORMATS, normalizeDateFormat, parseDateExact, parseDate, formatDate, reformatDate };
})();

const topicCore = (function () {
// >>> topic-core-functions
function progressAwareAFactor(fm, settings, overrides = {}) {
  const s = settings.scheduling;
  let remaining = null;
  const pageTarget = Number(fm.page_end) > 0 ? Number(fm.page_end) : Number(fm.total_pages);
  const readPoint = overrides.readPoint ?? fm.read_point;
  const readSeconds = overrides.readPointSeconds ?? fm.read_point_seconds;
  if (pageTarget > 0) {
    const read = Math.max(0, Math.min(Number(readPoint) || 0, pageTarget));
    remaining = Math.max(1, pageTarget - read);
  } else if (Number(fm.total_seconds) > 0) {
    const read = Math.max(0, Math.min(Number(readSeconds) || 0, Number(fm.total_seconds)));
    remaining = Math.max(1, (Number(fm.total_seconds) - read) / 60);
  }
  if (remaining == null) return null;
  const af = s.initial_af_base - s.initial_af_slope * Math.log2(remaining / s.initial_af_units_divisor);
  return Math.max(s.a_factor_min, Math.min(s.a_factor_max, af));
}

function hasProgressAdvanced({
  previousPage = 0,
  nextPage = 0,
  previousSeconds = 0,
  nextSeconds = 0,
  previousLine = 0,
  nextLine = 0,
} = {}) {
  return Number(nextPage) > Number(previousPage)
    || Number(nextSeconds) > Number(previousSeconds)
    || Number(nextLine) > Number(previousLine);
}

// Merge independently ranked topics and cards without allowing one type to
// monopolise the session. This mirrors SuperMemo's mixed topic/item stream
// while leaving each scheduler responsible for ranking its own material.
function interleaveLearningItems(items, score = () => 0) {
  const ranked = items.slice().sort((a, b) => score(b) - score(a));
  const topics = ranked.filter(item => item.fm?.type !== 'card');
  const cards = ranked.filter(item => item.fm?.type === 'card');
  if (!topics.length || !cards.length) return ranked;
  const out = [];
  let next = score(cards[0]) > score(topics[0]) ? 'card' : 'topic';
  while (topics.length || cards.length) {
    const primary = next === 'card' ? cards : topics;
    const fallback = next === 'card' ? topics : cards;
    out.push((primary.length ? primary : fallback).shift());
    next = next === 'card' ? 'topic' : 'card';
  }
  return out;
}
// <<< topic-core-functions
  return { progressAwareAFactor, hasProgressAdvanced, interleaveLearningItems };
})();

// ============================================================================
//  Constants
// ============================================================================

const ROOT = 'Sources/Incremental Reading';
const SOURCES_FOLDER = `${ROOT}/Sources`;
const EXTRACTS_FOLDER = `${ROOT}/Extracts`;
const CARDS_FOLDER = `${ROOT}/Cards`;
const ATTACHMENTS_FOLDER = `${ROOT}/Attachments`;
const CATEGORIES_FOLDER = `${ROOT}/Categories`;
const KNOWLEDGE_TREE_VIEW_TYPE = 'ir-tree-view';
const KNOWLEDGE_TREE_SIDEBAR_TYPE = 'ir-tree-sidebar';
const MAIN_DASHBOARD_VIEW_TYPE = 'ir-main-dashboard';
const PDF_VIEW_TYPE = 'ir-pdf-viewer';
const REVIEW_LOG_PATH = `${ROOT}/Review Log.md`;
const DASHBOARD_PATH = `${ROOT}/Incremental-Reading-Dashboard.md`;
const SPACED_REPETITION_PLUGIN_ID = 'obsidian-spaced-repetition';
const SPACED_REPETITION_REVIEW_COMMAND = `${SPACED_REPETITION_PLUGIN_ID}:srs-review-flashcards`;
const SPACED_REPETITION_NOTE_COMMAND = `${SPACED_REPETITION_PLUGIN_ID}:srs-review-flashcards-in-note`;
const SPACED_REPETITION_TAB_VIEW = 'spaced-repetition-tab-view';
const FLASHCARDS_PLUGIN_ID = 'flashcards-obsidian';
const FLASHCARDS_GENERATE_COMMAND = `${FLASHCARDS_PLUGIN_ID}:generate-flashcard-current-file`;

const READ_POINT_MARKER = '📍<!--ir-readpoint-->';
const READ_POINT_RE = /(?:📍\s*)?<!--ir-readpoint-->/g;
const BODY_MARKER = '<!--ir-card-body-->';
const DEFAULT_EXTRACT_HIGHLIGHT_COLOR = '#ffd166';
// ==highlight== cloze marker. Inner allows single '=' (LaTeX like ==E = mc^2==)
// but not '==', so the closing delimiter is never swallowed. Build per-use with
// `new RegExp(HL_CLOZE_SRC, 'g')` — shared lastIndex across call sites would corrupt matchAll/replace.
const HL_CLOZE_SRC = '==((?:[^=]|=(?!=))+)==';


// ============================================================================
//  Default settings — single source of truth for tunables.
// ============================================================================

const DEFAULT_SETTINGS = {
  scheduling: {
    a_factor_min: 1.05,
    a_factor_max: 5.0,
    progress_aware: true,
    stall_guard: true,
    quality_hold: 1.0,
    quality_speed_up: 0.95,
    quality_slow_down: 1.05,
    initial_af_base: 2.5,
    initial_af_slope: 0.25,
    initial_af_units_divisor: 10,
    extract_bump: 1.05,
  },
  flashcards: {
    backend: 'toolkit',
  },
  fsrs: { ...fsrsCore.DEFAULT_FSRS_SETTINGS },
  queue: {
    sidebar_enabled: true,
    default_tag_filter: '',
    sort_key: 'urgency',
    mix_cards: true,
  },
  inline_cards: {
    enabled: true,
    qa_regex: '^Q::\\s*(.+?)\\s*::A::\\s*(.+)$',
    cloze_regex: '\\{\\{c(\\d+)::([^}]+?)(?:::([^}]+?))?\\}\\}',
  },
  spaced_repetition: {
    flashcardTag: 'flashcards/incremental-reading',
    multilineCardSeparator: '?',
    multilineReversedCardSeparator: '??',
  },
  anki: {
    deck: '渐进阅读',
    flashcardsTag: 'card',
    syncOnCreate: true,
  },
  paths: {
    sources: 'Sources/Incremental Reading/Sources',
    extracts: 'Sources/Incremental Reading/Extracts',
    cards: 'Sources/Incremental Reading/Cards',
    attachments: 'Sources/Incremental Reading/Attachments',
    categories: 'Sources/Incremental Reading/Categories',
    dashboard: 'Sources/Incremental Reading/Incremental-Reading-Dashboard.md',
    review_log: 'Sources/Incremental Reading/Review Log.md',
  },
  misc: {
    debug: false,
    date_format: 'DD-MM-YYYY',
    extract_highlight_color: DEFAULT_EXTRACT_HIGHLIGHT_COLOR,
  },
  tree: {
    expanded: [],
    child_warn_threshold: 100,
    show_completed: false,
  },
  session: {
    date: null,
    paths: [],
    types: {},
    readPoints: {},
  },
  // enhance
  epubImport: {
    libraryFolder: '',
    dropLeadingToc: true,
    autoSplit: true,
  },
};

function normalizedExtractHighlightColor(value) {
  const color = String(value || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color) ? color : DEFAULT_EXTRACT_HIGHLIGHT_COLOR;
}

function extractHighlightBackground(value) {
  const color = normalizedExtractHighlightColor(value);
  const number = Number.parseInt(color.slice(1), 16);
  return `rgba(${number >> 16}, ${(number >> 8) & 255}, ${number & 255}, 0.18)`;
}

function excerptHighlightMarkup(value) {
  const text = String(value || '');
  if (!text || /^<mark class="ir-excerpt-text">[\s\S]*<\/mark>$/.test(text)) return text;
  return `<mark class="ir-excerpt-text">${text}</mark>`;
}

//  Date helpers
// ============================================================================

function configuredDateFormat(settings) {
  return dateCore.normalizeDateFormat(settings?.misc?.date_format);
}

function parseDateValue(value, settings) {
  return dateCore.parseDate(value, configuredDateFormat(settings));
}

function formatDateValue(date, settings) {
  return dateCore.formatDate(date, configuredDateFormat(settings));
}

function todayDateString(settings) { return formatDateValue(todayDate(), settings); }

function todayDate() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function futureDateString(days, settings) {
  const d = todayDate();
  d.setDate(d.getDate() + days);
  return formatDateValue(d, settings);
}

function daysBetween(a, b) {
  return Math.round((a - b) / 86400000);
}

// ============================================================================
//  Scoring helpers
// ============================================================================

function priorityToInterval(priority) {
  const p = Math.min(Math.max(Number(priority) || 50, 1), 100);
  return Math.max(1, Math.ceil(p * 0.15));
}

function urgency(fm, today, settings) {
  const pri = fm.priority ? (101 - fm.priority) * 10 : 0;
  const nr = parseDateValue(fm.next_review, settings);
  if (!nr) return pri;
  const diff = daysBetween(today, nr);
  let u = pri + diff * 2;
  if (diff >= 0) u += 5000;
  return u;
}

function isDue(fm, today, settings) {
  if (!fm.next_review) return true;
  const nr = parseDateValue(fm.next_review, settings);
  if (!nr) return true;
  return nr <= today;
}

function isPastDue(fm, today, settings) {
  if (!fm.next_review) return false;
  const nr = parseDateValue(fm.next_review, settings);
  if (!nr) return false;
  return nr < today;
}

function isActiveIR(fm) {
  if (!fm) return false;
  if (fm.type !== 'source' && fm.type !== 'extract' && fm.type !== 'card') return false;
  if (fm.status === 'done' || fm.status === 'container' ||
      fm.status === 'dismissed' || fm.status === 'inbox') return false;
  return true;
}

function isQueueVisibleIR(fm) {
  if (!fm) return false;
  if (fm.type !== 'source' && fm.type !== 'extract' && fm.type !== 'card') return false;
  return !['done', 'container', 'dismissed'].includes(fm.status);
}

function spacedRepetitionCardIsDue(content, today) {
  const dueDates = [...String(content || '').matchAll(/<!--SR:!?(\d{4}-\d{2}-\d{2})(?:,[^>]*)?-->/g)]
    .map(match => match[1]);
  if (!dueDates.length) return true; // New, unscheduled card.
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return dueDates.some(date => date <= todayString);
}

function spacedRepetitionScheduleSignature(content) {
  return [...String(content || '').matchAll(/<!--SR:!?[^>]*-->/g)]
    .map(match => match[0])
    .join('\n');
}

function savedQueueCandidates(paths, activePath, fromStart = false) {
  const queue = Array.isArray(paths) ? paths : [];
  const currentIndex = activePath ? queue.indexOf(activePath) : -1;
  return !fromStart && currentIndex >= 0 ? queue.slice(currentIndex + 1) : queue.slice();
}

// ============================================================================
//  A-Factor (topic scheduling) — progress-aware
// ============================================================================
//  Per-rep recompute from the *remaining* material so long unfinished sources
//  stay in active rotation (small a_factor) and short almost-done sources
//  exit quickly (large a_factor). Falls back to a static a_factor when the
//  file has no page/seconds metadata.

function clampAFactor(settings, x) {
  const s = settings.scheduling;
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 1) return s.a_factor_min;
  return Math.max(s.a_factor_min, Math.min(s.a_factor_max, n));
}

function readAFactor(settings, fm) {
  return clampAFactor(settings, fm?.a_factor);
}

function initialAFactor(settings, { total_pages, total_seconds } = {}) {
  const s = settings.scheduling;
  let units = null;
  if (Number(total_pages) > 0) units = Number(total_pages);
  else if (Number(total_seconds) > 0) units = Number(total_seconds) / 60;
  if (!units || units < 1) return 2.0;
  const af = s.initial_af_base - s.initial_af_slope * Math.log2(units / s.initial_af_units_divisor);
  return Math.max(s.a_factor_min, Math.min(2.5, af));
}

// ============================================================================
const round4 = (x) => Math.round(x * 10000) / 10000;

//  Link parsing
// ============================================================================

function linkTarget(value) {
  if (!value) return null;
  const s = String(value);
  const m = s.match(/\[\[([^\]\|]+)(?:\|[^\]]*)?\]\]/);
  return m ? m[1].trim() : s.trim();
}

function linkPointsTo(value, target) {
  const t = linkTarget(value);
  return t === target;
}

// ============================================================================
//  Inline cards — parse Q::A / cloze / {{c1::...}} forms out of a note body.
//  Each match yields a stable id so repeated exports can avoid duplicates.
// ============================================================================

function inlineCardId(filePath, literal) {
  let h = 0x811c9dc5;
  const s = `${filePath}\n${literal}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function parseInlineCards(filePath, body, settings) {
  const s = settings.inline_cards;
  if (!s.enabled) return [];
  const lines = body.split('\n');
  const out = [];

  let qa, cloze;
  try {
    qa = new RegExp(s.qa_regex);
    cloze = new RegExp(s.cloze_regex, 'g');
  } catch (error) {
    throw new Error(`行内卡片正则表达式无效：${error.message}`);
  }
  if (qa.global) throw new Error('Q::A 正则表达式不得使用全局标志。');

  // The same literal (e.g. `==voltage angle==`) on two lines hashes to the same
  // id, colliding so only one card is gradable and the other sticks in the queue.
  // Salt repeats with `#2`, `#3`… The first occurrence keeps the plain hash, so
  // ids for unique literals stay backward-compatible with existing review state.
  const seen = new Set();
  const uniqId = (literal) => {
    let id = inlineCardId(filePath, literal);
    let n = 1;
    while (seen.has(id)) id = inlineCardId(filePath, `${literal}#${++n}`);
    seen.add(id);
    return id;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(qa);
    if (m) {
      out.push({
        id: uniqId(m[0]),
        line: i,
        type: 'qa',
        question: m[1],
        answer: m[2],
      });
      continue;
    }
    for (const cm of line.matchAll(cloze)) {
      out.push({
        id: uniqId(cm[0]),
        line: i,
        type: 'cloze',
        cloze_index: Number(cm[1]),
        text: cm[2],
        hint: cm[3] || null,
        full_line: line,
      });
    }
    for (const hm of line.matchAll(new RegExp(HL_CLOZE_SRC, 'g'))) {
      out.push({
        id: uniqId(hm[0]),
        line: i,
        type: 'cloze',
        cloze_index: 1,
        text: hm[1],
        hint: null,
        full_line: line,
      });
    }
  }
  return out;
}

//  Modal helpers
// ============================================================================

class TextPromptModal extends Modal {
  constructor(app, title, defaultValue, resolve) {
    super(app);
    this.title = title;
    this.defaultValue = defaultValue ?? '';
    this.resolve = resolve;
    this._resolved = false;
  }
  onOpen() {
    this.titleEl.setText(this.title);
    const { contentEl } = this;
    contentEl.empty();
    const input = contentEl.createEl('input', { cls: 'ir-modal-input' });
    input.type = 'text';
    input.value = this.defaultValue;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._submit(input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); this._cancel(); }
    });
    const row = contentEl.createDiv({ cls: 'modal-button-container' });
    const submit = row.createEl('button', { text: 'OK', cls: 'mod-cta' });
    submit.addEventListener('click', () => this._submit(input.value));
    const cancel = row.createEl('button', { text: '取消' });
    cancel.addEventListener('click', () => this._cancel());
    // Defer focus a tick so any closing modal above us releases focus first.
    window.setTimeout(() => { input.focus(); input.select(); }, 20);
  }
  _submit(v) {
    if (this._resolved) return;
    this._resolved = true;
    this.close();
    this.resolve(v);
  }
  _cancel() {
    if (this._resolved) return;
    this._resolved = true;
    this.close();
    this.resolve(null);
  }
  onClose() {
    this.contentEl.empty();
    if (!this._resolved) {
      this._resolved = true;
      this.resolve(null);
    }
  }
}

class GenericSuggestModal extends FuzzySuggestModal {
  constructor(app, items, displayFn, resolve, placeholder) {
    super(app);
    this.items = items;
    this.displayFn = displayFn;
    this.resolve = resolve;
    this._chose = false;
    this._chosen = null;
    this._resolved = false;
    if (placeholder) this.setPlaceholder(placeholder);
  }
  getItems() { return this.items; }
  getItemText(i) { return this.displayFn(i); }
  // Resolve immediately on selection. Earlier "defer to onClose" was a
  // workaround for chained-modal focus loss, but evidence shows Obsidian
  // calls `close()` synchronously after `onChooseItem`, so by the time the
  // promise consumer runs, the modal is already gone.
  onChooseItem(i, evt) {
    if (this._resolved) return;
    this._resolved = true;
    this.resolve(i);
  }
  onClose() {
    super.onClose?.();
    // Obsidian fires `close()` BEFORE `onChooseItem` in current builds, so
    // we can't resolve null here directly — onChooseItem fires immediately
    // after and would arrive too late. Defer the cancel-resolve so a real
    // selection has time to land first.
    setTimeout(() => {
      if (this._resolved) return;
      this._resolved = true;
      this.resolve(null);
    }, 50);
  }
}

class ConfirmModal extends Modal {
  constructor(app, title, message, resolve) {
    super(app);
    this.title = title;
    this.message = message;
    this.resolve = resolve;
    this._resolved = false;
  }
  onOpen() {
    this.titleEl.setText(this.title);
    const { contentEl } = this;
    contentEl.empty();
    if (this.message) contentEl.createEl('p', { text: this.message });
    const row = contentEl.createDiv({ cls: 'modal-button-container' });
    const yes = row.createEl('button', { text: 'OK', cls: 'mod-cta' });
    yes.addEventListener('click', () => this._answer(true));
    const no = row.createEl('button', { text: '取消' });
    no.addEventListener('click', () => this._answer(false));
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._answer(true); }
      else if (e.key === 'Escape') { e.preventDefault(); this._answer(false); }
    };
    contentEl.addEventListener('keydown', onKey);
    window.setTimeout(() => yes.focus(), 20);
  }
  _answer(v) {
    if (this._resolved) return;
    this._resolved = true;
    this.close();
    this.resolve(v);
  }
  onClose() {
    this.contentEl.empty();
    if (!this._resolved) {
      this._resolved = true;
      this.resolve(false);
    }
  }
}

class LongTextModal extends Modal {
  constructor(app, title, defaultValue, resolve) {
    super(app);
    this.title = title;
    this.defaultValue = defaultValue ?? '';
    this.resolve = resolve;
    this._resolved = false;
  }
  onOpen() {
    this.titleEl.setText(this.title);
    const { contentEl } = this;
    contentEl.empty();
    const ta = contentEl.createEl('textarea', { cls: 'ir-modal-textarea' });
    ta.value = this.defaultValue;
    const row = contentEl.createDiv({ cls: 'modal-button-container' });
    const submit = row.createEl('button', { text: 'OK', cls: 'mod-cta' });
    submit.addEventListener('click', () => this._submit(ta.value));
    const cancel = row.createEl('button', { text: '取消' });
    cancel.addEventListener('click', () => this._cancel());
    window.setTimeout(() => ta.focus(), 20);
  }
  _submit(v) {
    if (this._resolved) return;
    this._resolved = true;
    this.close();
    this.resolve(v);
  }
  _cancel() {
    if (this._resolved) return;
    this._resolved = true;
    this.close();
    this.resolve(null);
  }
  onClose() {
    this.contentEl.empty();
    if (!this._resolved) {
      this._resolved = true;
      this.resolve(null);
    }
  }
}

// ------------------------------------------------------------------
//  OcclusionModal — drag-select rectangles over an image, commit
//  produces { rects: [{x,y,w,h}], mode: 'hide-one'|'show-one' } where
//  coords are fractions of the natural image dimensions (0..1).
//  Two commit buttons mirror SuperMemo: Hide-one / Show-one.
// ------------------------------------------------------------------
class OcclusionModal extends Modal {
  constructor(app, imageSrc, resolve) {
    super(app);
    this.imageSrc = imageSrc;
    this.resolve = resolve;
    this._resolved = false;
    this.rects = [];        // committed rects (in fractional 0..1 coords)
    this.dragStart = null;  // {x, y} in fractional coords, null if not dragging
    this.dragNow = null;
  }
  onOpen() {
    this.titleEl.setText('遮挡：拖动以绘制矩形');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('ir-occ-modal');

    contentEl.createEl('p', {
      cls: 'ir-occ-help',
      text: '按住并拖动以添加矩形。右键单击以移除。Shift+单击矩形可设置或清除其标签。在底部选择模式以生成卡片。'
    });

    const wrap = contentEl.createDiv({ cls: 'ir-occ-wrap' });

    const img = wrap.createEl('img', { cls: 'ir-occ-img' });
    img.src = this.imageSrc;
    img.draggable = false;

    const overlay = wrap.createDiv({ cls: 'ir-occ-overlay' });

    this.wrap = wrap;
    this.overlay = overlay;
    this.img = img;

    img.addEventListener('load', () => this._renderRects());

    const localFrac = (e) => {
      const r = overlay.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    };
    overlay.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.dragStart = localFrac(e);
      this.dragNow = this.dragStart;
      this._renderRects();
    });
    window.addEventListener('mousemove', this._mouseMove = (e) => {
      if (!this.dragStart) return;
      this.dragNow = localFrac(e);
      this._renderRects();
    });
    window.addEventListener('mouseup', this._mouseUp = (e) => {
      if (!this.dragStart) return;
      const a = this.dragStart, b = this.dragNow || this.dragStart;
      const x = Math.max(0, Math.min(a.x, b.x));
      const y = Math.max(0, Math.min(a.y, b.y));
      const w = Math.min(1 - x, Math.abs(a.x - b.x));
      const h = Math.min(1 - y, Math.abs(a.y - b.y));
      this.dragStart = null; this.dragNow = null;
      // Reject tiny rects (treat as misclick)
      if (w > 0.005 && h > 0.005) this.rects.push({ x, y, w, h });
      this._renderRects();
    });

    const buttonRow = contentEl.createDiv({ cls: 'modal-button-container ir-occ-btnrow' });

    const hideOneBtn = buttonRow.createEl('button', { text: '生成：隐藏一个（N 张卡片）', cls: 'mod-cta' });
    hideOneBtn.title = '每个矩形一张卡片；每张卡片只隐藏该矩形，显示其余部分。';
    hideOneBtn.addEventListener('click', () => this._commit('hide-one'));

    const showOneBtn = buttonRow.createEl('button', { text: '生成：显示一个（N 张卡片）' });
    showOneBtn.title = '每个矩形一张卡片；每张卡片只显示该矩形，隐藏其余部分。';
    showOneBtn.addEventListener('click', () => this._commit('show-one'));

    const clearBtn = buttonRow.createEl('button', { text: '清除' });
    clearBtn.addEventListener('click', () => { this.rects = []; this._renderRects(); });

    const cancelBtn = buttonRow.createEl('button', { text: '取消' });
    cancelBtn.addEventListener('click', () => this._cancel());

    this.statusEl = contentEl.createDiv({ cls: 'ir-occ-status' });
    this._updateStatus();
  }
  _updateStatus() {
    if (this.statusEl) this.statusEl.setText(`${this.rects.length} 个矩形已绘制`);
  }
  _renderRects() {
    if (!this.overlay) return;
    this.overlay.empty();
    const drawCover = (r, color, idx) => {
      const div = this.overlay.createDiv({ cls: 'ir-occ-cover' });
      // Position is data-driven (fractional rect), so it stays inline via CSS vars.
      div.style.setProperty('--ir-x', (r.x * 100) + '%');
      div.style.setProperty('--ir-y', (r.y * 100) + '%');
      div.style.setProperty('--ir-w', (r.w * 100) + '%');
      div.style.setProperty('--ir-h', (r.h * 100) + '%');
      div.style.setProperty('--ir-cover-bg', color);
      if (idx != null) {
        const labelSuffix = r.label ? ` — "${r.label}"` : '';
        div.title = `矩形 ${idx + 1}${labelSuffix} · shift+click=标签 · right-click=移除`;
        div.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.rects.splice(idx, 1);
          this._renderRects();
        });
        div.addEventListener('click', async (e) => {
          if (!e.shiftKey) return;
          e.preventDefault();
          e.stopPropagation();
          const cur = this.rects[idx]?.label || '';
          const next = await askText(this.app, `矩形 ${idx + 1} 的标签（留空 = 清除）`, cur);
          if (next === null) return;
          if (next.trim() === '') delete this.rects[idx].label;
          else this.rects[idx].label = next.trim();
          this._renderRects();
        });
        if (r.label) {
          div.createDiv({ cls: 'ir-occ-label', text: r.label });
        }
      }
      return div;
    };
    this.rects.forEach((r, i) => drawCover(r, 'rgba(255, 215, 0, 0.55)', i));
    if (this.dragStart && this.dragNow) {
      const a = this.dragStart, b = this.dragNow;
      const r = {
        x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
        w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y),
      };
      drawCover(r, 'rgba(255, 100, 100, 0.40)');
    }
    this._updateStatus();
  }
  _commit(mode) {
    if (this._resolved) return;
    if (this.rects.length === 0) { new Notice('请先绘制至少一个矩形。'); return; }
    this._resolved = true;
    this.close();
    this.resolve({ rects: this.rects.slice(), mode });
  }
  _cancel() {
    if (this._resolved) return;
    this._resolved = true;
    this.close();
    this.resolve(null);
  }
  onClose() {
    if (this._mouseMove) window.removeEventListener('mousemove', this._mouseMove);
    if (this._mouseUp) window.removeEventListener('mouseup', this._mouseUp);
    this.contentEl.empty();
    if (!this._resolved) {
      this._resolved = true;
      this.resolve(null);
    }
  }
}

function askOcclusion(app, imageSrc) {
  return new Promise((res) => new OcclusionModal(app, imageSrc, res).open());
}

// ------------------------------------------------------------------
class FlashcardModal extends Modal {
  constructor(app, opts, resolve) {
    super(app);
    this.opts = opts;
    this.resolve = resolve;
    this.resolved = false;
    this.renderComponent = new Component();
  }

  onOpen() {
    this.titleEl.setText(this.opts.title || '复习卡片');
    this.modalEl.addClass('ir-fc-modal-el');
    this.contentEl.empty();
    this.contentEl.addClass('ir-fc-modal');
    if (!this.opts.hideLabels) this.contentEl.createDiv({ cls: 'ir-fc-label', text: '问题' });
    const question = this.contentEl.createDiv({ cls: 'ir-fc-question ir-fc-box markdown-rendered' });
    this._renderMarkdown(question, this.opts.questionMd || '');
    this.answer = this.contentEl.createDiv({ cls: 'ir-fc-answer ir-fc-box ir-fc-answer-box markdown-rendered ir-hidden' });
    this.buttons = this.contentEl.createDiv({ cls: 'ir-fc-btn-row' });
    this.stage = 'question';
    if (this.opts.directGrade) this._reveal();
    else {
      const show = this.buttons.createEl('button', { text: '显示答案（Space）', cls: 'mod-cta ir-fc-show-btn' });
      show.addEventListener('click', () => this._reveal());
      window.setTimeout(() => show.focus(), 30);
    }
    this.keyHandler = event => {
      if (this.resolved) return;
      if (this.stage === 'question' && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault();
        this._reveal();
      } else if (this.stage === 'answer' && /^[1-4]$/.test(event.key)) {
        event.preventDefault();
        this._finish(Number(event.key));
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this._finish(null);
      }
    };
    this.contentEl.addEventListener('keydown', this.keyHandler);
  }

  _renderMarkdown(target, markdown) {
    target.empty();
    MarkdownRenderer.render(this.app, markdown, target, this.opts.sourcePath || '', this.renderComponent);
  }

  _reveal() {
    if (this.stage !== 'question') return;
    this.stage = 'answer';
    if (this.opts.answerMd?.trim()) {
      if (!this.opts.hideLabels) {
        const label = this.contentEl.createDiv({ cls: 'ir-fc-label ir-fc-label-answer', text: '答案' });
        this.contentEl.insertBefore(label, this.answer);
      }
      this.answer.removeClass('ir-hidden');
      this._renderMarkdown(this.answer, this.opts.answerMd);
    }
    this.buttons.empty();
    for (const [grade, label] of [[1, '重来'], [2, '困难'], [3, '良好'], [4, '简单']]) {
      const button = this.buttons.createEl('button', {
        cls: `ir-fc-grade-${grade} ir-fc-grade-btn${grade === 3 ? ' mod-cta' : ''}`,
      });
      button.createDiv({ cls: 'ir-fc-grade-label', text: label });
      button.createDiv({ cls: 'ir-fc-grade-key', text: `(${grade})` });
      button.addEventListener('click', () => this._finish(grade));
    }
    window.setTimeout(() => this.buttons.querySelector('.mod-cta')?.focus(), 30);
  }

  _finish(value) {
    if (this.resolved) return;
    this.resolved = true;
    this.close();
    this.resolve(value);
  }

  onClose() {
    if (this.keyHandler) this.contentEl.removeEventListener('keydown', this.keyHandler);
    this.renderComponent.unload();
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolve(null);
    }
  }
}

function reviewCard(app, options) {
  return new Promise(resolve => new FlashcardModal(app, options, resolve).open());
}

function askText(app, title, defaultValue = '') {
  return new Promise((res) => new TextPromptModal(app, title, defaultValue, res).open());
}

function pickFuzzy(app, items, displayFn, placeholder = '') {
  return new Promise((res) => new GenericSuggestModal(app, items, displayFn, res, placeholder).open());
}

function confirmDialog(app, title, message = '') {
  return new Promise((res) => new ConfirmModal(app, title, message, res).open());
}

function askLong(app, title, defaultValue = '') {
  return new Promise((res) => new LongTextModal(app, title, defaultValue, res).open());
}

async function pickFromList(app, displays, values, placeholder = '') {
  if (!values || values.length === 0) return null;
  const items = displays.map((d, i) => ({ d, v: values[i] }));
  const picked = await pickFuzzy(app, items, (i) => i.d, placeholder);
  return picked ? picked.v : null;
}

// ============================================================================
//  Vault helpers
// ============================================================================

function vaultAbsPath(app, relPath) {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return null;
  if (relPath) return adapter.getFullPath(normalizePath(relPath));
  const base = adapter.getBasePath();
  return base.endsWith('/') ? base : base + '/';
}

function getFm(app, file) {
  return file ? app.metadataCache.getFileCache(file)?.frontmatter : null;
}

// View refreshes used to run after every edit in the vault. Keep a compact
// signature of only the metadata the dashboard, queue, and tree actually use,
// so changing a note's body does not rebuild all three views while typing.
const IR_VIEW_FRONTMATTER_FIELDS = [
  'type', 'status', 'priority', 'next_review', 'last_reviewed', 'parent',
  'source', 'tree_root', 'tree_order', 'tags', 'checkpoints',
];

function irViewSignature(app, file) {
  if (!file || file.extension !== 'md') return null;
  const cache = app.metadataCache.getFileCache(file);
  const fm = cache?.frontmatter;
  if (!fm || !['category', 'source', 'extract', 'card'].includes(fm.type)) return null;
  const selected = {};
  for (const key of IR_VIEW_FRONTMATTER_FIELDS) selected[key] = fm[key];
  const inlineTags = (cache.tags || []).map(tag => tag.tag);
  return JSON.stringify([selected, inlineTags]);
}

function isViewVisible(view) {
  const el = view?.containerEl;
  if (!el?.isConnected) return false;
  return el.offsetParent !== null || (typeof el.getClientRects === 'function' && el.getClientRects().length > 0);
}

// Obsidian's cachedRead still returns a promise. Checking hundreds of card
// notes serially makes opening a session scale with the sum of every read.
// A small worker pool overlaps the independent reads without flooding a vault.
async function filterAsyncConcurrent(items, predicate, concurrency = 16) {
  const keep = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      keep[index] = await predicate(items[index], index);
    }
  };
  const count = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: count }, worker));
  return items.filter((_item, index) => keep[index]);
}

function configuredPath(settings, key, fallback) {
  const value = String(settings?.paths?.[key] || fallback).trim();
  return normalizePath(value);
}

function isPathInIRCollection(settings, path) {
  const normalized = normalizePath(String(path || ''));
  return [
    configuredPath(settings, 'sources', SOURCES_FOLDER),
    configuredPath(settings, 'extracts', EXTRACTS_FOLDER),
    configuredPath(settings, 'cards', CARDS_FOLDER),
    configuredPath(settings, 'categories', CATEGORIES_FOLDER),
  ].some(folder => normalized === folder || normalized.startsWith(folder + '/'));
}

function getAllIRFiles(app, settings) {
  const folders = [
    configuredPath(settings, 'sources', SOURCES_FOLDER),
    configuredPath(settings, 'extracts', EXTRACTS_FOLDER),
    configuredPath(settings, 'cards', CARDS_FOLDER),
    configuredPath(settings, 'categories', CATEGORIES_FOLDER),
  ];
  const files = new Map();
  for (const folder of folders) {
    for (const file of filesInFolder(app, folder)) {
      if (file.extension === 'md') files.set(file.path, file);
    }
  }
  return Array.from(files.values());
}

function filesInFolder(app, folderPath) {
  const root = app.vault.getAbstractFileByPath(normalizePath(folderPath));
  if (!root) return [];
  const out = [];
  const visit = (node) => {
    if (node instanceof TFile) { out.push(node); return; }
    if (Array.isArray(node.children)) for (const child of node.children) visit(child);
  };
  visit(root);
  return out;
}

function getEditorForFile(app, file) {
  for (const leaf of app.workspace.getLeavesOfType('markdown')) {
    if (leaf.view?.file?.path === file.path) return leaf.view.editor;
  }
  return null;
}

function frontmatterEndOffset(content) {
  if (!content.startsWith('---\n')) return 0;
  const second = content.indexOf('\n---\n', 4);
  return second === -1 ? 0 : second + 5;
}

function markerLineNumber(content) {
  const match = String(content).match(/(?:📍\s*)?<!--ir-readpoint-->/);
  if (!match) return 0;
  return (content.slice(0, match.index).match(/\n/g) || []).length + 1;
}

// Sanitize basename → safe folder name (strip path-illegal chars, collapse ws).
function slugifyForFolder(s) {
  return String(s).replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, ' ').trim();
}

// SHA-1 → 12 hex chars. Stable, collision-safe enough for clipboard de-dupe.
async function shortHashOfBytes(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-1', arrayBuffer);
  return Array.from(new Uint8Array(digest)).slice(0, 6)
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// Read PNG from clipboard. Returns { bytes: ArrayBuffer, mime: 'image/png' } or null.
async function readImageFromClipboard() {
  if (!navigator.clipboard?.read) return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imgType = item.types.find(t => t.startsWith('image/'));
      if (!imgType) continue;
      const blob = await item.getType(imgType);
      const bytes = await blob.arrayBuffer();
      return { bytes, mime: imgType };
    }
  } catch (e) { /* permission or no image */ }
  return null;
}

// Ensure folder exists. Recursive (Obsidian's createFolder is shallow).
async function ensureFolder(app, path) {
  if (app.vault.getAbstractFileByPath(path)) return;
  const parts = path.split('/');
  let cur = '';
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    if (!app.vault.getAbstractFileByPath(cur)) {
      try { await app.vault.createFolder(cur); }
      catch (e) { if (!String(e?.message || '').includes('exists')) throw e; }
    }
  }
}

// Resolve source TFile + fm from active. Returns { tfile, fm } or null.
async function resolveSourceFromActive(app, settings) {
  const active = app.workspace.getActiveFile();
  if (!active) { new Notice('没有活动文件。'); return null; }

  if (active.extension === 'md') {
    const fm = getFm(app, active);
    if (fm?.type === 'source') return { tfile: active, fm };
    new Notice('活动笔记不是渐进阅读来源。');
    return null;
  }

  if (active.extension !== 'pdf') {
    new Notice('活动文件必须是来源笔记或 PDF。');
    return null;
  }

  const absPath = vaultAbsPath(app, active.path);
  if (!absPath) { new Notice('无法解析文件系统路径。'); return null; }

  // Match by:
  //   1. exact filesystem path equality for an external PDF
  //   2. suffix match for vault PDFs (PDF++ case — active.path is vault-relative,
  //      pdf_path may store the same vault-absolute path or vault-relative)
  //   3. explicit pdf_vault_path field (preferred for PDF++-only sources)
  const vaultRel = active.path;
  const candidates = [];
  for (const f of filesInFolder(app, configuredPath(settings, 'sources', SOURCES_FOLDER))) {
    if (f.extension !== 'md') continue;
    const fm = getFm(app, f);
    if (fm?.type !== 'source') continue;
    const pdfPath = fm.pdf_path || fm.sioyek_path;
    const pdfVault = fm.pdf_vault_path;
    if (
      (pdfPath && (pdfPath === absPath || pdfPath === vaultRel || (typeof pdfPath === 'string' && pdfPath.endsWith('/' + vaultRel)))) ||
      (pdfVault && pdfVault === vaultRel)
    ) {
      candidates.push({ tfile: f, fm });
    }
  }
  if (candidates.length === 0) {
    new Notice('没有来源笔记通过 pdf_path 或 pdf_vault_path 链接到此 PDF。');
    return null;
  }
  if (candidates.length === 1) return candidates[0];

  let page = null;
  try {
    const eph = app.workspace.getMostRecentLeaf()?.getEphemeralState?.();
    const m = (eph?.subpath || '').match(/page=(\d+)/);
    if (m) page = parseInt(m[1], 10);
  } catch (e) { /* ignore */ }

  if (page != null) {
    const inRange = candidates.find(c => {
      const s = Number(c.fm.page_start) || null;
      const e = Number(c.fm.page_end) || null;
      return s && e && page >= s && page <= e;
    });
    if (inRange) return inRange;
  }

  return await pickFuzzy(
    app,
    candidates,
    c => `${c.tfile.basename}${(c.fm.page_start != null && c.fm.page_end != null) ? `  p.${c.fm.page_start}–${c.fm.page_end}` : ''}`,
    '为此 PDF 选择来源',
  );
}

// Resolve a source/extract parent from active. If active is a card, follow
// its `source` frontmatter link up to the parent source/extract. Used by
// element-creation commands (extract / flashcard / image-extract) so they
// work when invoked from inside a card during review.
async function resolveSourceOrExtractFromActive(app, settings) {
  const active = app.workspace.getActiveFile();
  if (!active) { new Notice('没有活动文件。'); return null; }

  if (active.extension === 'md') {
    const fm = getFm(app, active);
    if (fm?.type === 'source' || fm?.type === 'extract') {
      return { tfile: active, fm };
    }
    if (fm?.type === 'card') {
      const m = String(fm.source || '').match(/\[\[([^\]|#]+)/);
      if (!m) { new Notice('卡片没有来源链接。'); return null; }
      const parentName = m[1].trim();
      const parentTf = app.metadataCache.getFirstLinkpathDest(parentName, active.path)
        || getAllIRFiles(app, settings).find(f => f.basename === parentName);
      if (!parentTf) { new Notice(`未找到父级：${parentName}`); return null; }
      const parentFm = getFm(app, parentTf);
      if (!parentFm || (parentFm.type !== 'source' && parentFm.type !== 'extract')) {
        new Notice('卡片的父级不是来源或摘录。'); return null;
      }
      return { tfile: parentTf, fm: parentFm };
    }
    new Notice('活动笔记不是渐进阅读的来源、摘录或卡片。');
    return null;
  }

  if (active.extension === 'pdf') return await resolveSourceFromActive(app, settings);
  new Notice('活动文件必须是渐进阅读元素或 PDF。');
  return null;
}

// Resolve any IR element from active (source / extract / card). Falls back
// to source-resolution when active is a PDF.
async function resolveIRFromActive(app, settings, { allowCard = true, allowPdfFallback = true } = {}) {
  const active = app.workspace.getActiveFile();
  if (!active) { new Notice('没有活动文件。'); return null; }
  if (active.extension === 'md') {
    const fm = getFm(app, active);
    if (!fm) { new Notice('活动笔记没有 frontmatter。'); return null; }
    if (fm.type !== 'source' && fm.type !== 'extract' && (!allowCard || fm.type !== 'card')) {
      new Notice(`活动笔记不是渐进阅读的${allowCard ? '来源/摘录/卡片' : '来源/摘录'}。`);
      return null;
    }
    return { tfile: active, fm };
  }
  if (active.extension === 'pdf' && allowPdfFallback) {
    return await resolveSourceFromActive(app, settings);
  }
  new Notice('活动文件必须是渐进阅读元素或已链接的 PDF。');
  return null;
}

// BFS subtree walk via parent + source links.
function walkSubtree(app, settings, rootBasename, rootPath, { includeCards = true, rows = null } = {}) {
  const allPages = (rows || getAllIRFiles(app, settings).map(f => ({ tfile: f, fm: getFm(app, f) })))
    .filter(p => p.fm && (p.fm.type === 'source' || p.fm.type === 'extract' || (includeCards && p.fm.type === 'card')));
  const paths = new Set([rootPath]);
  const frontier = [rootBasename];
  const basenameCounts = new Map();
  for (const page of allPages) {
    const key = page.tfile.basename.toLowerCase();
    basenameCounts.set(key, (basenameCounts.get(key) || 0) + 1);
  }
  while (frontier.length) {
    const next = [];
    for (const name of frontier) {
      if ((basenameCounts.get(name.toLowerCase()) || 0) > 1) continue;
      for (const p of allPages) {
        if (paths.has(p.tfile.path)) continue;
        if (linkPointsTo(p.fm.parent, name) || linkPointsTo(p.fm.source, name)) {
          paths.add(p.tfile.path);
          next.push(p.tfile.basename);
        }
      }
    }
    frontier.length = 0;
    frontier.push(...next);
  }
  return Array.from(paths).map(path => {
    const tfile = app.vault.getAbstractFileByPath(path);
    return tfile ? { tfile, fm: getFm(app, tfile) } : null;
  }).filter(Boolean);
}

// ============================================================================
//  Visual learning — card generation policy
// ============================================================================
//
// Decides how many cards to spawn from a set of drawn rectangles, and
// which rect is the "question" for each. Two SuperMemo-canon modes:
//
//   hide-one : N cards. Each card hides ITS rect, reveals others.
//              Use for "what is this thing?" — anatomy labels, map regions,
//              labelled diagrams.
//
//   show-one : N cards. Each card shows ONLY its rect, hides others.
//              Use for "given this fragment alone, what surrounds it?" —
//              forces recall of context from a single landmark.
//
// Returns: Array<{ questionIndex: number }>. One element per generated card.
//
// LEARNING-MODE STUB — the default behavior generates one card per rect,
// each card pointing to its own rect as the question. Customise to:
//   - Skip generating cards for "label" rects (e.g. rects you only want as
//     visible context but never as questions). Filter before mapping.
//   - Collapse to ONE multi-blank card: return [{ questionIndex: -1 }] and
//     teach the renderer to treat -1 as "all rects are questions".
//   - Mix modes: pass a different `mode` for some rects (would also need
//     storage shape change so renderer knows).
function generateCardsFromRects(rects, mode) {
  // TODO(you): refine this policy. Default: 1 card per rect, in draw order.
  return rects.map((_r, i) => ({ questionIndex: i }));
}

// ============================================================================
//  Sidebar Queue View
// ============================================================================

const IR_QUEUE_VIEW_TYPE = 'ir-queue-view';

class IRQueueView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.filter = plugin.settings.queue.default_tag_filter || '';
    this.refreshTimer = null;
    this.contentLeaf = null;
    this.modifyTimer = null;
    this.timelineTimer = null;
    this.rowsGeneration = 0;
    this.queueRevision = 0;
    this.queueModel = null;
    this.queueModelPromise = null;
    this.timelineEl = null;
    this.activeTimelinePath = null;
    this.collectionRevision = 0;
    this.sectionLimits = new Map();
    this.needsRowsRender = false;
  }

  getViewType() { return IR_QUEUE_VIEW_TYPE; }
  getDisplayText() { return '阅读队列'; }
  getIcon() { return 'list-checks'; }

  async onOpen() {
    this.collectionRevision = this.plugin.irCollectionRevision;
    this._render();
    this.registerEvent(this.plugin.app.metadataCache.on('changed', (file) => {
      if (this.collectionRevision === this.plugin.irCollectionRevision) return;
      this.collectionRevision = this.plugin.irCollectionRevision;
      this._invalidateQueueModel();
      this._scheduleRowsRender('metadata');
      if (!this.plugin.directQueueNavigation
          && file.path === this.plugin.app.workspace.getActiveFile()?.path) this._refreshTimeline(true);
    }));
    // Spaced Repetition stores scheduling in an HTML comment in the card body,
    // so card-body writes are the one non-frontmatter edit that affects queues.
    this.registerEvent(this.plugin.app.vault.on('modify', (file) => {
      if (!isPathInIRCollection(this.plugin.settings, file?.path)) return;
      if (getFm(this.plugin.app, file)?.type !== 'card') return;
      this._invalidateQueueModel();
      // Spaced Repetition can write several times while accepting an answer.
      // Keep the model invalid but leave rendering to an explicit refresh.
      this.needsRowsRender = true;
    }));
    for (const event of ['create', 'delete', 'rename']) {
      this.registerEvent(this.plugin.app.vault.on(event, (file, oldPath) => {
        const relevant = event === 'rename'
          ? isPathInIRCollection(this.plugin.settings, file?.path)
            || isPathInIRCollection(this.plugin.settings, oldPath)
          : isPathInIRCollection(this.plugin.settings, file?.path);
        if (!relevant) return;
        this._invalidateQueueModel();
        this._scheduleRowsRender(`vault-${event}`);
      }));
    }
    // Navigation changes only the active note's timeline. Queue rows are
    // independent of the active file and must not be rebuilt on every click.
    this.registerEvent(this.plugin.app.workspace.on('file-open', file => {
      if (!this.plugin.directQueueNavigation) this._scheduleTimelineRefresh(file);
    }));
    this.registerEvent(this.plugin.app.workspace.on('active-leaf-change', () => {
      if (this.plugin.directQueueNavigation) return;
      if (this.needsRowsRender && this.plugin.app.workspace.activeLeaf === this.leaf) {
        this._scheduleRowsRender('visible');
      }
    }));
    this._scheduleDateRefresh();
  }

  async onClose() {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    if (this.modifyTimer) window.clearTimeout(this.modifyTimer);
    if (this.timelineTimer) window.clearTimeout(this.timelineTimer);
  }

  _invalidateQueueModel() {
    this.queueRevision++;
    this.queueModel = null;
    this.queueModelPromise = null;
  }

  _scheduleRowsRender(reason) {
    if (this.plugin.directQueueNavigation) return;
    if (this.plugin.collectionRenderDeferrals > 0) {
      this.needsRowsRender = true;
      return;
    }
    if (!isViewVisible(this)) {
      this.needsRowsRender = true;
      return;
    }
    this.needsRowsRender = false;
    if (this.modifyTimer) window.clearTimeout(this.modifyTimer);
    this.modifyTimer = window.setTimeout(() => {
      this.modifyTimer = null;
      this._renderRows(this.containerEl.children[1], reason);
    }, 150);
  }

  _scheduleDateRefresh() {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    const nextDay = new Date();
    nextDay.setHours(24, 0, 0, 100);
    this.refreshTimer = window.setTimeout(() => {
      this._invalidateQueueModel();
      this._renderRows(this.containerEl.children[1], 'date-change');
      this._scheduleDateRefresh();
    }, Math.max(1000, nextDay.getTime() - Date.now()));
  }

  _render() {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass('ir-queue-root');

    root.createDiv({ cls: 'ir-queue-header', text: '阅读队列' });

    const filterInput = root.createEl('input', {
      cls: 'ir-queue-filter',
      type: 'text',
      placeholder: '按标签或标题筛选…',
    });
    filterInput.value = this.filter;
    filterInput.addEventListener('input', e => {
      this.filter = e.target.value;
      this._renderRows(root, 'filter');
    });

    this.sectionsEl = root.createDiv({ cls: 'ir-queue-sections' });
    this.timelineEl = root.createDiv({ cls: 'ir-queue-timeline-host' });
    this._renderRows(root, 'open');
    this._refreshTimeline(true);
  }

  async _buildQueueModel() {
    const today = todayDate();
    let session = await this.plugin.readSessionSnapshot();
    if (!session) {
      const pool = await this.plugin.buildDuePool({ skipCurrent: false });
      session = this.plugin.buildInterleavedQueue(pool, today);
    }

    const sessionPaths = new Set(session.filter(row => !row.fm?.inline_parent).map(row => row.tfile.path));
    const groups = { overdue: [], newItems: [], active: [] };
    for (const { tfile: file, fm } of this.plugin.getIRRows()) {
      if (sessionPaths.has(file.path)) continue;
      if (!isQueueVisibleIR(fm) || fm.type === 'card') continue;
      const row = { tfile: file, file, fm };
      if (fm.status === 'pending' || fm.status === 'inbox') groups.newItems.push(row);
      else if (!fm.next_review) groups.active.push(row);
      else if (isPastDue(fm, today, this.plugin.settings)) groups.overdue.push(row);
    }

    const sortKey = this.plugin.settings.queue.sort_key;
    const sortFn = (a, b) => {
      if (sortKey === 'priority') return (a.fm.priority ?? 50) - (b.fm.priority ?? 50);
      if (sortKey === 'due_date') {
        const ad = parseDateValue(a.fm.next_review, this.plugin.settings);
        const bd = parseDateValue(b.fm.next_review, this.plugin.settings);
        return (ad?.getTime() ?? Infinity) - (bd?.getTime() ?? Infinity);
      }
      return urgency(b.fm, today, this.plugin.settings) - urgency(a.fm, today, this.plugin.settings);
    };
    groups.overdue.sort(sortFn);
    groups.newItems.sort(sortFn);
    groups.active.sort(sortFn);
    return { date: todayDateString(this.plugin.settings), session, groups };
  }

  async _getQueueModel() {
    const date = todayDateString(this.plugin.settings);
    if (this.queueModel?.date === date) return this.queueModel;
    if (this.queueModel && this.queueModel.date !== date) this._invalidateQueueModel();
    if (this.queueModelPromise) return this.queueModelPromise;

    const revision = this.queueRevision;
    const promise = this._buildQueueModel();
    this.queueModelPromise = promise;
    try {
      const model = await promise;
      if (revision === this.queueRevision) this.queueModel = model;
      return model;
    } finally {
      if (this.queueModelPromise === promise) this.queueModelPromise = null;
    }
  }

  async _renderRows(root, reason = 'unknown') {
    const started = window.performance?.now?.() ?? Date.now();
    const generation = ++this.rowsGeneration;
    const model = await this._getQueueModel();
    const sectionsEl = this.sectionsEl || root.querySelector('.ir-queue-sections');
    if (generation !== this.rowsGeneration || !sectionsEl.isConnected) return;
    sectionsEl.empty();

    const matchesFilter = (row) => {
      const file = row.tfile || row.file;
      return !this._filterMiss(this.plugin.app.metadataCache.getFileCache(file), file);
    };
    const sessionFiltered = model.session.filter(r => {
      const cache = this.plugin.app.metadataCache.getFileCache(r.tfile);
      return !this._filterMiss(cache, r.tfile);
    }).map(r => ({ ...r, file: r.tfile }));
    this._renderSection(sectionsEl, "今日会话", sessionFiltered);
    this._renderSection(sectionsEl, '逾期（不在会话中）', model.groups.overdue.filter(matchesFilter));
    this._renderSection(sectionsEl, '新建', model.groups.newItems.filter(matchesFilter));
    this._renderSection(sectionsEl, '活动（无到期）', model.groups.active.filter(matchesFilter));
    const elapsed = (window.performance?.now?.() ?? Date.now()) - started;
    this.plugin._dbg('queue render', { reason, elapsed_ms: Math.round(elapsed * 10) / 10 });
  }

  _filterMiss(cache, file) {
    if (!this.filter) return false;
    const f = this.filter.toLowerCase();
    const tagHit = (cache?.tags || []).some(t => t.tag.toLowerCase().includes(f));
    const titleHit = file.basename.toLowerCase().includes(f);
    return !tagHit && !titleHit;
  }

  _renderSection(root, title, rows) {
    if (!rows.length) return;
    const sec = root.createDiv({ cls: 'ir-queue-section' });
    sec.createEl('div', { cls: 'ir-queue-section-title', text: `${title} (${rows.length})` });
    const limit = this.sectionLimits.get(title) || 100;
    for (const r of rows.slice(0, limit)) {
      const el = sec.createDiv({ cls: 'ir-queue-row' });
      el.createSpan({ text: ({ source: '📖', extract: '✂️', card: '🃏' })[r.fm.type] || '•' });
      el.createSpan({ cls: 'ir-queue-row-title', text: r.file.basename });
      el.createSpan({ cls: 'ir-queue-row-pri', text: `p${r.fm.priority ?? '?'}` });
      el.addEventListener('click', () => this._open(r));
    }
    if (rows.length > limit) {
      const more = sec.createEl('button', {
        cls: 'ir-queue-show-more',
        text: `显示另外 ${Math.min(100, rows.length - limit)} 项`,
      });
      more.addEventListener('click', () => {
        this.sectionLimits.set(title, limit + 100);
        this._renderRows(this.containerEl.children[1], 'show-more');
      });
    }
  }

  async _open(r) {
    if (r.fm.inline_parent) {
      await this.plugin._reviewInlineCard(r.fm.inline_parent, r.fm.id);
      this._invalidateQueueModel();
      this._renderRows(this.containerEl.children[1], 'inline-review');
      return;
    }
    await this.plugin.openLearningItem({ ...r, tfile: r.file });
  }

  _refreshTimeline(force = false, file = this.plugin.app.workspace.getActiveFile()) {
    const path = file?.path || null;
    if (!force && path === this.activeTimelinePath) return;
    this.activeTimelinePath = path;
    if (this.timelineEl) this._renderTimeline(this.timelineEl, file);
  }

  _scheduleTimelineRefresh(file) {
    if (this.timelineTimer) window.clearTimeout(this.timelineTimer);
    this.timelineTimer = window.setTimeout(() => {
      this.timelineTimer = null;
      if (!this.plugin.directQueueNavigation) this._refreshTimeline(false, file);
    }, 120);
  }

  _renderTimeline(root, active = this.plugin.app.workspace.getActiveFile()) {
    root.empty();
    if (!active) return;
    const fm = this.plugin.app.metadataCache.getFileCache(active)?.frontmatter;
    if (!isActiveIR(fm)) return;

    const panel = root.createDiv({ cls: 'ir-timeline-panel' });
    panel.createEl('div', { cls: 'ir-queue-section-title', text: `时间线：${active.basename}` });

    for (const c of (fm.checkpoints || [])) {
      const row = panel.createDiv({ cls: 'ir-timeline-row' });
      row.setText(`${c.date} L${c.line} — ${c.note}`);
      row.addEventListener('click', async () => {
        const leaf = this.plugin.app.workspace.getLeaf(false);
        await leaf.openFile(active);
        const ed = this.plugin.app.workspace.activeEditor?.editor;
        if (ed) ed.setCursor({ line: c.line, ch: 0 });
      });
    }

    const input = panel.createEl('input', { type: 'text', cls: 'ir-queue-filter', placeholder: '新建检查点（Nd:: 可选）' });
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        await this.plugin.addCheckpoint(input.value.trim());
        input.value = '';
        this._refreshTimeline(true);
      }
    });
  }
}

// ============================================================================
//  Settings Tab
// ============================================================================

class UserGuideModal extends Modal {
  onOpen() {
    this.setTitle('渐进阅读工具包指南');
    const root = this.contentEl;
    root.addClass('ir-guide-modal');

    root.createEl('h3', { text: '快速上手' });
    const quick = root.createEl('ol');
    for (const text of [
      '打开一篇文章笔记并运行「导入剪藏」，或用「新建来源」创建来源。',
      '运行一次「构建今日会话队列」，然后用「下一元素」在队列中前进。',
      '选中重要文本并运行「摘录选中内容」。',
      '把光标停在中断处，然后运行「为当前阅读主题评级」。',
      '用「从剪贴板制作卡片」创建回忆材料。',
      '「下一元素」会自动打开卡片复习；给出答案即完成该队列项。',
    ]) quick.createEl('li', { text });

    root.createEl('h3', { text: '推荐快捷键' });
    root.createEl('p', { text: '打开「设置 -> 快捷键」并搜索 渐进阅读工具包。这些只是建议，不是默认值。' });
    const table = root.createEl('table');
    const head = table.createEl('thead').createEl('tr');
    head.createEl('th', { text: '命令' });
    head.createEl('th', { text: '建议快捷键' });
    const body = table.createEl('tbody');
    for (const [command, hotkey] of [
      ['下一元素', 'Cmd/Ctrl+Shift+J'],
      ['为当前阅读主题评级', 'Cmd/Ctrl+Shift+Enter'],
      ['摘录选中内容', 'Cmd/Ctrl+Shift+E'],
      ['从剪贴板制作卡片', 'Cmd/Ctrl+Shift+F'],
      ['当前元素操作…', 'Cmd/Ctrl+Shift+A'],
    ]) {
      const row = body.createEl('tr');
      row.createEl('td', { text: command });
      row.createEl('td').createEl('code', { text: hotkey });
    }

    root.createEl('h3', { text: '每日阅读循环' });
    const daily = root.createEl('ul');
    for (const text of [
      '「构建今日会话队列」负责排期工作；「下一元素」会打开保存的位置，并在需要时开始卡片复习。',
      '摘录仍是阅读主题；卡片使用各笔记上存储的后端。',
      '移动 Markdown 阅读位置或推进页码/时间戳都算作进度。',
      '用「宽限（分散逾期）」分摊逾期内容，用「推迟子树」一起移动相关材料。',
    ]) daily.createEl('li', { text });

    root.createEl('h3', { text: 'PDF、卡片与日期' });
    root.createEl('p', { text: '库内或外部 PDF 请使用工具包 PDF 阅读器。工具包卡片使用内置 FSRS，Anki 卡片在外部同步，已有的 Spaced Repetition 卡片保持其插件自有的排期。' });
    root.createEl('p', { text: '在「通用」设置中选择 DD-MM-YYYY、MM-DD-YYYY 或 YYYY-MM-DD。像 +3d 这样的相对排期适用于所有格式。' });

    root.createEl('h3', { text: '故障排查' });
    const trouble = root.createEl('ul');
    for (const text of [
      '复习中没有卡片：运行配置检查，并确认卡片笔记上存储的后端。',
      'PDF 无法打开：确认 pdf_path 指向存在的 PDF，或对库内文件使用 pdf_vault_path。',
      '知识树父级不明确：请重命名同名的文件。',
      '完整指南请通过帮助链接打开 GitHub 仓库中的 docs/USER-GUIDE.md。',
    ]) trouble.createEl('li', { text });
  }

  onClose() { this.contentEl.empty(); }
}

class IncrementalReadingSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    this._about(containerEl);
    this._scheduling(containerEl);
    this._queue(containerEl);
    this._flashcards(containerEl);
    this._inlineCards(containerEl);
    this._anki(containerEl);
    this._spacedRepetition(containerEl);
    this._knowledgeTree(containerEl);
    this._paths(containerEl);
    this._misc(containerEl);
    this._epubImport(containerEl); // enhance
  }

  // enhance
  _epubImport(root) {
    const sec = root.createDiv({ cls: 'ir-settings-section' });
    new Setting(sec).setName('EPUB 导入').setHeading();
    const s = this.settings.epubImport || (this.settings.epubImport = {});
    const save = () => this.plugin.saveSettings();
    new Setting(sec)
      .setName('EPUB 库目录')
      .setDesc('可选。填写后「从 EPUB 导入来源…」会先让你从该目录里挑书；留空则每次手输路径。解析在插件内完成，不需要外部工具。')
      .addText((t) => t.setPlaceholder('例如 /Users/you/books/Readest/Books').setValue(s.libraryFolder || '').onChange((v) => { s.libraryFolder = v.trim(); save(); }));
    new Setting(sec)
      .setName('导入后自动拆章')
      .setDesc('开启后，EPUB 导入完成即按 ## 标题拆成每章一篇，放进 IR/Sources/<书名>/，全部停在收件箱等你说要不要读。')
      .addToggle((t) => t.setValue(s.autoSplit !== false).onChange((v) => { s.autoSplit = v; save(); }));
    new Setting(sec)
      .setName('去掉开头的目录块')
      .setDesc('EPUB 自带目录页的锚点通常在 Obsidian 里失效。开启后写入前会丢掉第一个标题之前的内容，但保留其中的图片。')
      .addToggle((t) => t.setValue(s.dropLeadingToc !== false).onChange((v) => { s.dropLeadingToc = v; save(); }));
  }

  _about(root) {
    const sec = root.createDiv({ cls: 'ir-settings-section' });
    new Setting(sec).setName(`渐进阅读工具包 ${this.plugin.manifest.version}`).setHeading();
    new Setting(sec)
      .setName('用户指南')
      .setDesc('在 Obsidian 内打开快速上手、推荐快捷键、日常工作流和故障排查。')
      .addButton(button => button.setButtonText('打开用户指南').setCta().onClick(() => this.plugin.openUserGuide()));
    const backend = this.plugin.cardBackend();
    const ready = this.plugin.isCardBackendReady(backend);
    const backendLabel = this.plugin.cardBackendLabel(backend);
    new Setting(sec)
      .setName('配置状态')
      .setDesc(ready ? `${backendLabel} 已就绪。` : `${backendLabel} 需要处理；运行配置检查了解详情。`)
      .addButton(button => button.setButtonText('运行配置检查').onClick(() => this.plugin.runSetupCheck()));
  }

  _numberSetting(section, name, description, target, key, { min, max, step = 'any' } = {}) {
    const save = () => this.plugin.saveSettings();
    new Setting(section).setName(name).setDesc(description).addText(text => {
      text.inputEl.type = 'number';
      text.inputEl.step = String(step);
      if (min != null) text.inputEl.min = String(min);
      if (max != null) text.inputEl.max = String(max);
      text.setValue(String(target[key])).onChange(value => {
        const number = Number(value);
        const valid = Number.isFinite(number)
          && (min == null || number >= min)
          && (max == null || number <= max);
        text.inputEl.toggleClass('is-invalid', !valid);
        if (!valid) return;
        target[key] = number;
        save();
      });
    });
  }

  _scheduling(root) {
    const sec = root.createDiv({ cls: 'ir-settings-section' });
    new Setting(sec).setName('阅读排期').setHeading();
    const s = this.plugin.settings.scheduling;
    const save = () => this.plugin.saveSettings();

    new Setting(sec)
      .setName('进度感知 A 因子')
      .setDesc('根据剩余页数或媒体时间调整间隔。推荐用于书籍、PDF 和视频。')
      .addToggle(t => t.setValue(s.progress_aware).onChange(v => { s.progress_aware = v; save(); }));

    new Setting(sec)
      .setName('停滞保护')
      .setDesc('当页码、时间戳或 Markdown 阅读位置不再推进时，阻止间隔增长。')
      .addToggle(t => t.setValue(s.stall_guard).onChange(v => { s.stall_guard = v; save(); }));

    this._numberSetting(sec, '最小 A 因子', '最小的间隔增长倍率。略大于 1 的取值会让材料保持频繁轮换。', s, 'a_factor_min', { min: 1.01, max: 10, step: 0.01 });
    this._numberSetting(sec, '最大 A 因子', '接近完成的材料所允许的最大间隔增长倍率。', s, 'a_factor_max', { min: 1.01, max: 10, step: 0.01 });

    new Setting(sec).setName('复习节奏调整').setHeading();
    this._numberSetting(sec, '保持倍率', '选择「保持」时应用。用 1 可保持当前 A 因子。', s, 'quality_hold', { min: 0.1, max: 3, step: 0.01 });
    this._numberSetting(sec, '提前复习倍率', '选择「加快」时应用。小于 1 的取值会缩短未来的增长。', s, 'quality_speed_up', { min: 0.1, max: 3, step: 0.01 });
    this._numberSetting(sec, '推后倍率', '选择「放慢」时应用。大于 1 的取值会延长未来的增长。', s, 'quality_slow_down', { min: 0.1, max: 3, step: 0.01 });

    new Setting(sec).setName('初始间隔模型').setHeading();
    this._numberSetting(sec, '基础 A 因子', '在考虑来源长度之前的起始倍率。', s, 'initial_af_base', { min: 1.01, max: 10, step: 0.01 });
    this._numberSetting(sec, '长度敏感度', '较长的来源获得较小 A 因子的强度。', s, 'initial_af_slope', { min: 0, max: 3, step: 0.01 });
    this._numberSetting(sec, '长度基准', '作为中性来源大小的页数，媒体则为分钟数。', s, 'initial_af_units_divisor', { min: 1, max: 10000, step: 1 });
    this._numberSetting(sec, '摘录加成', '创建摘录后应用于父级 A 因子的倍率。', s, 'extract_bump', { min: 0.1, max: 3, step: 0.01 });
  }

  _queue(root) {
    const sec = root.createDiv({ cls: 'ir-settings-section' });
    new Setting(sec).setName('队列').setHeading();
    const s = this.plugin.settings.queue;
    const save = () => this.plugin.saveSettings();
    new Setting(sec).setName('启用侧边栏')
      .setDesc('允许阅读队列在侧边栏中打开，并随笔记变化刷新。')
      .addToggle(t => t.setValue(s.sidebar_enabled).onChange(v => { s.sidebar_enabled = v; save(); }));
    new Setting(sec).setName('默认标签筛选')
      .setDesc('侧边栏的初始筛选。留空则显示所有已排期主题。')
      .addText(t => t.setValue(s.default_tag_filter).onChange(v => { s.default_tag_filter = v; save(); }));
    new Setting(sec).setName('补充列表顺序')
      .setDesc('控制逾期、新建和未排期分组的顺序。今日会话保持其排期顺序。')
      .addDropdown(d => {
      d.addOption('urgency', '紧急度').addOption('priority', '优先级').addOption('due_date', '到期日')
       .setValue(s.sort_key).onChange(v => { s.sort_key = v; save(); });
    });
    new Setting(sec).setName('卡片与主题混合')
      .setDesc('把可在本地复习的工具包和 Spaced Repetition 卡片与阅读主题交替排列。Anki 卡片仍留在 Anki 中。')
      .addToggle(t => t.setValue(s.mix_cards !== false).onChange(v => { s.mix_cards = v; save(); }));
  }

  _inlineCards(root) {
    const sec = root.createDiv({ cls: 'ir-settings-section' });
    new Setting(sec).setName('行内卡片导出').setHeading();
    const s = this.plugin.settings.inline_cards;
    const save = () => this.plugin.saveSettings();
    new Setting(sec).setName('启用')
      .setDesc('允许「导出行内卡片」识别问答、填空和高亮文本形式。')
      .addToggle(t => t.setValue(s.enabled).onChange(v => { s.enabled = v; save(); }));
    new Setting(sec).setName('Q::A 正则表达式')
      .setDesc('用于单行 Q::问题::A::答案 卡片的高级模式。')
      .addText(t => t.setValue(s.qa_regex).onChange(v => { s.qa_regex = v; save(); }));
    new Setting(sec).setName('填空正则表达式')
      .setDesc('用于 {{c1::答案::提示}} 卡片的高级模式。')
      .addText(t => t.setValue(s.cloze_regex).onChange(v => { s.cloze_regex = v; save(); }));
  }

  _flashcards(root) {
    const sec = root.createDiv({ cls: 'ir-settings-section' });
    new Setting(sec).setName('Flashcards').setHeading();
    const settings = this.plugin.settings.flashcards;
    new Setting(sec)
      .setName('卡片创建方式')
      .setDesc('选择新建卡片的排期位置。已有卡片保持其原有的后端。')
      .addDropdown(dropdown => dropdown
        .addOption('toolkit', '工具包（内置）')
        .addOption('anki', '通过 Flashcards 使用 Anki')
        .addOption('spaced_repetition', 'Spaced Repetition（兼容）')
        .setValue(this.plugin.cardBackend())
        .onChange(async value => {
          settings.backend = cardProviderCore.normalizeCardBackend(value);
          await this.plugin.saveSettings();
          this.display();
        }));
    const selected = this.plugin.cardBackend();
    const descriptions = {
      toolkit: '卡片保留在库中，并使用工具包内置的 FSRS 排期器和复习窗口。',
      anki: '卡片使用 Reuseman Flashcards 语法，并通过该插件同步到 Anki。',
      spaced_repetition: '卡片使用 Spaced Repetition 社区插件自有的原生 Markdown 语法。',
    };
    new Setting(sec).setName('所选工作流').setDesc(descriptions[selected]);
  }

  _anki(root) {
    const sec = root.createDiv({ cls: 'ir-settings-section' });
    new Setting(sec).setName('通过 Flashcards 使用 Anki').setHeading();
    const settings = this.plugin.settings.anki;
    const save = () => this.plugin.saveSettings();
    new Setting(sec)
      .setName('依赖')
      .setDesc(this.plugin.isFlashcardsReady()
        ? '已就绪。Flashcards 可以从工具包卡片笔记生成 Anki 卡片。'
        : '安装并启用 Reuseman 的 Flashcards。同步时 Anki 和 AnkiConnect 也必须正在运行。')
      .addButton(button => button.setButtonText('立即同步').onClick(() => this.plugin.syncAnki()));
    new Setting(sec).setName('目标牌组')
      .setDesc('写入 Flashcards 支持的 cards-deck frontmatter 字段。')
      .addText(text => text.setValue(settings.deck).onChange(value => {
        settings.deck = value.trim() || '渐进阅读';
        save();
      }));
    new Setting(sec).setName('创建卡片后同步')
      .setDesc('创建卡片笔记后对当前文件运行 Flashcards: Generate。')
      .addToggle(toggle => toggle.setValue(settings.syncOnCreate !== false).onChange(value => {
        settings.syncOnCreate = value;
        save();
      }));
    new Setting(sec).setName('Flashcards 标签')
      .setDesc('与 Flashcards 插件的标签设置保持一致。不要包含开头的 #。')
      .addText(text => text.setValue(settings.flashcardsTag).onChange(value => {
        settings.flashcardsTag = value.replace(/^#/, '').trim() || 'card';
        save();
      }));
  }

  _spacedRepetition(root) {
    const sec = root.createDiv({ cls: 'ir-settings-section' });
    new Setting(sec).setName('Spaced Repetition').setHeading();
    const s = this.plugin.settings.spaced_repetition;
    const save = () => this.plugin.saveSettings();
    new Setting(sec)
      .setName('依赖')
      .setDesc(this.plugin.isSpacedRepetitionReady()
        ? '已就绪。卡片复习命令将打开 Spaced Repetition。'
        : '未就绪。请安装并启用 Spaced Repetition 社区插件。');
    new Setting(sec)
      .setName('卡片牌组标签')
      .setDesc('与 Spaced Repetition 中配置的卡片标签保持一致。不要包含开头的 #。')
      .addText(t => t.setValue(s.flashcardTag).onChange(v => {
        s.flashcardTag = v.replace(/^#/, '').trim() || 'flashcards/incremental-reading';
        save();
      }));
    new Setting(sec)
      .setName('多行卡片分隔符')
      .setDesc('与 Spaced Repetition 中配置的多行分隔符保持一致。')
      .addText(t => t.setValue(s.multilineCardSeparator).onChange(v => {
        s.multilineCardSeparator = v.trim() || '?';
        save();
      }));
    new Setting(sec)
      .setName('双向卡片分隔符')
      .setDesc('与 Spaced Repetition 中配置的多行反向分隔符保持一致。')
      .addText(t => t.setValue(s.multilineReversedCardSeparator).onChange(v => {
        s.multilineReversedCardSeparator = v.trim() || '??';
        save();
      }));
  }

  _knowledgeTree(root) {
    const sec = root.createDiv({ cls: 'ir-settings-section' });
    new Setting(sec).setName('知识树').setHeading();
    this._numberSetting(
      sec,
      '大分支警告',
      '当分类的子项数量超过此数值后高亮显示。',
      this.plugin.settings.tree,
      'child_warn_threshold',
      { min: 1, max: 100000, step: 1 },
    );
    new Setting(sec).setName('显示已完成材料')
      .setDesc('在知识树中包含已完成和已搁置的主题。')
      .addToggle(t => t.setValue(this.plugin.settings.tree.show_completed).onChange(v => {
        this.plugin.settings.tree.show_completed = v; this.plugin.saveSettings(); this.plugin._refreshTreeViews();
      }));
  }

  _paths(root) {
    const sec = root.createDiv({ cls: 'ir-settings-section' });
    new Setting(sec).setName('路径').setHeading();
    const s = this.plugin.settings.paths;
    const save = () => {
      this.plugin._invalidateIRCollection(true);
      return this.plugin.saveSettings();
    };
    const paths = [
      ['sources', '来源文件夹', '来源笔记和本地视频文件。'],
      ['extracts', '摘录文件夹', '作为独立阅读主题排期的段落。'],
      ['cards', '卡片文件夹', '由 Spaced Repetition 读取的 Markdown 卡片。'],
      ['attachments', '附件文件夹', '剪贴板图片和视觉学习素材。'],
      ['categories', '分类文件夹', '知识树的分类笔记。'],
      ['dashboard', '仪表盘笔记', '可选的会话快照和仪表盘笔记路径。'],
      ['review_log', '复习日志', '包含已完成主题复习的 Markdown 表格。'],
    ];
    for (const [key, name, description] of paths) {
      new Setting(sec).setName(name).setDesc(description)
        .addText(t => t
          .setPlaceholder(DEFAULT_SETTINGS.paths[key])
          .setValue(s[key] || DEFAULT_SETTINGS.paths[key])
          .onChange(v => { s[key] = v.trim() || DEFAULT_SETTINGS.paths[key]; save(); }))
        .addExtraButton(button => button
          .setIcon('rotate-ccw')
          .setTooltip(`重置 ${name.toLowerCase()}`)
          .onClick(async () => {
            s[key] = DEFAULT_SETTINGS.paths[key];
            await save();
            this.display();
          }));
    }
  }

  _misc(root) {
    const sec = root.createDiv({ cls: 'ir-settings-section' });
    new Setting(sec).setName('通用').setHeading();
    const s = this.plugin.settings.misc;
    const save = () => this.plugin.saveSettings();
    new Setting(sec).setName('日期格式')
      .setDesc('用于排期字段、提示、检查点和复习日志。')
      .addDropdown(d => {
        for (const format of dateCore.SUPPORTED_DATE_FORMATS) d.addOption(format, format);
        d.setValue(configuredDateFormat(this.plugin.settings)).onChange(async (value) => {
          const previous = configuredDateFormat(this.plugin.settings);
          if (previous === value) return;
          try {
            const changed = await this.plugin.migrateDateFormat(previous, value);
            s.date_format = value;
            await save();
            new Notice(`日期格式已改为 ${value}；已迁移 ${changed} 个已存日期${changed === 1 ? '' : 's'}。`);
          } catch (error) {
            new Notice(`日期迁移失败：${error.message}`);
          }
        });
      });
    new Setting(sec).setName('摘录高亮颜色')
      .setDesc('编辑和阅读视图中用于摘录的来源段落和摘录笔记的强调色。')
      .addColorPicker(picker => picker
        .setValue(normalizedExtractHighlightColor(s.extract_highlight_color))
        .onChange(async value => {
          s.extract_highlight_color = normalizedExtractHighlightColor(value);
          await save();
          this.plugin._refreshExcerptViews();
        }))
      .addExtraButton(button => button
        .setIcon('rotate-ccw')
        .setTooltip('重置摘录高亮颜色')
        .onClick(async () => {
          s.extract_highlight_color = DEFAULT_EXTRACT_HIGHLIGHT_COLOR;
          await save();
          this.plugin._refreshExcerptViews();
          this.display();
        }));
    new Setting(sec).setName('诊断').setHeading();
    new Setting(sec).setName('调试日志')
      .setDesc('将额外详情写入开发者控制台。正常使用时保持关闭。')
      .addToggle(t => t.setValue(s.debug).onChange(v => { s.debug = v; save(); }));
  }
}

// ============================================================================
//  Plugin
// ============================================================================

const TREE_ICONS = { category: '📁', source: '📖', extract: '✂️', card: '🃏' };

class MainDashboardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.timer = null;
    this.collectionRevision = 0;
    this.renderGeneration = 0;
    this.scrollToStatsOnRender = false;
    this.needsRender = false;
  }
  getViewType() { return MAIN_DASHBOARD_VIEW_TYPE; }
  getDisplayText() { return '学习仪表盘'; }
  getIcon() { return 'layout-dashboard'; }
  async onOpen() {
    this.collectionRevision = this.plugin.irCollectionRevision;
    this.render();
    this.registerEvent(this.plugin.app.metadataCache.on('changed', (file) => {
      if (this.collectionRevision === this.plugin.irCollectionRevision) return;
      this.collectionRevision = this.plugin.irCollectionRevision;
      this._requestRender();
    }));
    this.registerEvent(this.plugin.app.vault.on('modify', (file) => {
      if (!isPathInIRCollection(this.plugin.settings, file?.path)) return;
      if (getFm(this.plugin.app, file)?.type !== 'card') return;
      // Card answers change due state, but rebuilding analytics while the
      // review UI is grading makes the dependency feel frozen.
      this.needsRender = true;
    }));
    for (const event of ['create', 'delete', 'rename']) {
      this.registerEvent(this.plugin.app.vault.on(event, (file, oldPath) => {
        const relevant = event === 'rename'
          ? isPathInIRCollection(this.plugin.settings, file?.path)
            || isPathInIRCollection(this.plugin.settings, oldPath)
          : isPathInIRCollection(this.plugin.settings, file?.path);
        if (!relevant) return;
        this.collectionRevision = this.plugin.irCollectionRevision;
        this._requestRender();
      }));
    }
    this.registerEvent(this.plugin.app.workspace.on('active-leaf-change', () => {
      if (this.plugin.directQueueNavigation) return;
      if (this.needsRender && this.plugin.app.workspace.activeLeaf === this.leaf) this._requestRender();
    }));
  }
  async onClose() { if (this.timer) window.clearTimeout(this.timer); }
  _requestRender() {
    if (this.plugin.directQueueNavigation) return;
    if (this.plugin.collectionRenderDeferrals > 0) { this.needsRender = true; return; }
    if (!isViewVisible(this)) { this.needsRender = true; return; }
    this.needsRender = false;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.render();
    }, 250);
  }
  _metric(parent, value, label, tone = '') {
    const card = parent.createDiv({ cls: `ir-dashboard-metric ${tone}`.trim() });
    card.createDiv({ cls: 'ir-dashboard-metric-value', text: String(value) });
    card.createDiv({ cls: 'ir-dashboard-metric-label', text: label });
  }
  _activityChart(parent, days) {
    const max = Math.max(1, ...days.map(day => day.count));
    const chart = parent.createDiv({ cls: 'ir-dashboard-activity-chart' });
    chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', `过去 ${days.length} 天的主题复习`);
    for (const [index, day] of days.entries()) {
      const column = chart.createDiv({ cls: 'ir-dashboard-activity-column' });
      const value = column.createDiv({ cls: 'ir-dashboard-activity-value', text: String(day.count) });
      value.toggleClass('is-zero', day.count === 0);
      const track = column.createDiv({ cls: 'ir-dashboard-activity-track' });
      const bar = track.createDiv({ cls: 'ir-dashboard-activity-bar' });
      bar.style.height = `${day.count ? Math.max(8, day.count / max * 100) : 2}%`;
      bar.title = `${day.label}：${day.count} 条复习${day.count === 1 ? '' : ''}`;
      const label = column.createDiv({
        cls: 'ir-dashboard-activity-label',
        text: index === days.length - 1 ? '今天' : (index % 2 === 0 ? day.shortLabel : ''),
      });
      label.title = day.label;
    }
  }
  _distributionChart(parent, rows) {
    const max = Math.max(1, ...rows.map(row => row.value));
    const chart = parent.createDiv({ cls: 'ir-dashboard-distribution' });
    for (const row of rows) {
      const item = chart.createDiv({ cls: 'ir-dashboard-distribution-row' });
      const heading = item.createDiv({ cls: 'ir-dashboard-distribution-heading' });
      heading.createSpan({ text: row.label });
      heading.createSpan({ text: String(row.value) });
      const track = item.createDiv({ cls: 'ir-dashboard-distribution-track' });
      const bar = track.createDiv({ cls: `ir-dashboard-distribution-bar ${row.tone || ''}`.trim() });
      bar.style.width = `${row.value ? Math.max(3, row.value / max * 100) : 0}%`;
    }
  }
  async render() {
    this.needsRender = false;
    const generation = ++this.renderGeneration;
    const root = this.containerEl.children[1];
    root.empty(); root.addClass('ir-dashboard-root');
    const today = todayDate();
    const rows = this.plugin.getIRRows();
    const topics = rows.filter(row => ['source', 'extract'].includes(row.fm.type));
    const active = topics.filter(row => isActiveIR(row.fm));
    const cards = rows.filter(row => row.fm.type === 'card');
    const due = active.filter(row => isDue(row.fm, today, this.plugin.settings));
    const overdue = active.filter(row => isPastDue(row.fm, today, this.plugin.settings));
    const reviewed = topics.filter(row => row.fm.last_reviewed === todayDateString(this.plugin.settings));

    const activity = [];
    const activityByDate = new Map();
    for (let offset = 13; offset >= 0; offset--) {
      const date = new Date(today.getTime());
      date.setDate(date.getDate() - offset);
      const key = formatDateValue(date, this.plugin.settings);
      const item = {
        key,
        label: date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
        shortLabel: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
        count: 0,
      };
      activity.push(item);
      activityByDate.set(key, item);
    }
    let lifetimeReviews = 0;
    const logFile = this.plugin.app.vault.getAbstractFileByPath(this.plugin.reviewLogPath());
    if (logFile instanceof TFile) {
      try {
        const log = await this.plugin.app.vault.cachedRead(logFile);
        if (generation !== this.renderGeneration) return;
        for (const line of log.split('\n')) {
          const firstCell = line.match(/^\|\s*([^|]+?)\s*\|/)?.[1];
          const date = parseDateValue(firstCell, this.plugin.settings);
          if (!date) continue;
          lifetimeReviews++;
          const bucket = activityByDate.get(formatDateValue(date, this.plugin.settings));
          if (bucket) bucket.count++;
        }
      } catch (error) {
        this.plugin._dbg('Could not read review log for dashboard', error);
      }
    }
    if (lifetimeReviews === 0) {
      // Vaults without a review log still get useful, conservative activity
      // from each topic's latest review and lifetime frontmatter counters.
      for (const row of topics) {
        const date = parseDateValue(row.fm.last_reviewed, this.plugin.settings);
        const bucket = date && activityByDate.get(formatDateValue(date, this.plugin.settings));
        if (bucket) bucket.count++;
        lifetimeReviews += Math.max(0, Number(row.fm.review_count) || 0);
      }
    }
    const reviewsToday = activity[activity.length - 1].count || reviewed.length;
    const reviewsThisWeek = activity.slice(-7).reduce((sum, day) => sum + day.count, 0);
    const unscheduled = active.filter(row => !row.fm.next_review).length;
    const dueToday = active.filter(row => {
      const date = parseDateValue(row.fm.next_review, this.plugin.settings);
      return date && date.getTime() === today.getTime();
    }).length;
    const upcoming = active.filter(row => {
      const date = parseDateValue(row.fm.next_review, this.plugin.settings);
      return date && date > today;
    }).length;

    const head = root.createDiv({ cls: 'ir-dashboard-head' });
    const title = head.createDiv();
    title.createEl('h1', { text: '渐进学习' });
    title.createEl('p', { text: `${today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · 主题与卡片混合` });
    const actions = head.createDiv({ cls: 'ir-dashboard-actions' });
    for (const [label, action, cta] of [
      ['开始混合会话', () => this.plugin.buildSessionQueue({ openFirst: true }), true],
      ['复习卡片', () => this.plugin.reviewCards(), false],
      ['知识树', () => this.plugin._activateKnowledgeTree(), false],
    ]) {
      const button = actions.createEl('button', { text: label });
      if (cta) button.addClass('mod-cta');
      button.onclick = action;
    }
    const metrics = root.createDiv({ cls: 'ir-dashboard-metrics' });
    this._metric(metrics, due.length, '到期主题', due.length ? 'is-warning' : '');
    this._metric(metrics, overdue.length, '逾期', overdue.length ? 'is-danger' : '');
    this._metric(metrics, reviewsToday, '今日已复习', 'is-success');
    this._metric(metrics, reviewsThisWeek, '复习 · 7 天');
    this._metric(metrics, cards.length, '卡片笔记');
    this._metric(metrics, active.length, '活跃主题');

    const grid = root.createDiv({ cls: 'ir-dashboard-grid' });
    const sessionPanel = grid.createDiv({ cls: 'ir-dashboard-panel' });
    sessionPanel.createEl('h2', { text: '下次混合会话' });
    const savedSession = await this.plugin.readSessionSnapshot();
    const session = savedSession
      || this.plugin.buildInterleavedQueue(await this.plugin.buildDuePool({ skipCurrent: false }), today);
    if (generation !== this.renderGeneration) return;
    if (!session.length) sessionPanel.createEl('p', { text: '没有到期内容，你已全部跟上。' });
    for (const row of session.slice(0, 12)) {
      const item = sessionPanel.createDiv({ cls: 'ir-dashboard-session-row' });
      item.createSpan({ text: TREE_ICONS[row.fm.type] || '•' });
      item.createSpan({ cls: 'ir-dashboard-session-title', text: row.tfile.basename });
      item.createSpan({ cls: 'ir-dashboard-session-kind', text: row.fm.type });
      item.onclick = () => this.plugin.openLearningItem(row);
    }
    const health = grid.createDiv({ cls: 'ir-dashboard-panel' });
    health.createEl('h2', { text: '材料库健康度' });
    const statusCounts = new Map();
    for (const row of topics) statusCounts.set(row.fm.status || 'active', (statusCounts.get(row.fm.status || 'active') || 0) + 1);
    for (const [status, count] of [...statusCounts.entries()].sort((a, b) => b[1] - a[1])) {
      const line = health.createDiv({ cls: 'ir-dashboard-health-row' });
      line.createSpan({ text: status }); line.createSpan({ text: String(count) });
    }
    health.createEl('p', { cls: 'ir-dashboard-note', text: '主题间隔使用进度感知的 A 因子。工具包卡片使用 FSRS；外部卡片系统保留各自的排期。' });

    const analytics = root.createDiv({ cls: 'ir-dashboard-analytics' });
    analytics.createEl('h2', { text: '学习分析' });
    const analyticsGrid = analytics.createDiv({ cls: 'ir-dashboard-analytics-grid' });
    const activityPanel = analyticsGrid.createDiv({ cls: 'ir-dashboard-panel ir-dashboard-panel-wide' });
    const activityHead = activityPanel.createDiv({ cls: 'ir-dashboard-chart-head' });
    activityHead.createEl('h3', { text: '复习活动' });
    activityHead.createSpan({ text: `本周 ${reviewsThisWeek} 次 · 累计 ${lifetimeReviews} 次` });
    this._activityChart(activityPanel, activity);

    const workloadPanel = analyticsGrid.createDiv({ cls: 'ir-dashboard-panel' });
    workloadPanel.createEl('h3', { text: '队列负载' });
    this._distributionChart(workloadPanel, [
      { label: '逾期', value: overdue.length, tone: 'is-danger' },
      { label: '今日到期', value: dueToday, tone: 'is-warning' },
      { label: '未排期', value: unscheduled, tone: 'is-accent' },
      { label: '即将到期', value: upcoming, tone: 'is-success' },
    ]);

    const mixPanel = analyticsGrid.createDiv({ cls: 'ir-dashboard-panel' });
    mixPanel.createEl('h3', { text: '材料库构成' });
    this._distributionChart(mixPanel, [
      { label: '来源', value: topics.filter(row => row.fm.type === 'source').length, tone: 'is-accent' },
      { label: '摘录', value: topics.filter(row => row.fm.type === 'extract').length, tone: 'is-warning' },
      { label: '卡片笔记', value: cards.length, tone: 'is-success' },
    ]);
    mixPanel.createEl('p', { cls: 'ir-dashboard-note', text: '卡片复习历史仍可在 Spaced Repetition 插件中查看。' });

    if (this.scrollToStatsOnRender) {
      this.scrollToStatsOnRender = false;
      window.setTimeout(() => analytics.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    }
  }
}

class PdfViewerView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.state = {}; }
  getViewType() { return PDF_VIEW_TYPE; }
  getDisplayText() { return this.state.title ? `PDF：${this.state.title}` : 'PDF 阅读器'; }
  getIcon() { return 'file-text'; }
  async setState(state) { this.state = { ...state }; this.render(); }
  getState() { return this.state; }
  async onOpen() { this.render(); }
  render() {
    const root = this.containerEl.children[1]; root.empty(); root.addClass('ir-pdf-root');
    if (!this.state.url) { root.createEl('p', { text: '打开一个 PDF 来源即可开始。' }); return; }
    const bar = root.createDiv({ cls: 'ir-pdf-toolbar' });
    bar.createSpan({ cls: 'ir-pdf-title', text: this.state.title || 'PDF' });
    bar.createSpan({ text: '页' });
    const page = bar.createEl('input', { type: 'number', cls: 'ir-pdf-page' });
    page.min = '1'; page.value = String(this.state.page || 1);
    const frame = root.createEl('iframe', { cls: 'ir-pdf-frame', attr: { title: this.state.title || 'PDF 查看器' } });
    const load = () => { this.state.page = Math.max(1, Number(page.value) || 1); frame.src = `${this.state.url}#page=${this.state.page}&view=FitH`; };
    page.onchange = load;
    const save = bar.createEl('button', { text: '保存阅读位置' });
    save.onclick = async () => {
      if (this.state.sourcePath) {
        const source = this.plugin.app.vault.getAbstractFileByPath(this.state.sourcePath);
        if (source) await this.plugin.app.fileManager.processFrontMatter(source, fm => { fm.read_point = Math.max(1, Number(page.value) || 1); });
      }
      new Notice(`PDF 阅读位置已保存到第 ${Math.max(1, Number(page.value) || 1)} 页`);
    };
    load();
  }
}

class KnowledgeTreeView extends ItemView {
  constructor(leaf, plugin, mode) {
    super(leaf);
    this.plugin = plugin;
    this.mode = mode || 'main';
    this.filter = '';
    this.typeFilter = 'all';
    this._match = null;
    this.index = null;
    this.refreshTimer = null;
    this.collectionRevision = 0;
    this.needsRender = false;
    this.selectedPaths = new Set();
    this.renderedSelectablePaths = [];
    this.lastSelectedPath = null;
  }

  getViewType() { return this.mode === 'sidebar' ? KNOWLEDGE_TREE_SIDEBAR_TYPE : KNOWLEDGE_TREE_VIEW_TYPE; }
  getDisplayText() { return '知识树'; }
  getIcon() { return 'folder-tree'; }

  async onOpen() {
    this.collectionRevision = this.plugin.irCollectionRevision;
    this._render();
    this.registerEvent(this.plugin.app.metadataCache.on('changed', (file) => {
      if (this.collectionRevision === this.plugin.irCollectionRevision) return;
      this.collectionRevision = this.plugin.irCollectionRevision;
      this._requestBodyRender();
    }));
    for (const event of ['create', 'delete', 'rename']) {
      this.registerEvent(this.plugin.app.vault.on(event, (file, oldPath) => {
        const relevant = event === 'rename'
          ? isPathInIRCollection(this.plugin.settings, file?.path)
            || isPathInIRCollection(this.plugin.settings, oldPath)
          : isPathInIRCollection(this.plugin.settings, file?.path);
        if (!relevant) return;
        this.collectionRevision = this.plugin.irCollectionRevision;
        this._requestBodyRender();
      }));
    }
    this.registerEvent(this.plugin.app.workspace.on('active-leaf-change', () => {
      if (this.plugin.directQueueNavigation) return;
      if (this.needsRender && this.plugin.app.workspace.activeLeaf === this.leaf) this._requestBodyRender();
    }));
  }
  async onClose() {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
  }

  _requestBodyRender() {
    if (this.plugin.directQueueNavigation) return;
    if (this.plugin.collectionRenderDeferrals > 0) { this.needsRender = true; return; }
    if (!isViewVisible(this)) { this.needsRender = true; return; }
    this.needsRender = false;
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this._renderBody();
    }, 300);
  }

  // Full render: rebuilds toolbar + body. Used on open and cross-view refresh.
  // Internal updates (filter typing, expand, drag, edits) call _renderBody only, so
  // the filter <input> is not recreated mid-typing (which would drop focus).
  _render() {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass('ir-tree-root');
    root.toggleClass('ir-tree-main', this.mode === 'main');
    root.toggleClass('ir-tree-compact', this.mode === 'sidebar');

    const bar = root.createDiv({ cls: 'ir-tree-toolbar' });
    if (this.mode === 'main') {
      const b1 = bar.createEl('button', { text: '+ 分类' });
      b1.onclick = async () => { await this.plugin.createCategory(); this._renderBody(); };
      const b2 = bar.createEl('button', { text: '全部展开' });
      b2.onclick = () => { this._setExpandAll(true); this._renderBody(); };
      const b3 = bar.createEl('button', { text: '全部折叠' });
      b3.onclick = () => { this._setExpandAll(false); this._renderBody(); };
      const refresh = bar.createEl('button', { text: '刷新' });
      refresh.onclick = () => this._renderBody();
    }
    const fi = bar.createEl('input', { cls: 'ir-tree-filter', type: 'text', placeholder: '按标题或标签筛选…' });
    fi.value = this.filter;
    fi.oninput = (e) => { this.filter = e.target.value; this._renderBody(); };
    if (this.mode === 'main') {
      const type = bar.createEl('select', { cls: 'ir-tree-type-filter' });
      for (const [value, label] of [['all', '所有类型'], ['category', '分类'], ['source', '来源'], ['extract', '摘录'], ['card', '卡片']]) type.createEl('option', { value, text: label });
      type.value = this.typeFilter;
      type.onchange = () => { this.typeFilter = type.value; this._renderBody(); };
    }

    if (this.mode === 'main') {
      this._bulkBar = root.createDiv({ cls: 'ir-tree-bulk' });
      this._renderBulkBar();
    }

    this._bodyEl = root.createDiv({ cls: 'ir-tree-body' });
    if (this.mode === 'main') {
      this._bodyEl.addEventListener('dragover', (e) => { e.preventDefault(); });
      this._bodyEl.addEventListener('drop', async (e) => {
        const src = e.dataTransfer.getData('text/ir-path');
        if (src) { await this.plugin.reparent(src, null); this._renderBody(); }
      });
    }
    this._renderBody();
  }

  _renderBody() {
    this.needsRender = false;
    if (!this._bodyEl) { this._render(); return; }
    this._bodyEl.empty();
    this.index = this.plugin.buildTreeIndex();
    const currentPaths = new Set(this.index.pages.map(page => page.path));
    for (const path of this.selectedPaths) {
      if (!currentPaths.has(path)) this.selectedPaths.delete(path);
    }
    this.renderedSelectablePaths = [];
    if (this.mode === 'main') this._renderSummary();
    this._computeFilter();
    const catRoots = this.index.roots.filter(p => p.fm.type === 'category' && !treeCore.effectiveParent(p.fm));
    const loose = this.index.roots.filter(p => !(p.fm.type === 'category' && !treeCore.effectiveParent(p.fm)));
    for (const p of catRoots) this._renderNode(this._bodyEl, p, 0);
    this._renderUnfiled(this._bodyEl, loose);
    const renderedPaths = new Set(this.renderedSelectablePaths);
    for (const path of this.selectedPaths) {
      if (!renderedPaths.has(path)) this.selectedPaths.delete(path);
    }
    if (this.lastSelectedPath && !this.selectedPaths.has(this.lastSelectedPath)) this.lastSelectedPath = null;
    this._renderBulkBar();
  }

  _computeFilter() {
    const f = this.filter.trim().toLowerCase();
    const constrained = !!f || this.typeFilter !== 'all' || !this.plugin.settings.tree.show_completed;
    if (!constrained) { this._match = null; return; }
    const matches = (p) => {
      if (this.typeFilter !== 'all' && p.fm.type !== this.typeFilter) return false;
      if (!this.plugin.settings.tree.show_completed && ['done', 'dismissed'].includes(p.fm.status)) return false;
      if (!f || p.basename.toLowerCase().includes(f)) return true;
      const tags = p.fm && p.fm.tags;
      const tagStr = Array.isArray(tags) ? tags.join(' ') : String(tags || '');
      return tagStr.toLowerCase().includes(f);
    };
    const keep = new Set();
    const hiddenCompleted = new Set();
    if (!this.plugin.settings.tree.show_completed) {
      for (const page of this.index.pages) {
        if (['done', 'dismissed'].includes(page.fm.status)) hiddenCompleted.add(page.path);
      }
    }
    for (const p of this.index.pages) {
      if (!matches(p)) continue;
      let cur = p;
      const guard = new Set();
      while (cur) {
        keep.add(cur.path);
        const up = treeCore.effectiveParent(cur.fm);
        if (!up) break;
        const next = this.index.byName.get(up.toLowerCase());
        if (!next || guard.has(next.path)) break;
        guard.add(next.path);
        cur = next;
      }
    }
    this._match = { keep, hiddenCompleted, forceExpand: !!f || this.typeFilter !== 'all' };
  }

  _renderSummary() {
    let summary = this._bodyEl.previousElementSibling;
    if (!summary || !summary.hasClass?.('ir-tree-summary')) summary = this._bodyEl.parentElement.createDiv({ cls: 'ir-tree-summary' });
    this._bodyEl.parentElement.insertBefore(summary, this._bodyEl);
    summary.empty();
    const counts = { category: 0, source: 0, extract: 0, card: 0 };
    for (const page of this.index.pages) {
      if (!this.plugin.settings.tree.show_completed && ['done', 'dismissed'].includes(page.fm.status)) continue;
      counts[page.fm.type] = (counts[page.fm.type] || 0) + 1;
    }
    for (const [type, label] of [['category', 'categories'], ['source', 'sources'], ['extract', 'extracts'], ['card', 'cards']]) {
      const chip = summary.createEl('button', { text: `${TREE_ICONS[type]} ${counts[type]} ${label}` });
      chip.title = `显示 ${label}`;
      chip.onclick = () => { this.typeFilter = this.typeFilter === type ? 'all' : type; this._render(); };
    }
  }

  _renderBulkBar() {
    if (!this._bulkBar) return;
    const count = this.selectedPaths.size;
    this._bulkBar.empty();
    this._bulkBar.toggleClass('is-active', count > 0);
    this._bulkBar.createSpan({ cls: 'ir-tree-bulk-count', text: `已选 ${count}` });

    const rendered = this.renderedSelectablePaths;
    const allVisibleSelected = rendered.length > 0 && rendered.every(path => this.selectedPaths.has(path));
    const visible = this._bulkBar.createEl('button', { text: allVisibleSelected ? '取消选择可见项' : '选择可见项' });
    visible.type = 'button';
    visible.disabled = rendered.length === 0;
    visible.onclick = () => {
      for (const path of rendered) {
        if (allVisibleSelected) this.selectedPaths.delete(path);
        else this.selectedPaths.add(path);
      }
      this.lastSelectedPath = null;
      this._renderBody();
    };

    const done = this._bulkBar.createEl('button', { text: '已完成' });
    done.type = 'button'; done.disabled = count === 0;
    done.title = '将选中的来源、摘录和卡片标记为已完成';
    done.onclick = () => this._runBulkAction('done');

    const reset = this._bulkBar.createEl('button', { text: '重置' });
    reset.type = 'button'; reset.disabled = count === 0;
    reset.title = '将选中项设为活跃并清除其排期历史';
    reset.onclick = () => this._runBulkAction('reset');

    const clear = this._bulkBar.createEl('button', { text: '清除' });
    clear.type = 'button'; clear.disabled = count === 0;
    clear.onclick = () => { this.selectedPaths.clear(); this.lastSelectedPath = null; this._renderBody(); };
  }

  async _runBulkAction(action) {
    const paths = [...this.selectedPaths];
    if (!paths.length) return;
    const changed = action === 'done'
      ? await this.plugin.markPathsDone(paths)
      : await this.plugin.resetPaths(paths);
    if (!changed) return;
    this.selectedPaths.clear();
    this.lastSelectedPath = null;
    this._renderBody();
  }

  _toggleSelected(path, { range = false } = {}) {
    if (range && this.lastSelectedPath) {
      const from = this.renderedSelectablePaths.indexOf(this.lastSelectedPath);
      const to = this.renderedSelectablePaths.indexOf(path);
      if (from >= 0 && to >= 0) {
        const shouldSelect = !this.selectedPaths.has(path);
        for (const candidate of this.renderedSelectablePaths.slice(Math.min(from, to), Math.max(from, to) + 1)) {
          if (shouldSelect) this.selectedPaths.add(candidate);
          else this.selectedPaths.delete(candidate);
        }
      }
    } else if (this.selectedPaths.has(path)) this.selectedPaths.delete(path);
    else this.selectedPaths.add(path);
    this.lastSelectedPath = path;
    this._renderBody();
  }

  _renderNode(parentEl, page, depth) {
    if (depth > 50) return;
    if (this._match && !this._match.keep.has(page.path)) return;

    if (this._match?.hiddenCompleted.has(page.path)) {
      const promoted = treeCore.flattenedVisibleChildren(
        this.index, page, this._match.keep, this._match.hiddenCompleted
      );
      for (const child of promoted) this._renderNode(parentEl, child, depth);
      return;
    }

    const key = page.path;
    const children = treeCore.flattenedVisibleChildren(
      this.index, page, this._match?.keep || null, this._match?.hiddenCompleted || null
    );
    const hasChildren = children.length > 0;
    const expanded = !!this._match?.forceExpand || this.plugin.isExpanded(key);

    const row = parentEl.createDiv({ cls: 'ir-tree-row' });
    row.dataset.irPath = page.path;
    // Indent scales with tree depth, so it stays inline via a CSS var.
    row.style.setProperty('--ir-tree-depth', String(depth));

    const tw = row.createSpan({ cls: 'ir-tree-twisty', text: hasChildren ? (expanded ? '▼' : '▶') : '' });
    if (hasChildren) tw.onclick = (e) => { e.stopPropagation(); this.plugin.toggleExpanded(key); this._renderBody(); };

    const selectable = this.mode === 'main' && ['source', 'extract', 'card'].includes(page.fm.type);
    if (selectable) {
      this.renderedSelectablePaths.push(page.path);
      const checkbox = row.createEl('input', { cls: 'ir-tree-select', type: 'checkbox' });
      checkbox.checked = this.selectedPaths.has(page.path);
      checkbox.draggable = false;
      checkbox.setAttribute('aria-label', `选择 ${page.basename}`);
      checkbox.onpointerdown = event => event.stopPropagation();
      checkbox.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        this._toggleSelected(page.path, { range: event.shiftKey });
      };
      row.toggleClass('is-selected', checkbox.checked);
    }

    row.createSpan({ cls: 'ir-tree-icon', text: TREE_ICONS[page.fm.type] || '•' });
    row.createSpan({ cls: 'ir-tree-title', text: page.basename });

    const parentName = treeCore.effectiveParent(page.fm);
    if (parentName && !this.index.byName.has(parentName.toLowerCase())) {
      const w = row.createSpan({ cls: 'ir-tree-warn', text: '⚠' });
      w.title = `未找到父级：${parentName}`;
    }

    if (this.mode === 'main') {
      if (page.fm.type !== 'category') {
        row.createSpan({ cls: 'ir-tree-pri', text: `p${page.fm.priority ?? '?'}` });
      }
      if (hasChildren) {
        const cc = row.createSpan({ cls: 'ir-tree-count', text: String(children.length) });
        if (children.length > this.plugin.settings.tree.child_warn_threshold) cc.addClass('ir-tree-count-warn');
      }
      const status = row.createSpan({ cls: `ir-tree-status is-${page.fm.status || 'active'}`, text: page.fm.status || 'active' });
      status.title = page.fm.next_review ? `下次复习：${page.fm.next_review}` : '无复习日期';
      this._attachDrag(row, page);
      this._attachActions(row, page);
    }

    row.tabIndex = 0;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-expanded', hasChildren ? String(expanded) : 'false');
    row.setAttribute('aria-selected', String(this.selectedPaths.has(page.path)));
    row.onclick = (event) => {
      if (event.target.closest('button, input, .ir-tree-twisty')) return;
      if (selectable && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this._toggleSelected(page.path, { range: event.shiftKey });
        return;
      }
      this._openPage(page);
    };
    row.onkeydown = (event) => {
      if (event.key === 'Enter') { event.preventDefault(); this._openPage(page); }
      if (hasChildren && event.key === 'ArrowRight' && !expanded) { event.preventDefault(); this.plugin.toggleExpanded(key); this._renderBody(); }
      if (hasChildren && event.key === 'ArrowLeft' && expanded) { event.preventDefault(); this.plugin.toggleExpanded(key); this._renderBody(); }
    };

    if (expanded && hasChildren) {
      for (const c of children) this._renderNode(parentEl, c, depth + 1);
    }
  }

  _renderUnfiled(body, loose) {
    const kept = this._match ? loose.filter(p => this._match.keep.has(p.path)) : loose;
    const visible = [];
    for (const page of kept) {
      if (this._match?.hiddenCompleted.has(page.path)) {
        visible.push(...treeCore.flattenedVisibleChildren(
          this.index, page, this._match.keep, this._match.hiddenCompleted
        ));
      } else visible.push(page);
    }
    if (!visible.length) return;
    const key = '::unfiled::';
    const expanded = !!this._match?.forceExpand || this.plugin.isExpanded(key);
    const row = body.createDiv({ cls: 'ir-tree-row ir-tree-unfiled' });
    const tw = row.createSpan({ cls: 'ir-tree-twisty', text: expanded ? '▼' : '▶' });
    tw.onclick = (e) => { e.stopPropagation(); this.plugin.toggleExpanded(key); this._renderBody(); };
    row.createSpan({ cls: 'ir-tree-icon', text: '📥' });
    row.createSpan({ cls: 'ir-tree-title', text: `未归档（${visible.length}）` });
    if (expanded) for (const p of visible) this._renderNode(body, p, 1);
  }

  _setExpandAll(on) {
    if (!on) { this.plugin.settings.tree.expanded = []; this.plugin.saveSettings(); return; }
    const keys = ['::unfiled::'];
    for (const p of this.index.pages) {
      if ((this.index.childrenOf.get(p.basename.toLowerCase()) || []).length) keys.push(p.path);
    }
    this.plugin.settings.tree.expanded = keys;
    this.plugin.saveSettings();
  }

  async _openPage(page) {
    let leaf = this.contentLeaf;
    if (!leaf || !leaf.view) {
      leaf = this.plugin.app.workspace.getLeaf('tab');
      this.contentLeaf = leaf;
    }
    await leaf.openFile(page.tfile, { active: true });
    this.plugin.app.workspace.revealLeaf(leaf);
    if (page.fm.type === 'source') {
      this.plugin.app.commands.executeCommandById(`${this.plugin.manifest.id}:jump-to-read-point`);
    }
  }

  _attachDrag(row, page) {
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/ir-path', page.path);
      e.dataTransfer.effectAllowed = 'move';
    });
    if (page.fm.type === 'card') return;   // cards are leaves, never drop targets
    row.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); row.addClass('ir-tree-drop'); });
    row.addEventListener('dragleave', () => row.removeClass('ir-tree-drop'));
    row.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation();
      row.removeClass('ir-tree-drop');
      const src = e.dataTransfer.getData('text/ir-path');
      if (!src || src === page.path) return;
      await this.plugin.reparent(src, page.basename);
      this._renderBody();
    });
  }

  _attachActions(row, page) {
    const actions = row.createDiv({ cls: 'ir-tree-actions' });
    actions.addEventListener('pointerdown', event => event.stopPropagation());
    actions.addEventListener('click', event => event.stopPropagation());
    const move = actions.createEl('button', { text: '移动' });
    move.type = 'button'; move.draggable = false; move.title = '移动到其他节点下';
    move.onclick = async (e) => { e.preventDefault(); e.stopPropagation(); await this.plugin.reparentPath(page.path); this._renderBody(); };
    const up = actions.createEl('button', { text: '↑' });
    up.type = 'button'; up.draggable = false; up.title = '上移';
    up.onclick = async (e) => { e.preventDefault(); e.stopPropagation(); await this.plugin.reorderSibling(page.path, -1); this._renderBody(); };
    const down = actions.createEl('button', { text: '↓' });
    down.type = 'button'; down.draggable = false; down.title = '下移';
    down.onclick = async (e) => { e.preventDefault(); e.stopPropagation(); await this.plugin.reorderSibling(page.path, +1); this._renderBody(); };
    const ren = actions.createEl('button', { text: '✎' });
    ren.type = 'button'; ren.draggable = false; ren.title = '重命名';
    ren.onclick = async (e) => { e.preventDefault(); e.stopPropagation(); await this.plugin.renameTreeNode(page.path); this._renderBody(); };
    if (['source', 'extract', 'card'].includes(page.fm.type)) {
      if (page.fm.status !== 'done') {
        const done = actions.createEl('button', { text: '✓' });
        done.type = 'button'; done.draggable = false; done.title = '标记为已完成';
        done.onclick = async (e) => { e.preventDefault(); e.stopPropagation(); await this.plugin.markPathsDone([page.path]); this._renderBody(); };
      }
      const reset = actions.createEl('button', { text: '↺' });
      reset.type = 'button'; reset.draggable = false; reset.title = '重置排期并设为活跃';
      reset.onclick = async (e) => { e.preventDefault(); e.stopPropagation(); await this.plugin.resetPaths([page.path]); this._renderBody(); };
    }
    if (page.fm.type !== 'card') {
      const dis = actions.createEl('button', { text: '✕' });
      dis.type = 'button'; dis.draggable = false; dis.title = '搁置';
      dis.onclick = async (e) => { e.preventDefault(); e.stopPropagation(); await this.plugin.dismissTreeNode(page.path); this._renderBody(); };
    }
  }
}

class IncrementalReadingPlugin extends Plugin {
  async onload() {
    const storedSettings = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, storedSettings);
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      this.settings[key] = Object.assign({}, DEFAULT_SETTINGS[key], this.settings[key] || {});
    }
    // Versions through 1.1.8 created SR cards exclusively. Preserve that
    // workflow on upgrade, while new installations start with in-house cards.
    if (storedSettings?.spaced_repetition && !storedSettings?.flashcards) {
      this.settings.flashcards.backend = 'spaced_repetition';
    }
    this.settings.session.types = { ...(this.settings.session.types || {}) };
    this.settings.session.readPoints = { ...(this.settings.session.readPoints || {}) };
    this.cardDueCache = new Map();
    this.cardScheduleSignatures = new Map();
    this.irFilesCache = null;
    this.irRowsCache = null;
    this.irMetadataSignatures = new Map();
    this.irCollectionRevision = 0;
    this.collectionRenderDeferrals = 0;
    this.directQueueNavigation = false;
    this.directQueueNavigationDepth = 0;
    this.pendingSpacedRepetitionReview = null;
    this.spacedRepetitionCloseGeneration = 0;
    this.spacedRepetitionCloseAttempt = 0;
    this.sessionSaveTimer = null;
    this.ankiSyncTimer = null;
    this.pendingAnkiSyncPaths = new Set();
    this.treeIndexCache = null;
    this.duePoolCache = null;
    this.registerEvent(this.app.metadataCache.on('changed', file => {
      this._refreshExcerptViews(file);
      if (!isPathInIRCollection(this.settings, file.path)) return;
      const next = irViewSignature(this.app, file);
      const previous = this.irMetadataSignatures.get(file.path) ?? null;
      if (next === previous) return;
      if (next === null) this.irMetadataSignatures.delete(file.path);
      else this.irMetadataSignatures.set(file.path, next);
      this.irRowsCache = null;
      this.treeIndexCache = null;
      this.duePoolCache = null;
      this.irCollectionRevision++;
    }));
    this.registerEvent(this.app.vault.on('modify', file => {
      const pending = this.pendingSpacedRepetitionReview;
      if (pending?.path === file.path && pending.expiresAt > Date.now()) {
        this._confirmSpacedRepetitionReview(file, pending);
      }
      if (!isPathInIRCollection(this.settings, file.path)) return;
      this.cardDueCache.delete(file.path);
      this.cardScheduleSignatures.delete(file.path);
      if (getFm(this.app, file)?.type === 'card') this.duePoolCache = null;
    }));
    this.registerEvent(this.app.vault.on('create', file => {
      if (isPathInIRCollection(this.settings, file?.path)) this._invalidateIRCollection(true);
    }));
    this.registerEvent(this.app.vault.on('delete', file => {
      this.cardDueCache.delete(file.path);
      this.cardScheduleSignatures.delete(file.path);
      if (this.pendingSpacedRepetitionReview?.path === file.path) this.pendingSpacedRepetitionReview = null;
      if (isPathInIRCollection(this.settings, file?.path)) this._invalidateIRCollection(true);
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.cardDueCache.delete(oldPath);
      this.cardDueCache.delete(file.path);
      this.cardScheduleSignatures.delete(oldPath);
      this.cardScheduleSignatures.delete(file.path);
      if (this.pendingSpacedRepetitionReview?.path === oldPath) this.pendingSpacedRepetitionReview.path = file.path;
      if (isPathInIRCollection(this.settings, oldPath)
          || isPathInIRCollection(this.settings, file?.path)) this._invalidateIRCollection(true);
    }));
    await this.saveData(this.settings);
    this.addSettingTab(new IncrementalReadingSettingTab(this.app, this));
    this.registerView(IR_QUEUE_VIEW_TYPE, leaf => new IRQueueView(leaf, this));
    this.registerView(KNOWLEDGE_TREE_VIEW_TYPE, leaf => new KnowledgeTreeView(leaf, this, 'main'));
    this.registerView(KNOWLEDGE_TREE_SIDEBAR_TYPE, leaf => new KnowledgeTreeView(leaf, this, 'sidebar'));
    this.registerView(MAIN_DASHBOARD_VIEW_TYPE, leaf => new MainDashboardView(leaf, this));
    this.registerView(PDF_VIEW_TYPE, leaf => new PdfViewerView(leaf, this));
    this.registerEvent(this.app.workspace.on('file-open', () => this._refreshExcerptViews()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this._refreshExcerptViews()));
    const cmd = (id, name, callback) => this.addCommand({ id, name, callback });

    // ---- Visual learning code-block renderer ----
    this.registerMarkdownCodeBlockProcessor('ir-occlusion', (source, el, ctx) => {
      let data;
      try { data = parseYaml(source) || {}; }
      catch (e) {
        el.createEl('div', { text: `[ir-occlusion] YAML 解析错误：${e.message}` });
        return;
      }
      if (!data.image || !Array.isArray(data.rects) || data.rects.length === 0) {
        el.createEl('div', { text: '[ir-occlusion] 缺少图片或矩形区域' });
        return;
      }
      const mode = data.mode || 'hide-one';
      const qIdx = Number.isFinite(data.question_index) ? data.question_index : 0;

      const tf = this.app.vault.getAbstractFileByPath(data.image)
        || this.app.metadataCache.getFirstLinkpathDest(data.image, ctx.sourcePath);
      if (!tf) {
        el.createEl('div', { text: `[ir-occlusion] 未找到图片：${data.image}` });
        return;
      }
      const src = this.app.vault.adapter.getResourcePath(tf.path);

      const wrap = el.createDiv({ cls: 'ir-occ-wrap' });

      const img = wrap.createEl('img', { cls: 'ir-occ-img-fluid' });
      img.src = src;
      img.draggable = false;

      const overlay = wrap.createDiv({ cls: 'ir-occ-overlay ir-occ-overlay-static' });

      const isHidden = (i) => qIdx === -1
        ? true
        : (mode === 'hide-one' ? i === qIdx : i !== qIdx);

      const covers = data.rects.map((r, i) => {
        const d = overlay.createDiv({ cls: 'ir-occ-cover ir-occ-cover-plain' });
        d.style.setProperty('--ir-x', (r.x * 100) + '%');
        d.style.setProperty('--ir-y', (r.y * 100) + '%');
        d.style.setProperty('--ir-w', (r.w * 100) + '%');
        d.style.setProperty('--ir-h', (r.h * 100) + '%');
        const hidden = isHidden(i);
        if (hidden) d.addClass('ir-occ-cover-hidden');
        if (i === qIdx) d.addClass('ir-occ-cover-current');
        if (r.label) d.title = r.label;
        return { div: d, hidden };
      });

      const btnRow = el.createDiv({ cls: 'ir-occ-btn-row' });
      const btn = btnRow.createEl('button', { text: '显示答案' });
      let revealed = false;
      btn.addEventListener('click', () => {
        revealed = !revealed;
        overlay.toggleClass('ir-occ-revealed', revealed);
        btn.setText(revealed ? '隐藏答案' : '显示答案');
      });
    });

    // Core review loop
    cmd('build-session-queue','构建今日会话队列',    () => this.buildSessionQueue());
    cmd('next-element',       '下一元素',                    () => this.nextElement());
    cmd('end-session',        '为当前阅读主题评级',     () => this.gradeCurrent());
    // Keep the two highest-frequency capture actions directly hotkeyable.
    cmd('extract-selection',  '摘录选中内容',               () => this.extractSelection());
    cmd('flashcard-clipboard','从剪贴板制作卡片',        () => this.flashcardClipboard());
    // Less frequent functionality is grouped to keep the command palette small.
    cmd('capture-more',       '捕获或创建…',               () => this.captureOrCreate());
    cmd('current-actions',    '当前元素操作…',         () => this.currentElementActions());
    cmd('open-toolkit-view',  '打开工具包视图…',               () => this.openToolkitView());
    cmd('advanced-tools',     '高级工具…',                  () => this.advancedTools());
    // ---- 增强：把常用菜单项提升为可绑键的命令 ----
    cmd('read-point-set',    '阅读点：设到光标',                 () => this.setReadPointAtCursor());
    cmd('read-point-jump',   '阅读点：跳转到阅读位置',           () => this.jumpToReadPoint());
    cmd('mark-done-current', '当前元素：已完成',                 () => this.markDone());
    cmd('dismiss-current',   '当前元素：搁置',                   () => this.dismiss());
    cmd('postpone-current',  '当前元素：推迟',                   () => this.postpone());
    cmd('trash-ir-item',     '删除当前 IR 材料…',                () => this.trashCurrentIRItem());
    cmd('remove-from-ir',    '移出 IR（保留笔记）…',             () => this.removeCurrentFromIR());
    cmd('source-clipboard',  '从剪贴板新建来源（文章）',        () => this.newSourceFromClipboard());
    cmd('epub-import',       '从 EPUB 导入来源…',              () => this.importFromEpub());
    cmd('activate-ir-item',  '当前元素：设为活跃（加入今日队列）', () => this.activateCurrentIRItem());
    cmd('split-source-chapters', '拆分来源为章节（每章一个文件）', () => this.splitSourceIntoChapters(this.app.workspace.getActiveFile()));
    this.app.workspace.onLayoutReady(() => {
      this._refreshExcerptViews();
      const count = this._legacyCardFiles().length;
      if (count) new Notice(`渐进阅读工具包：发现 ${count} 个旧版卡片${count === 1 ? '' : ''}。打开高级工具，选择「将旧版卡片迁移到 Spaced Repetition」。`, 10000);
    });
  }

  onunload() {
    this._clearExcerptViews();
    if (this.ankiSyncTimer) {
      window.clearTimeout(this.ankiSyncTimer);
      this.ankiSyncTimer = null;
    }
    this.pendingAnkiSyncPaths?.clear();
    if (this.sessionSaveTimer) {
      window.clearTimeout(this.sessionSaveTimer);
      this.sessionSaveTimer = null;
      this.saveData(this.settings).catch(error => console.error('[IR] final session persistence failed', error));
    }
  }

  _refreshExcerptViews(file = null) {
    const color = normalizedExtractHighlightColor(this.settings?.misc?.extract_highlight_color);
    const background = extractHighlightBackground(color);
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (!view?.contentEl || (file && view.file?.path !== file.path)) continue;
      const isExtract = getFm(this.app, view.file)?.type === 'extract';
      view.contentEl.toggleClass('ir-extract-view', isExtract);
      view.contentEl.style.setProperty('--ir-extract-highlight-color', color);
      view.contentEl.style.setProperty('--ir-extract-highlight-background', background);
    }
  }

  _clearExcerptViews() {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const el = leaf.view?.contentEl;
      if (!el) continue;
      el.removeClass('ir-extract-view');
      el.style.removeProperty('--ir-extract-highlight-color');
      el.style.removeProperty('--ir-extract-highlight-background');
    }
  }

  async _runActionMenu(title, entries) {
    const picked = await pickFromList(
      this.app,
      entries.map(entry => entry.label),
      entries,
      title,
    );
    if (picked) return picked.run();
  }

  captureOrCreate() {
    return this._runActionMenu('捕获或创建', [
      { label: '新建来源', run: () => this.newSource() },
      { label: '从剪贴板新建来源（文章）', run: () => this.newSourceFromClipboard() }, // enhance
      { label: '导入剪藏（当前笔记）', run: () => this.importClipping() },
      { label: '从剪贴板摘录（支持 PDF）', run: () => this.extractClipboard() },
      { label: '卡片：为此图片命名', run: () => this.flashcardImageName() },
      { label: '从剪贴板摘录图片', run: () => this.imageExtractClipboard() },
      { label: '遮挡：从图片创建卡片', run: () => this.occlusionCreate() },
    ]);
  }

  currentElementActions() {
    return this._runActionMenu('当前元素操作', [
      { label: '已完成', run: () => this.markDone() },
      { label: '重置', run: () => this.resetCurrent() },
      { label: '设为活跃（加入今日队列）', run: () => this.activateCurrentIRItem() }, // enhance
      { label: '搁置', run: () => this.dismiss() },
      { label: '推迟', run: () => this.postpone() },
      { label: '排期（手动日期）', run: () => this.schedule() },
      { label: '设置优先级', run: () => this.setPriority() },
      { label: '提升优先级', run: () => this.boost() },
      { label: '打开父节点', run: () => this.openParent() },
      { label: '打开 PDF（工具包查看器）', run: () => this.openPdf() },
      { label: '切换阅读位置', run: () => this.toggleReadPoint() },
      { label: '跳转到阅读位置', run: () => this.jumpToReadPoint() },
      { label: '添加时间线检查点', run: () => this.addCheckpoint() },
    ]);
  }

  openToolkitView() {
    return this._runActionMenu('打开工具包视图', [
      { label: '仪表盘', run: () => this.openDashboard() },
      { label: '统计与分析', run: () => this.openDashboard('stats') },
      { label: '阅读队列侧边栏', run: () => this._activateQueueView() },
      { label: '知识树', run: () => this._activateKnowledgeTree() },
      { label: '知识树侧边栏', run: () => this._activateKnowledgeTreeSidebar() },
      { label: '用户指南', run: () => this.openUserGuide() },
    ]);
  }

  advancedTools() {
    return this._runActionMenu('高级工具', [
      { label: '子集复习', run: () => this.subsetReview() },
      { label: '宽限（分散逾期）', run: () => this.mercy() },
      { label: '推迟子树', run: () => this.postponeSubtree() },
      { label: '按 H2 标题拆分文章', run: () => this.splitArticle() },
      { label: '将书籍拆分为章节', run: () => this.splitBook() },
      { label: '新建分类', run: async () => { await this.createCategory(); this._refreshTreeViews(); } },
      { label: '将活跃元素移动到…下', run: async () => { await this.reparentActive(); this._refreshTreeViews(); } },
      { label: '将行内卡片导出到选定的卡片系统', run: () => this.seedInlineCards() },
      { label: '将 Anki 卡片与 Flashcards 同步', run: () => this.syncAnki() },
      { label: '将旧版卡片迁移到 Spaced Repetition', run: () => this.migrateLegacyCards() },
      { label: '性能诊断', run: () => this.performanceDiagnostics() },
    ]);
  }

  sourcesFolder() { return configuredPath(this.settings, 'sources', SOURCES_FOLDER); }
  extractsFolder() { return configuredPath(this.settings, 'extracts', EXTRACTS_FOLDER); }
  cardsFolder() { return configuredPath(this.settings, 'cards', CARDS_FOLDER); }
  attachmentsFolder() { return configuredPath(this.settings, 'attachments', ATTACHMENTS_FOLDER); }
  categoriesFolder() { return configuredPath(this.settings, 'categories', CATEGORIES_FOLDER); }
  dashboardPath() { return configuredPath(this.settings, 'dashboard', DASHBOARD_PATH); }
  reviewLogPath() { return configuredPath(this.settings, 'review_log', REVIEW_LOG_PATH); }

  _nativeCardText(value) {
    return spacedRepetitionCore.nativeCardText(value);
  }

  _spacedRepetitionSettings() {
    return this.settings.spaced_repetition || DEFAULT_SETTINGS.spaced_repetition;
  }

  _spacedRepetitionDeckTag() {
    const configured = this._spacedRepetitionSettings().flashcardTag;
    return String(configured || 'flashcards/incremental-reading').replace(/^#/, '').replace(/\/+$/, '');
  }

  _spacedRepetitionBody(format, question, answer) {
    return spacedRepetitionCore.spacedRepetitionBody(
      format,
      question,
      answer,
      this._spacedRepetitionSettings()
    );
  }

  _cardBackendFor(frontmatter) {
    return cardProviderCore.storedCardBackend(frontmatter);
  }

  async _nextCardName(parentTitle) {
    const safeParent = slugifyForFolder(parentTitle) || '未命名';
    const folder = this.cardsFolder();
    const existing = filesInFolder(this.app, folder).filter(file =>
      file.extension === 'md' && file.basename.startsWith(`${safeParent} - 卡片`));
    let number = existing.length + 1;
    let name = `${safeParent} - 卡片 ${number}`;
    while (this.app.vault.getAbstractFileByPath(`${folder}/${name}.md`)) {
      name = `${safeParent} - 卡片 ${++number}`;
    }
    return name;
  }

  async _createCard(parentFile, spec) {
    const backend = this.cardBackend();
    if (backend === 'anki') return this._createFlashcardsAnkiCard(parentFile, spec);
    if (backend === 'spaced_repetition') return this._createSpacedRepetitionCard(parentFile, spec);
    return this._createToolkitCard(parentFile, spec);
  }

  _toolkitCardBody(format, question, answer) {
    const spacer = `<div style="height: 90vh;"></div>\n\n${BODY_MARKER}\n\n`;
    if (format === 'cloze' || format === 'occlusion') return `${spacer}${question}\n`;
    return `${spacer}${question}\n\n> [!answer]- Answer\n> ${String(answer || '').replace(/\n/g, '\n> ')}\n`;
  }

  async _createToolkitCard(parentFile, spec) {
    if (spec.format === 'reverse') {
      const forward = await this._createToolkitCard(parentFile, { ...spec, format: 'basic' });
      const reverse = await this._createToolkitCard(parentFile, {
        ...spec,
        format: 'basic',
        question: spec.answer,
        answer: spec.question,
      });
      return { file: forward.file, files: [forward.file, reverse.file], name: `${forward.name} + ${reverse.name}` };
    }
    const folder = this.cardsFolder();
    await ensureFolder(this.app, folder);
    const name = await this._nextCardName(parentFile.basename);
    const priority = getFm(this.app, parentFile)?.priority ?? 50;
    const frontmatter = [
      '---', 'type: card',
      `source: ${JSON.stringify(`[[${parentFile.basename}]]`)}`,
      'status: pending', `priority: ${priority}`,
      `next_review: ${futureDateString(1, this.settings)}`, 'interval: 1',
      'review_count: 0', 'last_reviewed:', 'last_grade:', 'last_retrievability:',
      'stability:', 'difficulty:', `date_added: ${todayDateString(this.settings)}`,
      `card_format: ${spec.format}`, 'ir_card_backend: toolkit',
      ...(spec.extraFrontmatter || []),
      'cssclasses:', '  - hide-answer', 'tags:',
      '  - incremental-reading', '  - ir/card', '---', '',
    ];
    const file = await this.app.vault.create(
      `${folder}/${name}.md`,
      frontmatter.join('\n') + this._toolkitCardBody(spec.format, spec.question, spec.answer)
    );
    return { file, name };
  }

  async _createFlashcardsAnkiCard(parentFile, spec) {
    const folder = this.cardsFolder();
    await ensureFolder(this.app, folder);
    const name = await this._nextCardName(parentFile.basename);
    const deck = String(this.settings.anki.deck || '渐进阅读')
      .replace(/\s*\r?\n\s*/g, ' ').trim() || '渐进阅读';
    const frontmatter = [
      '---', 'type: card',
      `source: ${JSON.stringify(`[[${parentFile.basename}]]`)}`,
      'status: active', `date_added: ${todayDateString(this.settings)}`,
      `card_format: ${spec.format}`, 'ir_card_backend: anki', 'ir_anki: true',
      ...(spec.extraFrontmatter || []),
      `cards-deck: ${deck}`,
      'tags:', '  - incremental-reading', '  - ir/card', '---', '',
    ];
    const body = cardProviderCore.flashcardsPluginBody(
      spec.format, spec.question, spec.answer, this.settings.anki
    );
    const file = await this.app.vault.create(`${folder}/${name}.md`, frontmatter.join('\n') + body);
    if (this.settings.anki.syncOnCreate !== false) this._scheduleAnkiSync(file.path);
    return { file, name };
  }

  _scheduleAnkiSync(path) {
    this.pendingAnkiSyncPaths.add(path);
    if (this.ankiSyncTimer) window.clearTimeout(this.ankiSyncTimer);
    this.ankiSyncTimer = window.setTimeout(() => {
      this.ankiSyncTimer = null;
      const paths = [...this.pendingAnkiSyncPaths];
      this.pendingAnkiSyncPaths.clear();
      this.syncAnki({ quiet: true, paths })
        .catch(error => console.error('[IR] Flashcards auto-sync failed', error));
    }, 750);
  }

  async syncAnki({ quiet = false, paths = null } = {}) {
    if (!this.isFlashcardsReady()) {
      if (!quiet) new Notice('同步前请先启用 Flashcards by Reuseman。');
      return false;
    }
    const targets = (paths || this.getIRRows()
      .filter(row => row.fm.type === 'card' && this._cardBackendFor(row.fm) === 'anki')
      .map(row => row.tfile.path))
      .map(path => this.app.vault.getAbstractFileByPath(path))
      .filter(file => file instanceof TFile);
    if (!targets.length) {
      if (!quiet) new Notice('未找到 Flashcards 管理的卡片笔记。');
      return false;
    }
    const original = this.app.workspace.getActiveFile();
    const leaf = this.app.workspace.getLeaf(false);
    let started = 0;
    try {
      for (const file of targets) {
        await leaf.openFile(file);
        if (this.app.commands.executeCommandById(FLASHCARDS_GENERATE_COMMAND)) started++;
      }
    } finally {
      if (original instanceof TFile && original.path !== this.app.workspace.getActiveFile()?.path) {
        await leaf.openFile(original);
      }
    }
    if (!quiet) new Notice(`已开始同步 ${started} 个 Flashcards 卡片笔记${started === 1 ? '' : ''}。`);
    return started > 0;
  }

  async _createSpacedRepetitionCard(parentFile, { format, question, answer = '', extraFrontmatter = [] }) {
    const folder = this.cardsFolder();
    await ensureFolder(this.app, folder);
    const parentTitle = parentFile.basename;
    const safeParent = slugifyForFolder(parentTitle) || '未命名';
    const existing = filesInFolder(this.app, folder).filter(f =>
      f.extension === 'md' && f.basename.startsWith(safeParent + ' - 卡片'));
    let cardNum = existing.length + 1;
    let name = `${safeParent} - 卡片 ${cardNum}`;
    while (this.app.vault.getAbstractFileByPath(`${folder}/${name}.md`)) {
      name = `${safeParent} - 卡片 ${++cardNum}`;
    }
    const fm = [
      '---',
      'type: card',
      `source: ${JSON.stringify(`[[${parentTitle}]]`)}`,
      `date_added: ${todayDateString(this.settings)}`,
      `card_format: ${format}`,
      'ir_card_backend: spaced_repetition',
      'ir_spaced_repetition: true',
      `ir_spaced_repetition_deck_tag: ${JSON.stringify(this._spacedRepetitionDeckTag())}`,
      ...extraFrontmatter,
      'tags:',
      '  - incremental-reading',
      '  - ir/card',
      `  - ${this._spacedRepetitionDeckTag()}`,
      '---',
      '',
    ];
    const file = await this.app.vault.create(
      `${folder}/${name}.md`,
      fm.join('\n') + this._spacedRepetitionBody(format, question, answer)
    );
    return { file, name };
  }

  _legacyCardFiles() {
    return filesInFolder(this.app, this.cardsFolder()).filter(file => {
      if (file.extension !== 'md') return false;
      const fm = getFm(this.app, file);
      const tags = Array.isArray(fm?.tags)
        ? fm.tags.map(String)
        : (typeof fm?.tags === 'string' ? fm.tags.split(/[\s,]+/).filter(Boolean) : []);
      const deckTag = this._spacedRepetitionDeckTag();
      return fm?.type === 'card' && !fm.ir_card_backend && fm.ir_anki !== true
        && fm.ir_spaced_repetition !== true
        && !tags.some(tag => tag.replace(/^#/, '') === deckTag);
    });
  }

  async migrateLegacyCards() {
    const files = this._legacyCardFiles();
    if (!files.length) { new Notice('没有可迁移的旧版 IR 卡片。'); return; }
    const ok = await confirmDialog(
      this.app,
      `要迁移 ${files.length} 个旧版卡片${files.length === 1 ? '' : ''}吗？`,
      '卡片内容将转换为 Spaced Repetition 语法。IR 排期字段将被移除。'
    );
    if (!ok) return;

    let migrated = 0, skipped = 0;
    for (const file of files) {
      const fm = getFm(this.app, file) || {};
      const content = await this.app.vault.read(file);
      const body = content.slice(frontmatterEndOffset(content))
        .replace(/^\s*<div style="height: 90vh;"><\/div>\s*/, '')
        .replace(BODY_MARKER, '')
        .trim();
      let format = fm.card_format || 'basic';
      let question = body, answer = '';

      if (format === 'occlusion') {
        answer = fm.occlusion_image ? `![[${fm.occlusion_image}]]` : '';
      } else if (format === 'cloze') {
        const selected = Math.max(1, Number(fm.cloze_index) || 1);
        let index = 0;
        question = body.replace(new RegExp(HL_CLOZE_SRC, 'g'), (match, text) => {
          index++;
          return index === selected ? match : text;
        });
      } else {
        const marker = /\n> \[!answer\]- Answer\s*\n/;
        const parts = body.split(marker);
        if (parts.length < 2) { skipped++; continue; }
        question = parts.shift().trim();
        answer = parts.join('\n').split('\n').map(line => line.replace(/^> ?/, '')).join('\n').trim();
        format = 'basic';
      }

      await this.app.fileManager.processFrontMatter(file, (next) => {
        if (typeof next.tags === 'string') next.tags = next.tags.split(/[\s,]+/).filter(Boolean);
        if (!Array.isArray(next.tags)) next.tags = [];
        const wasDone = next.status === 'done';
        const deckTag = this._spacedRepetitionDeckTag();
        for (const tag of ['incremental-reading', 'ir/card', ...(wasDone ? [] : [deckTag])]) {
          if (!next.tags.includes(tag)) next.tags.push(tag);
        }
        next.ir_spaced_repetition = true;
        next.ir_spaced_repetition_deck_tag = deckTag;
        if (wasDone) next.ir_completed_deck_tag = deckTag;
        next.card_format = format;
        for (const key of [
          ...(wasDone ? [] : ['status']), 'priority', 'next_review', 'interval', 'review_count',
          ...(wasDone ? [] : ['last_reviewed']),
          'last_grade', 'last_retrievability', 'stability', 'difficulty', 'cssclasses',
        ]) delete next[key];
      });
      await this.app.vault.process(file, (current) =>
        current.slice(0, frontmatterEndOffset(current)) + this._spacedRepetitionBody(format, question, answer)
      );
      migrated++;
    }
    new Notice(`已迁移 ${migrated} 张卡片到 Spaced Repetition${skipped ? '；跳过 ' + skipped + ' 张' : ''}。`);
  }

  async reviewCards() {
    const backend = this.cardBackend();
    if (backend === 'anki') return this.syncAnki();
    if (backend === 'toolkit') {
      const today = todayDate();
      const card = this.getIRRows().find(row =>
        isActiveIR(row.fm)
        && row.fm.type === 'card'
        && this._cardBackendFor(row.fm) === 'toolkit'
        && isDue(row.fm, today, this.settings));
      if (!card) { new Notice('没有到期的工具包卡片。'); return false; }
      await this._openLearningFile(card.tfile, 'card');
      return true;
    }
    if (!this.app.commands.executeCommandById(SPACED_REPETITION_REVIEW_COMMAND)) {
      new Notice('Spaced Repetition 仍在启动中。请重新加载 Obsidian 后重试。');
      return false;
    }
    return true;
  }

  async _reviewCardFile(file, frontmatter = getFm(this.app, file)) {
    const backend = this._cardBackendFor(frontmatter);
    if (backend === 'toolkit') return this._gradeToolkitCard(file, frontmatter);
    if (backend === 'anki') {
      this.syncAnki({ paths: [file.path] });
      new Notice('此卡片在 Anki 中复习。');
      return false;
    }
    return this.reviewCardsInNote(file);
  }

  async _gradeToolkitCard(file, frontmatter) {
    const content = await this.app.vault.cachedRead(file);
    let body = content.slice(frontmatterEndOffset(content));
    const marker = body.indexOf(BODY_MARKER);
    if (marker >= 0) body = body.slice(marker + BODY_MARKER.length);
    body = body.trim();
    let question = body;
    let answer = body;
    let hideLabels = false;
    let directGrade = false;
    if (frontmatter.card_format === 'occlusion') {
      answer = frontmatter.occlusion_image ? `![[${frontmatter.occlusion_image}]]` : body;
      hideLabels = true;
      directGrade = true;
    } else if (frontmatter.card_format === 'cloze') {
      answer = body.replace(new RegExp(HL_CLOZE_SRC, 'g'), '**$1**');
      question = body.replace(new RegExp(HL_CLOZE_SRC, 'g'), '**[ … ]**');
    } else {
      const match = body.match(/^([\s\S]*?)\n\n> \[!answer\][^\n]*\n([\s\S]*?)$/);
      if (match) {
        question = match[1].trim();
        answer = match[2].replace(/^> ?/gm, '').trim();
      }
    }
    const grade = await reviewCard(this.app, {
      title: file.basename,
      sourcePath: file.path,
      questionMd: question,
      answerMd: answer,
      hideLabels,
      directGrade,
    });
    if (!grade) return false;
    const reviewedOn = todayDateString(this.settings);
    const previous = parseDateValue(frontmatter.last_reviewed, this.settings);
    const elapsed = previous ? Math.max(0, daysBetween(todayDate(), previous)) : 0;
    const next = fsrsCore.scheduleFsrsReview(frontmatter, grade, elapsed, this.settings.fsrs);
    await this.app.fileManager.processFrontMatter(file, current => {
      current.ir_card_backend = 'toolkit';
      current.stability = next.stability;
      current.difficulty = next.difficulty;
      current.last_grade = grade;
      current.last_retrievability = next.retrievability;
      current.last_reviewed = reviewedOn;
      current.next_review = futureDateString(next.interval, this.settings);
      current.interval = next.interval;
      current.review_count = (Number(current.review_count) || 0) + 1;
      if (current.status === 'pending' || current.status === 'inbox') current.status = 'active';
    });
    await this.consumeSessionItem(file.path, { background: true });
    this._invalidateIRCollection();
    new Notice(`卡片已复习 · ${['', '重来', '困难', '良好', '简单'][grade]} · 下次在 ${next.interval} 天后。`);
    return true;
  }

  async reviewCardsInNote(file = this.app.workspace.getActiveFile()) {
    const active = file;
    const generation = ++this.spacedRepetitionCloseGeneration;
    let baseline = active ? this.cardScheduleSignatures.get(active.path) : null;
    if (active) {
      if (baseline == null) {
        try {
          baseline = spacedRepetitionScheduleSignature(await this.app.vault.cachedRead(active));
        } catch (error) {
          console.error('[IR] could not read Spaced Repetition baseline', error);
          baseline = '';
        }
      }
    }
    this.pendingSpacedRepetitionReview = active
      ? { path: active.path, baseline, reviewed: false, expiresAt: Date.now() + 10 * 60 * 1000, generation, verifying: false }
      : null;
    if (!this.app.commands.executeCommandById(SPACED_REPETITION_NOTE_COMMAND)) {
      this.pendingSpacedRepetitionReview = null;
      new Notice('打开一篇卡片笔记，待 Spaced Repetition 初始化后重试。');
    }
  }

  async _confirmSpacedRepetitionReview(file, pending) {
    if (pending.verifying) return;
    pending.verifying = true;
    try {
      const content = await this.app.vault.cachedRead(file);
      if (this.pendingSpacedRepetitionReview?.generation !== pending.generation) return;
      const signature = spacedRepetitionScheduleSignature(content);
      if (signature === pending.baseline) return;
      pending.baseline = signature;
      pending.reviewed = true;
      this._closeSpacedRepetitionDeckMenuWhenReady(pending.generation);
    } catch (error) {
      console.error('[IR] could not verify Spaced Repetition review', error);
    } finally {
      if (this.pendingSpacedRepetitionReview?.generation === pending.generation) pending.verifying = false;
    }
  }

  _closeSpacedRepetitionDeckMenuWhenReady(generation) {
    const attempt = ++this.spacedRepetitionCloseAttempt;
    const deadline = Date.now() + 5000;
    const check = () => {
      if (generation !== this.spacedRepetitionCloseGeneration
          || attempt !== this.spacedRepetitionCloseAttempt) return;
      const tabLeaves = this.app.workspace.getLeavesOfType(SPACED_REPETITION_TAB_VIEW);
      const modal = activeDocument.querySelector('#sr-modal-view');
      if (!tabLeaves.length && !modal) return;

      const deckMenu = activeDocument.querySelector('.sr-deck-container:not(.sr-is-hidden)');
      if (deckMenu) {
        const pending = this.pendingSpacedRepetitionReview?.generation === generation
          ? this.pendingSpacedRepetitionReview
          : null;
        for (const leaf of tabLeaves) leaf.detach();
        const closeButton = (modal?.closest('.modal-container') || modal)
          ?.querySelector('.modal-close-button');
        closeButton?.click();
        if (pending?.reviewed) this.consumeSessionItem(pending.path, { background: true });
        if (pending) this.pendingSpacedRepetitionReview = null;
        this.spacedRepetitionCloseGeneration++;
        if (pending?.reviewed) new Notice('卡片已复习。准备好后运行「下一元素」。');
        return;
      }
      if (Date.now() < deadline) window.setTimeout(check, 50);
    };
    window.setTimeout(check, 50);
  }

  openUserGuide() {
    new UserGuideModal(this.app).open();
  }

  cardBackend() {
    return cardProviderCore.normalizeCardBackend(this.settings.flashcards?.backend);
  }

  cardBackendLabel(backend = this.cardBackend()) {
    return ({
      toolkit: '工具包内置卡片',
      anki: 'Anki 集成',
      spaced_repetition: 'Spaced Repetition 集成',
    })[backend];
  }

  isCardBackendReady(backend = this.cardBackend()) {
    if (backend === 'anki') return this.isFlashcardsReady();
    if (backend === 'spaced_repetition') return this.isSpacedRepetitionReady();
    return true;
  }

  isFlashcardsReady() {
    const commands = this.app.commands.listCommands?.() || [];
    return commands.some(command => command.id === FLASHCARDS_GENERATE_COMMAND);
  }

  isSpacedRepetitionReady() {
    const commands = this.app.commands.listCommands?.() || [];
    const ids = new Set(commands.map(command => command.id));
    return ids.has(SPACED_REPETITION_REVIEW_COMMAND) && ids.has(SPACED_REPETITION_NOTE_COMMAND);
  }

  runSetupCheck() {
    const issues = [];
    const notes = [];
    const backend = this.cardBackend();
    if (backend === 'anki' && !this.isFlashcardsReady()) {
      issues.push('启用 Flashcards by Reuseman。同步时 Anki 与 AnkiConnect 必须处于运行状态。');
    }
    if (backend === 'spaced_repetition' && !this.isSpacedRepetitionReady()) {
      issues.push('启用 Spaced Repetition 以进行卡片复习。');
    }
    const vaultPaths = [
      ['来源', this.sourcesFolder()],
      ['摘录', this.extractsFolder()],
      ['卡片', this.cardsFolder()],
      ['附件', this.attachmentsFolder()],
      ['分类', this.categoriesFolder()],
    ];
    const normalized = vaultPaths.map(([, path]) => path.toLowerCase());
    if (new Set(normalized).size !== normalized.length) issues.push('库文件夹必须使用不同的路径。');
    if (!(Number(this.settings.scheduling.a_factor_min) > 1)) issues.push('A 因子最小值必须大于 1。');
    if (!(Number(this.settings.scheduling.a_factor_max) >= Number(this.settings.scheduling.a_factor_min))) {
      issues.push('A 因子最大值不得小于最小值。');
    }
    if (backend === 'spaced_repetition'
        && this._spacedRepetitionSettings().multilineCardSeparator === this._spacedRepetitionSettings().multilineReversedCardSeparator) {
      issues.push('基础卡片和双向卡片的分隔符必须不同。');
    }
    if (backend === 'anki' && !String(this.settings.anki.deck || '').trim()) issues.push('Anki 目标牌组不能为空。');
    try {
      const inline = this.settings.inline_cards;
      const qa = new RegExp(inline.qa_regex);
      new RegExp(inline.cloze_regex, 'g');
      if (qa.global) issues.push('行内 Q::A 正则表达式不得使用全局标志。');
    } catch (error) {
      issues.push(`行内卡片正则表达式无效：${error.message}`);
    }
    if (issues.length) {
      new Notice(`配置需要处理：\n- ${issues.join('\n- ')}`, 12000);
      return false;
    }
    const detail = notes.length ? `\n${notes.join('\n')}` : '';
    new Notice(`配置就绪。日期格式：${configuredDateFormat(this.settings)}。已选择 ${this.cardBackendLabel()}。${detail}`, 8000);
    return true;
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async migrateDateFormat(fromFormat, toFormat) {
    const keys = ['next_review', 'last_reviewed', 'date_added', 'date_done', 'date_dismissed', 'today_session_date'];
    const files = new Map(this.getIRFiles().map(file => [file.path, file]));
    const dashboard = this.app.vault.getAbstractFileByPath(this.dashboardPath());
    if (dashboard instanceof TFile) files.set(dashboard.path, dashboard);
    let changed = 0;
    for (const file of files.values()) {
      if (!getFm(this.app, file)) continue;
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        for (const key of keys) {
          if (!fm[key]) continue;
          const next = dateCore.reformatDate(fm[key], fromFormat, toFormat);
          if (next !== fm[key]) { fm[key] = next; changed++; }
        }
        if (Array.isArray(fm.checkpoints)) {
          for (const checkpoint of fm.checkpoints) {
            if (!checkpoint?.date) continue;
            const next = dateCore.reformatDate(checkpoint.date, fromFormat, toFormat);
            if (next !== checkpoint.date) { checkpoint.date = next; changed++; }
          }
        }
      });
    }
    const logFile = this.app.vault.getAbstractFileByPath(this.reviewLogPath());
    if (logFile instanceof TFile) {
      await this.app.vault.process(logFile, (content) => content.split('\n').map(line => {
        const match = line.match(/^(\|\s*)([^|]+?)(\s*\|)/);
        if (!match) return line;
        const value = match[2].trim();
        const next = dateCore.reformatDate(value, fromFormat, toFormat);
        if (next === value) return line;
        changed++;
        return match[1] + next + match[3] + line.slice(match[0].length);
      }).join('\n'));
    }
    return changed;
  }

  // Debug logging — silent unless the user enables it in settings. Keeps the
  // default console clean (Obsidian guideline: only errors by default).
  _dbg(...args) {
    if (this.settings?.misc?.debug) console.log('[Incremental Reading Toolkit]', ...args);
  }

  _invalidateIRCollection(filesChanged = false) {
    if (filesChanged) {
      this.irFilesCache = null;
      this.irMetadataSignatures.clear();
    }
    this.irRowsCache = null;
    this.treeIndexCache = null;
    this.duePoolCache = null;
    this.irCollectionRevision++;
  }

  getIRFiles() {
    if (!this.irFilesCache) this.irFilesCache = getAllIRFiles(this.app, this.settings);
    return this.irFilesCache;
  }

  getIRRows() {
    if (!this.irRowsCache) {
      this.irRowsCache = this.getIRFiles().map(tfile => ({
        tfile,
        file: tfile,
        fm: getFm(this.app, tfile),
      })).filter(row => row.fm);
      for (const row of this.irRowsCache) {
        this.irMetadataSignatures.set(row.tfile.path, irViewSignature(this.app, row.tfile));
      }
    }
    return this.irRowsCache;
  }

  async _cardIsDue(file, today) {
    const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const key = `${dateKey}:${file.stat?.mtime || 0}:${file.stat?.size || 0}`;
    const cached = this.cardDueCache.get(file.path);
    if (cached?.key === key) return cached.promise;

    const promise = this.app.vault.cachedRead(file).then(content => {
      this.cardScheduleSignatures.set(file.path, spacedRepetitionScheduleSignature(content));
      return spacedRepetitionCardIsDue(content, today);
    });
    this.cardDueCache.set(file.path, { key, promise });
    try {
      return await promise;
    } catch (error) {
      if (this.cardDueCache.get(file.path)?.promise === promise) this.cardDueCache.delete(file.path);
      throw error;
    }
  }

  _cardCanJoinQueue(frontmatter) {
    if (this.settings.queue.mix_cards === false) return false;
    const backend = this._cardBackendFor(frontmatter);
    if (backend === 'anki') return false;
    return backend !== 'spaced_repetition' || this.isSpacedRepetitionReady();
  }

  async _cardDueByBackend(item, today) {
    const backend = this._cardBackendFor(item.fm);
    if (backend === 'toolkit') return isDue(item.fm, today, this.settings);
    if (backend === 'spaced_repetition') return this._cardIsDue(item.tfile, today);
    return false;
  }

  // ---- Next / Random -----------------------------------------------------

  async buildDuePool({ skipCurrent = true } = {}) {
    const today = todayDate();
    const active = this.app.workspace.getActiveFile();
    const dateKey = todayDateString(this.settings);
    const mixCards = this.settings.queue.mix_cards !== false;
    const srReady = this.isSpacedRepetitionReady();
    const key = `${dateKey}:${this.irCollectionRevision}:${mixCards}:${srReady}`;
    if (this.duePoolCache?.key !== key) {
      const promise = (async () => {
        const candidates = [];
        for (const { tfile: f, fm } of this.getIRRows()) {
          if (!isActiveIR(fm)) continue;
          if (fm.type === 'card') {
            if (!this._cardCanJoinQueue(fm)) continue;
          } else if (!isDue(fm, today, this.settings)) continue;
          candidates.push({ tfile: f, fm });
        }
        return filterAsyncConcurrent(candidates, async item => {
          if (item.fm.type !== 'card') return true;
          return this._cardDueByBackend(item, today);
        });
      })();
      this.duePoolCache = { key, promise };
      promise.catch(() => {
        if (this.duePoolCache?.promise === promise) this.duePoolCache = null;
      });
    }
    const pool = await this.duePoolCache.promise;
    return skipCurrent && active ? pool.filter(item => item.tfile.path !== active.path) : pool.slice();
  }

  // Read the dashboard's session snapshot (path list persisted as
  // `today_session_paths`). Returns active, not-reviewed-today items in
  // snapshot order. Null if no fresh snapshot exists.
  async readSessionSnapshot() {
    const todayStr = todayDateString(this.settings);
    let paths = null;
    if (this.settings.session?.date === todayStr && Array.isArray(this.settings.session.paths)) {
      paths = this.settings.session.paths;
    } else {
      // One-way compatibility with session snapshots written by versions <=1.1.0.
      const dash = this.app.vault.getAbstractFileByPath(this.dashboardPath());
      const fm = dash ? getFm(this.app, dash) : null;
      if (fm?.today_session_date === todayStr && Array.isArray(fm.today_session_paths)) paths = fm.today_session_paths;
    }
    if (paths === null) return null;
    const today = todayDate();
    const candidates = [];
    const seen = new Set();
    for (const p of paths) {
      if (seen.has(p)) continue;   // drop duplicate snapshot keys
      seen.add(p);
      const tf = this.app.vault.getAbstractFileByPath(p);
      if (!tf) continue;
      const f = getFm(this.app, tf);
      if (!isActiveIR(f)) continue;
      if (f.last_reviewed === todayStr) continue;
      if (f.type === 'card') {
        if (!this._cardCanJoinQueue(f)) continue;
      } else if (!isDue(f, today, this.settings)) continue;
      candidates.push({ tfile: tf, fm: f });
    }
    return filterAsyncConcurrent(candidates, async item => {
      if (item.fm.type !== 'card') return true;
      return this._cardDueByBackend(item, today);
    });
  }

  async persistSessionSnapshot(queue) {
    const paths = queue.map(q => q.tfile?.path).filter(Boolean);
    const types = Object.fromEntries(queue
      .filter(item => item.tfile?.path && item.fm?.type)
      .map(item => [item.tfile.path, item.fm.type]));
    const readPoints = Object.fromEntries(queue
      .filter(item => item.tfile?.path && Number(item.fm?.read_point_line) > 0)
      .map(item => [item.tfile.path, Number(item.fm.read_point_line)]));
    this.settings.session = { date: todayDateString(this.settings), paths, types, readPoints };
    await this.saveSettings();
    const dash = this.app.vault.getAbstractFileByPath(this.dashboardPath());
    if (!dash) return;
    try {
      await this.app.fileManager.processFrontMatter(dash, (fm) => {
        fm.today_session_paths = paths;
        fm.today_session_date = todayDateString(this.settings);
      });
    } catch (e) {
      console.error('[IR] persistSessionSnapshot failed', e);
    }
  }

  buildInterleavedQueue(pool, today) {
    if (this.settings.queue.mix_cards === false) {
      return pool.filter(item => item.fm.type !== 'card').sort((a, b) => urgency(b.fm, today, this.settings) - urgency(a.fm, today, this.settings));
    }
    return topicCore.interleaveLearningItems(pool, item => urgency(item.fm, today, this.settings));
  }

  async consumeSessionItem(path, { background = false } = {}) {
    if (this.settings.session?.date !== todayDateString(this.settings)) return;
    this.settings.session.paths = (this.settings.session.paths || []).filter(value => value !== path);
    if (this.settings.session.types) delete this.settings.session.types[path];
    if (this.settings.session.readPoints) delete this.settings.session.readPoints[path];
    // Settings are the authoritative live session. The dashboard snapshot is
    // rebuilt only by Build today's session queue, avoiding a second vault
    // write on the grading path.
    if (!background) return this.saveSettings();
    this._scheduleSessionSave();
  }

  _scheduleSessionSave() {
    if (this.sessionSaveTimer) window.clearTimeout(this.sessionSaveTimer);
    this.sessionSaveTimer = window.setTimeout(() => {
      this.sessionSaveTimer = null;
      this.saveData(this.settings)
        .catch(error => console.error('[IR] background session persistence failed', error));
    }, 1500);
  }

  async _withDeferredCollectionRenders(callback, { flush = true } = {}) {
    this.collectionRenderDeferrals++;
    try {
      return await callback();
    } finally {
      this.collectionRenderDeferrals--;
      if (this.collectionRenderDeferrals === 0 && flush) this._flushDeferredCollectionRenders();
    }
  }

  _flushDeferredCollectionRenders() {
    for (const leaf of this.app.workspace.getLeavesOfType(IR_QUEUE_VIEW_TYPE)) {
      const view = leaf.view;
      if (view?.needsRowsRender) view._scheduleRowsRender('grade-complete');
    }
    for (const leaf of this.app.workspace.getLeavesOfType(MAIN_DASHBOARD_VIEW_TYPE)) {
      if (leaf.view?.needsRender) leaf.view._requestRender();
    }
    for (const type of [KNOWLEDGE_TREE_VIEW_TYPE, KNOWLEDGE_TREE_SIDEBAR_TYPE]) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        if (leaf.view?.needsRender) leaf.view._requestBodyRender();
      }
    }
  }

  _markCollectionViewsStale({ queue = true, dashboard = true, tree = false } = {}) {
    if (queue) {
      for (const leaf of this.app.workspace.getLeavesOfType(IR_QUEUE_VIEW_TYPE)) {
        leaf.view?._invalidateQueueModel?.();
        if (leaf.view) leaf.view.needsRowsRender = true;
      }
    }
    if (dashboard) {
      for (const leaf of this.app.workspace.getLeavesOfType(MAIN_DASHBOARD_VIEW_TYPE)) {
        if (leaf.view) leaf.view.needsRender = true;
      }
    }
    if (tree) {
      for (const type of [KNOWLEDGE_TREE_VIEW_TYPE, KNOWLEDGE_TREE_SIDEBAR_TYPE]) {
        for (const leaf of this.app.workspace.getLeavesOfType(type)) {
          if (leaf.view) leaf.view.needsRender = true;
        }
      }
    }
  }

  async openLearningItem(item) {
    if (!item?.tfile) return;
    await this._openLearningFile(item.tfile, item.fm.type, item.fm.read_point_line);
  }

  async _openLearningFile(file, type, readPointLine = 0) {
    this.directQueueNavigationDepth++;
    this.directQueueNavigation = true;
    try {
      await this.app.workspace.getLeaf(false).openFile(file);
      window.setTimeout(() => {
        if (this.app.workspace.getActiveFile()?.path !== file.path) return;
        if (type === 'card') this._reviewCardFile(file);
        else if (type === 'source' && Number(readPointLine) > 0) {
          const editor = getEditorForFile(this.app, file);
          const line = Math.max(0, Number(readPointLine) - 1);
          editor?.setCursor({ line, ch: 0 });
          editor?.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
        }
      }, 60);
    } finally {
      window.setTimeout(() => {
        this.directQueueNavigationDepth = Math.max(0, this.directQueueNavigationDepth - 1);
        this.directQueueNavigation = this.directQueueNavigationDepth > 0;
      }, 1000);
    }
  }

  async buildSessionQueue({ openFirst = false } = {}) {
    const pool = await this.buildDuePool({ skipCurrent: false });
    const queue = this.buildInterleavedQueue(pool, todayDate());
    await this.persistSessionSnapshot(queue);
    this._markCollectionViewsStale();
    this._flushDeferredCollectionRenders();
    if (!queue.length) { new Notice('✨ 没有到期内容，已全部跟上。'); return; }
    new Notice(`已构建今日队列，共 ${queue.length} 个元素${queue.length === 1 ? '' : ''}。`);
    if (openFirst) await this.nextElement({ fromStart: true });
  }

  async nextElement({ fromStart = false } = {}) {
    const session = this.settings.session;
    if (session?.date !== todayDateString(this.settings) || !Array.isArray(session.paths)) {
      new Notice("今日没有已保存的队列。请先运行「构建今日会话队列」。");
      return;
    }
    const today = todayDateString(this.settings);
    const active = this.app.workspace.getActiveFile();
    const activePath = active?.path;
    // enhance：先算好下一批再评级，避免评级把当前项移出队列后回退到队首。
    const candidates = savedQueueCandidates(session.paths, activePath, fromStart);
    // enhance：当前这篇属于今日队列、今天却还没有记忆状态时，直接弹出评级；不选就不前进。
    if (!fromStart && activePath && session.paths.includes(activePath)) {
      const activeFm = active ? getFm(this.app, active) : null;
      const settled = !!activeFm && (
        activeFm.last_reviewed === today ||
        activeFm.status === 'done' ||
        activeFm.status === 'dismissed' ||
        activeFm.status === 'container'
      );
      if (!settled) {
        const graded = await this.gradeCurrent();
        if (!graded) { new Notice('还没有记录记忆状态，留在这一篇。'); return; }
      }
    }
    const next = candidates
      .map(path => this.app.vault.getAbstractFileByPath(path))
      .find(file => file instanceof TFile);
    if (!next) {
      const pending = session.paths.filter((path) => {
        const f = this.app.vault.getAbstractFileByPath(path);
        const rowFm = f instanceof TFile ? getFm(this.app, f) : null;
        if (!rowFm) return false;
        return !(rowFm.last_reviewed === today || rowFm.status === 'done' || rowFm.status === 'dismissed' || rowFm.status === 'container');
      });
      new Notice(pending.length
        ? '队列里还有 ' + pending.length + ' 篇没记录记忆状态，今天不算做完。'
        : '✨ 已全部跟上。');
      return;
    }
    const nextType = session.types?.[next.path] || getFm(this.app, next)?.type;
    const readPointLine = session.readPoints?.[next.path] || 0;

    return this._openLearningFile(next, nextType, readPointLine);
  }

  async randomDue() {
    const pool = await this.buildDuePool();
    if (pool.length === 0) { new Notice('✨ 没有到期内容，已全部跟上。'); return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    await this.openLearningItem(pick);
    const action = pick.fm.type === 'card' ? '🃏 复习' : (pick.fm.type === 'source' ? '📖 阅读' : '📝 处理');
    new Notice(`🎲 ${action}：${pick.tfile.basename} · p${pick.fm.priority ?? '—'}（${pool.length} 个到期中的第 1 个）`);
  }

  async gradeCurrent() {
    return this._withDeferredCollectionRenders(async () => {
      const active = this.app.workspace.getActiveFile();
      const activeFrontmatter = getFm(this.app, active);
      if (activeFrontmatter?.type === 'card') {
        const backend = this._cardBackendFor(activeFrontmatter);
        if (backend === 'toolkit') return this._gradeToolkitCard(active, activeFrontmatter);
        if (backend === 'anki') new Notice('此卡片在 Anki 中复习。');
        else new Notice('当 Spaced Repetition 接受复习后，卡片会自动完成。');
        return false;
      }
      const graded = await this.endSession();
      if (graded) {
        if (active) this.consumeSessionItem(active.path, { background: true });
        new Notice('元素已评级。准备好后运行「下一元素」。');
      }
      // Let metadata notifications land while collection rendering is still
      // deferred. Views remain stale until a later explicit refresh.
      await new Promise(resolve => window.setTimeout(resolve, 0));
      return graded;
    }, { flush: false });
  }

  // ---- End Session (A-Factor topics; Toolkit cards use in-house FSRS) -----

  async endSession() {
    const active = this.app.workspace.getActiveFile();
    if (!active || active.extension !== 'md') {
      new Notice('请先打开一个渐进阅读来源、摘录或工具包卡片。');
      return;
    }
    const fm = getFm(this.app, active);
    if (!fm || !['source', 'extract', 'card'].includes(fm.type)) {
      new Notice('当前笔记不是渐进阅读元素。');
      return;
    }
    if (fm.type === 'card') return this._reviewCardFile(active, fm);
    const today = todayDateString(this.settings);
    return await this._gradeTopic(active, fm, today);
  }

  async _gradeTopic(file, fm, today) {
    let newReadPoint = fm.read_point;
    let newReadPointSeconds = fm.read_point_seconds;
    let previousReadPointLine = Number(fm.read_point_line) || 0;
    let newReadPointLine = previousReadPointLine;
    const isVideo = fm.type === 'source'
      && (fm.source_type === 'youtube' || fm.source_type === 'video' || fm.read_point_seconds != null);
    if (fm.type === 'source' && fm.read_point != null && !isVideo) {
      const rp = await askText(this.app, '你停在第几页', String(fm.read_point));
      if (rp === null) return;
      if (!/^[1-9]\d*$/.test(rp.trim())) { new Notice('请输入正整数页码。'); return; }
      newReadPoint = Number(rp);
    } else if (isVideo) {
      const cur = formatSeconds(Number(fm.read_point_seconds) || 0);
      const raw = await askText(this.app, '你停止处的时间戳（mm:ss 或 hh:mm:ss）', cur);
      if (raw === null) return;
      const parsed = parseTimeInput(raw);
      if (parsed == null) { new Notice('时间戳无效，请使用 mm:ss 或 hh:mm:ss。'); return; }
      newReadPointSeconds = parsed;
    }

    const isMarkdownSource = fm.type === 'source' && !fm.total_pages && !fm.pdf_path && !fm.pdf_vault_path && !fm.sioyek_path;
    if (isMarkdownSource) {
      const currentContent = await this.app.vault.cachedRead(file);
      if (!previousReadPointLine) previousReadPointLine = markerLineNumber(currentContent);
      if (!newReadPointLine) newReadPointLine = previousReadPointLine;
      const editor = getEditorForFile(this.app, file);
      const cursor = editor?.getCursor?.();
      if (editor && cursor) {
        const updateMarker = await confirmDialog(this.app, `将 📍 更新到第 ${cursor.line + 1} 行？`);
        if (updateMarker) {
          newReadPointLine = cursor.line + 1;
          await this.app.vault.process(file, (content) => {
            const fmEnd = frontmatterEndOffset(content);
            const lines = content.split('\n');
            let insertAt = 0;
            for (let i = 0; i < cursor.line; i++) insertAt += lines[i].length + 1;
            if (insertAt < fmEnd) insertAt = fmEnd;
            let stripped = content;
            const existing = [...content.matchAll(READ_POINT_RE)];
            if (existing.length) {
              for (const m of existing.reverse()) {
                stripped = stripped.slice(0, m.index) + stripped.slice(m.index + m[0].length);
                if (m.index < insertAt) insertAt -= m[0].length;
              }
            }
            return stripped.slice(0, insertAt) + READ_POINT_MARKER + stripped.slice(insertAt);
          });
          new Notice(`📍 已移动到第 ${cursor.line + 1} 行`);
        }
      }
    }

    const priority = fm.priority ?? 50;
    const s = this.settings.scheduling;

    // Capture pre-rep read position to drive stall guard.
    const prevReadPoint = Number(fm.read_point) || 0;
    const prevReadSeconds = Number(fm.read_point_seconds) || 0;

    const priorAFactor = readAFactor(this.settings, fm);
    const progressAF = s.progress_aware ? topicCore.progressAwareAFactor(fm, this.settings, {
      readPoint: newReadPoint,
      readPointSeconds: newReadPointSeconds,
    }) : null;
    const baseAF = progressAF != null ? progressAF : priorAFactor;

    const qualityFactor = await pickFromList(
      this.app,
      ['保持（不变）',
       `加快（×${s.quality_speed_up}，更早再见）`,
       `减慢（×${s.quality_slow_down}，往后推）`],
      [s.quality_hold, s.quality_speed_up, s.quality_slow_down],
      '这次读得怎么样？（决定下次间隔怎么调）'
    );
    if (qualityFactor == null) return;
    const aFactor = clampAFactor(this.settings, baseAF * qualityFactor);

    const priorReps = fm.review_count ?? 0;
    const reviewCount = priorReps + 1;
    const isFirstRep = priorReps === 0 || !(Number(fm.interval) > 0);

    let interval = isFirstRep
      ? priorityToInterval(priority)
      : Math.max(1, Math.round(Number(fm.interval) * aFactor));

    // Stall guard: no growth if read_point did not advance.
    if (s.stall_guard && !isFirstRep) {
      const advanced = topicCore.hasProgressAdvanced({
        previousPage: prevReadPoint,
        nextPage: newReadPoint ?? prevReadPoint,
        previousSeconds: prevReadSeconds,
        nextSeconds: newReadPointSeconds ?? prevReadSeconds,
        previousLine: previousReadPointLine,
        nextLine: newReadPointLine,
      });
      if (!advanced) interval = Math.min(interval, Number(fm.interval) || interval);
    }

    const nextReview = futureDateString(interval, this.settings);

    let markedDone = false;
    const chapterEnd = Number(fm.page_end) || null;
    const bookEnd = Number(fm.total_pages) || null;
    const target = chapterEnd || bookEnd;
    const vidTarget = Number(fm.total_seconds) || null;
    const reachedPages = fm.type === 'source' && target && newReadPoint != null && newReadPoint >= target;
    const reachedVideo = isVideo && vidTarget && newReadPointSeconds != null && newReadPointSeconds >= vidTarget;
    if (reachedPages || reachedVideo) {
      const unit = reachedVideo ? 'video' : (chapterEnd ? 'chapter' : 'source');
      markedDone = await confirmDialog(this.app, `将 ${unit} 标记为已完成？`);
    }

    await this.app.fileManager.processFrontMatter(file, (fmw) => {
      fmw.interval = interval;
      fmw.review_count = reviewCount;
      fmw.next_review = nextReview;
      fmw.last_reviewed = today;
      fmw.a_factor = round4(aFactor);
      if (newReadPoint !== undefined && newReadPoint !== null) fmw.read_point = newReadPoint;
      if (newReadPointSeconds !== undefined && newReadPointSeconds !== null) fmw.read_point_seconds = newReadPointSeconds;
      if (newReadPointLine > 0) fmw.read_point_line = newReadPointLine;
      if (markedDone) statusCore.completeItemFrontmatter(fmw, today, this._spacedRepetitionDeckTag());
      else if (fmw.status === 'inbox' || fmw.status === 'pending') fmw.status = 'active';
      for (const k of ['stability', 'difficulty', 'last_grade', 'last_retrievability', 'ease']) {
        if (fmw[k] !== undefined) delete fmw[k];
      }
    });

    // Keep the historical review-log columns stable. A-Factor before/after are
    // captured in the final columns for dashboard and script compatibility.
    const logFile = this.app.vault.getAbstractFileByPath(this.reviewLogPath());
    if (logFile) {
      const elapsedDays = (() => {
        const lr = parseDateValue(fm.last_reviewed, this.settings);
        const tdy = parseDateValue(today, this.settings);
        return (lr && tdy) ? Math.max(0, Math.round((tdy - lr) / 86400000)) : 0;
      })();
      const row = `| ${today} | [[${file.basename}]] | ${fm.type} | — | ${elapsedDays} |  |  |  | ${round4(priorAFactor)} | ${round4(aFactor)} |\n`;
      this.app.vault.append(logFile, row)
        .catch(error => console.error('[IR] background review-log append failed', error));
    }

    const typeLabel = fm.type === 'source' ? '来源' : '摘录';
    if (markedDone) {
      this.consumeSessionItem(file.path, { background: true });
      new Notice(`${typeLabel} 已标记为已完成。后续复习已清除。`);
    } else {
      new Notice(`${typeLabel}：优先级 ${priority} a=${round4(aFactor)} → ${interval} 天后（${nextReview}）`);
    }
    return true;
  }

  // Adaptive A-Factor tuning per SM canon. Multiplies a_factor by `factor`,
  // clamped to [settings.a_factor_min, settings.a_factor_max], persists to
  // frontmatter, and returns { from, to } when the value actually moved.
  async _bumpAFactor(file, fm, factor) {
    if (!fm || (fm.type !== 'source' && fm.type !== 'extract')) return null;
    const cur = readAFactor(this.settings, fm);
    const next = clampAFactor(this.settings, cur * factor);
    if (Math.abs(next - cur) < 0.005) return null;
    await this.app.fileManager.processFrontMatter(file, (fmw) => { fmw.a_factor = round4(next); });
    return { from: round4(cur), to: round4(next) };
  }

  // ---- Sidebar queue + checkpoints ---------------------------------------

  async _activateQueueView() {
    if (!this.settings.queue.sidebar_enabled) {
      new Notice('已在渐进阅读工具包设置中禁用侧边栏');
      return;
    }
    const leaves = this.app.workspace.getLeavesOfType(IR_QUEUE_VIEW_TYPE);
    if (leaves.length) {
      this.app.workspace.revealLeaf(leaves[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: IR_QUEUE_VIEW_TYPE });
    this.app.workspace.revealLeaf(leaf);
  }

  async _activateKnowledgeTree() {
    const existing = this.app.workspace.getLeavesOfType(KNOWLEDGE_TREE_VIEW_TYPE);
    if (existing.length) { this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: KNOWLEDGE_TREE_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async _activateKnowledgeTreeSidebar() {
    const existing = this.app.workspace.getLeavesOfType(KNOWLEDGE_TREE_SIDEBAR_TYPE);
    if (existing.length) { this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getLeftLeaf(false);
    await leaf.setViewState({ type: KNOWLEDGE_TREE_SIDEBAR_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  _refreshTreeViews() {
    for (const t of [KNOWLEDGE_TREE_VIEW_TYPE, KNOWLEDGE_TREE_SIDEBAR_TYPE]) {
      for (const leaf of this.app.workspace.getLeavesOfType(t)) {
        const v = leaf.view;
        if (v && typeof v._renderBody === 'function') v._renderBody();
        else if (v && typeof v._render === 'function') v._render();
      }
    }
  }

  isExpanded(key) { return (this.settings.tree.expanded || []).includes(key); }

  toggleExpanded(key) {
    const arr = this.settings.tree.expanded || (this.settings.tree.expanded = []);
    const i = arr.indexOf(key);
    if (i >= 0) arr.splice(i, 1); else arr.push(key);
    this.saveSettings();
  }

  // Build the tree index from every IR element. Duplicate basenames stay visible
  // as roots and cannot be used as parents until the user gives them unique names.
  buildTreeIndex() {
    if (this.treeIndexCache?.revision === this.irCollectionRevision) return this.treeIndexCache.index;
    const pages = [];
    for (const { tfile: f, fm } of this.getIRRows()) {
      const t = fm.type;
      if (t !== 'category' && t !== 'source' && t !== 'extract' && t !== 'card') continue;
      pages.push({ path: f.path, basename: f.basename, fm, tfile: f });
    }
    const index = treeCore.buildTreeIndex(pages);
    this.treeIndexCache = { revision: this.irCollectionRevision, index };
    return index;
  }

  async createCategory(parentName = null) {
    const name = await askText(this.app, '分类名称', '');
    if (!name) return null;
    const safe = slugifyForFolder(name);
    if (!safe) { new Notice('分类名称无效'); return null; }
    await ensureFolder(this.app, this.categoriesFolder());
    const path = `${this.categoriesFolder()}/${safe}.md`;
    if (this.app.vault.getAbstractFileByPath(path)) { new Notice('分类已存在'); return null; }
    const fm = ['---', 'type: category'];
    if (parentName) fm.push(`parent: ${JSON.stringify(`[[${parentName}]]`)}`);
    fm.push('tree_order: 0', 'tags:', '  - incremental-reading', '  - ir/category', '---', '', `# ${name}`, '');
    const file = await this.app.vault.create(path, fm.join('\n'));
    new Notice(`已创建分类：${name}`);
    return file;
  }

  async reparent(childPath, newParentName) {
    const child = this.app.vault.getAbstractFileByPath(childPath);
    if (!child) { new Notice('未找到节点'); return; }
    const idx = this.buildTreeIndex();
    if (newParentName && idx.duplicates.has(newParentName.toLowerCase())) {
      new Notice(`已拒绝：有多个节点名为「${newParentName}」`); return;
    }
    if (newParentName && treeCore.wouldCreateCycle(idx, child.basename, newParentName)) {
      new Notice('已拒绝：会形成循环'); return;
    }
    await this.app.fileManager.processFrontMatter(child, (fm) => {
      if (newParentName) {
        fm.parent = `[[${newParentName}]]`;
        delete fm.tree_root;
      } else {
        delete fm.parent;
        fm.tree_root = true;
      }
    });
    new Notice(newParentName ? `已移动到 ${newParentName} 下` : '已移动到顶层');
    this._refreshTreeViews();
  }

  async reparentActive() {
    const active = this.app.workspace.getActiveFile();
    if (!active || active.extension !== 'md') { new Notice('没有活跃的 Markdown 元素'); return; }
    return await this.reparentPath(active.path);
  }

  async reparentPath(path) {
    const active = this.app.vault.getAbstractFileByPath(path);
    if (!active || active.extension !== 'md') { new Notice('未找到树节点'); return false; }
    const fm = getFm(this.app, active);
    if (!fm || !['category', 'source', 'extract', 'card'].includes(fm.type)) {
      new Notice('节点不是渐进阅读元素'); return false;
    }
    const idx = this.buildTreeIndex();
    const candidates = idx.pages.filter(p =>
      p.fm.type !== 'card' && p.path !== active.path && !idx.duplicates.has(p.basename.toLowerCase()));
    const displays = candidates.map(p => `${TREE_ICONS[p.fm.type] || '•'} ${p.basename}`);
    const values = candidates.map(p => p.basename);
    displays.unshift('⤴ (top level / Unfiled)');
    values.unshift('::root::');
    const picked = await pickFromList(this.app, displays, values, '移动到…下');
    if (picked == null) return false;
    await this.reparent(active.path, picked === '::root::' ? null : picked);
    return true;
  }

  async reorderSibling(path, dir) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!f) return;
    const idx = this.buildTreeIndex();
    const page = treeCore.pageByPath(idx, path);
    if (!page) { new Notice('未找到树节点'); return false; }
    const parentName = treeCore.effectiveParent(page.fm);
    let siblings;
    if (parentName) {
      siblings = idx.childrenOf.get(parentName.toLowerCase()) || [];
    } else {
      // Root level renders in two visual groups: top-level categories, and the
      // Unfiled bucket (everything else). Reorder within the moved node's own group
      // so ↑/↓ matches what the user sees.
      const isCatRoot = (p) => p.fm.type === 'category' && !treeCore.effectiveParent(p.fm);
      const movedIsCatRoot = isCatRoot(page);
      siblings = idx.roots.filter(p => isCatRoot(p) === movedIsCatRoot);
    }
    const order = siblings.map(s => ({ path: s.path, tree_order: s.fm && s.fm.tree_order }));
    const curIdx = order.findIndex(s => s.path === path);
    if (curIdx < 0) { new Notice('无法在同级节点中定位此节点'); return false; }
    const targetIndex = curIdx + dir;
    if (targetIndex < 0 || targetIndex >= order.length) {
      new Notice(dir < 0 ? '已经是第一个同级节点' : '已经是最后一个同级节点');
      return false;
    }
    const writes = treeCore.computeReorder(order, path, targetIndex);
    for (const w of writes) {
      const tf = this.app.vault.getAbstractFileByPath(w.path);
      if (tf) await this.app.fileManager.processFrontMatter(tf, (fm) => { fm.tree_order = w.tree_order; });
    }
    this._refreshTreeViews();
    return true;
  }

  async renameTreeNode(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!f) return;
    const next = await askText(this.app, '新名称', f.basename);
    if (!next || next === f.basename) return;
    const safe = slugifyForFolder(next);
    if (!safe) { new Notice('名称无效'); return; }
    const dir = f.parent ? f.parent.path : '';
    const newPath = (dir ? dir + '/' : '') + safe + '.md';
    if (this.app.vault.getAbstractFileByPath(newPath)) { new Notice('已存在同名文件'); return; }
    await this.app.fileManager.renameFile(f, newPath);
    new Notice(`已重命名为 ${safe}`);
    this._refreshTreeViews();
  }

  async dismissTreeNode(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!f) return;
    if (getFm(this.app, f)?.type === 'card') {
      new Notice('卡片复习状态由 Spaced Repetition 管理。');
      return;
    }
    const ok = await confirmDialog(this.app, `搁置「${f.basename}」？`,
      '将状态设为：已搁置（保留在知识树中，从复习队列中移除）。');
    if (!ok) return;
    await this.app.fileManager.processFrontMatter(f, (fm) => { fm.status = 'dismissed'; });
    new Notice('已搁置');
    this._refreshTreeViews();
  }

  async markPathsDone(paths, { confirm = true } = {}) {
    const files = [...new Set(paths || [])]
      .map(path => this.app.vault.getAbstractFileByPath(path))
      .filter(file => file instanceof TFile && ['source', 'extract', 'card'].includes(getFm(this.app, file)?.type));
    const pending = files.filter(file => getFm(this.app, file)?.status !== 'done');
    if (!pending.length) { new Notice('所选项均已完成。'); return 0; }
    if (confirm) {
      const label = pending.length === 1 ? `"${pending[0].basename}"` : `${pending.length} 个所选项`;
      const ok = await confirmDialog(
        this.app,
        `将 ${label} 标记为已完成？`,
        '未来的复习日期将被清除。卡片也会离开 Spaced Repetition 牌组。'
      );
      if (!ok) return 0;
    }
    const today = todayDateString(this.settings);
    const deckTag = this._spacedRepetitionDeckTag();
    for (const file of pending) {
      await this.app.fileManager.processFrontMatter(file, fm => {
        statusCore.completeItemFrontmatter(fm, today, deckTag);
      });
      this.cardDueCache.delete(file.path);
      this.cardScheduleSignatures.delete(file.path);
      if (this.pendingSpacedRepetitionReview?.path === file.path) this.pendingSpacedRepetitionReview = null;
      this.consumeSessionItem(file.path, { background: true });
    }
    this._invalidateIRCollection();
    this._refreshTreeViews();
    new Notice(`${pending.length} 项${pending.length === 1 ? '' : 's'}已标记为已完成。未来复习已清除。`);
    return pending.length;
  }

  async resetPaths(paths, { confirm = true } = {}) {
    const files = [...new Set(paths || [])]
      .map(path => this.app.vault.getAbstractFileByPath(path))
      .filter(file => file instanceof TFile && ['source', 'extract', 'card'].includes(getFm(this.app, file)?.type));
    if (!files.length) { new Notice('未选择可重置的项。'); return 0; }
    if (confirm) {
      const label = files.length === 1 ? `"${files[0].basename}"` : `${files.length} 个所选项`;
      const ok = await confirmDialog(
        this.app,
        `重置 ${label}？`,
        '把它设回「进行中」并清空排期历史？下次会重新累计间隔，已进队列的内容按新内容重排。'
      );
      if (!ok) return 0;
    }
    const deckTag = this._spacedRepetitionDeckTag();
    for (const file of files) {
      const isCard = getFm(this.app, file)?.type === 'card';
      await this.app.fileManager.processFrontMatter(file, fm => {
        statusCore.resetItemFrontmatter(fm, deckTag);
      });
      if (isCard && this._cardBackendFor(getFm(this.app, file)) === 'spaced_repetition') {
        await this.app.vault.process(file, content => statusCore.clearSpacedRepetitionSchedule(content));
        this.cardDueCache.delete(file.path);
        this.cardScheduleSignatures.delete(file.path);
      }
    }
    this._invalidateIRCollection();
    this._refreshTreeViews();
    new Notice(`${files.length} 项${files.length === 1 ? '' : 's'}已重置。`);
    return files.length;
  }

  async seedInlineCards() {
    const active = this.app.workspace.getActiveFile();
    if (!active) { new Notice('没有活动文件'); return; }
    const cache = this.app.metadataCache.getFileCache(active);
    const fm = cache?.frontmatter;
    if (!fm || (fm.type !== 'source' && fm.type !== 'extract')) {
      new Notice('当前活动文件不是来源/摘录');
      return;
    }
    const body = await this.app.vault.cachedRead(active);
    let parsed;
    try {
      parsed = parseInlineCards(active.path, body, this.settings);
    } catch (error) {
      new Notice(error.message, 8000);
      return;
    }
    if (!parsed.length) { new Notice('未找到行内卡片'); return; }

    const grouped = new Map();
    for (const card of parsed) {
      const key = card.type === 'qa' ? card.id : inlineCardId(active.path, `line:${card.line}:${card.full_line}`);
      if (!grouped.has(key)) grouped.set(key, card);
    }
    const existingIds = new Set();
    for (const file of filesInFolder(this.app, this.cardsFolder())) {
      if (file.extension !== 'md') continue;
      const id = getFm(this.app, file)?.ir_inline_id;
      if (id) existingIds.add(String(id));
    }

    let created = 0;
    const clozeRegex = new RegExp(this.settings.inline_cards.cloze_regex, 'g');
    for (const [id, card] of grouped) {
      if (existingIds.has(id)) continue;
      let format = card.type === 'qa' ? 'basic' : 'cloze';
      let question = card.question;
      let answer = card.answer || '';
      if (format === 'cloze') {
        question = card.full_line.replace(clozeRegex, (_match, _index, text, hint) =>
          `==${text}==${hint ? `^[${hint}]` : ''}`
        );
      }
      await this._createCard(active, {
        format,
        question,
        answer,
        extraFrontmatter: [`ir_inline_id: ${JSON.stringify(id)}`],
      });
      existingIds.add(id);
      created++;
    }
    new Notice(created
      ? `已导出 ${created} 张行内卡片${created === 1 ? '' : 's'}到 ${this.cardBackendLabel()}`
      : '所有行内卡片均已导出');
  }

  async addCheckpoint(noteOverride) {
    const active = this.app.workspace.getActiveFile();
    if (!active) { new Notice('没有活动文件'); return; }
    const cache = this.app.metadataCache.getFileCache(active);
    if (!isActiveIR(cache?.frontmatter) || cache.frontmatter.type === 'card') {
      new Notice('检查点仅适用于来源和摘录。'); return;
    }

    let note = noteOverride;
    if (note == null) {
      note = await new Promise(resolve => {
        new TextPromptModal(this.app, '检查点备注（以 Nd:: 开头可覆盖间隔）', '', resolve).open();
      });
    }
    if (note == null) return;

    const editor = this.app.workspace.activeEditor?.editor;
    const line = editor ? editor.getCursor().line : 0;

    let interval = null;
    let cleanNote = note;
    const m = note.match(/^(\d+)d::\s*(.*)$/);
    if (m) { interval = Number(m[1]); cleanNote = m[2]; }

    await this.app.fileManager.processFrontMatter(active, (fm) => {
      fm.checkpoints = fm.checkpoints || [];
      fm.checkpoints.push({
        date: todayDateString(this.settings),
        line,
        note: cleanNote,
        ...(fm.type === 'source' && fm.read_point_seconds != null ? { read_point_seconds: fm.read_point_seconds } : {}),
      });
      if (interval != null) {
        fm.interval = interval;
        fm.next_review = futureDateString(interval, this.settings);
      }
    });

    new Notice(interval != null ? `检查点已保存，下次在 ${interval} 天后` : '检查点已保存');
  }

  // ---- Done / Dismiss / Postpone / Schedule ------------------------------

  async markDone() {
    const r = await resolveIRFromActive(this.app, this.settings, { allowCard: true, allowPdfFallback: true });
    if (!r) return;
    const { tfile, fm } = r;
    if (fm.status === 'done') { new Notice('已完成。'); return; }
    await this.markPathsDone([tfile.path]);
  }

  async resetCurrent() {
    const r = await resolveIRFromActive(this.app, this.settings, { allowCard: true, allowPdfFallback: true });
    if (!r) return;
    await this.resetPaths([r.tfile.path]);
  }

  async dismiss() {
    const r = await resolveIRFromActive(this.app, this.settings, { allowCard: false, allowPdfFallback: true });
    if (!r) return;
    const { tfile, fm } = r;
    if (fm.status === 'dismissed') { new Notice('已搁置。'); return; }
    await this.app.fileManager.processFrontMatter(tfile, (fmw) => {
      fmw.status = 'dismissed';
      fmw.date_dismissed = todayDateString(this.settings);
    });
    new Notice('已搁置：仍留在知识树，但不再出现在阅读队列。想恢复就打开它，用「当前元素操作… → 重置」。');
  }

  async postpone() {
    const r = await resolveIRFromActive(this.app, this.settings, { allowCard: false, allowPdfFallback: true });
    if (!r) return;
    const choice = await pickFromList(
      this.app,
      ['明天（+1 天）', '+3 days', '+1 week', '+2 weeks'],
      [1, 3, 7, 14],
      '推迟多久？'
    );
    if (!choice) return;
    const newDate = futureDateString(choice, this.settings);
    await this.app.fileManager.processFrontMatter(r.tfile, (fmw) => {
      fmw.next_review = newDate;
      fmw.interval = choice;
    });
    new Notice(`已推迟 +${choice} 天 · 下次复习：${newDate}`);
  }

  async schedule() {
    const r = await resolveIRFromActive(this.app, this.settings, { allowCard: false, allowPdfFallback: true });
    if (!r) return;
    const cur = r.fm.next_review || '(unscheduled)';
    const dateFormat = configuredDateFormat(this.settings);
    const raw = await askText(this.app, `排期（${dateFormat} 或 +Nd/-Nd；当前：${cur}）`, '');
    if (!raw || raw.trim() === '') return;
    const input = raw.trim();

    let newDate = null;
    const offset = input.match(/^([+-]?)(\d+)\s*d?$/i);
    if (offset) {
      const sign = offset[1] === '-' ? -1 : 1;
      newDate = futureDateString(sign * parseInt(offset[2], 10), this.settings);
    } else {
      const parsed = dateCore.parseDateExact(input, dateFormat);
      if (!parsed) { new Notice(`${dateFormat} 日期无效：${input}`); return; }
      newDate = formatDateValue(parsed, this.settings);
    }
    const newParsed = parseDateValue(newDate, this.settings);
    const newInterval = newParsed ? Math.max(1, Math.round((newParsed - todayDate()) / 86400000)) : null;
    await this.app.fileManager.processFrontMatter(r.tfile, (fmw) => {
      fmw.next_review = newDate;
      if (newInterval != null) fmw.interval = newInterval;
    });
    new Notice(`已排期：${cur} → ${newDate}`);
  }

  // ---- Set Priority / Boost ---------------------------------------------

  async setPriority() {
    const r = await resolveIRFromActive(this.app, this.settings, { allowCard: false, allowPdfFallback: true });
    if (!r) return;
    const cur = r.fm.priority ?? 50;
    const raw = await askText(this.app, '新优先级（1-100，1 为最高）', String(cur));
    if (raw === null) return;
    if (!/^\d+$/.test(raw.trim())) { new Notice('优先级无效 — 请输入 1-100 的整数。'); return; }
    const p = Number(raw);
    if (!Number.isInteger(p) || p < 1 || p > 100) { new Notice('优先级无效 — 请输入 1-100 的整数。'); return; }
    await this.app.fileManager.processFrontMatter(r.tfile, (fmw) => { fmw.priority = p; });
    new Notice(`优先级 → ${p}（next_review 不变 — 由 A 因子驱动）`);
  }

  async boost() {
    const r = await resolveIRFromActive(this.app, this.settings, { allowCard: false, allowPdfFallback: true });
    if (!r) return;
    const amount = await pickFromList(
      this.app,
      ['小（-5）', '中（-15）', '强（-30）', '自定义'],
      [5, 15, 30, 'custom'],
      '提升幅度'
    );
    if (!amount) return;
    let delta;
    if (amount === 'custom') {
      const raw = await askText(this.app, '提升幅度（1-99）', '10');
      if (!raw) return;
      if (!/^\d+$/.test(raw.trim())) { new Notice('提升幅度无效。'); return; }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 99) { new Notice('提升幅度无效。'); return; }
      delta = n;
    } else { delta = amount; }

    const cascade = await confirmDialog(this.app, '是否将提升级联到子树中的所有后代？');
    const orig = r.fm.priority ?? 50;
    const newPri = Math.max(1, orig - delta);
    await this.app.fileManager.processFrontMatter(r.tfile, (fmw) => {
      if (fmw.boost_from == null) fmw.boost_from = orig;
      fmw.priority = newPri;
    });

    let cascaded = 0;
    if (cascade) {
      const subtree = walkSubtree(this.app, this.settings, r.tfile.basename, r.tfile.path, { rows: this.getIRRows() });
      for (const p of subtree) {
        if (p.tfile.path === r.tfile.path) continue;
        if (p.fm.type === 'card') continue;
        const childOrig = p.fm.priority ?? 50;
        const childNew = Math.max(1, childOrig - delta);
        if (childNew !== childOrig) {
          await this.app.fileManager.processFrontMatter(p.tfile, (fmw) => {
            if (fmw.boost_from == null) fmw.boost_from = childOrig;
            fmw.priority = childNew;
          });
          cascaded++;
        }
      }
    }
    const cmsg = cascade ? ` + ${cascaded} 个后代${cascaded === 1 ? '' : 's'}` : '';
    new Notice(`已提升：${orig} → ${newPri}${cmsg}。boost_from 已保留。`);
  }

  // ---- Subset Review / Mercy / Postpone Subtree --------------------------

  async subsetReview() {
    const r = await resolveSourceFromActive(this.app, this.settings);
    if (!r) return;
    const filter = await pickFromList(
      this.app,
      ['所有主题', '仅到期/逾期'],
      ['all', 'due'],
      '筛选子树的依据'
    );
    if (!filter) return;

    const today = todayDate();
    let subset = walkSubtree(this.app, this.settings, r.tfile.basename, r.tfile.path, {
      includeCards: false,
      rows: this.getIRRows(),
    })
      .filter(p => p.tfile.path !== r.tfile.path);
    if (filter === 'due') subset = subset.filter(p => isDue(p.fm, today, this.settings));
    subset = subset.filter(p => p.fm.status !== 'done' && p.fm.status !== 'container' && p.fm.status !== 'dismissed');
    if (subset.length === 0) { new Notice(`没有匹配的后代。`); return; }

    subset.sort((a, b) => urgency(b.fm, today, this.settings) - urgency(a.fm, today, this.settings));
    const statusIcon = (fm) => {
      const nr = parseDateValue(fm.next_review, this.settings);
      if (!nr) return '⚪';
      const off = daysBetween(today, nr);
      return off > 0 ? '🔴' : (off === 0 ? '🟡' : '🟢');
    };
    const picked = await pickFuzzy(
      this.app,
      subset,
      p => {
        const t = p.fm.type === 'source' ? '📖' : '📝';
        return `${t} ${statusIcon(p.fm)} p${p.fm.priority ?? '—'} u${urgency(p.fm, today, this.settings).toFixed(0)}  ${p.tfile.basename}`;
      },
      `子集（${r.tfile.basename}）`
    );
    if (!picked) return;
    await this.app.workspace.getLeaf(false).openFile(picked.tfile);
  }

  async mercy() {
    const choice = await pickFromList(
      this.app, ['3 days', '7 days', '14 days', '30 days'], [3, 7, 14, 30], '分摊窗口'
    );
    if (!choice) return;
    const today = todayDate();
    const overdue = [];
    for (const { tfile: f, fm } of this.getIRRows()) {
      if (!isActiveIR(fm) || fm.type === 'card') continue;
      if (!isPastDue(fm, today, this.settings)) continue;
      overdue.push({ tfile: f, fm });
    }
    if (overdue.length === 0) { new Notice('没有逾期项。'); return; }
    overdue.sort((a, b) => urgency(b.fm, today, this.settings) - urgency(a.fm, today, this.settings));
    let updated = 0;
    for (let rank = 0; rank < overdue.length; rank++) {
      const off = Math.floor(rank * choice / overdue.length);
      const d = new Date(today.getTime()); d.setDate(d.getDate() + off);
      const newDate = formatDateValue(d, this.settings);
      await this.app.fileManager.processFrontMatter(overdue[rank].tfile, (fmw) => { fmw.next_review = newDate; fmw.interval = Math.max(1, off); });
      updated++;
    }
    new Notice(`宽限：${updated} 个逾期项分摊到 ${choice} 天。`);
  }

  async postponeSubtree() {
    const r = await resolveSourceFromActive(this.app, this.settings);
    if (!r) return;
    const choice = await pickFromList(
      this.app,
      ['+1d', '+3d', '+1 week', '+2 weeks', '+1 month'],
      [1, 3, 7, 14, 30],
      '将子树推迟多久'
    );
    if (!choice) return;
    const subtree = walkSubtree(this.app, this.settings, r.tfile.basename, r.tfile.path, { rows: this.getIRRows() });
    let postponed = 0;
    for (const p of subtree) {
      const fm = p.fm;
      if (fm.type === 'card') continue;
      if (fm.status === 'done' || fm.status === 'container' || fm.status === 'dismissed') continue;
      let baseDate = todayDateString(this.settings);
      if (fm.next_review) {
        const candidate = parseDateValue(fm.next_review, this.settings);
        if (candidate && candidate > todayDate()) baseDate = fm.next_review;
      }
      const baseObj = parseDateValue(baseDate, this.settings) || todayDate();
      baseObj.setDate(baseObj.getDate() + choice);
      const newDate = formatDateValue(baseObj, this.settings);
      await this.app.fileManager.processFrontMatter(p.tfile, (fmw) => { fmw.next_review = newDate; });
      postponed++;
    }
    new Notice(`子树已推迟 +${choice} 天 · ${postponed} 个元素${postponed === 1 ? '' : 's'}。`);
  }

  // ---- Extract / Flashcard ------------------------------------------------

  async extractClipboard() {
    await this._createExtract(true);
  }

  async extractSelection() {
    const active = this.app.workspace.getActiveFile();
    if (!active || active.extension !== 'md') {
      new Notice('摘录所选内容需要打开一个 Markdown 来源。');
      return;
    }
    const fm = getFm(this.app, active);
    if (fm?.type !== 'source') { new Notice('请从来源笔记中运行。'); return; }
    const editor = getEditorForFile(this.app, active);
    const selection = editor?.getSelection?.() || '';
    if (!selection.trim()) { new Notice('未选择文本。'); return; }
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    const selectedText = selection.trim();
    const created = await this._writeExtract(active, fm, selectedText);
    if (!created) return;
    if (editor.getRange(from, to).trim() !== selectedText) {
      new Notice('已创建摘录，但来源在其段落被高亮之前发生了变化。');
      return;
    }
    editor.replaceRange(excerptHighlightMarkup(editor.getRange(from, to)), from, to);
  }

  async _createExtract(fromClipboard) {
    const r = await resolveSourceOrExtractFromActive(this.app, this.settings);
    if (!r) return;
    let clip = '';
    try { clip = (await navigator.clipboard.readText()).trim(); }
    catch (e) { new Notice('无法读取剪贴板。'); return; }
    if (!clip) { new Notice('剪贴板为空。'); return; }
    await this._writeExtract(r.tfile, r.fm, clip);
  }

  async _writeExtract(sourceFile, fm, body) {
    const sourceTitle = sourceFile.basename;
    const safeSourceTitle = slugifyForFolder(sourceTitle) || '未命名';
    const extractsFolder = this.extractsFolder();
    await ensureFolder(this.app, extractsFolder);
    const priority = fm.priority ?? 50;
    const today = todayDateString(this.settings);
    const existing = filesInFolder(this.app, extractsFolder).filter(f =>
      f.extension === 'md' && f.basename.startsWith(safeSourceTitle + ' - 摘录'));
    let n = existing.length + 1;
    let name = `${safeSourceTitle} - 摘录 ${n}`;
    while (this.app.vault.getAbstractFileByPath(`${extractsFolder}/${name}.md`)) {
      name = `${safeSourceTitle} - 摘录 ${++n}`;
    }
    const autoInterval = priorityToInterval(priority);

    const customStr = await askText(this.app, `首次间隔天数（留空则自动：${autoInterval} 天）`, '');
    if (customStr === null) return false;
    if (customStr.trim() && !/^[1-9]\d*$/.test(customStr.trim())) {
      new Notice('间隔无效 — 请输入正整数天数。'); return false;
    }
    const interval = customStr.trim() ? Number(customStr) : autoInterval;
    const nextReview = futureDateString(interval, this.settings);

    const content = `---
type: extract
source: ${JSON.stringify(`[[${sourceTitle}]]`)}
status: pending
priority: ${priority}
next_review: ${nextReview}
interval: ${interval}
a_factor: 2.0
review_count: 0
last_reviewed:
date_added: ${today}
tags:
  - incremental-reading
  - ir/extract
---

${body}
`;
    const path = `${extractsFolder}/${name}.md`;
    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(`摘录已存在于 ${path}`); return false;
    }
    await this.app.vault.create(path, content);
    const decayCap = Math.min(100, priority + 30);
    const newPri = Math.min(decayCap, priority + 1);
    if (newPri !== priority) {
      await this.app.fileManager.processFrontMatter(sourceFile, (fmw) => { fmw.priority = newPri; });
    }
    const bump = await this._bumpAFactor(sourceFile, fm, this.settings.scheduling.extract_bump);
    const bumpMsg = bump ? ` · a ${bump.from}→${bump.to}` : '';
    new Notice(`摘录：${name} · p${priority}→${newPri} · 复习 +${interval} 天（${nextReview}）${bumpMsg}`);
    return true;
  }

  async flashcardClipboard() {
    this._dbg('flashcardClipboard start');
    const r = await resolveSourceOrExtractFromActive(this.app, this.settings);
    if (!r) return;
    const parentFile = r.tfile;
    const fm = r.fm;

    // Image clipboard branch: build image-based card with prompted answer.
    const imgClip = await readImageFromClipboard();
    if (imgClip) {
      return await this._flashcardFromImage(parentFile, fm, { imgClip });
    }

    let clip = '';
    try { clip = (await navigator.clipboard.readText()).trim(); }
    catch (e) { new Notice('无法读取剪贴板。'); return; }
    if (!clip) { new Notice('剪贴板为空（无文本或图片）。'); return; }
    this._dbg('flashcard: clip length', clip.length, 'inline-match', /^[^\n]+::[^\n]+$/.test(clip));

    const parentTitle = parentFile.basename;
    let cardFormat = null, questionText = null, answerText = null;

    const COLON = ':';
    const inlineRe = new RegExp(`^[^\\n]+${COLON}${COLON}[^\\n]+$`);
    if (inlineRe.test(clip) && !clip.includes('\n')) {
      const parts = clip.split(COLON + COLON);
      questionText = parts[0].trim();
      answerText = parts.slice(1).join(COLON + COLON).trim();
      cardFormat = 'basic';
    } else if (/\n\?\n/.test(clip)) {
      const parts = clip.split(/\n\?\n/);
      questionText = parts[0].trim();
      answerText = parts.slice(1).join('\n?\n').trim();
      cardFormat = 'basic';
    } else {
      cardFormat = await pickFromList(
        this.app,
        ['填空删除（Wozniak 第 5 条规则 — 推荐）',
         '基础问答（问题 + 隐藏答案）',
         '基础反向（词汇对）'],
        ['cloze', 'basic', 'reverse'],
        '卡片格式'
      );
      this._dbg('flashcard: cardFormat =', JSON.stringify(cardFormat));
      if (!cardFormat) return;
      if (cardFormat === 'cloze') {
        this._dbg('flashcard: about to open cloze keyword prompt');
        const kw = await askText(this.app, '要填空的单词（逗号分隔；留空 = 手动编辑）', '');
        this._dbg('flashcard: kw returned =', JSON.stringify(kw));
        if (kw === null) return;
        let text = clip;
        const keywords = kw.split(',').map(w => w.trim()).filter(Boolean);
        const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (keywords.length) {
          const missing = [];
          for (const w of keywords) {
            const re = new RegExp(`\\b${escape(w)}\\b`);
            if (!re.test(text)) { missing.push(w); continue; }
            text = text.replace(re, `==${w}==`);
          }
          if (missing.length === keywords.length) {
            const edited = await askText(this.app, '编辑文本 — 用 ==标记== 包住单词', clip);
            if (!edited) return;
            text = edited;
          }
        } else {
          const edited = await askText(this.app, '编辑文本 — 用 ==标记== 包住单词', clip);
          if (!edited) return;
          text = edited;
        }
        if (!new RegExp(HL_CLOZE_SRC).test(text)) { new Notice('没有 ==标记== — 已中止。'); return; }
        questionText = text;
      } else {
        answerText = await askText(this.app, '答案（第 4 条规则：保持简短）', '');
        if (!answerText || !answerText.trim()) return;
        questionText = clip.replace(/\n+/g, ' ');
        answerText = answerText.trim();
      }
    }

    if (cardFormat !== 'cloze') {
      const prefix = await askText(this.app, "上下文标签（可选，例如 'bioch:' — 第 16 条规则）", '');
      if (prefix === null) return;
      if (prefix.trim()) {
        const pfx = prefix.trim().replace(/:?\s*$/, ':');
        questionText = `${pfx} ${questionText}`;
      }
    }

    const created = await this._createCard(parentFile, {
      format: cardFormat,
      question: questionText,
      answer: answerText,
    });
    const kind = cardFormat === 'reverse' ? '双向卡片' : (cardFormat === 'cloze' ? '填空卡片' : '卡片');
    new Notice(`${kind} 已使用 ${this.cardBackendLabel()} 创建：${created.name}`);
  }

  // Build a basic image-based flashcard (image is the question, user supplies
  // text answer). Image saved into the parent's attachment folder, embedded
  // via vault-relative wikilink. Pass either { imgClip } (binary from clipboard)
  // or { vaultPath } (existing image already in vault). skipCaption=true omits
  // the caption prompt — used for the pure "name this image" flashcard type.
  async _flashcardFromImage(parentFile, fm, { imgClip, vaultPath, skipCaption } = {}) {
    const parentTitle = parentFile.basename;

    let imgPath;
    if (imgClip) {
      const ext = imgClip.mime === 'image/jpeg' ? 'jpg'
        : (imgClip.mime === 'image/webp' ? 'webp' : 'png');
      const attachDir = `${this.attachmentsFolder()}/${slugifyForFolder(parentTitle)}`;
      await ensureFolder(this.app, attachDir);
      const hash = await shortHashOfBytes(imgClip.bytes);
      imgPath = `${attachDir}/img-${hash}.${ext}`;
      if (!this.app.vault.getAbstractFileByPath(imgPath)) {
        await this.app.vault.createBinary(imgPath, imgClip.bytes);
      }
    } else if (vaultPath) {
      imgPath = vaultPath;
    } else {
      new Notice('未提供图片。');
      return;
    }

    let caption = '';
    if (!skipCaption) {
      caption = await askText(this.app, '问题标题（可选，显示在图片上方）', '');
      if (caption === null) return;
    }
    const answer = await askText(this.app, '答案 — 说明这是什么', '');
    if (answer === null || !answer.trim()) { new Notice('必须填写答案。'); return; }

    const questionText = caption && caption.trim()
      ? `${caption.trim()}\n![[${imgPath}]]`
      : `![[${imgPath}]]`;
    const answerText = answer.trim();
    const created = await this._createCard(parentFile, {
      format: 'basic',
      question: questionText,
      answer: answerText,
    });
    new Notice(`图片卡片已使用 ${this.cardBackendLabel()} 创建：${created.name}`);
  }

  // "Name this image" flashcard: image is the only thing on the front,
  // user types the name on the back. Pulls image from clipboard if present,
  // otherwise picks from the parent's embedded images or attachment folder.
  async flashcardImageName() {
    const r = await resolveSourceOrExtractFromActive(this.app, this.settings);
    if (!r) return;

    const imgClip = await readImageFromClipboard();
    if (imgClip) {
      return await this._flashcardFromImage(r.tfile, r.fm, { imgClip, skipCaption: true });
    }

    const fileContent = await this.app.vault.read(r.tfile);
    const linkRe = /!\[\[([^\]|#]+\.(?:png|jpe?g|webp|gif))(?:[#|][^\]]*)?\]\]/gi;
    const linked = Array.from(fileContent.matchAll(linkRe)).map(m => m[1].trim());

    const parentBase = (r.fm.type === 'source')
      ? r.tfile.basename
      : (() => {
          const link = String(r.fm.source || '').match(/\[\[([^\]|#]+)/);
          return link ? link[1] : r.tfile.basename;
        })();
    const attachDir = `${this.attachmentsFolder()}/${slugifyForFolder(parentBase)}`;
    const folderFiles = filesInFolder(this.app, attachDir).filter(f =>
      f.path.startsWith(attachDir + '/') && /\.(png|jpe?g|webp|gif)$/i.test(f.name));

    const candidates = new Map();
    for (const path of linked) {
      const tf = this.app.vault.getAbstractFileByPath(path)
        || this.app.metadataCache.getFirstLinkpathDest(path, r.tfile.path);
      if (tf) candidates.set(tf.path, tf);
    }
    for (const f of folderFiles) candidates.set(f.path, f);

    const list = Array.from(candidates.values());
    if (list.length === 0) {
      new Notice('剪贴板中没有图片，此笔记也没有链接任何图片。');
      return;
    }

    const picked = list.length === 1
      ? list[0]
      : await pickFuzzy(this.app, list, f => f.path, '选择要命名的图片');
    if (!picked) return;

    return await this._flashcardFromImage(r.tfile, r.fm, { vaultPath: picked.path, skipCaption: true });
  }

  // ---- Image extract / Occlusion (visual learning) -----------------------

  async imageExtractClipboard() {
    const r = await resolveSourceOrExtractFromActive(this.app, this.settings);
    if (!r) return;

    const sourceFolder = slugifyForFolder(r.tfile.basename);
    const attachDir = `${this.attachmentsFolder()}/${sourceFolder}`;

    // Two clipboard formats supported:
    //   1. binary image (e.g. screen-capture, Preview.app copy)
    //   2. text containing ![[<image-in-vault>]] (PDF++ auto-copy after
    //      rectangular selection on a PDF). PDF++ writes the image to its
    //      configured attachment folder and copies the embed link.
    let bytes = null, ext = null;

    const img = await readImageFromClipboard();
    if (img) {
      bytes = img.bytes;
      ext = img.mime === 'image/jpeg' ? 'jpg' : (img.mime === 'image/webp' ? 'webp' : 'png');
    } else {
      let clipText = '';
      try { clipText = (await navigator.clipboard.readText()).trim(); } catch (e) { /* no perm */ }
      const wikilinkMatch = clipText.match(/!\[\[([^\]|#]+\.(?:png|jpe?g|webp|gif))(?:[#|][^\]]*)?\]\]/i);
      const mdLinkMatch = clipText.match(/!\[[^\]]*\]\(([^)]+\.(?:png|jpe?g|webp|gif))\)/i);
      const linkPath = wikilinkMatch?.[1] || mdLinkMatch?.[1] || null;
      if (!linkPath) {
        new Notice('剪贴板中没有图片。使用 PDF++ 时：启用「矩形选择」+「自动复制」，拖拽出矩形，然后运行此命令。');
        return;
      }
      const sourceTf = this.app.vault.getAbstractFileByPath(linkPath)
        || this.app.metadataCache.getFirstLinkpathDest(linkPath, r.tfile.path);
      if (!sourceTf) { new Notice(`库中未找到图片：${linkPath}`); return; }
      bytes = await this.app.vault.readBinary(sourceTf);
      ext = (sourceTf.extension || 'png').toLowerCase();
      if (ext === 'jpeg') ext = 'jpg';
    }

    await ensureFolder(this.app, attachDir);
    const hash = await shortHashOfBytes(bytes);
    const imgPath = `${attachDir}/img-${hash}.${ext}`;

    if (!this.app.vault.getAbstractFileByPath(imgPath)) {
      await this.app.vault.createBinary(imgPath, bytes);
    }

    const caption = await askText(this.app, '标题（可选，用作摘录正文）', '');
    if (caption === null) return;
    const body = caption.trim()
      ? `![[${imgPath}]]\n\n${caption.trim()}`
      : `![[${imgPath}]]`;

    await this._writeExtract(r.tfile, r.fm, body);
  }

  async occlusionCreate() {
    const r = await resolveSourceOrExtractFromActive(this.app, this.settings);
    if (!r) return;

    const fileContent = await this.app.vault.read(r.tfile);
    const linkRe = /!\[\[([^\]|#]+\.(?:png|jpg|jpeg|webp|gif))(?:[#|][^\]]*)?\]\]/gi;
    const linked = [];
    let m;
    while ((m = linkRe.exec(fileContent))) linked.push(m[1].trim());

    let imgVaultPath = null;
    if (linked.length === 1) {
      imgVaultPath = linked[0];
    } else if (linked.length > 1) {
      imgVaultPath = await pickFromList(this.app, linked, linked, '选择要遮挡的图片');
      if (!imgVaultPath) return;
    } else {
      const parentBase = (r.fm.type === 'source')
        ? r.tfile.basename
        : (() => {
            const link = String(r.fm.source || '').match(/\[\[([^\]|#]+)/);
            return link ? link[1] : r.tfile.basename;
          })();
      const dir = `${this.attachmentsFolder()}/${slugifyForFolder(parentBase)}`;
      const folder = this.app.vault.getAbstractFileByPath(dir);
      if (!folder) {
        new Notice('此来源没有图片。请先使用图片摘录（Mod+Shift+K）或嵌入一张图片。');
        return;
      }
      const files = filesInFolder(this.app, dir).filter(f =>
        f.path.startsWith(dir + '/') && /\.(png|jpe?g|webp|gif)$/i.test(f.name));
      if (files.length === 0) { new Notice('附件文件夹中没有图片。'); return; }
      const picked = await pickFuzzy(this.app, files, f => f.name, '选择图片');
      if (!picked) return;
      imgVaultPath = picked.path;
    }

    const tf = this.app.vault.getAbstractFileByPath(imgVaultPath)
      || this.app.metadataCache.getFirstLinkpathDest(imgVaultPath, r.tfile.path);
    if (!tf) { new Notice(`未找到图片：${imgVaultPath}`); return; }
    const resolvedPath = tf.path;
    const src = this.app.vault.adapter.getResourcePath(resolvedPath);

    const result = await askOcclusion(this.app, src);
    if (!result) return;

    const cardSpecs = generateCardsFromRects(result.rects, result.mode);
    if (!cardSpecs || cardSpecs.length === 0) { new Notice('未生成卡片。'); return; }

    const useToolkitForOcclusion = this.cardBackend() === 'anki';
    if (useToolkitForOcclusion) {
      new Notice('Anki 导出不会渲染工具包遮挡块；这些卡片将使用内置复习器。');
    }

    let written = 0;

    const yamlRects = result.rects
      .map(rect => {
        const base = `x: ${round4(rect.x)}, y: ${round4(rect.y)}, w: ${round4(rect.w)}, h: ${round4(rect.h)}`;
        const label = rect.label ? `, label: "${String(rect.label).replace(/"/g, '\\"')}"` : '';
        return `  - {${base}${label}}`;
      })
      .join('\n');

    for (const spec of cardSpecs) {
      const question = '```ir-occlusion\n' +
        `image: ${JSON.stringify(resolvedPath)}\n` +
        `mode: ${result.mode}\n` +
        `question_index: ${spec.questionIndex}\n` +
        'rects:\n' + yamlRects + '\n' +
        '```\n';
      const cardSpec = {
        format: 'occlusion',
        question,
        answer: `![[${resolvedPath}]]`,
        extraFrontmatter: [
          `occlusion_image: ${JSON.stringify(resolvedPath)}`,
          `occlusion_mode: ${result.mode}`,
          `occlusion_question_index: ${spec.questionIndex}`,
        ],
      };
      if (useToolkitForOcclusion) await this._createToolkitCard(r.tfile, cardSpec);
      else await this._createCard(r.tfile, cardSpec);
      written++;
    }

    const label = useToolkitForOcclusion ? this.cardBackendLabel('toolkit') : this.cardBackendLabel();
    new Notice(`遮挡：由 ${result.rects.length} 个矩形生成 ${written} 张${label}卡片`);
  }

  // ---- New source / Import clipping --------------------------------------

  async newSource() {
    const title = await askText(this.app, '来源标题', '');
    if (!title) return;
    const sourceType = await pickFromList(
      this.app,
      ['书籍', '文章', 'PDF', 'YouTube 视频', '本地视频文件'],
      ['book', 'article', 'pdf', 'youtube', 'video'],
      '来源类型'
    );
    if (!sourceType) return;
    const priStr = await askText(this.app, '优先级（1-100，1 为最高）', '50');
    if (priStr === null) return;
    if (!/^\d+$/.test(priStr.trim())) {
      new Notice('优先级无效 — 请输入 1 到 100 的整数。'); return;
    }
    const pNum = Number(priStr);
    if (!Number.isInteger(pNum) || pNum < 1 || pNum > 100) {
      new Notice('优先级无效 — 请输入 1 到 100 的整数。'); return;
    }

    const today = todayDateString(this.settings);
    const interval = priorityToInterval(pNum);
    const nextReview = futureDateString(interval, this.settings);

    let pdf_path = null, total_pages = null, read_point = null, source_url = null;
    let video_id = null, video_url = null, video_path = null, author = null;
    let read_point_seconds = null, total_seconds = null;

    if (sourceType === 'book' || sourceType === 'pdf') {
      pdf_path = await askText(this.app, 'PDF 路径（相对库或绝对路径）', '');
      if (pdf_path) pdf_path = pdf_path.replace(/^['"]|['"]$/g, '');
      const pages = await askText(this.app, '总页数', '');
      if (pages === null) return;
      if (pages.trim() && !/^[1-9]\d*$/.test(pages.trim())) {
        new Notice('总页数无效 — 请输入正整数。'); return;
      }
      total_pages = pages.trim() ? Number(pages) : null;
      read_point = 1;
    } else if (sourceType === 'article') {
      source_url = (await askText(this.app, '来源 URL（可选）', '')) || null;
    } else if (sourceType === 'youtube') {
      video_url = await askText(this.app, 'YouTube URL', '');
      if (!video_url) { new Notice('必须填写 YouTube URL。'); return; }
      const m = video_url.match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/);
      if (!m) { new Notice('YouTube URL 无效。'); return; }
      video_id = m[1];
      author = (await askText(this.app, '作者/频道（可选）', '')) || null;
      const dur = await askText(this.app, '总时长 mm:ss 或 hh:mm:ss（可选）', '');
      if (dur === null) return;
      total_seconds = parseTimeInput(dur);
      if (dur.trim() && total_seconds == null) { new Notice('时长无效 — 请使用 mm:ss 或 hh:mm:ss。'); return; }
      read_point_seconds = 0;
    } else if (sourceType === 'video') {
      const videosFolder = `${this.sourcesFolder()}/Videos`;
      const videos = filesInFolder(this.app, videosFolder)
        .filter(f => f.path.startsWith(videosFolder + '/') && /\.(mp4|webm|mov|mkv)$/i.test(f.name))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (videos.length === 0) {
        new Notice(`请先将视频放入 ${videosFolder}/。`); return;
      }
      const picked = await pickFuzzy(this.app, videos, v => v.name, '选择视频文件');
      if (!picked) return;
      video_path = picked.path;
      author = (await askText(this.app, '作者（可选）', '')) || null;
      const dur = await askText(this.app, '总时长 mm:ss 或 hh:mm:ss（可选）', '');
      if (dur === null) return;
      total_seconds = parseTimeInput(dur);
      if (dur.trim() && total_seconds == null) { new Notice('时长无效 — 请使用 mm:ss 或 hh:mm:ss。'); return; }
      read_point_seconds = 0;
    }

    const status = await this._askInboxOrActive(); // enhance
    if (!status) return;

    const aFactorInit = round4(initialAFactor(this.settings, { total_pages, total_seconds }));
    const fmLines = [
      '---',
      'type: source',
      `source_type: ${sourceType}`,
      `status: ${status}`,
      `priority: ${pNum}`,
      `next_review: ${nextReview}`,
      `interval: ${interval}`,
      `a_factor: ${aFactorInit}`,
      'review_count: 0',
      'last_reviewed:',
    ];
    if (read_point !== null)         fmLines.push(`read_point: ${read_point}`);
    if (total_pages !== null)        fmLines.push(`total_pages: ${total_pages}`);
    if (pdf_path)                    fmLines.push(`pdf_path: ${JSON.stringify(pdf_path)}`);
    if (source_url)                  fmLines.push(`source_url: ${JSON.stringify(source_url)}`);
    if (video_url)                   fmLines.push(`video_url: ${JSON.stringify(video_url)}`);
    if (video_id)                    fmLines.push(`video_id: ${JSON.stringify(video_id)}`);
    if (video_path)                  fmLines.push(`video_path: ${JSON.stringify(video_path)}`);
    if (read_point_seconds !== null) fmLines.push(`read_point_seconds: ${read_point_seconds}`);
    if (total_seconds !== null)      fmLines.push(`total_seconds: ${total_seconds}`);
    if (author)                      fmLines.push(`author: ${JSON.stringify(author)}`);
    fmLines.push(`date_added: ${today}`);
    fmLines.push('tags:');
    fmLines.push('  - incremental-reading');
    fmLines.push('  - ir/source');
    fmLines.push('---');

    let body = `\n# ${title}\n\n`;
    if (sourceType === 'book' || sourceType === 'pdf') {
      body += `> [!tip] Open in viewer\n> Run **Incremental Reading Toolkit: Open PDF (Toolkit viewer)**. Vault and external PDFs are supported.\n\n`;
    } else if (sourceType === 'youtube') {
      body += `<iframe width="640" height="360" src="https://www.youtube.com/embed/${video_id}?start=${read_point_seconds}" frameborder="0" allowfullscreen></iframe>\n\n`;
    } else if (sourceType === 'video') {
      body += `![[${video_path}]]\n\n`;
    }
    body += `## Reading Notes\n\n\n## Extracts\n\n`;

    const safeTitle = slugifyForFolder(title);
    if (!safeTitle) { new Notice('来源标题不含有效文件名。'); return; }
    const sourcesFolder = this.sourcesFolder();
    await ensureFolder(this.app, sourcesFolder);
    const path = `${sourcesFolder}/${safeTitle}.md`;
    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(`已存在：${path}`); return;
    }
    const f = await this.app.vault.create(path, fmLines.join('\n') + body);
    await this.app.workspace.getLeaf(false).openFile(f);
    new Notice(`已创建 ${title}。初始间隔倍率 ${aFactorInit}。`);
  }

  async importClipping() {
    const active = this.app.workspace.getActiveFile();
    if (!active || active.extension !== 'md') {
      new Notice('请先打开一篇剪藏笔记。'); return;
    }
    const existing = getFm(this.app, active);
    if (existing?.type === 'source') { new Notice('已经是渐进阅读来源。'); return; }

    const priStr = await askText(this.app, '优先级（1-100，1 为最高）', '50');
    if (priStr === null) return;
    if (!/^\d+$/.test(priStr.trim())) { new Notice('优先级无效。'); return; }
    const p = Number(priStr);
    if (!Number.isInteger(p) || p < 1 || p > 100) { new Notice('优先级无效。'); return; }

    const today = todayDateString(this.settings);
    const interval = priorityToInterval(p);
    const nextReview = futureDateString(interval, this.settings);
    const initialStatus = await this._askInboxOrActive(); // enhance
    if (!initialStatus) return;

    const aFactorInit = round4(initialAFactor(this.settings, {
      total_pages: Number(existing?.total_pages) || null,
      total_seconds: Number(existing?.total_seconds) || null,
    }));

    const sourcesFolder = this.sourcesFolder();
    await ensureFolder(this.app, sourcesFolder);
    const baseName = slugifyForFolder(active.basename) || '未命名';
    let newPath = `${sourcesFolder}/${baseName}.md`;
    let suffix = 2;
    while (active.path !== newPath && this.app.vault.getAbstractFileByPath(newPath)) {
      newPath = `${sourcesFolder}/${baseName} ${suffix++}.md`;
    }
    if (active.path !== newPath) await this.app.fileManager.renameFile(active, newPath);

    await this.app.fileManager.processFrontMatter(active, (fm) => {
      fm.type = 'source';
      fm.source_type = 'article';
      fm.status = initialStatus;
      fm.priority = p;
      fm.next_review = nextReview;
      fm.interval = interval;
      fm.a_factor = aFactorInit;
      fm.review_count = 0;
      fm.last_reviewed = null;
      fm.read_point = null;
      fm.total_pages = null;
      fm.sioyek_path = null;
      fm.pdf_path = null;
      for (const k of ['ease', 'stability', 'difficulty', 'last_grade', 'last_retrievability']) {
        if (fm[k] !== undefined) delete fm[k];
      }
      if (!fm.source_url && fm.source) fm.source_url = fm.source;
      fm.date_added = today;
      if (typeof fm.tags === 'string') fm.tags = fm.tags.split(/[\s,]+/).filter(Boolean);
      if (!Array.isArray(fm.tags)) fm.tags = [];
      if (!fm.tags.includes('incremental-reading')) fm.tags.push('incremental-reading');
      if (!fm.tags.includes('ir/source')) fm.tags.push('ir/source');
    });

    new Notice(`已导入（${initialStatus}）· p${p} · 复习 +${interval} 天`);
  }

  // ---- Navigation --------------------------------------------------------

  async openDashboard(section = null) {
    let leaf = this.app.workspace.getLeavesOfType(MAIN_DASHBOARD_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: MAIN_DASHBOARD_VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    if (section === 'stats' && leaf.view instanceof MainDashboardView) {
      leaf.view.scrollToStatsOnRender = true;
      await leaf.view.render();
    }
  }

  async openParent() {
    const active = this.app.workspace.getActiveFile();
    if (!active) { new Notice('没有活动文件。'); return; }
    const fm = getFm(this.app, active);
    if (!fm) { new Notice('没有 frontmatter。'); return; }
    if (fm.type !== 'source' && fm.type !== 'extract' && fm.type !== 'card') {
      new Notice('不是渐进阅读元素。'); return;
    }
    const parentName = (fm.type === 'card' || fm.type === 'extract')
      ? linkTarget(fm.source) : linkTarget(fm.parent);
    if (!parentName) { new Notice('没有父级链接。'); return; }
    const parent = this.app.metadataCache.getFirstLinkpathDest(parentName, active.path);
    if (!parent) { new Notice(`未找到父级「${parentName}」。`); return; }
    await this.app.workspace.getLeaf(false).openFile(parent);
    new Notice(`↑ ${parent.basename}`);
  }

  async openPdf() {
    const r = await resolveSourceFromActive(this.app, this.settings);
    if (!r) return;
    const fm = r.fm;
    const configured = fm.pdf_vault_path || fm.pdf_path || fm.sioyek_path;
    if (!configured) { new Notice('未设置 pdf_path 或 pdf_vault_path。'); return; }
    const rawPath = String(configured);
    const ext = (rawPath.split('.').pop() || '').toLowerCase();
    if (ext === 'epub') { new Notice('Obsidian 阅读器不支持 Epub。'); return; }
    if (ext !== 'pdf') { new Notice(`不支持的扩展名 .${ext}`); return; }
    const vaultBase = vaultAbsPath(this.app, '');
    const rel = rawPath.startsWith(vaultBase) ? rawPath.slice(vaultBase.length) : rawPath.replace(/^\/+/, '');
    const vaultFile = this.app.vault.getAbstractFileByPath(rel);
    let url;
    if (vaultFile instanceof TFile) url = this.app.vault.getResourcePath(vaultFile);
    else {
      const absolute = rawPath.startsWith('/') ? rawPath : vaultAbsPath(this.app, rawPath);
      const fs = require('fs');
      if (!fs.existsSync(absolute)) { new Notice(`未在 ${rawPath} 找到 PDF`); return; }
      url = require('url').pathToFileURL(absolute).href;
    }
    const ps = Number(fm.page_start) || null, pe = Number(fm.page_end) || null, rp = Number(fm.read_point) || null;
    let page = (rp && ps && pe) ? Math.max(ps, Math.min(rp, pe)) : (rp || ps || 1);
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: PDF_VIEW_TYPE, active: true, state: { url, page, title: r.tfile.basename, sourcePath: r.tfile.path } });
    this.app.workspace.revealLeaf(leaf);
  }

  // ===== ENHANCE BEGIN =====
  // incremental-reading-enhance 的本地增强；合并上游后需重新套用，见 docs/ENHANCE.zh-CN.md。

  async setReadPointAtCursor() {
    const active = this.app.workspace.getActiveFile();
    if (!active || active.extension !== 'md') { new Notice('请打开一个 Markdown 来源。'); return; }
    const fm = getFm(this.app, active);
    if (!fm || fm.type !== 'source') { new Notice('不是渐进阅读来源。'); return; }
    if (fm.total_pages || fm.pdf_path || fm.pdf_vault_path || fm.sioyek_path) {
      new Notice('PDF 来源 — 请使用打开 PDF（工具包查看器）。'); return;
    }
    const editor = getEditorForFile(this.app, active);
    const cursor = editor?.getCursor?.();
    if (!editor || !cursor) { new Notice('没有编辑器光标。'); return; }
    const line = cursor.line + 1;
    await this.app.vault.process(active, (text) => {
      let stripped = text;
      const ms = [...text.matchAll(READ_POINT_RE)];
      for (const m of ms.reverse()) {
        stripped = stripped.slice(0, m.index) + stripped.slice(m.index + m[0].length);
      }
      const fmEnd = frontmatterEndOffset(stripped);
      const lines = stripped.split('\n');
      let insertAt = 0;
      for (let i = 0; i < cursor.line; i++) insertAt += lines[i].length + 1;
      if (insertAt < fmEnd) insertAt = fmEnd;
      return stripped.slice(0, insertAt) + READ_POINT_MARKER + stripped.slice(insertAt);
    });
    await this.app.fileManager.processFrontMatter(active, (next) => { next.read_point_line = line; });
    new Notice(`📍 阅读点已设到第 ${line} 行`);
  }

  _isIRManaged(file) {
    const folders = [this.sourcesFolder(), this.extractsFolder(), this.cardsFolder(), this.categoriesFolder()]
      .filter(Boolean)
      .map((f) => normalizePath(f).replace(/\/+$/, '') + '/');
    const path = normalizePath(file.path);
    return folders.some((f) => path.startsWith(f));
  }

  async trashCurrentIRItem() {
    const active = this.app.workspace.getActiveFile();
    if (!active) { new Notice('没有活动文件。'); return; }
    const fm = getFm(this.app, active);
    if (!fm || !['source', 'extract', 'card'].includes(fm.type)) { new Notice('当前笔记不是渐进阅读元素。'); return; }
    const ok = await confirmDialog(this.app, `将「${active.basename}」移入回收站？`);
    if (!ok) return;
    await this.app.fileManager.trashFile(active);
    this._invalidateIRCollection(true);
    new Notice(`已移入回收站：${active.basename}`);
  }

  async removeCurrentFromIR() {
    const active = this.app.workspace.getActiveFile();
    if (!active) { new Notice('没有活动文件。'); return; }
    const fm0 = getFm(this.app, active);
    if (!fm0 || !['source', 'extract', 'card'].includes(fm0.type)) { new Notice('当前笔记不是渐进阅读元素。'); return; }
    const ok = await confirmDialog(this.app, '移出 IR：清掉排期字段、ir/* 标签与 📍 标记，并把笔记移到库根目录？');
    if (!ok) return;
    const IR_FM_KEYS = [
      'type', 'source_type', 'status', 'priority', 'next_review', 'interval', 'a_factor',
      'review_count', 'last_reviewed', 'date_added', 'date_done', 'date_dismissed',
      'read_point', 'read_point_line', 'read_point_seconds', 'total_pages', 'total_seconds',
      'page_start', 'page_end', 'pdf_path', 'pdf_vault_path', 'sioyek_path', 'source',
      'card_format', 'ir_card_backend', 'ir_spaced_repetition',
      'ir_spaced_repetition_deck_tag', 'ir_completed_deck_tag', 'tree_order', 'inline_parent', 'epub_path',
    ];
    const IR_TAGS = ['incremental-reading', 'ir/source', 'ir/extract', 'ir/card', 'flashcards/incremental-reading'];
    await this.app.fileManager.processFrontMatter(active, (fmw) => {
      for (const k of IR_FM_KEYS) delete fmw[k];
      if (fmw.tags !== undefined) {
        const list = Array.isArray(fmw.tags) ? fmw.tags : String(fmw.tags ?? '').split(/[\s,]+/);
        const kept = list.map((t) => String(t).trim()).filter((t) => t && !IR_TAGS.includes(t.replace(/^#/, '')));
        if (kept.length) fmw.tags = kept; else delete fmw.tags;
      }
      if (Array.isArray(fmw.cssclasses)) {
        const kept = fmw.cssclasses.filter((c) => c !== 'hide-answer');
        if (kept.length) fmw.cssclasses = kept; else delete fmw.cssclasses;
      }
    });
    await this.app.vault.process(active, (text) => {
      READ_POINT_RE.lastIndex = 0;
      return text.replace(READ_POINT_RE, '').replace(/\n{3,}/g, '\n\n');
    });
    let target = active.basename + '.md';
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(target)) target = `${active.basename} ${suffix++}.md`;
    await this.app.fileManager.renameFile(active, target);
    this._invalidateIRCollection(true);
    new Notice(`已移出 IR：${target}`);
  }
  async newSourceFromClipboard() {
    let clip = '';
    try { clip = (await navigator.clipboard.readText()).trim(); }
    catch (e) { new Notice('无法读取剪贴板。'); return; }
    if (!clip) { new Notice('剪贴板为空（无文本）。'); return; }

    const firstLine = clip.split('\n').map((s) => s.trim()).find(Boolean) || '';
    const suggested = (firstLine.replace(/^#+\s*/, '').slice(0, 60).trim()) || '剪贴板文章';
    const title = await askText(this.app, '来源标题', suggested);
    if (!title) return;

    const priStr = await askText(this.app, '优先级（1-100，1 为最高）', '50');
    if (priStr === null) return;
    if (!/^\d+$/.test(priStr.trim())) { new Notice('优先级无效。'); return; }
    const p = Number(priStr);
    if (!Number.isInteger(p) || p < 1 || p > 100) { new Notice('优先级无效。'); return; }

    const status = await this._askInboxOrActive(); // enhance
    if (!status) return;

    const today = todayDateString(this.settings);
    const interval = priorityToInterval(p);
    const nextReview = futureDateString(interval, this.settings);
    const aFactorInit = round4(initialAFactor(this.settings, { total_pages: null, total_seconds: null }));

    const safeTitle = slugifyForFolder(title);
    if (!safeTitle) { new Notice('来源标题不含有效文件名。'); return; }
    const sourcesFolder = this.sourcesFolder();
    await ensureFolder(this.app, sourcesFolder);
    let path = `${sourcesFolder}/${safeTitle}.md`;
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) path = `${sourcesFolder}/${safeTitle} ${suffix++}.md`;

    const fmLines = [
      '---',
      'type: source',
      'source_type: article',
      `status: ${status}`,
      `priority: ${p}`,
      `next_review: ${nextReview}`,
      `interval: ${interval}`,
      `a_factor: ${aFactorInit}`,
      'review_count: 0',
      'last_reviewed:',
      `date_added: ${today}`,
      'tags:',
      '  - incremental-reading',
      '  - ir/source',
      '---',
    ];
    const body = `\n# ${title}\n\n${clip}\n\n## Reading Notes\n\n\n## Extracts\n\n`;
    const f = await this.app.vault.create(path, fmLines.join('\n') + body);
    this._invalidateIRCollection(true);
    await this.app.workspace.getLeaf(false).openFile(f);
    new Notice(`已从剪贴板创建来源「${title}」（${status}）· p${p} · 复习 +${interval} 天`);
  }

  // ---- EPUB 导入（纯 JS 解析 EPUB，不调外部进程） ----
  _epubImportSettings() {
    const cfg = this.settings.epubImport || {};
    return {
      libraryFolder: String(cfg.libraryFolder || '').trim(),
      dropLeadingToc: cfg.dropLeadingToc !== false,
    };
  }

  _epubReadZip(buffer) {
    const zlib = require('zlib');
    const bytes = new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    const floor = Math.max(0, bytes.length - 66000);
    for (let i = bytes.length - 22; i >= floor; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 EPUB：找不到 ZIP 结尾记录');
    const count = view.getUint16(eocd + 10, true);
    let ptr = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder('utf-8');
    const entries = new Map();
    for (let n = 0; n < count; n++) {
      if (ptr + 46 > bytes.length || view.getUint32(ptr, true) !== 0x02014b50) break;
      const method = view.getUint16(ptr + 10, true);
      const compSize = view.getUint32(ptr + 20, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localOff = view.getUint32(ptr + 42, true);
      const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
      if (localOff + 30 <= bytes.length && view.getUint32(localOff, true) === 0x04034b50) {
        const lNameLen = view.getUint16(localOff + 26, true);
        const lExtraLen = view.getUint16(localOff + 28, true);
        const start = localOff + 30 + lNameLen + lExtraLen;
        const raw = bytes.subarray(start, Math.min(start + compSize, bytes.length));
        let data = null;
        try { data = method === 0 ? raw : zlib.inflateRawSync(raw); } catch (e) { data = null; }
        if (data) entries.set(name, data);
      }
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  _epubText(entries, name) {
    const data = entries.get(name);
    if (!data) return null;
    return new TextDecoder('utf-8').decode(data);
  }

  _epubJoin(base, href) {
    const nodePath = require('path');
    const clean = String(href || '').split('#')[0].trim();
    if (!clean || /^[a-z][a-z0-9+.-]*:/i.test(clean)) return null;
    return nodePath.posix.normalize(nodePath.posix.join(nodePath.posix.dirname(base), decodeURIComponent(clean)));
  }

  _epubInline(node) {
    let out = '';
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) { out += child.nodeValue.replace(/\s+/g, ' '); continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      const inner = this._epubInline(child);
      const trimmed = inner.trim();
      if (tag === 'strong' || tag === 'b') out += trimmed ? '**' + trimmed + '**' : inner;
      else if (tag === 'em' || tag === 'i') out += trimmed ? '*' + trimmed + '*' : inner;
      else if (tag === 'code') out += trimmed ? '`' + trimmed + '`' : inner;
      else if (tag === 'br') out += '\n';
      else if (tag === 'img') out += this._epubImage(child);
      else out += inner;
    }
    return out;
  }

  _epubImage(node) {
    const raw = node.getAttribute('src');
    if (!raw) return '';
    const resolved = this._epubJoin(this._epubCurrentDoc || '', raw);
    if (!resolved) return '';
    return '![' + (node.getAttribute('alt') || '') + '](epubimg:' + resolved + ')';
  }

  _epubBlocks(root) {
    const out = [];
    const push = (s) => { if (s && s.trim()) out.push(s.trim()); };
    const walk = (node) => {
      for (const child of Array.from(node.children)) {
        const tag = child.tagName.toLowerCase();
        if (/^h[1-6]$/.test(tag)) { push('#'.repeat(Number(tag[1])) + ' ' + this._epubInline(child).trim()); continue; }
        if (tag === 'p') { push(this._epubInline(child)); continue; }
        if (tag === 'blockquote') {
          const inner = this._epubBlocks(child).join('\n\n');
          if (inner) push(inner.split('\n').map((l) => '> ' + l).join('\n'));
          continue;
        }
        if (tag === 'ul' || tag === 'ol') {
          const items = [];
          let i = 1;
          for (const li of Array.from(child.children)) {
            if (li.tagName.toLowerCase() !== 'li') continue;
            items.push((tag === 'ol' ? (i++) + '. ' : '- ') + this._epubInline(li).trim());
          }
          push(items.join('\n'));
          continue;
        }
        if (tag === 'pre') { push('~~~\n' + String(child.textContent || '').replace(/\s+$/, '') + '\n~~~'); continue; }
        if (tag === 'img') { push(this._epubImage(child)); continue; }
        if (tag === 'hr') { push('---'); continue; }
        if (tag === 'table') { push(this._epubInline(child)); continue; }
        if (['div', 'section', 'article', 'main', 'body', 'figure', 'figcaption', 'header', 'footer'].includes(tag)) { walk(child); continue; }
        const text = this._epubInline(child).trim();
        if (text) push(text);
      }
    };
    walk(root);
    return out;
  }

  _stripLeadingToc(text) {
    const lines = text.split('\n');
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^#{1,6} /.test(lines[i])) { idx = i; break; }
    }
    if (idx <= 0 || idx > 900) return text;
    const kept = lines.slice(0, idx).filter((l) => l.indexOf('![') === 0);
    return (kept.length ? kept.join('\n') + '\n\n' : '') + lines.slice(idx).join('\n');
  }

  _confirmEpubPreview(text) {
    const app = this.app;
    return new Promise((resolve) => {
      class EpubPreviewModal extends Modal {
        constructor(a) { super(a); this.resolved = false; }
        onOpen() {
          this.titleEl.setText('EPUB 转换预览');
          const contentEl = this.contentEl;
          contentEl.empty();
          const pre = contentEl.createEl('pre');
          pre.setText(text);
          pre.style.maxHeight = '50vh';
          pre.style.overflow = 'auto';
          pre.style.whiteSpace = 'pre-wrap';
          const row = contentEl.createDiv({ cls: 'modal-button-container' });
          const yes = row.createEl('button', { text: '写入来源', cls: 'mod-cta' });
          yes.addEventListener('click', () => { this.finish(true); });
          const no = row.createEl('button', { text: '取消' });
          no.addEventListener('click', () => { this.finish(false); });
          window.setTimeout(() => yes.focus(), 20);
        }
        finish(v) { if (this.resolved) return; this.resolved = true; this.close(); resolve(v); }
        onClose() { if (!this.resolved) { this.resolved = true; resolve(false); } }
      }
      new EpubPreviewModal(app).open();
    });
  }

  async importFromEpub() {
    const fsn = require('fs');
    const nodePath = require('path');
    const cfg = this._epubImportSettings();

    let epubPath = null;
    if (cfg.libraryFolder && fsn.existsSync(cfg.libraryFolder)) {
      const root = cfg.libraryFolder.replace(/\/+$/, '');
      const found = [];
      const scan = (dir, depth) => {
        if (depth > 4) return;
        let names;
        try { names = fsn.readdirSync(dir); } catch (e) { return; }
        for (const name of names) {
          const full = nodePath.join(dir, name);
          let st;
          try { st = fsn.statSync(full); } catch (e) { continue; }
          if (st.isDirectory()) scan(full, depth + 1);
          else if (/\.epub$/i.test(name)) found.push(full);
        }
      };
      scan(root, 0);
      if (found.length) {
        found.sort();
        const rels = found.map((f) => f.slice(root.length + 1));
        const picked = await pickFuzzy(this.app, rels, (r) => r, '选择 EPUB');
        if (!picked) return;
        epubPath = nodePath.join(root, picked);
      }
    }
    if (!epubPath) {
      const input = await askText(this.app, 'EPUB 路径（绝对路径或库内相对路径）', '');
      if (input === null) return;
      const trimmed = String(input).trim();
      if (!trimmed) return;
      epubPath = trimmed;
    }
    if (!nodePath.isAbsolute(epubPath)) {
      const abs = vaultAbsPath(this.app, epubPath);
      if (abs) epubPath = abs;
    }
    if (!fsn.existsSync(epubPath)) { new Notice('找不到文件：' + epubPath, 10000); return; }

    const defaultTitle = nodePath.basename(epubPath).replace(/\.epub$/i, '');
    const title = await askText(this.app, '来源标题', defaultTitle);
    if (!title) return;

    const priStr = await askText(this.app, '优先级（1-100，1 为最高）', '50');
    if (priStr === null) return;
    if (!/^\d+$/.test(String(priStr).trim())) { new Notice('优先级无效。'); return; }
    const p = Number(String(priStr).trim());
    if (!Number.isInteger(p) || p < 1 || p > 100) { new Notice('优先级无效。'); return; }

    let entries;
    let spine;
    let opfPath;
    try {
      const buf = fsn.readFileSync(epubPath);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      entries = this._epubReadZip(ab);
      const container = this._epubText(entries, 'META-INF/container.xml');
      if (!container) throw new Error('缺少 META-INF/container.xml');
      const cdoc = new DOMParser().parseFromString(container, 'text/xml');
      const rootfile = cdoc.querySelector('rootfile');
      opfPath = rootfile ? rootfile.getAttribute('full-path') : null;
      if (!opfPath) throw new Error('container.xml 里没有 rootfile');
      const opfSrc = this._epubText(entries, opfPath);
      if (!opfSrc) throw new Error('找不到 OPF：' + opfPath);
      const opf = new DOMParser().parseFromString(opfSrc, 'text/xml');
      const manifest = new Map();
      for (const item of Array.from(opf.querySelectorAll('manifest > item'))) {
        manifest.set(item.getAttribute('id'), { href: item.getAttribute('href'), type: item.getAttribute('media-type') || '' });
      }
      spine = [];
      for (const ref of Array.from(opf.querySelectorAll('spine > itemref'))) {
        const item = manifest.get(ref.getAttribute('idref'));
        if (item && /x?html/i.test(item.type)) spine.push(item);
      }
      if (!spine.length) {
        for (const item of manifest.values()) if (/x?html/i.test(item.type)) spine.push(item);
      }
      if (!spine.length) throw new Error('OPF 里没有可读的 XHTML');
    } catch (err) {
      new Notice('EPUB 解析失败：' + String(err && err.message ? err.message : err), 12000);
      return;
    }

    const parts = [];
    for (const item of spine) {
      const docPath = this._epubJoin(opfPath, item.href);
      if (!docPath) continue;
      const src = this._epubText(entries, docPath);
      if (!src) continue;
      this._epubCurrentDoc = docPath;
      let blocks = [];
      try {
        const doc = new DOMParser().parseFromString(src, 'text/html');
        blocks = this._epubBlocks(doc.body);
      } catch (e) { blocks = []; }
      if (blocks.length) parts.push(blocks.join('\n\n'));
    }
    if (!parts.length) { new Notice('没有从 EPUB 里解析出正文。'); return; }

    let md = parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
    if (cfg.dropLeadingToc) md = this._stripLeadingToc(md);

    const imgPaths = [];
    md = md.replace(/\(epubimg:([^)]+)\)/g, (whole, zipPath) => {
      if (imgPaths.indexOf(zipPath) === -1) imgPaths.push(zipPath);
      return whole;
    });
    const media = imgPaths.map((zipPath, i) => {
      const base = nodePath.basename(zipPath).replace(/[?#].*$/, '');
      const ext = (base.match(/\.[^.]+$/) || [''])[0];
      const stem = ext ? base.slice(0, -ext.length) : base;
      let name = base;
      let n = 2;
      while (imgPaths.slice(0, i).some((other) => nodePath.basename(other) === name)) name = stem + '-' + (n++) + ext;
      return { name: name, base: base, zipPath: zipPath };
    });
    const byZip = Object.create(null);
    for (const item of media) byZip[item.zipPath] = item.name;
    md = md.replace(/!\[[^\]]*\]\(epubimg:([^)]+)\)/g, (whole, zipPath) => {
      const name = byZip[zipPath] || byZip[decodeURIComponent(zipPath)];
      return name ? '![[' + name + ']]' : '';
    });

    const lines = md.split('\n');
    const h1 = lines.filter((l) => l.indexOf('# ') === 0).length;
    const h2 = lines.filter((l) => l.indexOf('## ') === 0).length;
    const dirty = lines.filter((l) => /[<>]/.test(l)).length;
    const bodyLines = lines.filter((l) => l.trim());
    const previewLines = [
      '文件：' + epubPath,
      '结果：' + spine.length + ' 个 XHTML / ' + h1 + ' 个 H1 / ' + h2 + ' 个 H2 / 残留标签行 ' + dirty + ' / 图片 ' + media.length + ' 张',
      '正文：' + bodyLines.length + ' 个非空行，约 ' + Math.round(md.length / 1000) + ' KB',
      '',
      '--- 开头 ---',
    ].concat(bodyLines.slice(0, 6)).concat(['', '--- 结尾 ---']).concat(bodyLines.slice(-4));

    const ok = await this._confirmEpubPreview(previewLines.join('\n'));
    if (!ok) return;

    const safeTitle = slugifyForFolder(title);
    if (!safeTitle) { new Notice('来源标题不含有效文件名。'); return; }
    const mediaFolder = this.attachmentsFolder() + '/' + safeTitle;
    const written = [];
    if (media.length) {
      await ensureFolder(this.app, mediaFolder);
      for (const item of media) {
        const data = entries.get(item.zipPath);
        if (!data) continue;
        const copy = data.slice();
        await this.app.vault.adapter.writeBinary(mediaFolder + '/' + item.name, copy.buffer);
        written.push(item.name);
      }
    }

    const status = await this._askInboxOrActive(); // enhance
    if (!status) return;
    const today = todayDateString(this.settings);
    const interval = priorityToInterval(p);
    const nextReview = futureDateString(interval, this.settings);
    const aFactorInit = round4(initialAFactor(this.settings, { total_pages: null, total_seconds: null }));

    const sourcesFolder = this.sourcesFolder();
    await ensureFolder(this.app, sourcesFolder);
    let target = sourcesFolder + '/' + safeTitle + '.md';
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(target)) target = sourcesFolder + '/' + safeTitle + ' ' + (suffix++) + '.md';

    const fm = [
      '---',
      'type: source',
      'source_type: article',
      'status: ' + status,
      'priority: ' + p,
      'next_review: ' + nextReview,
      'interval: ' + interval,
      'a_factor: ' + aFactorInit,
      'review_count: 0',
      'last_reviewed:',
      'date_added: ' + today,
      'epub_path: ' + JSON.stringify(epubPath),
      'tags:',
      '  - incremental-reading',
      '  - ir/source',
      '---',
    ];
    const content = fm.join('\n') + '\n\n# ' + title + '\n\n' + md;
    let file = await this.app.vault.create(target, content);
    this._invalidateIRCollection(true);
    if (cfg.autoSplit && h2 > 0) {
      await this.splitSourceIntoChapters(file);
      const movedFile = this.app.vault.getAbstractFileByPath(this.sourcesFolder() + '/' + safeTitle + '/' + safeTitle + '.md');
      if (movedFile) file = movedFile;
    }
    await this.app.workspace.getLeaf(false).openFile(file);
    new Notice('已导入「' + title + '」· ' + status + ' · 图片 ' + written.length + ' 张');
  }

  async _askInboxOrActive() {
    return await pickFromList(
      this.app,
      ['放进收件箱（暂不排期）', '立刻排期，进入阅读队列'],
      ['inbox', 'active'],
      '先放进收件箱（暂不排期）？选「取消」＝立刻按优先级排期，进入阅读队列。'
    );
  }

  async activateCurrentIRItem() {
    const r = await resolveIRFromActive(this.app, this.settings, { allowCard: false, allowPdfFallback: true });
    if (!r) return;
    const tfile = r.tfile;
    const today = todayDateString(this.settings);
    await this.app.fileManager.processFrontMatter(tfile, (fmw) => {
      fmw.status = 'active';
      fmw.next_review = today;
      if (fmw.date_done !== undefined) delete fmw.date_done;
      if (fmw.date_dismissed !== undefined) delete fmw.date_dismissed;
    });
    this._invalidateIRCollection(true);
    new Notice('已设为进行中，今天就会进阅读队列：' + tfile.basename);
  }

  async splitSourceIntoChapters(file) {
    if (!file || file.extension !== 'md') { new Notice('请先打开一篇来源笔记。'); return 0; }
    const fm = getFm(this.app, file);
    if (!fm || fm.type !== 'source') { new Notice('不是渐进阅读来源。'); return 0; }
    if (fm.status === 'container') { new Notice('已经是容器，无需再拆。'); return 0; }

    const content = await this.app.vault.read(file);
    const fmEnd = content.indexOf('\n---', 3);
    const body = fmEnd !== -1 ? content.slice(fmEnd + 4) : content;
    const parentTitle = file.basename;

    const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase();
    const skipTitles = ['目录', 'cover', '封面', '版权', '版权信息', '扉页', 'sub-topics'];
    const isSkipped = (title) => {
      const n = norm(title);
      return n === norm(parentTitle) || skipTitles.includes(n);
    };

    const all = [];
    const re = new RegExp('^(#{1,2}) (.+)$', 'gm');
    let m;
    while ((m = re.exec(body)) !== null) {
      all.push({ level: m[1].length, title: m[2].trim(), index: m.index });
    }
    const usable = all.filter((h) => !isSkipped(h.title));
    if (!usable.length) { new Notice('没有找到可用的标题，无法拆分。'); return 0; }

    const sectionLength = (h) => {
      const next = usable.find((x) => x.index > h.index);
      const end = next ? next.index : body.length;
      return body.slice(h.index, end).trim().length;
    };
    const candidates = {};
    for (const level of [2, 1]) {
      const heads = usable.filter((h) => h.level === level && sectionLength(h) >= 200);
      const titles = heads.map((h) => h.title);
      candidates[level] = { heads, unique: new Set(titles).size === titles.length };
    }
    let chosen = null;
    for (const level of [2, 1]) {
      const c = candidates[level];
      if (c && c.heads.length >= 3 && c.unique) { chosen = c.heads; break; }
    }
    if (!chosen) {
      const c2 = candidates[2] && candidates[2].heads.length >= 3 ? candidates[2].heads : (candidates[1] ? candidates[1].heads : []);
      chosen = c2.length ? c2 : usable;
    }
    if (!chosen.length) { new Notice('没有找到可拆分的章节。'); return 0; }

    const safeTitle = slugifyForFolder(parentTitle) || '未命名';
    const bookFolder = this.sourcesFolder() + '/' + safeTitle;
    await ensureFolder(this.app, bookFolder);

    const today = todayDateString(this.settings);
    const priority = fm.priority ?? 50;
    const baseInterval = priorityToInterval(priority);
    const links = [];
    const used = new Set();
    let created = 0;

    for (let i = 0; i < chosen.length; i++) {
      const h = chosen[i];
      const next = chosen[i + 1];
      const sectionBody = body.slice(h.index, next ? next.index : body.length).trimEnd();
      const interval = baseInterval + i;
      const nextReview = futureDateString(interval, this.settings);
      const stem = slugifyForFolder(parentTitle + ' - ' + h.title) || (parentTitle + ' - 第 ' + (i + 1) + ' 节');
      let noteTitle = stem;
      let n = 2;
      while (used.has(noteTitle)) noteTitle = stem + ' ' + (n++);
      used.add(noteTitle);
      const noteContent = '---\n' +
        'type: source\n' +
        'source_type: article\n' +
        'status: inbox\n' +
        'parent: ' + JSON.stringify('[[' + parentTitle + ']]') + '\n' +
        'priority: ' + priority + '\n' +
        'next_review: ' + nextReview + '\n' +
        'interval: ' + interval + '\n' +
        'a_factor: 2.0\n' +
        'review_count: 0\n' +
        'last_reviewed:\n' +
        'date_added: ' + today + '\n' +
        'tags:\n' +
        '  - incremental-reading\n' +
        '  - ir/source\n' +
        '  - ir/sub-topic\n' +
        '---\n\n' + sectionBody + '\n';
      const p = bookFolder + '/' + noteTitle + '.md';
      if (!this.app.vault.getAbstractFileByPath(p)) {
        await this.app.vault.create(p, noteContent);
        created++;
      }
      links.push('- [[' + noteTitle + ']]');
    }

    const targetParentPath = bookFolder + '/' + safeTitle + '.md';
    if (file.path !== targetParentPath && !this.app.vault.getAbstractFileByPath(targetParentPath)) {
      await this.app.fileManager.renameFile(file, targetParentPath);
    }
    const moved = this.app.vault.getAbstractFileByPath(targetParentPath) || file;
    const subSection = '\n## Sub-topics\n\n' + links.join('\n') + '\n';
    const bodyWithoutOld = content.replace(/\n## Sub-topics[\s\S]*?(?=\n## |$)/, '');
    await this.app.vault.process(moved, () => bodyWithoutOld + subSection);
    await this.app.fileManager.processFrontMatter(moved, (fmw) => { fmw.status = 'container'; });
    this._invalidateIRCollection(true);
    new Notice('已拆出 ' + created + ' 篇（按 H' + (chosen[0].level) + '）到 ' + bookFolder + '，全部停在收件箱。');
    return created;
  }

  // ===== ENHANCE END =====

  async toggleReadPoint() {
    const active = this.app.workspace.getActiveFile();
    if (!active || active.extension !== 'md') { new Notice('请打开一个 Markdown 来源。'); return; }
    const fm = getFm(this.app, active);
    if (!fm || fm.type !== 'source') { new Notice('不是渐进阅读来源。'); return; }
    if (fm.total_pages || fm.pdf_path || fm.pdf_vault_path || fm.sioyek_path) {
      new Notice('PDF 来源 — 请使用打开 PDF（工具包查看器）。'); return;
    }
    const editor = getEditorForFile(this.app, active);
    const cursor = editor?.getCursor?.();
    if (!editor || !cursor) { new Notice('没有编辑器光标。'); return; }
    const content = editor.getValue();
    READ_POINT_RE.lastIndex = 0;
    const hasMarker = READ_POINT_RE.test(content);

    let action;
    if (hasMarker) {
      action = await pickFromList(
        this.app,
        [`将 📍 移到第 ${cursor.line + 1} 行`, '清除 📍 标记'],
        ['move', 'clear'],
        '📍 已设置'
      );
    } else {
      action = await pickFromList(
        this.app, [`在第 ${cursor.line + 1} 行设置 📍`], ['set'], '📍 标记'
      );
    }
    if (!action) return;
    await this.app.vault.process(active, (text) => {
      let stripped = text;
      const ms = [...text.matchAll(READ_POINT_RE)];
      for (const m of ms.reverse()) {
        stripped = stripped.slice(0, m.index) + stripped.slice(m.index + m[0].length);
      }
      if (action === 'clear') return stripped;
      const fmEnd = frontmatterEndOffset(stripped);
      const lines = stripped.split('\n');
      let insertAt = 0;
      for (let i = 0; i < cursor.line; i++) insertAt += lines[i].length + 1;
      if (insertAt < fmEnd) insertAt = fmEnd;
      return stripped.slice(0, insertAt) + READ_POINT_MARKER + stripped.slice(insertAt);
    });
    await this.app.fileManager.processFrontMatter(active, (next) => {
      if (action === 'clear') delete next.read_point_line;
      else next.read_point_line = cursor.line + 1;
    });
    new Notice(action === 'clear' ? '📍 已清除。' : `📍 ${action} 于第 ${cursor.line + 1} 行`);
  }

  async jumpToReadPoint({ silent = false } = {}) {
    const active = this.app.workspace.getActiveFile();
    if (!active || active.extension !== 'md') { if (!silent) new Notice('不是 Markdown 来源。'); return; }
    const fm = getFm(this.app, active);
    if (!fm || fm.type !== 'source') { if (!silent) new Notice('不是渐进阅读来源。'); return; }
    if (fm.total_pages || fm.pdf_path || fm.pdf_vault_path || fm.sioyek_path) {
      if (!silent) new Notice('PDF — 请使用打开 PDF（工具包查看器）。'); return;
    }
    const openEditor = getEditorForFile(this.app, active);
    let line = Math.max(0, (Number(fm.read_point_line) || 0) - 1);
    let ch = 0;
    if (!fm.read_point_line) {
      const content = openEditor?.getValue?.() ?? await this.app.vault.cachedRead(active);
      const m = content.match(/(?:📍\s*)?<!--ir-readpoint-->/);
      if (!m) { if (!silent) new Notice('没有 📍 阅读位置。'); return; }
      const before = content.slice(0, m.index);
      line = (before.match(/\n/g) || []).length;
      ch = m.index - (before.lastIndexOf('\n') + 1);
    }
    let leaf = this.app.workspace.getLeavesOfType('markdown').find(l => l.view?.file?.path === active.path);
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(active);
    }
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    const editor = leaf.view?.editor;
    if (editor) {
      editor.setCursor({ line, ch });
      editor.scrollIntoView({ from: { line, ch }, to: { line, ch } }, true);
      if (!silent) new Notice(`已跳转到 📍（第 ${line + 1} 行）`);
    } else if (!silent) new Notice('编辑器不可用。');
  }

  // ---- Stats -------------------------------------------------------------

  async stats() {
    await this.openDashboard('stats');
  }

  async performanceDiagnostics() {
    const now = () => window.performance?.now?.() ?? Date.now();
    let started = now();
    const files = getAllIRFiles(this.app, this.settings);
    const scanMs = now() - started;

    started = now();
    const rows = files.map(tfile => ({ tfile, fm: getFm(this.app, tfile) })).filter(row => row.fm);
    for (const row of rows) irViewSignature(this.app, row.tfile);
    const metadataMs = now() - started;

    started = now();
    treeCore.buildTreeIndex(rows
      .filter(row => ['category', 'source', 'extract', 'card'].includes(row.fm.type))
      .map(row => ({ path: row.tfile.path, basename: row.tfile.basename, fm: row.fm, tfile: row.tfile })));
    const treeMs = now() - started;

    this.duePoolCache = null;
    this.cardDueCache.clear();
    started = now();
    const due = await this.buildDuePool({ skipCurrent: false });
    const dueMs = now() - started;
    const cards = rows.filter(row => row.fm.type === 'card').length;
    const result = {
      files: files.length,
      cards,
      due: due.length,
      folder_scan_ms: Math.round(scanMs * 10) / 10,
      metadata_ms: Math.round(metadataMs * 10) / 10,
      tree_index_ms: Math.round(treeMs * 10) / 10,
      due_pool_ms: Math.round(dueMs * 10) / 10,
    };
    console.info('[Incremental Reading Toolkit] performance diagnostics', result);
    new Notice([
      `IR 诊断 · ${result.files} 个文件（${result.cards} 张卡片）`,
      `文件夹扫描 ${result.folder_scan_ms}ms · 元数据 ${result.metadata_ms}ms`,
      `树索引 ${result.tree_index_ms}ms · 到期池 ${result.due_pool_ms}ms`,
      '完整详情已写入开发者控制台。',
    ].join('\n'), 15000);
    return result;
  }

  // ---- Splits ------------------------------------------------------------

  async splitArticle() {
    const active = this.app.workspace.getActiveFile();
    if (!active || active.extension !== 'md') { new Notice('请打开一篇来源笔记。'); return; }
    const fm = getFm(this.app, active);
    if (!fm || fm.type !== 'source') { new Notice('不是来源。'); return; }
    if (fm.source_type !== 'article') { new Notice('仅限文章 — 书籍请使用拆分书籍。'); return; }
    if (fm.status === 'container') { new Notice('已拆分。'); return; }

    const content = await this.app.vault.read(active);
    const fmEnd = content.indexOf('\n---', 3);
    const body = fmEnd !== -1 ? content.slice(fmEnd + 4) : content;
    const headings = [...body.matchAll(/^## (.+)$/gm)].map(m => ({ title: m[1].trim(), index: m.index }));
    if (headings.length === 0) { new Notice('未找到 H2 标题。'); return; }

    const confirmed = await askLong(this.app,
      '用于拆分的标题（删除行即跳过）',
      headings.map(h => h.title).join('\n'));
    if (!confirmed || confirmed.trim() === '') return;
    const titles = new Set(confirmed.split('\n').map(s => s.trim()).filter(Boolean));
    const selected = headings.filter(h => titles.has(h.title));
    if (selected.length === 0) return;

    const today = todayDateString(this.settings);
    const parentTitle = active.basename;
    const priority = fm.priority ?? 50;
    const baseInterval = priorityToInterval(priority);
    const folder = active.parent.path;
    const links = [];

    for (let i = 0; i < selected.length; i++) {
      const h = selected[i];
      const next = headings[headings.indexOf(h) + 1];
      const sectionBody = body.slice(h.index, next ? next.index : body.length).trimEnd();
      const interval = baseInterval + i;
      const nextReview = futureDateString(interval, this.settings);
      const noteTitle = slugifyForFolder(`${parentTitle} - ${h.title}`) || `${parentTitle} - 第 ${i + 1} 节`;
      const noteContent = `---
type: source
source_type: article
status: inbox // enhance：拆分产物停在收件箱，不自动进队列
parent: ${JSON.stringify(`[[${parentTitle}]]`)}
priority: ${priority}
next_review: ${nextReview}
interval: ${interval}
a_factor: 2.0
review_count: 0
last_reviewed:
date_added: ${today}
tags:
  - incremental-reading
  - ir/source
  - ir/sub-topic
---

${sectionBody}
`;
      const p = `${folder}/${noteTitle}.md`;
      if (!this.app.vault.getAbstractFileByPath(p)) {
        await this.app.vault.create(p, noteContent);
      }
      links.push(`- [[${noteTitle}]]`);
    }

    const subSection = `\n## Sub-topics\n\n${links.join('\n')}\n`;
    const bodyWithoutOld = content.replace(/\n## Sub-topics[\s\S]*?(?=\n## |$)/, '');
    await this.app.vault.process(active, () => bodyWithoutOld + subSection);
    await this.app.fileManager.processFrontMatter(active, (fmw) => { fmw.status = 'container'; });
    new Notice(`已拆分为 ${selected.length} 个子主题${selected.length === 1 ? '' : 's'}。`);
  }

  async splitBook() {
    const active = this.app.workspace.getActiveFile();
    if (!active || active.extension !== 'md') { new Notice('请打开一篇书籍来源笔记。'); return; }
    const fm = getFm(this.app, active);
    if (!fm || fm.type !== 'source') { new Notice('不是来源。'); return; }
    if (fm.status === 'container') { new Notice('已经是容器。'); return; }
    if (fm.source_type !== 'book' && fm.source_type !== 'pdf') {
      const cont = await confirmDialog(this.app, "不是书籍/PDF — 仍要继续吗？");
      if (!cont) return;
    }
    const toc = await askLong(this.app,
      "粘贴章节列表（每行一章）：'START-END: Title' 或 'START: Title'",
      '');
    if (!toc) return;
    const lines = toc.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) { new Notice('请至少输入一个章节。'); return; }
    const chapters = [];
    for (const line of lines) {
      const m = line.match(/^(\d+)\s*(?:[-–—]\s*(\d+))?\s*[:：]\s*(.+)$/);
      if (!m) { new Notice(`无法解析：「${line}」`); return; }
      const title = m[3].trim();
      if (!title) { new Notice(`缺少章节标题：「${line}」`); return; }
      chapters.push({ start: Number(m[1]), end: m[2] ? Number(m[2]) : null, title });
    }
    for (let i = 0; i < chapters.length; i++) {
      if (chapters[i].end == null) {
        chapters[i].end = (i + 1 < chapters.length)
          ? chapters[i + 1].start - 1
          : (fm.total_pages ?? chapters[i].start);
      }
    }
    const totalPages = Number(fm.total_pages) > 0 ? Number(fm.total_pages) : null;
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];
      const previous = chapters[i - 1];
      if (chapter.start < 1 || chapter.end < chapter.start) {
        new Notice(`「${chapter.title}」的页码范围无效。`); return;
      }
      if (previous && chapter.start <= previous.end) {
        new Notice(`「${chapter.title}」附近的章节范围重叠或顺序错误。`); return;
      }
      if (totalPages && chapter.end > totalPages) {
        new Notice(`「${chapter.title}」的结束位置超出了来源的 ${totalPages} 页。`); return;
      }
    }

    const parentTitle = active.basename;
    const priority = fm.priority ?? 50;
    const baseInterval = priorityToInterval(priority);
    const sourceType = fm.source_type ?? 'book';
    const pdfPath = fm.pdf_path ?? fm.pdf_vault_path ?? fm.sioyek_path ?? null;
    const dateAdded = fm.date_added ?? todayDateString(this.settings);
    const folder = this.sourcesFolder();
    await ensureFolder(this.app, folder);
    let created = 0;
    const skipped = [];

    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      const num = String(i + 1).padStart(2, '0');
      const safeTitle = slugifyForFolder(ch.title) || `第 ${i + 1} 章`;
      const name = slugifyForFolder(`${parentTitle} - Ch${num} ${safeTitle}`);
      const path = `${folder}/${name}.md`;
      if (this.app.vault.getAbstractFileByPath(path)) { skipped.push(name); continue; }

      const chInterval = baseInterval + i;
      const chNext = futureDateString(chInterval, this.settings);
      const chPages = (ch.end != null && ch.start != null) ? Math.max(1, ch.end - ch.start + 1) : null;
      const chAFactor = round4(initialAFactor(this.settings, { total_pages: chPages }));

      const content = `---
type: source
source_type: ${sourceType}
status: active
priority: ${priority}
parent: ${JSON.stringify(`[[${parentTitle}]]`)}
chapter_num: ${i + 1}
next_review: ${chNext}
interval: ${chInterval}
a_factor: ${chAFactor}
review_count: 0
last_reviewed:
read_point: ${ch.start}
page_start: ${ch.start}
page_end: ${ch.end}
total_pages: ${totalPages}
pdf_path: ${pdfPath ? JSON.stringify(pdfPath) : ''}
date_added: ${dateAdded}
tags:
  - incremental-reading
  - ir/source
  - ir/chapter
---

# ${ch.title}

> [!tip] Parent
> [[${parentTitle}]] — pages ${ch.start}–${ch.end} (${ch.end - ch.start + 1}p)

## Notes


## Extracts

`;
      await this.app.vault.create(path, content);
      created++;
    }

    await this.app.fileManager.processFrontMatter(active, (fmw) => {
      fmw.status = 'container';
      fmw.next_review = null;
    });
    await this.app.vault.process(active, (cur) => {
      if (cur.includes('## Chapters')) return cur;
      const list = chapters.map((ch, i) => {
        const num = String(i + 1).padStart(2, '0');
        const safeTitle = slugifyForFolder(ch.title) || `第 ${i + 1} 章`;
        const name = slugifyForFolder(`${parentTitle} - Ch${num} ${safeTitle}`);
        return `- [[${name}]] (p.${ch.start}–${ch.end})`;
      }).join('\n');
      return cur.trimEnd() + `\n\n## Chapters\n\n${list}\n`;
    });
    const skipMsg = skipped.length ? ` | 已跳过 ${skipped.length} 个（已存在）` : '';
    new Notice(`已拆分：${created} 个章节。${skipMsg}`);
  }
}

function formatSeconds(s) {
  const sec = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

// Helper used outside the class (newSource)
function parseTimeInput(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (s === '') return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const parts = s.split(':').map(p => p.trim());
  if (!parts.every(p => /^\d+$/.test(p))) return null;
  if (parts.length === 2) {
    const [minutes, seconds] = parts.map(Number);
    return seconds < 60 ? minutes * 60 + seconds : null;
  }
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts.map(Number);
    return minutes < 60 && seconds < 60 ? hours * 3600 + minutes * 60 + seconds : null;
  }
  return null;
}

module.exports = IncrementalReadingPlugin;
