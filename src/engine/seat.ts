// Multiplayer: the round as one player is allowed to see it.
//
// rotateState relabels the players so that `me` becomes player 0 ("You" everywhere in the UI). Dealing is
// relative to the dealer, so the rotated state is exactly what newRound/replay would give with the dealer
// relabelled the same way (tested).
//
// seatView then removes everything that player must not see while the round is on: the other hands (kept as
// the right number of blank tiles), the wall, the round's seed (it would let anyone rebuild the whole wall),
// the tile the others just drew, the other players' claim options (a pong option reveals a pair) and their
// passes, and the hidden parts of the event log. Once the round has ended everyone shows their hand (Q11), so
// the full state is sent; the seed itself goes separately (RoomState.seed) so the round keeps one id throughout.

import type { Action, GameEvent, GameState, Pending, RoundResult } from './game';
import type { Kind } from './tiles';

const rot = (p: number, r: number) => (p - r + 3) % 3;
const rotArr = <T>(a: T[], r: number): T[] => [0, 1, 2].map((q) => a[(q + r) % 3]);
const rotAction = (a: Action, r: number): Action => ({ ...a, player: rot(a.player, r) });

function rotResult(res: RoundResult, r: number): RoundResult {
  return {
    ...res,
    // The winning hand's sets record who each claimed tile came from.
    score: res.score && {
      ...res.score,
      groups: res.score.groups?.map((grp) => ('from' in grp && typeof grp.from === 'number' ? { ...grp, from: rot(grp.from, r) } : grp)),
    },
    winner: res.winner === undefined ? undefined : rot(res.winner, r),
    payer: res.payer === undefined ? undefined : rot(res.payer, r),
    loserFans: res.loserFans && rotArr(res.loserFans, r),
    jokers: rotArr(res.jokers, r),
    fanPayout: rotArr(res.fanPayout, r),
    fei: rotArr(res.fei, r),
    loser: rotArr(res.loser, r),
    kong: rotArr(res.kong, r),
    total: rotArr(res.total, r),
    nextDealer: rot(res.nextDealer, r),
  };
}

function rotEvent(ev: GameEvent, r: number): GameEvent {
  switch (ev.e) {
    case 'deal': return { e: 'deal', hands: rotArr(ev.hands, r) };
    case 'draw': case 'bonus': case 'jokerSwap': return { ...ev, player: rot(ev.player, r) };
    case 'action': return { e: 'action', action: rotAction(ev.action, r) };
    case 'claim': return { e: 'claim', action: rotAction(ev.action, r), from: rot(ev.from, r) };
    case 'end': return { e: 'end', result: rotResult(ev.result, r) };
  }
}

/** The same round with player `me` relabelled as player 0 (and the others in turn order after). */
export function rotateState(g: GameState, me: number): GameState {
  const r = me;
  const players = rotArr(g.players, r).map((pl) => ({
    ...pl,
    melds: pl.melds.map((m) => (m.from === undefined ? m : { ...m, from: rot(m.from, r) })),
  }));
  const pending: Pending | null = g.pending && {
    ...g.pending,
    from: rot(g.pending.from, r),
    options: rotArr(g.pending.options, r).map((opts) => opts.map((a) => rotAction(a, r))),
    responses: rotArr(g.pending.responses, r).map((a) => a && rotAction(a, r)),
  };
  return {
    ...g,
    dealer: rot(g.dealer, r),
    turn: rot(g.turn, r),
    lastDrawer: rot(g.lastDrawer, r),
    players,
    kongMoney: rotArr(g.kongMoney, r),
    pending,
    result: g.result && rotResult(g.result, r),
    actions: g.actions.map((a) => rotAction(a, r)),
    events: g.events.map((ev) => rotEvent(ev, r)),
  };
}

/** A stand-in for a tile the viewer may not see. Never rendered face up (hands show as a count). */
const HIDDEN: Kind = 0;

/**
 * What player `me` may see, relabelled so they are player 0. `roundId` replaces the seed (a stable number for the
 * UI's keys that reveals nothing); the real seed is only shared once the round has ended.
 */
export function seatView(g: GameState, me: number, roundId: number): GameState {
  const s = rotateState(structuredClone(g), me);
  s.seed = roundId;
  if (s.phase === 'ended') return s; // everyone shows their hand
  for (let q = 1; q < 3; q++) s.players[q].hand = s.players[q].hand.map(() => HIDDEN);
  for (let i = 0; i < s.wall.length; i++) s.wall[i] = HIDDEN;
  if (s.turn !== 0) s.lastDrawn = null;
  if (s.pending) {
    s.pending.options = s.pending.options.map((opts, q) => (q === 0 ? opts : []));
    s.pending.responses = s.pending.responses.map((a, q) => (q === 0 ? a : null));
  }
  // Others' passes say they had something to claim; their draws and their deal are private.
  const privatePass = (a: Action) => a.type === 'pass' && a.player !== 0;
  s.actions = s.actions.filter((a) => !privatePass(a));
  s.events = s.events.flatMap((ev): GameEvent[] => {
    if (ev.e === 'deal') return [{ e: 'deal', hands: ev.hands.map((h, q) => (q === 0 ? h : h.map(() => HIDDEN))) }];
    if (ev.e === 'draw' && ev.player !== 0) return [{ ...ev, tile: HIDDEN }];
    if (ev.e === 'action' && privatePass(ev.action)) return [];
    return [ev];
  });
  return s;
}
