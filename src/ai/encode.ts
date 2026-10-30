// What a learning AI sees and can do, as fixed-size numbers.
//
// Observation: built only from the acting player's PlayerView (same information as a human or bot gets).
// Actions: 42 fixed slots; a mask marks which are legal right now.
//
//   0-15  discard kind k           16 set a fei aside        17 self-drawn win     18 win (discard/rob)
//   19    pass                     20 pong                   21 kong a discard
//   22-24 chow with the discard as the low / middle / high tile
//   25-40 kong of kind k (concealed, or adding to an exposed pong)
//   41    Joker Opening Slam

import { afterClaim, inputFromView, liveCounts, shanten } from '../analyzer';
import { Action, bonusNumber, GameState, isBonus, isFlower, JOKER, Kind, loserFan, Meld, PLAYABLE, PlayerView } from '../engine';

export const ACTIONS = 42;

/** Which slot an action fills. */
export function actionSlot(a: Action, claimTile: Kind | null): number {
  switch (a.type) {
    case 'discard': return a.tile;
    case 'discardJoker': return 16;
    case 'selfWin': return 17;
    case 'win': return 18;
    case 'pass': return 19;
    case 'pong': return 20;
    case 'claimKong': return 21;
    case 'chow': return 22 + (claimTile! - a.start); // discard at position 0, 1 or 2 of the chow
    case 'kong': return 25 + a.kind;
    case 'openingSlam': return 41;
  }
}

/**
 * The legal actions by slot. Where several legal actions share a slot (chows that could use a fei or a
 * real tile), the one using the fewest fei is kept.
 */
export function slotActions(legal: Action[], claimTile: Kind | null): (Action | null)[] {
  const out: (Action | null)[] = new Array(ACTIONS).fill(null);
  const feiUsed = (a: Action) => (a.type === 'chow' ? a.jokerKinds.length : 'jokers' in a ? a.jokers : 0);
  for (const a of legal) {
    const i = actionSlot(a, claimTile);
    const cur = out[i];
    if (!cur || feiUsed(a) < feiUsed(cur)) out[i] = a;
  }
  return out;
}

// Observation layout (all values roughly 0-1).
const KINDS = PLAYABLE; // 16
const SECTIONS = {
  hand: KINDS * 4,          // count >= 1, 2, 3, 4 for each kind
  handFei: 5,               // fei in hand: 0..4 one-hot
  ownMelds: KINDS * 3,      // pong/kong, kong, chow-start per kind
  ownMeldFei: 1,
  ownDiscards: KINDS,       // count / 4
  ownBonus: 17,             // flowers 1-4, seasons 1-4 (own seat and 4 marked), 8 others summed, fei set aside
  unseen: KINDS + 1,        // copies not visible to me / 4, fei / 4
  opp: 2 * (KINDS * 3 + KINDS + 4 + KINDS), // per opponent: melds, discards, [hand size, fei aside, visible fan, bonus count], last discards
  seat: 3 + 3,              // my seat, dealer relative to me
  phase: 4,                 // opening / turn / claim / robKong
  claim: KINDS + 1 + 2,     // claim tile one-hot (+ fei), from: next / previous player
  misc: 4,                  // wall left, my turn, win available, win fan / 10
};
export const OBS = Object.values(SECTIONS).reduce((a, b) => a + b, 0);

