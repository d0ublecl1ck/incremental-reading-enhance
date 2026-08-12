'use strict';

// Pure, Obsidian-free FSRS-6 scheduling used by Toolkit-owned flashcards.

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

module.exports = {
  DEFAULT_FSRS_SETTINGS,
  fsrsContext,
  fsrsRetrievability,
  fsrsInterval,
  scheduleFsrsReview,
};
