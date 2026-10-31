// Hard bot: the normal bot's analysis, plus one more step of looking ahead when it chooses a discard, with
// weights tuned by playing bots against each other (scripts/tune-bot.ts, duplicate format).
//
// The normal bot asks of each discard "how many tiles improve this hand?" (ukeire). The hard bot also asks
// "and how good is the hand after that improvement?": for every improving draw it finds the best follow-up
// discard and counts that hand's improving tiles too. Shapes that keep improving beat shapes that accept
// one tile and then stall. Everything still comes from the bot's own view; no peeking.

import { analyze, Analysis, AnalyzerInput, liveCounts, WEIGHTS } from '../analyzer/analyze';
import { shantenOfCounts } from '../analyzer/shanten';
import { JOKER, Kind, PLAYABLE } from '../engine/tiles';

/**
 * Tunable: the normal bot's three weights, plus how much the second step counts (0 = the normal bot).
 * Tuned 2026-11-01 (scripts/tune-bot.ts, 600 deals a trial): these weights earn +0.08 +/- 0.10 RM/round
 * against two normal bots on 1,000 fresh deals; the second step alone earned +0.00. The normal bot's level
 * is set by its heuristics, not these numbers.
 */
export const HARD = { ukeire: 1.5, fan: 2.25, defence: 0.444, ukeire2: 0.5, candidates: 4 };

/** The normal analysis, run with the hard bot's weights. */
export function hardAnalyze(input: AnalyzerInput): Analysis {
  const saved = { ...WEIGHTS };
  Object.assign(WEIGHTS, { ukeire: HARD.ukeire, fan: HARD.fan, defence: HARD.defence });
  try {
    return analyze(input);
  } finally {
    Object.assign(WEIGHTS, saved);
  }
}

/** Improving tiles of a 13-tile hand given as counts, weighted by how many of each are still live. */
function ukeireOfCounts(c: number[], fei: number, meldCount: number, live: number[], now: number): number {
  let total = 0;
  for (let t = 0; t < PLAYABLE; t++) {
    if (!live[t]) continue;
    c[t]++;
    if (shantenOfCounts(c, fei, meldCount).best < now) total += live[t];
    c[t]--;
  }
  if (live[JOKER] && shantenOfCounts(c, fei + 1, meldCount).best < now) total += live[JOKER];
  return total;
}

/**
 * Second-order ukeire of a 13-tile hand: over every improving draw, the best follow-up hand's ukeire,
 * weighted by how many copies of that draw are live. Returned per live improving tile, so it is on the same
 * scale as plain ukeire (roughly "how many tiles improve the hand after the next improvement").
 */
export function ukeire2(hand13: Kind[], meldCount: number, live: number[]): number {
  const c = new Array(PLAYABLE).fill(0);
  let fei = 0;
  for (const t of hand13) if (t === JOKER) fei++; else c[t]++;
  const now = shantenOfCounts(c, fei, meldCount).best;
  let weighted = 0;
  let draws = 0;
  const after = (drawn: Kind | null) => {
    // Live counts once this tile is drawn: one fewer of it elsewhere.
    const live2 = live.slice();
    if (drawn !== null) live2[drawn]--;
    let best = 0;
    for (let d = 0; d < PLAYABLE; d++) {
      if (!c[d]) continue;
      c[d]--;
      if (shantenOfCounts(c, fei, meldCount).best === now - 1) best = Math.max(best, ukeireOfCounts(c, fei, meldCount, live2, now - 1));
      c[d]++;
    }
    return best;
  };
  for (let t = 0; t < PLAYABLE; t++) {
    if (!live[t]) continue;
    c[t]++;
    if (shantenOfCounts(c, fei, meldCount).best < now) {
      weighted += live[t] * after(t);
      draws += live[t];
    }
    c[t]--;
  }
  if (live[JOKER]) {
    fei++;
    if (shantenOfCounts(c, fei, meldCount).best < now) {
      weighted += live[JOKER] * after(JOKER);
      draws += live[JOKER];
    }
    fei--;
  }
  return draws ? weighted / draws : 0;
}

/** The hard bot's discard: among the best-shanten discards, the normal value plus the second step. */
export function hardDiscard(input: AnalyzerInput, analysis: Analysis): Kind {
  const options = analysis.options;
  const bestShanten = options[0].shanten;
  const cands = options.filter((o) => o.shanten === bestShanten).slice(0, HARD.candidates);
  if (cands.length <= 1 || bestShanten < 1) return options[0].tile; // ready hands: waits matter, not shape
  const live = liveCounts(input);
  let best = cands[0];
  let bestValue = -Infinity;
  for (const o of cands) {
    const hand13 = input.hand.slice();
    hand13.splice(hand13.indexOf(o.tile), 1);
    const value = o.value + HARD.ukeire2 * 8 * ukeire2(hand13, input.melds.length, live);
    if (value > bestValue) {
      bestValue = value;
      best = o;
    }
  }
  return best.tile;
}