/** Encodes a player's view into `out` (length OBS) starting at `at`. */
export function encodeView(v: PlayerView, out: Float32Array, at = 0) {
  let i = at;
  const put = (x: number) => { out[i++] = x; };
  const me = v.me;
  const rel = (p: number) => (p - me + 3) % 3; // 0 me, 1 next (right), 2 previous (left)

  // Own hand.
  const counts = new Array(KINDS).fill(0);
  let fei = 0;
  for (const t of v.hand) if (t === JOKER) fei++; else counts[t]++;
  for (let k = 0; k < KINDS; k++) for (let n = 1; n <= 4; n++) put(counts[k] >= n ? 1 : 0);
  for (let n = 0; n <= 4; n++) put(fei === n ? 1 : 0);

  const meldPlanes = (melds: Meld[]) => {
    const pong = new Array(KINDS).fill(0), kong = new Array(KINDS).fill(0), chow = new Array(KINDS).fill(0);
    let mf = 0;
    for (const m of melds) {
      const k = m.slots[0].kind;
      if (m.type === 'chow') chow[k] += 0.5; else pong[k] = 1;
      if (m.type === 'kong') kong[k] = 1;
      mf += m.slots.filter((s) => s.joker).length;
    }
    return { planes: [...pong, ...kong, ...chow], fei: mf };
  };
  const own = meldPlanes(v.self.melds);
  own.planes.forEach(put);
  put(own.fei / 4);

  const discards = (tiles: Kind[]) => {
    const c = new Array(KINDS).fill(0);
    for (const t of tiles) if (t < KINDS) c[t]++;
    return c.map((x) => x / 4);
  };
  discards(v.self.discards).forEach(put);

  // Own bonus tiles: numbered ones by number, flagged when they score for my seat (own number or 4).
  const ownNum = v.seat + 1;
  const bonusVec = new Array(17).fill(0);
  for (const b of v.self.bonus) {
    if (!isBonus(b)) continue;
    if (b <= 24) {
      const n = bonusNumber(b);
      bonusVec[(isFlower(b) ? 0 : 4) + n - 1] = n === ownNum || n === 4 ? 1 : 0.5;
    } else bonusVec[8 + (b - 25)] = 1;
  }
  bonusVec[16] = v.self.discardedJokers / 4;
  bonusVec.forEach(put);

  // Unseen copies of each kind, from my point of view.
  const seen = new Array(KINDS + 1).fill(0);
  const see = (k: Kind) => { if (k <= JOKER) seen[k]++; };
  v.hand.forEach(see);
  v.players.forEach((o) => {
    o.discards.forEach(see);
    seen[JOKER] += o.discardedJokers;
    o.melds.forEach((m) => m.slots.forEach((s) => see(s.joker ? JOKER : s.kind)));
  });
  for (let k = 0; k <= KINDS; k++) put(Math.max(0, 4 - seen[k]) / 4);

  // Opponents: next player (right), then previous player (left).
  for (const r of [1, 2]) {
    const p = (me + r) % 3;
    const o = v.players[p];
    meldPlanes(o.melds).planes.forEach(put);
    discards(o.discards).forEach(put);
    put(o.handSize / 14);
    put(o.discardedJokers / 4);
    put(loserFan(o.seat, [], o.melds, o.bonus, o.discardedJokers).fan / 10);
    put(o.bonus.length / 16);
    // Their last two discards, most recent weighted higher.
    const last = new Array(KINDS).fill(0);
    o.discards.slice(-2).forEach((t, j, arr) => { if (t < KINDS) last[t] = j === arr.length - 1 ? 1 : 0.5; });
    last.forEach(put);
  }

  for (let s = 0; s < 3; s++) put(v.seat === s ? 1 : 0);
  for (let r = 0; r < 3; r++) put(rel(v.dealer) === r ? 1 : 0);
  for (const ph of ['opening', 'turn', 'claim', 'robKong']) put(v.phase === ph ? 1 : 0);

  for (let k = 0; k <= KINDS; k++) put(v.claimTile === k ? 1 : 0);
  const from = v.phase === 'claim' || v.phase === 'robKong' ? rel(v.turn) : 0;
  put(from === 2 ? 1 : 0); // from the player before me (chow possible)
  put(from === 1 ? 1 : 0);

  put(v.wallLeft / 84);
  put(v.phase === 'turn' && v.turn === me ? 1 : 0);
  put(v.winScore ? 1 : 0);
  put(v.winScore ? v.winScore.fan / 10 : 0);

  if (i - at !== OBS) throw new Error(`Observation size mismatch: wrote ${i - at}, expected ${OBS}`);
}

// ---------------------------------------------------------------------------------------------------
// Hints (v2): the analyzer's hand-reading, which the v1 AI had to discover from raw tiles and couldn't.
// Only the cheap parts: tiles from ready (shanten) and live improving tiles, per possible move. About
// 0.15 ms per decision on your turn. Built from the player's own view only.

