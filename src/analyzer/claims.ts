// Advice on claiming a discard (pong, kong, chow or pass), shared by the hint button and the bots.

import { Action, JOKER, Kind, Meld, Slot } from '../engine';
import { analyze, AnalyzerInput, Reach } from './analyze';
import { shanten } from './shanten';

const removeOne = (h: Kind[], t: Kind) => {
  const out = h.slice();
  const i = out.indexOf(t);
  if (i >= 0) out.splice(i, 1);
  return out;
};

/** The hand and melds after making a claim (before discarding). Null for non-claim actions. */
export function afterClaim(input: AnalyzerInput, a: Action, tile: Kind): AnalyzerInput | null {
  let hand = input.hand.slice();
  const take = (k: Kind) => { hand = removeOne(hand, k); };
  let meld: Meld;
  if (a.type === 'pong' || a.type === 'claimKong') {
    const size = a.type === 'pong' ? 3 : 4;
    for (let i = 0; i < size - 1 - a.jokers; i++) take(tile);
    for (let i = 0; i < a.jokers; i++) take(JOKER);
    const slots: Slot[] = [...Array(size)].map((_, i) => ({ kind: tile, joker: i >= size - a.jokers }));
    meld = { type: a.type === 'pong' ? 'pong' : 'kong', slots, concealed: false };
  } else if (a.type === 'chow') {
    const slots: Slot[] = [];
    for (let k = a.start; k < a.start + 3; k++) {
      const joker = a.jokerKinds.includes(k);
      if (k !== tile) take(joker ? JOKER : k);
      slots.push({ kind: k, joker: k !== tile && joker });
    }
    meld = { type: 'chow', slots, concealed: false };
  } else return null;
  return { ...input, hand, melds: [...input.melds, meld] };
}

export interface ClaimAdvice {
  action: Action;
  /** Tiles from ready after the claim and your best discard (kong: before the replacement draw). */
  shanten: number;
  reaches5: Reach | null;
  recommended: boolean;
  note: string;
}

/** Evaluates each claim option against passing. `input.hand` is your 13-tile hand. */
export function claimAdvice(input: AnalyzerInput, legal: Action[], tile: Kind): ClaimAdvice[] {
  const now = shanten(input.hand, input.melds.length).best;
  const out: ClaimAdvice[] = [];
  let bestValue = -Infinity;
  let best: ClaimAdvice | null = null;

  for (const a of legal) {
    if (a.type === 'win') {
      out.push({ action: a, shanten: -1, reaches5: 'yes', recommended: true, note: 'A winning hand.' });
      continue;
    }
    const after = afterClaim(input, a, tile);
    if (!after) continue;
    if (a.type === 'claimKong' && a.jokers > 0) {
      out.push({
        action: a, shanten: shanten(after.hand, after.melds.length).best, reaches5: null, recommended: false,
        // Kong money (2026-10-31): a fei kong now earns kong money, but the fei is used up for good.
        note: `Earns kong money (2 units from the discarder) and a free replacement draw, but uses up ${a.jokers === 1 ? 'your fei' : `${a.jokers} of your fei`}: a pong scores the same fan and keeps the wild tile.`,
      });
      continue;
    }
    if (a.type === 'claimKong') {
      const sh = shanten(after.hand, after.melds.length).best;
      const advice: ClaimAdvice = {
        action: a, shanten: sh, reaches5: null, recommended: false,
        note: sh <= now ? 'Costs nothing and draws a free replacement tile.' : 'Breaks up your hand.',
      };
      out.push(advice);
      if (sh <= now && 1000 > bestValue) { bestValue = 1000; best = advice; }
      continue;
    }
    const opt = analyze(after).options[0];
    if (!opt) continue;
    const better = opt.shanten < now;
    const pays = opt.fan.reaches5 !== 'no' && !(opt.fan.reaches5 === 'unlikely' && opt.shanten > 0);
    const note = !better
      ? `Doesn't get you closer (still ${now} away).`
      : !pays
        ? `Gets you to ${opt.shanten} away, but the hand then can't realistically reach 5 fan.`
        : `Gets you to ${opt.shanten} away${opt.shanten === 0 ? ' (ready)' : ''}; 5 fan: ${opt.fan.reaches5}.`;
    const advice: ClaimAdvice = { action: a, shanten: opt.shanten, reaches5: opt.fan.reaches5, recommended: false, note };
    out.push(advice);
    if (better && pays && opt.value > bestValue) { bestValue = opt.value; best = advice; }
  }

  const win = out.find((x) => x.action.type === 'win');
  if (win) out.forEach((x) => (x.recommended = x === win));
  else if (best) best.recommended = true;
  const pass = legal.find((a) => a.type === 'pass');
  if (pass) {
    out.push({
      action: pass, shanten: now, reaches5: null, recommended: !win && !best,
      note: win || best ? 'Let it go.' : 'No claim here improves your hand enough.',
    });
  }
  return out;
}
