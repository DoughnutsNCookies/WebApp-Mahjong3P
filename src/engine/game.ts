// One round of play as a state machine. A round is fully determined by its seed, dealer, rules and the
// list of actions, so the action list doubles as the hand log and can be replayed.
//
// Flow: deal -> (opening slam check) -> dealer's turn -> discard -> claim window -> next draw ...
// Claims on a discard: win beats pong/kong beats chow; among equal claims the player next in turn order
// after the discarder wins (Q4). Chow only from the player immediately before you.

import { groupJokers, Slot } from './decompose';
import { addDeltas, fanPayout, feiPayout, loserSettlement, PaymentType } from './money';
import { DEFAULT_RULES, Rules, Seat } from './rules';
import { makeRng, shuffle } from './rng';
import { CAP, FanItem, loserFan, Meld, ReplacementReason, Score, scoreWin, WinInput } from './scoring';
import { code, fullSet, isBonus, isDot, JOKER, Kind, PLAYABLE } from './tiles';

export interface PlayerState {
  /** Concealed tiles, jokers included, kept sorted. */
  hand: Kind[];
  melds: Meld[];
  bonus: Kind[];
  discardedJokers: number;
  /** Tiles discarded to the table that nobody took. Discarded jokers are counted in `discardedJokers`. */
  discards: Kind[];
}

export type Phase = 'opening' | 'turn' | 'claim' | 'robKong' | 'ended';

export type Action =
  | { type: 'discard'; player: number; tile: Kind }
  | { type: 'selfWin'; player: number }
  /** Concealed kong (4 in hand, `jokers` of them jokers) or added kong (4th tile onto an exposed pong). */
  | { type: 'kong'; player: number; kind: Kind; kongType: 'concealed' | 'added'; jokers: number }
  | { type: 'openingSlam'; player: number }
  | { type: 'pass'; player: number }
  /** Win on the current discard, or by robbing the kong being declared. */
  | { type: 'win'; player: number }
  | { type: 'pong'; player: number; jokers: number }
  | { type: 'claimKong'; player: number; jokers: number }
  /** `jokerKinds`: which tiles of the chow (other than the discard) are filled by jokers. */
  | { type: 'chow'; player: number; start: Kind; jokerKinds: Kind[] };

export interface Pending {
  tile: Kind;
  from: number;
  /** Legal responses for each player (empty = not involved). */
  options: Action[][];
  responses: (Action | null)[];
}

export interface RoundResult {
  type: 'win' | 'draw';
  winner?: number;
  /** Who paid the fan payout alone (discard wins and Steal Kong). */
  payer?: number;
  payment?: PaymentType;
  score?: Score;
  /** Loser settlement fan per player (winner's entry is 0). Only after a win under 10 fan. */
  loserFans?: { fan: number; items: FanItem[] }[];
  jokers: number[];
  fanPayout: number[];
  fei: number[];
  loser: number[];
  /** Net money per player for the round, in sen. */
  total: number[];
  nextDealer: number;
}

export type GameEvent =
  | { e: 'deal'; hands: Kind[][] }
  | { e: 'draw'; player: number; tile: Kind; reason: 'wall' | ReplacementReason }
  | { e: 'bonus'; player: number; tile: Kind }
  | { e: 'jokerSwap'; player: number; kind: Kind }
  | { e: 'action'; action: Action }
  | { e: 'claim'; action: Action; from: number }
  | { e: 'end'; result: RoundResult };

export interface GameState {
  rules: Rules;
  seed: number;
  dealer: number;
  wall: Kind[];
  /** Normal draws come from wall[head++]; kong and bonus replacements from wall[--tail]. Q10: no tiles held back. */
  head: number;
  tail: number;
  players: PlayerState[];
  phase: Phase;
  /** Player whose turn it is (during claims: the discarder). */
  turn: number;
  /** This turn began with a draw, so a self-drawn win is possible. False after claiming a discard. */
  turnDrew: boolean;
  lastDrawn: Kind | null;
  /** Replacement draws so far this turn, for Kong Hu, Flower Hu and the 10-fan chains. */
  chain: ReplacementReason[];
  lastDrawWasLast: boolean;
  lastDrawer: number;
  discardsMade: number;
  pending: Pending | null;
  result: RoundResult | null;
  actions: Action[];
  events: GameEvent[];
}

