// Hand analyzer. Like the engine, pure TypeScript: runs in the browser (hint button, post-hand review)
// and in Node (bots, simulations).

import { GameState, isBonus, PlayerView, seatOf, wallLeft } from '../engine';
import { AnalyzerInput } from './analyze';

export * from './analyze';
export * from './shanten';

/** Analyzer input from what a player can see. */
export function inputFromView(v: PlayerView): AnalyzerInput {
  return {
    seat: v.seat,
    hand: v.hand,
    melds: v.self.melds,
    bonus: v.self.bonus,
    discardedJokers: v.self.discardedJokers,
    ownDiscards: v.self.discards,
    opponents: v.players
      .map((o, player) => ({ ...o, player, bonusCount: o.bonus.length }))
      .filter((o) => o.player !== v.me),
    wallLeft: v.wallLeft,
    bonusSeen: v.players.reduce((a, o) => a + o.bonus.filter(isBonus).length, 0),
  };
}

/** Same, straight from the full game state (for the post-hand review, which replays the log). */
export function inputFromState(s: GameState, p: number): AnalyzerInput {
  const pl = s.players[p];
  return {
    seat: seatOf(s, p),
    hand: pl.hand,
    melds: pl.melds,
    bonus: pl.bonus,
    discardedJokers: pl.discardedJokers,
    ownDiscards: pl.discards,
    opponents: s.players
      .map((o, player) => ({
        player, seat: seatOf(s, player), melds: o.melds, discards: o.discards,
        discardedJokers: o.discardedJokers, bonusCount: o.bonus.length,
      }))
      .filter((o) => o.player !== p),
    wallLeft: wallLeft(s),
    bonusSeen: s.players.reduce((a, o) => a + o.bonus.length, 0),
  };
}
