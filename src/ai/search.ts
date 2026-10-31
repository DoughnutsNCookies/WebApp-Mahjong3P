// Look-ahead for the trained AI. On its turn, instead of taking the network's first choice, it tries each of
// its most promising moves in a few dozen imagined continuations of the round and picks the one that makes
// the most money on average.
//
// The player doesn't know the opponents' hands or the wall, so each continuation deals the tiles it hasn't
// seen out at random (keeping everyone's hand size), then all three players play on with the network's own
// policy. Only the player's information is used: the multiset of unseen tiles and the hand sizes. The same
// imagined deals are used for every candidate move, so candidates are compared on equal luck.
//
// This is the "search" half of the usual recipe for stronger game AIs: if searching on top of the network
// beats the network alone, the network can then be trained to copy the searched choices.

import type { Action, GameState } from '../engine/game';
import { applyActionInPlace, waitingFor } from '../engine/game';
import { makeRng, shuffle } from '../engine/rng';
import type { Kind } from '../engine/tiles';
import { aiAction, scoreMoves, WebModel } from './web';

export interface SearchOptions {
  /** How many of the network's top moves to try (the rest are dropped unseen). */
  candidates: number;
  /** Imagined continuations per candidate. */
  rollouts: number;
}
export const DEFAULT_SEARCH: SearchOptions = { candidates: 4, rollouts: 24 };

/** A copy of the round with the hidden tiles dealt out at random from the ones `player` can't see. */
export function determinize(g: GameState, player: number, rng: () => number): GameState {
  const s = structuredClone(g);
  s.events = []; // not needed to play on
  const hidden: Kind[] = [];
  for (let q = 0; q < 3; q++) if (q !== player) hidden.push(...s.players[q].hand);
  for (let i = s.head; i < s.tail; i++) hidden.push(s.wall[i]);
  hidden.sort((a, b) => a - b); // only the multiset may matter, never the arrangement
  shuffle(hidden, rng);
  let k = 0;
  for (let q = 0; q < 3; q++) {
    if (q === player) continue;
    const n = s.players[q].hand.length;
    s.players[q].hand = hidden.slice(k, k + n).sort((a, b) => a - b);
    k += n;
  }
  for (let i = s.head; i < s.tail; i++) s.wall[i] = hidden[k++];
  return s;
}

/** Plays `first`, then everyone follows the network to the end. Returns `player`'s money in RM. */
function playout(s: GameState, player: number, first: Action, m: WebModel): number {
  applyActionInPlace(s, first);
  while (s.phase !== 'ended') {
    const p = waitingFor(s)[0];
    applyActionInPlace(s, aiAction(s, p, m));
  }
  return s.result!.total[player] / 100;
}

/** The move with the best average outcome over imagined continuations; the network's choice when only one
 *  move is legal or it isn't the player's turn. */
export function searchAction(g: GameState, player: number, m: WebModel, opt: SearchOptions = DEFAULT_SEARCH): Action {
  const { slots, scores } = scoreMoves(g, player, m);
  const legal = slots.map((a, i) => (a ? { a, score: scores[i] } : null)).filter((x): x is { a: Action; score: number } => !!x);
  if (legal.length === 1 || g.phase !== 'turn') return legal.reduce((b, x) => (x.score > b.score ? x : b)).a;
  const cands = legal.sort((x, y) => y.score - x.score).slice(0, opt.candidates).map((x) => x.a);
  // Deterministic for a given position, so results are reproducible.
  const rng = makeRng(((g.seed ^ (g.actions.length * 2654435761) ^ (player * 40503)) >>> 0) || 1);
  const totals = new Array(cands.length).fill(0);
  for (let r = 0; r < opt.rollouts; r++) {
    const det = determinize(g, player, rng);
    cands.forEach((c, i) => { totals[i] += playout(structuredClone(det), player, c, m); });
  }
  let best = 0;
  for (let i = 1; i < cands.length; i++) if (totals[i] > totals[best]) best = i;
  return cands[best];
}