export const seatOf = (s: GameState, p: number) => ((p - s.dealer + 3) % 3) as Seat;
export const wallLeft = (s: GameState) => s.tail - s.head;
const next = (p: number) => (p + 1) % 3;
const sortHand = (h: Kind[]) => h.sort((a, b) => a - b);

function removeTiles(hand: Kind[], kind: Kind, n: number) {
  for (let i = 0; i < n; i++) {
    const at = hand.indexOf(kind);
    if (at < 0) throw new Error(`Hand has no ${code(kind)} to remove`);
    hand.splice(at, 1);
  }
}

const count = (hand: Kind[], kind: Kind) => hand.filter((t) => t === kind).length;

/** Real tiles and joker stand-ins of each kind the player already owns, for the 4-copies limit. */
function owned(p: PlayerState): number[] {
  const use = new Array(PLAYABLE).fill(0);
  for (const t of p.hand) if (t !== JOKER) use[t]++;
  for (const m of p.melds) for (const s of m.slots) use[s.kind]++;
  return use;
}

export function jokersOwned(p: PlayerState): number {
  return count(p.hand, JOKER) + p.melds.reduce((a, m) => a + groupJokers(m), 0) + p.discardedJokers;
}

// ---------------------------------------------------------------------------------------------------
// Setup