const SH_MAX = 6; // shanten values are clamped to -1..6

/** Turn: current shanten (one-hot), then per discard kind: shanten after, is-best flag, live improving tiles.
 *  Claim: shanten now (13 tiles) and after each claim slot (pong, kong, chow low/mid/high). */
export const HINTS = (SH_MAX + 2) + KINDS * 3 + 1 + 5;

const shNorm = (s: number) => (Math.min(SH_MAX, s) + 1) / (SH_MAX + 1);

export function encodeHints(v: PlayerView, out: Float32Array, at = 0) {
  out.fill(0, at, at + HINTS);
  const meldCount = v.self.melds.length;
  const input = inputFromView(v);
  let i = at;
  if (v.phase === 'turn' && v.turn === v.me && v.hand.length + 3 * meldCount === 14) {
    const now = shanten(v.hand, meldCount).best;
    out[i + Math.min(SH_MAX, now) + 1] = 1;
    i += SH_MAX + 2;
    const live = liveCounts(input);
    const after: { k: Kind; sh: number; uk: number }[] = [];
    for (const k of new Set(v.hand)) {
      if (k === JOKER) continue;
      const h = v.hand.slice();
      h.splice(h.indexOf(k), 1);
      const sh = shanten(h, meldCount).best;
      let uk = 0;
      for (let x = 0; x <= JOKER; x++) if (live[x] && shanten([...h, x], meldCount).best < sh) uk += live[x];
      after.push({ k, sh, uk });
    }
    const best = Math.min(...after.map((a) => a.sh));
    for (const a of after) {
      out[i + a.k * 3] = shNorm(a.sh);
      out[i + a.k * 3 + 1] = a.sh === best ? 1 : 0;
      out[i + a.k * 3 + 2] = Math.min(1, a.uk / 60);
    }
    return;
  }
  i += SH_MAX + 2 + KINDS * 3;
  if ((v.phase === 'claim' || v.phase === 'robKong') && v.claimTile !== null && v.legal.length) {
    out[i++] = shNorm(shanten(v.hand, meldCount).best);
    const slots = slotActions(v.legal, v.claimTile);
    [20, 21, 22, 23, 24].forEach((slot, j) => {
      const a = slots[slot];
      const after = a ? afterClaim(input, a, v.claimTile!) : null;
      if (after) out[i + j] = 1 - shNorm(shanten(after.hand, after.melds.length).best);
    });
  }
}

// ---------------------------------------------------------------------------------------------------
// Hidden information, for the training coach only (the value estimate). The player part of the network
// never receives this, so a trained AI plays from its own view alone.

const WALL_AHEAD = 9;  // next normal draws, from the front of the wall
const REPL_AHEAD = 3;  // next kong/bonus replacements, from the back
const PER_KIND = KINDS + 2; // playable kinds, fei, any bonus tile

/** Opponents' concealed hands (next player, then previous), and the coming wall tiles. */
export const PRIV = 2 * (KINDS + 1) + 2 * PER_KIND + 1;

export function encodePrivileged(g: GameState, me: number, out: Float32Array, at = 0) {
  let i = at;
  const put = (x: number) => { out[i++] = x; };
  for (const r of [1, 2]) {
    const c = new Array(KINDS + 1).fill(0);
    for (const t of g.players[(me + r) % 3].hand) c[t === JOKER ? KINDS : t]++;
    c.forEach((x) => put(x / 4));
  }
  const kinds = (tiles: Kind[]) => {
    const c = new Array(PER_KIND).fill(0);
    for (const t of tiles) c[t === JOKER ? KINDS : isBonus(t) ? KINDS + 1 : t]++;
    return c;
  };
  kinds(g.wall.slice(g.head, Math.min(g.tail, g.head + WALL_AHEAD))).forEach((x) => put(x / WALL_AHEAD));
  kinds(g.wall.slice(Math.max(g.head, g.tail - REPL_AHEAD), g.tail)).forEach((x) => put(x / REPL_AHEAD));
  put((g.tail - g.head) / 84);
  if (i - at !== PRIV) throw new Error(`Privileged size mismatch: wrote ${i - at}, expected ${PRIV}`);
}
