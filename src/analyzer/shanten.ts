// Shanten: how many tiles away a hand is from ready (0 = one tile from winning, -1 = a winning hand).
// Works for 13-tile hands (after a discard) and 14-tile hands (before one), counting exposed melds.
//
// Jokers are wild, so each joker fills one missing tile. The 4-copies limit on jokers is ignored here
// (it matters only in rare hands); the engine's scorer enforces it on actual wins.

// Imported from the module itself, not the engine index: in the hot loops below, going through the index
// re-exports costs a lookup per use under tsx (it was the biggest cost in the training server's hints).
import { JOKER, Kind, PLAYABLE } from '../engine/tiles';

export interface Shanten {
  standard: number;
  /** 7 Pairs (and 7 Stars / Big Wheel): no jokers allowed, but jokers can be set aside for free. */
  sevenPairs: number;
  /** 13 Wonders: needs all 4 jokers. */
  wonders: number;
  best: number;
}

/** [complete sets, two-tile partial sets, has a pair for the pair slot] */
type Combo = [number, number, number];

const dotMemo = new Map<number, Combo[]>();

/**
 * Every useful way to group the dots (only 9 kinds, so this is small and cached by dots pattern).
 * Dominated combos (no better in any count) are dropped.
 */
function dotCombos(c: number[]): Combo[] {
  let key = 0;
  for (let i = 0; i < 9; i++) key = key * 5 + c[i];
  const hit = dotMemo.get(key);
  if (hit) return hit;

  // Many groupings give the same counts; keep each distinct (f, p, pair) once.
  const seen = new Set<number>();
  const d = c.slice(0, 9);
  const rec = (i: number, f: number, p: number, pair: number) => {
    while (i < 9 && d[i] === 0) i++;
    if (i === 9) return void seen.add(f * 100 + p * 10 + pair);
    if (d[i] >= 3) { d[i] -= 3; rec(i, f + 1, p, pair); d[i] += 3; }
    if (i <= 6 && d[i + 1] && d[i + 2]) { d[i]--; d[i + 1]--; d[i + 2]--; rec(i, f + 1, p, pair); d[i]++; d[i + 1]++; d[i + 2]++; }
    if (d[i] >= 2) {
      d[i] -= 2;
      if (!pair) rec(i, f, p, 1);
      rec(i, f, p + 1, pair);
      d[i] += 2;
    }
    if (i <= 7 && d[i + 1]) { d[i]--; d[i + 1]--; rec(i, f, p + 1, pair); d[i]++; d[i + 1]++; }
    if (i <= 6 && d[i + 2]) { d[i]--; d[i + 2]--; rec(i, f, p + 1, pair); d[i]++; d[i + 2]++; }
    d[i]--; rec(i, f, p, pair); d[i]++; // leave one as a single
  };
  rec(0, 0, 0, 0);
  const found: Combo[] = [...seen].map((v) => [Math.floor(v / 100), Math.floor(v / 10) % 10, v % 10]);
  const pareto = found.filter((a) => !found.some((b) =>
    b !== a && b[0] >= a[0] && b[1] >= a[1] && b[2] >= a[2]));
  dotMemo.set(key, pareto);
  return pareto;
}

// Finished answers. The result depends only on the dots pattern, the honour pong and pair counts, the tile
// total and the sets needed, so that is the key (a plain number: under 2^34).
const missingMemo = new Map<number, number>();

/** Fewest tiles missing to complete `sets` sets plus a pair, using real tiles only. */
function minMissing(c: number[], sets: number): number {
  // Honours can't chow, so each kind is simply a set (3+), a pair (2) or a single.
  let real = 0;
  let dotKey = 0;
  for (let i = 0; i < 9; i++) { dotKey = dotKey * 5 + c[i]; real += c[i]; }
  let triples = 0;
  let pairs = 0;
  for (let k = 9; k < PLAYABLE; k++) {
    real += c[k];
    if (c[k] >= 3) triples++;
    else if (c[k] === 2) pairs++;
  }
  const key = (((dotKey * 8 + triples) * 8 + pairs) * 32 + real) * 5 + sets;
  const hit = missingMemo.get(key);
  if (hit !== undefined) return hit;
  const result = computeMissing(c, sets, real, triples, pairs);
  missingMemo.set(key, result);
  return result;
}

function computeMissing(c: number[], sets: number, real: number, triples: number, pairs: number): number {
  // Where the pair-slot pair comes from among the honours: none, an honour pair, or a broken honour pong.
  const honourChoices: Combo[] = [[triples, pairs, 0]];
  if (pairs) honourChoices.push([triples, pairs - 1, 1]);
  if (triples) honourChoices.push([triples - 1, pairs, 1]);

  let best = 3 * sets + 2;
  for (const [df, dp, dpair] of dotCombos(c)) {
    for (const [hf, hp, hpair] of honourChoices) {
      let f = df + hf;
      let p = dp + hp + (dpair && hpair ? 1 : 0); // a second pair can still be a partial set
      const pair = dpair || hpair ? 1 : 0;
      f = Math.min(f, sets);
      p = Math.min(p, sets - f);
      let singles = real - 3 * f - 2 * p - 2 * pair;
      let missing = p;
      if (!pair) {
        if (singles > 0) { singles--; missing += 1; } else missing += 2;
      }
      const open = sets - f - p;
      const fromSingles = Math.min(open, Math.max(0, singles));
      missing += fromSingles * 2 + (open - fromSingles) * 3;
      if (missing < best) best = missing;
    }
  }
  return best;
}

export function shanten(hand: Kind[], meldCount: number): Shanten {
  const c = new Array(PLAYABLE).fill(0);
  let jokers = 0;
  for (const t of hand) if (t === JOKER) jokers++; else c[t]++;
  return shantenOfCounts(c, jokers, meldCount);
}

const WONDER_KINDS = [9, 10, 11, 12, 13, 14, 15, 0, 8];

/**
 * The same, from tile counts (16 playable kinds) and a joker count. Doesn't change `c`, so callers trying
 * many "discard this, draw that" variations can adjust one count, ask, and put it back without copying.
 */
export function shantenOfCounts(c: number[], jokers: number, meldCount: number): Shanten {
  const standard = Math.max(-1, minMissing(c, 4 - meldCount) - jokers - 1);
  let sevenPairs = 99;
  let wonders = 99;
  if (meldCount === 0) {
    // Jokers are set aside and replaced, so the real tiles are what count; a replacement is a free extra try.
    // Four of a kind counts as two pairs here (Q7), so distinct kinds don't matter.
    let pairs = 0;
    for (let k = 0; k < PLAYABLE; k++) pairs += c[k] >> 1;
    sevenPairs = 6 - Math.min(pairs, 7);
    let have = 0;
    let dup = 0;
    for (const k of WONDER_KINDS) {
      if (c[k] > 0) have++;
      if (c[k] >= 2) dup = 1;
    }
    wonders = 9 - have + (1 - dup) + (4 - jokers) - 1;
  }
  return { standard, sevenPairs, wonders, best: Math.min(standard, sevenPairs, wonders) };
}
