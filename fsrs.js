/**
 * FSRS-V4 (Free Spaced Repetition Scheduler)
 * Minimale Implementierung der Anki-Variante, vanilla JS.
 * Referenz: https://github.com/open-spaced-repetition/fsrs4anki
 *
 * Card-Schema: { D, S, last, due, reps, lapses, state }
 *   D: difficulty (1-10)
 *   S: stability in days
 *   last: epoch ms of last review (0 = never)
 *   due: epoch ms when next due
 *   reps: total reviews
 *   lapses: count of "again" ratings
 *   state: "new" | "learning" | "review" | "relearning"
 *
 * Rating: 1=Again, 2=Hard, 3=Good, 4=Easy
 */

const FSRS_DEFAULT_WEIGHTS = [
  0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14,
  0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61
];

const REQUEST_RETENTION = 0.9;
const DECAY = -0.5;
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;
const DAY_MS = 86400000;

function clampD(d) {
  return Math.max(1, Math.min(10, d));
}

function initStability(rating, w) {
  return Math.max(0.1, w[rating - 1]);
}

function initDifficulty(rating, w) {
  return clampD(w[4] - (rating - 3) * w[5]);
}

function meanRevert(current, target, weight) {
  return weight * target + (1 - weight) * current;
}

function nextDifficulty(d, rating, w) {
  const newD = d - w[6] * (rating - 3);
  return clampD(meanRevert(newD, w[4], w[7]));
}

function retrievability(elapsedDays, s) {
  if (s <= 0) return 0;
  return Math.pow(1 + FACTOR * elapsedDays / s, DECAY);
}

function nextStabilityReview(d, s, r, rating, w) {
  const hardPenalty = rating === 2 ? w[15] : 1;
  const easyBonus = rating === 4 ? w[16] : 1;
  return s * (1 + Math.exp(w[8]) *
    (11 - d) *
    Math.pow(s, -w[9]) *
    (Math.exp(w[10] * (1 - r)) - 1) *
    hardPenalty *
    easyBonus);
}

function nextStabilityForget(d, s, r, w) {
  return w[11] *
    Math.pow(d, -w[12]) *
    (Math.pow(s + 1, w[13]) - 1) *
    Math.exp(w[14] * (1 - r));
}

function intervalDays(s) {
  return Math.max(1, Math.round(
    s * (Math.pow(REQUEST_RETENTION, 1 / DECAY) - 1) / FACTOR
  ));
}

export function fsrsNewCard() {
  return {
    D: 0,
    S: 0,
    last: 0,
    due: 0,
    reps: 0,
    lapses: 0,
    state: "new"
  };
}

export function fsrsReview(card, rating, now, weights = FSRS_DEFAULT_WEIGHTS) {
  const w = weights;
  const c = { ...card };

  if (!c.last || c.state === "new") {
    // First review
    c.D = initDifficulty(rating, w);
    c.S = initStability(rating, w);
    c.reps = 1;
    c.lapses = rating === 1 ? 1 : 0;
    c.state = rating === 1 ? "learning" : "review";
  } else {
    const elapsedDays = Math.max(0, (now - c.last) / DAY_MS);
    const r = retrievability(elapsedDays, c.S);
    c.D = nextDifficulty(c.D, rating, w);
    if (rating === 1) {
      c.lapses += 1;
      c.S = Math.max(0.1, nextStabilityForget(c.D, c.S, r, w));
      c.state = "relearning";
    } else {
      c.S = Math.max(0.1, nextStabilityReview(c.D, c.S, r, rating, w));
      c.state = "review";
    }
    c.reps += 1;
  }

  c.last = now;
  c.due = now + intervalDays(c.S) * DAY_MS;
  return c;
}

/**
 * Manueller "Kenne ich schon"-Skip: schiebt Karte auf 60 Tage,
 * mit moderaten Initialwerten falls noch ungeprüft.
 */
export function fsrsSkip(card, now) {
  const c = { ...card };
  c.last = now;
  c.due = now + 60 * DAY_MS;
  c.state = "review";
  if (c.S < 60) c.S = 60;
  if (c.D === 0) c.D = 5;
  if (c.reps === 0) c.reps = 1;
  return c;
}

/**
 * Bei Stau (z.B. nach Wochen Pause): Karten werden nicht alle auf "jetzt"
 * gelegt, sondern proportional zu ihrer Stability gestaffelt.
 * Verhindert, dass nach 14 Tagen Pause alle 200 Karten gleichzeitig anstehen.
 */
export function fsrsRedistribute(cards, now) {
  // Sortiere überfällige Karten nach S aufsteigend (instabilste zuerst)
  const overdue = cards.filter(c => c.due && c.due < now && c.state !== "new");
  overdue.sort((a, b) => a.S - b.S);
  // Verteile auf max. 14 Tage, max. 25 pro Tag
  const perDay = 25;
  let dayOffset = 0;
  let countToday = 0;
  for (const c of overdue) {
    if (countToday >= perDay) {
      dayOffset += 1;
      countToday = 0;
      if (dayOffset > 14) break;
    }
    c.due = now + dayOffset * DAY_MS;
    countToday += 1;
  }
  return cards;
}

export function isDue(card, now) {
  if (!card || card.state === "new" || card.reps === 0) return true;
  return card.due <= now;
}
