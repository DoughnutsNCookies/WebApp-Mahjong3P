// Rule-based bots. They decide from their own PlayerView only: no peeking at other hands or the wall.
//
//   easy:   speed only. Discards toward ready with the most live tiles, claims when that gets it closer,
//           keeps every joker, never folds.
//   normal: the full analyzer. Weighs fan routes (5-fan minimum, path to 10) and safety, folds against
//           a close opponent, follows the joker advice, and won't claim into a hand that can't pay.
//   advanced: normal, plus money-based play once ready (see advanced.ts): may turn down a win under
//           10 fan when holding out is worth more, and picks its wait by expected payout.

import { afterClaim, analyze, AnalyzerInput, DiscardOption, inputFromView, liveCounts, shanten } from '../analyzer';
import { Action, GameState, JOKER, Kind, playerView } from '../engine';
import { bestReadyDiscard, decideWin } from './advanced';

export type BotLevel = 'easy' | 'normal' | 'advanced';
export * from './advanced';

export function botAction(s: GameState, player: number, level: BotLevel): Action {
  const view = playerView(s, player);
  const legal = view.legal;
  if (!legal.length) throw new Error(`Player ${player} has nothing to do`);
  const input = inputFromView(view);

  // Easy and normal always take a win: every legal win already meets the 5-fan minimum, and a discard
  // win pays 3/4 of a self-drawn one while waiting risks dealing in. Advanced weighs it up.
  const win = legal.find((a) => a.type === 'win' || a.type === 'selfWin' || a.type === 'openingSlam');
  if (win) {
    if (level !== 'advanced' || win.type === 'openingSlam' || !view.winScore) return win;
    const d = decideWin(input, view.winScore.fan, win.type === 'selfWin');
    if (d.take) return win;
    if (win.type === 'selfWin') return { type: 'discard', player, tile: d.discard! };
    return legal.find((a) => a.type === 'pass')!;
  }

  if (view.phase === 'turn') return turnAction(input, legal, level);
  if (view.phase === 'claim') return claimAction(input, legal, view.claimTile!, level);
  return legal.find((a) => a.type === 'pass')!;
}

// ---------------------------------------------------------------------------------------------------
// On your turn

/** Easy: fewest tiles from ready, then most live tiles. */
function fastest(input: AnalyzerInput): { tile: Kind; shanten: number; live: number } {
  const live = liveCounts(input);
  let best = { tile: -1, shanten: 99, live: -1 };
  for (const tile of new Set(input.hand)) {
    if (tile === JOKER) continue;
    const h = removeOne(input.hand, tile);
    const sh = shanten(h, input.melds.length).best;
    if (sh > best.shanten) continue;
    let n = 0;
    for (let t = 0; t <= JOKER; t++) {
      if (live[t] > 0 && shanten([...h, t], input.melds.length).best < sh) n += live[t];
    }
    if (sh < best.shanten || n > best.live) best = { tile, shanten: sh, live: n };
  }
  return best;
}

function turnAction(input: AnalyzerInput, legal: Action[], level: BotLevel): Action {
  const player = legal[0].player;
  const best = level === 'easy' ? fastest(input) : null;
  const analysis = level !== 'easy' ? analyze(input) : null;
  const bestShanten = best ? best.shanten : analysis!.options[0].shanten;

  // Kongs: take one when it costs nothing (the replacement draw is free).
  for (const a of legal) {
    if (a.type !== 'kong' || a.jokers > 0) continue;
    if (a.kongType === 'concealed') {
      const rest = input.hand.filter((t) => t !== a.kind);
      if (shanten(rest, input.melds.length + 1).best <= bestShanten) return a;
    } else {
      const rest = removeOne(input.hand, a.kind);
      if (shanten(rest, input.melds.length).best <= bestShanten) return a;
    }
  }

  if (analysis?.joker?.recommend === 'set aside' && legal.some((a) => a.type === 'discardJoker')) {
    return { type: 'discardJoker', player };
  }

  let tile = best ? best.tile : analysis!.options[0].tile;
  if (level === 'advanced' && analysis!.options[0].shanten === 0) {
    tile = bestReadyDiscard(input, analysis!)?.tile ?? tile;
  }
  return { type: 'discard', player, tile };
}

// ---------------------------------------------------------------------------------------------------
// Claiming a discard

function claimAction(input: AnalyzerInput, legal: Action[], tile: Kind, level: BotLevel): Action {
  const pass = legal.find((a) => a.type === 'pass')!;
  const now = shanten(input.hand, input.melds.length).best;
  let bestClaim: Action | null = null;
  let bestScore = -Infinity;

  for (const a of legal) {
    if (a.type !== 'pong' && a.type !== 'claimKong' && a.type !== 'chow') continue;
    const after = afterClaim(input, a, tile);
    if (!after) continue;

    if (a.type === 'claimKong') {
      // A kong draws a replacement instead of discarding: compare the 3n+1 hand directly.
      const sh = shanten(after.hand, after.melds.length).best;
      if (sh <= now) return a;
      continue;
    }

    if (level === 'easy') {
      const opt = fastest(after);
      if (opt.shanten < now && opt.shanten * -1000 + opt.live > bestScore) {
        bestScore = opt.shanten * -1000 + opt.live;
        bestClaim = a;
      }
      continue;
    }

    const opt: DiscardOption | undefined = analyze(after).options[0];
    if (!opt || opt.shanten >= now) continue;
    // Exposing a set gives up concealed routes (7 Pairs, Hidden Treasures); only claim into a hand that
    // can still reach 5 fan.
    if (opt.fan.reaches5 === 'no' || (opt.fan.reaches5 === 'unlikely' && opt.shanten > 0)) continue;
    if (opt.value > bestScore) {
      bestScore = opt.value;
      bestClaim = a;
    }
  }
  return bestClaim ?? pass;
}

function removeOne(h: Kind[], t: Kind): Kind[] {
  const out = h.slice();
  const i = out.indexOf(t);
  if (i >= 0) out.splice(i, 1);
  return out;
}
