'use strict';

// Pure formatting and backend detection for Toolkit, SR, and Anki cards.

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

module.exports = { normalizeCardBackend, storedCardBackend, compactFlashcardField, flashcardsPluginBody };
