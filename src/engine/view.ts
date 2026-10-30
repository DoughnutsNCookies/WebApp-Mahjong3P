// What one player is allowed to see. A multiplayer server sends only this, never the GameState.

import { Action, GameState, legalActions, Phase, PlayerState, RoundResult, seatOf, wallLeft } from './game';
import { Seat } from './rules';
import { Meld } from './scoring';
import { Kind } from './tiles';

export interface OpponentView {
  handSize: number;
  melds: Meld[];
  bonus: Kind[];
  discardedJokers: number;
  discards: Kind[];
  seat: Seat;
}

export interface PlayerView {
  me: number;
  seat: Seat;
  dealer: number;
  phase: Phase;
  turn: number;
  wallLeft: number;
  hand: Kind[];
  self: PlayerState;
  /** Indexed by player; your own entry is your public info. */
  players: OpponentView[];
  /** The tile currently open to claims, if any. */
  claimTile: Kind | null;
  legal: Action[];
  /** At the end of the round every hand is shown (Q11). */
  revealedHands: Kind[][] | null;
  result: RoundResult | null;
}

export function playerView(s: GameState, me: number): PlayerView {
  const ended = s.phase === 'ended';
  return structuredClone({
    me,
    seat: seatOf(s, me),
    dealer: s.dealer,
    phase: s.phase,
    turn: s.turn,
    wallLeft: wallLeft(s),
    hand: s.players[me].hand,
    self: s.players[me],
    players: s.players.map((pl, p) => ({
      handSize: pl.hand.length,
      // Concealed kongs show their tile when declared (Q6), so melds are public.
      melds: pl.melds,
      bonus: pl.bonus,
      discardedJokers: pl.discardedJokers,
      discards: pl.discards,
      seat: seatOf(s, p),
    })),
    claimTile: s.phase === 'claim' || s.phase === 'robKong' ? s.pending!.tile : null,
    legal: legalActions(s, me),
    revealedHands: ended ? s.players.map((pl) => pl.hand) : null,
    result: s.result,
  });
}
