// House rules for Malaysian 3-player mahjong (not Lami).
//
// Sources, in order of precedence:
//   1. The player's house rules (handover sections 1-9).
//   2. Answers to the rule questions asked on 2026-10-30 (marked "Q1".."Q11" in the code).
//   3. The "Dragon Gate" mobile app's rules and combo pages.
// Anything still assumed is marked "ASSUMPTION" where it is used, so it can be found and changed.

export interface Rules {
  /** Stake per fan, in sen. Default RM0.20. All money is kept in whole sen. */
  unitSen: number;
  /** Fewest fan needed to win. */
  minFan: number;
  /** A capped (10-fan) hand pays this many times the linear value. The cap itself is fixed at 10 (CAP). */
  capPayoutMultiplier: number;
  /** ASSUMPTION: Joker Opening Slam (4 jokers in the starting hand) is an instant win, paid as self-drawn. */
  openingSlamInstantWin: boolean;
  /**
   * Kong money (Sean's table, 2026-10-31; replaces the handover's "no instant kong payout"). In units of
   * the stake per fan. A kong from a discard: the discarder pays kongDiscardUnits. A self kong (four in
   * hand) or adding the 4th tile to a shown pong: each other player pays kongSelfUnits. A robbed kong pays
   * nothing. ASSUMPTIONS: paid even if the round ends in a draw (it's paid when made); fei kongs pay the same.
   */
  kongDiscardUnits: number;
  kongSelfUnits: number;
}

export const DEFAULT_RULES: Rules = {
  unitSen: 20,
  minFan: 5,
  capPayoutMultiplier: 2,
  openingSlamInstantWin: true,
  kongDiscardUnits: 2,
  kongSelfUnits: 1,
};

/** Seats: 0 = East (dealer), 1 = South, 2 = West. There is no North seat. */
export type Seat = 0 | 1 | 2;
export const SEAT_NAMES = ['East', 'South', 'West'] as const;

/**
 * Fan for a pong/kong of each wind, by the scoring player's seat (section 7).
 * Rows: East, South, West, North. Columns: East, South, West seat.
 */
export const WIND_PONG_FAN: readonly (readonly number[])[] = [
  [2, 1, 1],
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 1],
];
