// What one player is allowed to see. A multiplayer server sends only this, never the GameState.

import { Action, availableWin, GameState, legalActions, Phase, PlayerState, RoundResult, seatOf, wallLeft } from './game';
import { Seat } from './rules';
import { Meld, Score } from './scoring';
import { Kind } from './tiles';

export interface OpponentView {
  handSize: number;
  melds: Meld[];
  bonus: Kind[];
  discardedJokers: number;
  discards: Kind[];
  /** When each discard was made (see PlayerState.discardAt). */
  discardAt: number[];
  seat: Seat;
}

export interface PlayerView {
  me: number;
  seat: Seat;
  dealer: number;
  phase: Phase;
  turn: number;
  wallLeft: number;
  /** Discards made so far this round (the clock for `discardAt`). */
  discardsMade: number;
  hand: Kind[];
  self: PlayerState;
  /** Indexed by player; your own entry is your public info. */
  players: OpponentView[];
  /** The tile currently open to claims, if any. */
  claimTile: Kind | null;
  legal: Action[];
  /** The win you could declare right now and what it scores, if any. */
  winScore: Score | null;
  /** At the end of the round every hand is shown (Q11). */
  revealedHands: Kind[][] | null;
  result: RoundResult | null;
}

/**
 * copy: false skips the defensive copy: the view then shares the game state's arrays and must be treated
 * as read-only and used before the next move (the training server does this for speed).
 */
export function playerView(s: GameState, me: number, { copy = true }: { copy?: boolean } = {}): PlayerView {
  const ended = s.phase === 'ended';
  const view: PlayerView = {
    me,
    seat: seatOf(s, me),
    dealer: s.dealer,
    phase: s.phase,
    turn: s.turn,
    wallLeft: wallLeft(s),
    discardsMade: s.discardsMade,
    hand: s.players[me].hand,
    self: s.players[me],
    players: s.players.map((pl, p) => ({
      handSize: pl.hand.length,
      // Concealed kongs show their tile when declared (Q6), so melds are public.
      melds: pl.melds,
      bonus: pl.bonus,
      discardedJokers: pl.discardedJokers,
      discards: pl.discards,
      discardAt: pl.discardAt,
      seat: seatOf(s, p),
    })),
    claimTile: s.phase === 'claim' || s.phase === 'robKong' ? s.pending!.tile : null,
    legal: legalActions(s, me),
    winScore: availableWin(s, me),
    revealedHands: ended ? s.players.map((pl) => pl.hand) : null,
    result: s.result,
  };
  return copy ? structuredClone(view) : view;
}
