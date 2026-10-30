// Section 9: fan payout, fei (joker) money and loser settlement. All amounts are whole sen.
// Each function returns one delta per player (positive = receives); every result sums to zero.

import { DEFAULT_RULES, Rules } from './rules';
import { CAP } from './scoring';

/** 5-9 fan pays linearly; a capped 10-fan hand pays double. */
export function handValue(fan: number, rules: Rules = DEFAULT_RULES): number {
  return fan >= CAP ? CAP * rules.unitSen * rules.capPayoutMultiplier : fan * rules.unitSen;
}

/**
 * 'discard': discard wins, Last Discard, Earthly Slam and Steal Kong. The payer pays 3V alone.
 * 'self': self-drawn wins, including Kong Hu, Flower Hu and the replacement-chain hands and Last Tile.
 *         Each opponent pays 2V.
 */
export type PaymentType = 'discard' | 'self';

export function fanPayout(
  winner: number,
  fan: number,
  type: PaymentType,
  payer: number | undefined,
  rules: Rules = DEFAULT_RULES,
): number[] {
  const v = handValue(fan, rules);
  const d = [0, 0, 0];
  if (type === 'discard') {
    if (payer === undefined || payer === winner) throw new Error('A discard win needs a payer other than the winner');
    d[payer] -= 3 * v;
    d[winner] += 3 * v;
  } else {
    for (let p = 0; p < 3; p++) if (p !== winner) {
      d[p] -= 2 * v;
      d[winner] += 2 * v;
    }
  }
  return d;
}

/**
 * Every joker a player has (in hand, in melds or discarded) earns one unit from each opponent.
 * Settled every round, win or draw; all three players settle with each other.
 */
export function feiPayout(jokers: number[], rules: Rules = DEFAULT_RULES): number[] {
  const d = [0, 0, 0];
  for (let p = 0; p < 3; p++) {
    for (let q = 0; q < 3; q++) if (q !== p) {
      d[q] -= jokers[p] * rules.unitSen;
      d[p] += jokers[p] * rules.unitSen;
    }
  }
  return d;
}

/**
 * Loser settlement between the two losers after a win under 10 fan, at the normal per-fan rate.
 * `fans[winner]` is ignored.
 *   Both 5+: the lower pays the difference. Only one 5+: the other pays that one's full fan value.
 *   Neither 5+, or equal: nothing.
 */
export function loserSettlement(winner: number, fans: number[], rules: Rules = DEFAULT_RULES): number[] {
  const d = [0, 0, 0];
  const [a, b] = [0, 1, 2].filter((p) => p !== winner);
  const fa = fans[a], fb = fans[b];
  const min = rules.minFan;
  let amount = 0;
  let to = a, from = b;
  if (fa >= min && fb >= min) {
    amount = Math.abs(fa - fb);
    if (fb > fa) [to, from] = [b, a];
  } else if (fa >= min) {
    amount = fa;
  } else if (fb >= min) {
    amount = fb;
    [to, from] = [b, a];
  }
  d[to] += amount * rules.unitSen;
  d[from] -= amount * rules.unitSen;
  return d;
}

export const addDeltas = (...ds: number[][]) => [0, 1, 2].map((p) => ds.reduce((a, d) => a + d[p], 0));

/** Formats sen as RM, e.g. 300 -> "RM3.00", -40 -> "-RM0.40". */
export const rm = (sen: number) => `${sen < 0 ? '-' : ''}RM${(Math.abs(sen) / 100).toFixed(2)}`;