export function newRound(seed: number, dealer = 0, rules: Rules = DEFAULT_RULES): GameState {
  const s: GameState = {
    rules, seed, dealer,
    wall: shuffle(fullSet(), makeRng(seed)),
    head: 0, tail: 84,
    players: [0, 1, 2].map(() => ({ hand: [], melds: [], bonus: [], discardedJokers: 0, discards: [] })),
    phase: 'turn', turn: dealer, turnDrew: true, lastDrawn: null, chain: [], lastDrawWasLast: false,
    lastDrawer: dealer, discardsMade: 0, pending: null, result: null, actions: [], events: [],
  };
  const order = [dealer, next(dealer), next(next(dealer))];
  for (const p of order) for (let i = 0; i < 13; i++) s.players[p].hand.push(s.wall[s.head++]);
  s.players[dealer].hand.push(s.wall[s.head++]);
  s.lastDrawn = s.players[dealer].hand[13];
  s.events.push({ e: 'deal', hands: s.players.map((p) => p.hand.slice()) });

  // Bonus tiles in the starting hands are set aside and replaced, dealer first.
  for (const p of order) {
    const pl = s.players[p];
    while (pl.hand.some(isBonus)) {
      const at = pl.hand.findIndex(isBonus);
      const [b] = pl.hand.splice(at, 1);
      pl.bonus.push(b);
      s.events.push({ e: 'bonus', player: p, tile: b });
      const t = s.wall[--s.tail];
      s.events.push({ e: 'draw', player: p, tile: t, reason: 'bonus' });
      pl.hand.push(t);
      if (p === dealer && at === 13) s.lastDrawn = t;
    }
    sortHand(pl.hand);
  }

  // ASSUMPTION (rules.openingSlamInstantWin): 4 jokers in the starting hand may be declared at once.
  if (rules.openingSlamInstantWin) {
    const options = s.players.map((pl, p): Action[] =>
      count(pl.hand, JOKER) === 4 ? [{ type: 'openingSlam', player: p }, { type: 'pass', player: p }] : [],
    );
    if (options.some((o) => o.length)) {
      s.phase = 'opening';
      s.pending = { tile: JOKER, from: dealer, options, responses: [null, null, null] };
    }
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------
// Win checks

function winInput(s: GameState, p: number, winTile: Kind, selfDrawn: boolean, extra?: Partial<WinInput>): WinInput {
  const pl = s.players[p];
  return {
    seat: seatOf(s, p),
    hand: selfDrawn ? pl.hand.slice() : [...pl.hand, winTile],
    melds: pl.melds,
    bonus: pl.bonus,
    discardedJokers: pl.discardedJokers,
    winTile,
    selfDrawn,
    ...extra,
  };
}

function selfWinScore(s: GameState, p: number): Score | null {
  const pl = s.players[p];
  const score = scoreWin(winInput(s, p, s.lastDrawn ?? pl.hand[pl.hand.length - 1], true, {
    replacementChain: s.chain,
    heavenly: p === s.dealer && s.discardsMade === 0 && pl.melds.length === 0,
    lastTile: s.lastDrawWasLast,
  }));
  return score && score.fan >= s.rules.minFan ? score : null;
}

function claimWinScore(s: GameState, p: number, tile: Kind, from: number, robbed: boolean): Score | null {
  const score = scoreWin(winInput(s, p, tile, false, {
    robbedKong: robbed,
    earthly: !robbed && s.discardsMade === 1 && from === s.dealer && p !== s.dealer,
    lastDiscard: !robbed && wallLeft(s) === 0,
  }));
  return score && score.fan >= s.rules.minFan ? score : null;
}

// ---------------------------------------------------------------------------------------------------
// Legal actions

function turnActions(s: GameState, p: number): Action[] {
  const pl = s.players[p];
  const out: Action[] = [];
  if (s.turnDrew && selfWinScore(s, p)) out.push({ type: 'selfWin', player: p });
  if (wallLeft(s) > 0) {
    const jokers = count(pl.hand, JOKER);
    const use = owned(pl);
    for (let k = 0; k < PLAYABLE; k++) {
      const real = count(pl.hand, k);
      const need = 4 - real;
      // Q1: jokers can fill a kong. Never more than 4 of a kind in total.
      if (real >= 1 && need <= jokers && use[k] === real) {
        out.push({ type: 'kong', player: p, kind: k, kongType: 'concealed', jokers: need });
      }
    }
    for (const m of pl.melds) {
      if (m.type !== 'pong' || m.concealed) continue;
      const k = m.slots[0].kind;
      if (count(pl.hand, k) > 0) out.push({ type: 'kong', player: p, kind: k, kongType: 'added', jokers: 0 });
      else if (jokers > 0 && use[k] < 4) out.push({ type: 'kong', player: p, kind: k, kongType: 'added', jokers: 1 });
    }
  }
  for (const t of new Set(pl.hand)) out.push({ type: 'discard', player: p, tile: t });
  return out;
}

/** What player p may do with a discarded tile. */
function claimOptions(s: GameState, p: number, tile: Kind, from: number): Action[] {
  const out: Action[] = [];
  if (claimWinScore(s, p, tile, from, false)) out.push({ type: 'win', player: p });
  // Q2: a discarded joker can only be won on. After the last wall tile, only a win can be claimed.
  if (tile === JOKER || wallLeft(s) === 0) return out;

  const pl = s.players[p];
  const real = count(pl.hand, tile);
  const jokers = count(pl.hand, JOKER);
  const use = owned(pl);
  // Q5: a pong can be one real tile plus a joker (or two jokers). Jokers only fill what real tiles can't,
  // and never make a 5th copy of the tile.
  for (const [type, size] of [['pong', 3], ['claimKong', 4]] as const) {
    const j = Math.max(0, size - 1 - real);
    if (j <= jokers && use[tile] + 1 + j <= 4) out.push({ type, player: p, jokers: j });
  }
  if (p === next(from) && isDot(tile)) {
    for (let start = Math.max(0, tile - 2); start <= Math.min(tile, 6); start++) {
      const others = [start, start + 1, start + 2].filter((k) => k !== tile);
      // Each of the two other tiles comes from the hand, real or as a joker.
      for (let mask = 0; mask < 4; mask++) {
        const jokerKinds = others.filter((_, i) => mask & (1 << i));
        const realKinds = others.filter((_, i) => !(mask & (1 << i)));
        if (jokerKinds.length > jokers) continue;
        if (realKinds.some((k) => count(pl.hand, k) === 0)) continue;
        if (jokerKinds.some((k) => use[k] + 1 > 4)) continue;
        out.push({ type: 'chow', player: p, start, jokerKinds });
      }
    }
  }
  return out;
}

export function legalActions(s: GameState, p: number): Action[] {
  if (s.phase === 'ended') return [];
  if (s.phase === 'turn') return s.turn === p ? turnActions(s, p) : [];
  const pend = s.pending!;
  if (pend.responses[p]) return [];
  return pend.options[p];
}

/** Players who still have to act. */
export function waitingFor(s: GameState): number[] {
  if (s.phase === 'ended') return [];
  if (s.phase === 'turn') return [s.turn];
  return [0, 1, 2].filter((p) => s.pending!.options[p].length && !s.pending!.responses[p]);
}

// ---------------------------------------------------------------------------------------------------
// Applying actions

const sameAction = (a: Action, b: Action) => JSON.stringify(a) === JSON.stringify(b);

export function applyAction(state: GameState, action: Action): GameState {
  if (!legalActions(state, action.player).some((a) => sameAction(a, action))) {
    throw new Error(`Illegal action: ${JSON.stringify(action)} in phase ${state.phase}`);
  }
  const s = structuredClone(state);
  s.actions.push(action);
  s.events.push({ e: 'action', action });

  switch (s.phase) {
    case 'turn': doTurnAction(s, action); break;
    case 'opening':
    case 'claim':
    case 'robKong':
      s.pending!.responses[action.player] = action;
      if (waitingFor(s).length === 0) resolvePending(s);
      break;
  }
  return s;
}

/** Draws for player p. Bonus tiles are set aside and replaced; returns false if the wall ran out. */
function draw(s: GameState, p: number, reason: 'wall' | ReplacementReason): boolean {
  if (wallLeft(s) === 0) {
    endDraw(s);
    return false;
  }
  if (reason === 'wall') s.chain = [];
  else s.chain.push(reason);
  const tile = reason === 'wall' ? s.wall[s.head++] : s.wall[--s.tail];
  s.lastDrawer = p;
  s.lastDrawWasLast = wallLeft(s) === 0;
  s.events.push({ e: 'draw', player: p, tile, reason });
  const pl = s.players[p];

  if (isBonus(tile)) {
    pl.bonus.push(tile);
    s.events.push({ e: 'bonus', player: p, tile });
    return draw(s, p, 'bonus');
  }

  // Section 5: drawing the real tile a joker stands for in an exposed meld swaps it in automatically;
  // Q3: the joker returns to the hand. ASSUMPTION: exposed kongs swap too, concealed kongs do not.
  let got = tile;
  if (tile !== JOKER) {
    const slot = pl.melds.filter((m) => !m.concealed).flatMap((m) => m.slots).find((x) => x.joker && x.kind === tile);
    if (slot) {
      slot.joker = false;
      got = JOKER;
      s.events.push({ e: 'jokerSwap', player: p, kind: tile });
    }
  }
  pl.hand.push(got);
  sortHand(pl.hand);
  s.lastDrawn = got;
  s.phase = 'turn';
  s.turn = p;
  s.turnDrew = true;
  s.pending = null;
  return true;
}

function doTurnAction(s: GameState, a: Action) {
  const pl = s.players[a.player];
  if (a.type === 'selfWin') return endWin(s, a.player, selfWinScore(s, a.player)!, 'self');

  if (a.type === 'discard') {
    removeTiles(pl.hand, a.tile, 1);
    if (a.tile === JOKER) pl.discardedJokers++;
    else pl.discards.push(a.tile);
    s.discardsMade++;
    return openClaims(s, a.player, a.tile);
  }

  if (a.type === 'kong') {
    const k = a.kind;
    if (a.kongType === 'concealed') {
      removeTiles(pl.hand, k, 4 - a.jokers);
      removeTiles(pl.hand, JOKER, a.jokers);
      const slots: Slot[] = [...Array(4)].map((_, i) => ({ kind: k, joker: i >= 4 - a.jokers }));
      pl.melds.push({ type: 'kong', slots, concealed: true, kongType: 'concealed' });
    } else {
      removeTiles(pl.hand, a.jokers ? JOKER : k, 1);
      const m = pl.melds.find((x) => x.type === 'pong' && !x.concealed && x.slots[0].kind === k)!;
      m.type = 'kong';
      m.kongType = 'added';
      m.slots.push({ kind: k, joker: a.jokers === 1 });
    }
    // Q6: any declared kong can be robbed. The robbed tile is the kong's kind.
    const options = [0, 1, 2].map((q): Action[] =>
      q !== a.player && claimWinScore(s, q, k, a.player, true) ? [{ type: 'win', player: q }, { type: 'pass', player: q }] : [],
    );
    if (options.some((o) => o.length)) {
      s.phase = 'robKong';
      s.pending = { tile: k, from: a.player, options, responses: [null, null, null] };
      return;
    }
    draw(s, a.player, 'kong');
  }
}

function openClaims(s: GameState, from: number, tile: Kind) {
  const options = [0, 1, 2].map((p): Action[] => {
    if (p === from) return [];
    const opts = claimOptions(s, p, tile, from);
    return opts.length ? [...opts, { type: 'pass', player: p }] : [];
  });
  if (options.some((o) => o.length)) {
    s.phase = 'claim';
    s.turn = from;
    s.pending = { tile, from, options, responses: [null, null, null] };
    return;
  }
  draw(s, next(from), 'wall');
}

function resolvePending(s: GameState) {
  const pend = s.pending!;
  const byPriority = [next(pend.from), next(next(pend.from))];
  const chosen = (types: Action['type'][]) =>
    byPriority.map((p) => pend.responses[p]).find((r) => r && types.includes(r.type)) ?? null;

  if (s.phase === 'opening') {
    const order = [s.dealer, next(s.dealer), next(next(s.dealer))];
    const p = order.find((q) => pend.responses[q]?.type === 'openingSlam');
    s.phase = 'turn';
    s.pending = null;
    if (p !== undefined) {
      const score = scoreWin({ ...winInput(s, p, JOKER, true), openingSlam: true })!;
      endWin(s, p, score, 'self');
    }
    return;
  }

  if (s.phase === 'robKong') {
    const win = chosen(['win']);
    const konger = s.players[pend.from];
    if (!win) return void draw(s, pend.from, 'kong');
    const score = claimWinScore(s, win.player, pend.tile, pend.from, true)!;
    // Undo the kong: the robbed tile goes to the winner.
    const m = konger.melds.pop()!;
    if (m.kongType === 'added') {
      const robbed = m.slots.pop()!;
      konger.melds.push({ ...m, type: 'pong', kongType: undefined });
      s.players[win.player].hand.push(robbed.joker ? JOKER : robbed.kind);
    } else {
      const at = m.slots.findIndex((x) => !x.joker);
      const [robbed] = m.slots.splice(at, 1);
      konger.hand.push(...m.slots.map((x) => (x.joker ? JOKER : x.kind)));
      sortHand(konger.hand);
      s.players[win.player].hand.push(robbed.kind);
    }
    sortHand(s.players[win.player].hand);
    return endWin(s, win.player, score, 'discard', pend.from);
  }

  // Claim on a discard.
  const tile = pend.tile;
  const discarder = s.players[pend.from];
  const takeDiscard = () => {
    if (tile === JOKER) discarder.discardedJokers--;
    else discarder.discards.pop();
  };

  const win = chosen(['win']);
  if (win) {
    const score = claimWinScore(s, win.player, tile, pend.from, false)!;
    takeDiscard();
    s.players[win.player].hand.push(tile);
    sortHand(s.players[win.player].hand);
    return endWin(s, win.player, score, 'discard', pend.from);
  }

  const claim = chosen(['pong', 'claimKong']) ?? chosen(['chow']);
  if (!claim) return void draw(s, next(pend.from), 'wall');

  takeDiscard();
  const p = claim.player;
  const pl = s.players[p];
  s.events.push({ e: 'claim', action: claim, from: pend.from });
  if (claim.type === 'pong' || claim.type === 'claimKong') {
    const size = claim.type === 'pong' ? 3 : 4;
    removeTiles(pl.hand, tile, size - 1 - claim.jokers);
    removeTiles(pl.hand, JOKER, claim.jokers);
    const slots: Slot[] = [...Array(size)].map((_, i) => ({ kind: tile, joker: i >= size - claim.jokers }));
    pl.melds.push({
      type: claim.type === 'pong' ? 'pong' : 'kong', slots, concealed: false, from: pend.from,
      ...(claim.type === 'claimKong' ? { kongType: 'exposed' as const } : {}),
    });
  } else if (claim.type === 'chow') {
    const slots: Slot[] = [];
    for (let k = claim.start; k < claim.start + 3; k++) {
      const joker = claim.jokerKinds.includes(k);
      if (k !== tile) removeTiles(pl.hand, joker ? JOKER : k, 1);
      slots.push({ kind: k, joker: k !== tile && joker });
    }
    pl.melds.push({ type: 'chow', slots, concealed: false, from: pend.from });
  }
  s.pending = null;
  s.phase = 'turn';
  s.turn = p;
  s.turnDrew = false;
  s.chain = [];
  s.lastDrawn = null;
  // An exposed kong from a discard is not robbable (Q6): the discard itself was open to a win.
  if (claim.type === 'claimKong') draw(s, p, 'kong');
}

// ---------------------------------------------------------------------------------------------------
// End of round

function endWin(s: GameState, winner: number, score: Score, payment: PaymentType, payer?: number) {
  const jokers = s.players.map(jokersOwned);
  const fan = fanPayout(winner, score.fan, payment, payer, s.rules);
  const fei = feiPayout(jokers, s.rules);
  let loserFans: RoundResult['loserFans'];
  let loser = [0, 0, 0];
  // Loser settlement only after a win under 10 fan.
  if (score.fan < CAP) {
    loserFans = s.players.map((pl, p) =>
      p === winner ? { fan: 0, items: [] } : loserFan(seatOf(s, p), pl.hand, pl.melds, pl.bonus, pl.discardedJokers),
    );
    loser = loserSettlement(winner, loserFans.map((x) => x.fan), s.rules);
  }
  finish(s, {
    type: 'win', winner, payer, payment, score, loserFans, jokers,
    fanPayout: fan, fei, loser, total: addDeltas(fan, fei, loser), nextDealer: winner,
  });
}

/** Wall ran out: only fei money is settled, and the last player who drew deals next. */
function endDraw(s: GameState) {
  const jokers = s.players.map(jokersOwned);
  const fei = feiPayout(jokers, s.rules);
  finish(s, {
    type: 'draw', jokers, fanPayout: [0, 0, 0], fei, loser: [0, 0, 0], total: fei, nextDealer: s.lastDrawer,
  });
}

function finish(s: GameState, result: RoundResult) {
  s.phase = 'ended';
  s.pending = null;
  s.result = result;
  s.events.push({ e: 'end', result });
}

/** Rebuilds a round from its log. */
export function replay(seed: number, dealer: number, actions: Action[], rules: Rules = DEFAULT_RULES): GameState {
  return actions.reduce(applyAction, newRound(seed, dealer, rules));
}
