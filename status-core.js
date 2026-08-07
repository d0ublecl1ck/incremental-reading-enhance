'use strict';
// Pure, Obsidian-free status transitions for sources, extracts, and cards.

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

module.exports = {
  RESET_SCHEDULING_FIELDS,
  normalizedTagList,
  managedCardDeckTag,
  completeItemFrontmatter,
  resetItemFrontmatter,
  clearSpacedRepetitionSchedule,
};
