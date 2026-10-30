// Shanten: how many tiles away a hand is from ready (0 = one tile from winning, -1 = a winning hand).
// Works for 13-tile hands (after a discard) and 14-tile hands (before one), counting exposed melds.
//
// Jokers are wild, so each joker fills one missing tile. The 4-copies limit on jokers is ignored here
// (it matters only in rare hands); the engine's scorer enforces it on actual wins.

import { isDot, JOKER, Kind, PLAYABLE } from '../engine';

export interface Shanten {
  standard: number;
  /** 7 Pairs (and 7 Stars / Big Wheel): no jokers allowed, but jokers can be set aside for free. */
  sevenPairs: number;
  /** 13 Wonders: needs all 4 jokers. */
  wonders: number;
  best: number;
}

const memo = new Map<string, number>();

/** Fewest tiles missing to complete `sets` sets plus a pair, using real tiles only. */
function minMissing(c: number[], sets: number): number {
  const key = c.join('') + '/' + sets;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;

  let best = 3 * sets + 2;
  // full: complete sets; part: two-tile partial sets; pair: has a pair for the pair slot; singles: lone tiles.
  const rec = (i: number, full: number, part: number, pair: boolean, singles: number) => {
    while (i < PLAYABLE && c[i] === 0) i++;
    if (i === PLAYABLE) {
      let missing = part;
      let s = singles;
      if (!pair) {
        if (s > 0) { s--; missing += 1; } else missing += 2;
      }
      const open = sets - full - part;
      const fromSingles = Math.min(open, s);
      missing += fromSingles * 2 + (open - fromSingles) * 3;
      if (missing < best) best = missing;
      return;
    }
    const groups = full + part;
    if (groups < sets) {
      if (c[i] >= 3) { c[i] -= 3; rec(i, full + 1, part, pair, singles); c[i] += 3; }
      if (isDot(i) && i <= 6 && c[i + 1] && c[i + 2]) {
        c[i]--; c[i + 1]--; c[i + 2]--; rec(i, full + 1, part, pair, singles); c[i]++; c[i + 1]++; c[i + 2]++;
      }
    }
    if (!pair && c[i] >= 2) { c[i] -= 2; rec(i, full, part, true, singles); c[i] += 2; }
    if (groups < sets) {
      if (c[i] >= 2) { c[i] -= 2; rec(i, full, part + 1, pair, singles); c[i] += 2; }
      if (isDot(i) && i <= 7 && c[i + 1]) { c[i]--; c[i + 1]--; rec(i, full, part + 1, pair, singles); c[i]++; c[i + 1]++; }
      if (isDot(i) && i <= 6 && c[i + 2]) { c[i]--; c[i + 2]--; rec(i, full, part + 1, pair, singles); c[i]++; c[i + 2]++; }
    }
    c[i]--; rec(i, full, part, pair, singles + 1); c[i]++;
  };
  rec(0, 0, 0, false, 0);
  memo.set(key, best);
  return best;
}

export function shanten(hand: Kind[], meldCount: number): Shanten {
  const c = new Array(PLAYABLE).fill(0);
  let jokers = 0;
  for (const t of hand) if (t === JOKER) jokers++; else c[t]++;

  const sets = 4 - meldCount;
  const standard = Math.max(-1, minMissing(c, sets) - jokers - 1);

  let sevenPairs = 99;
  let wonders = 99;
  if (meldCount === 0) {
    // Jokers are set aside and replaced, so the real tiles are what count; a replacement is a free extra try.
    // Four of a kind counts as two pairs here (Q7), so distinct kinds don't matter.
    const pairs = c.reduce((a, n) => a + Math.floor(n / 2), 0);
    sevenPairs = 6 - Math.min(pairs, 7);

    const wonderKinds = [9, 10, 11, 12, 13, 14, 15, 0, 8];
    const have = wonderKinds.filter((k) => c[k] > 0).length;
    const dup = wonderKinds.some((k) => c[k] >= 2) ? 1 : 0;
    wonders = 9 - have + (1 - dup) + (4 - jokers) - 1;
  }
  return { standard, sevenPairs, wonders, best: Math.min(standard, sevenPairs, wonders) };
}
