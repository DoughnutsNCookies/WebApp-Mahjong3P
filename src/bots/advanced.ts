// Advanced bot: the normal bot plus money-based decisions once it is ready (one tile from winning).
//
// It can turn down a win under 10 fan when carrying on is worth more: for example early in the round,
// holding a wait that pays 10 fan self-drawn, against 5 fan off a discard now. It also chooses between
// ready hands by expected payout rather than by number of live tiles, so it leans toward the 10-fan
// doubling. Still no peeking: everything comes from its own view.
//
// The estimates are deliberately simple and explainable (the numbers are shown in `reason`):
//   p  = chance per round of turns that it wins: a fixed amount per live winning tile
//   h  = chance per round of turns that someone else wins, from how threatening the opponents look
//   over the turns left: P(win first) = p/(p+h) * (1 - (1-p-h)^turns), P(lose first) likewise with h.
// The rates were fitted to 2,606 ready hands in normal-bot games (who actually won first). The fitted
// model is within 2-5 points of the real outcomes by live tiles and by wall left. Refit with
// scripts/calibrate.ts if the analyzer's threat levels or the bots change.
const P_PER_LIVE = 0.0525;
const H_PER_THREAT = 0.28;
const H_PER_PROGRESS = 0.03;

import {
  Analysis, AnalyzerInput, liveCounts, opponentThreats, resetWaitCache, shanten, Threat, Wait, waitsOf,
} from '../analyzer';
import { CAP, handValue, JOKER, Kind } from '../engine';

/** Rough cost of someone else winning, in sen: about a 7-fan hand, sometimes paid alone. */
const LOSS_IF_OTHER_WINS = 1.5;
/** Turn down a win only if carrying on is clearly better. */
const DECLINE_MARGIN = 1.15;

export interface Continuation {
  /** Expected sen from carrying on with this ready hand. */
  ev: number;
  pWin: number;
  pLose: number;
  waits: Wait[];
}

function removeOne(h: Kind[], t: Kind): Kind[] {
  const out = h.slice();
  out.splice(out.indexOf(t), 1);
  return out;
}

/**
 * Live winning tiles, counting half for tiles that can only be self-drawn (jokers, or waits only worth
 * 5 fan self-drawn): about half of all wins come off discards.
 */
export function effectiveLive(waits: Wait[]): number {
  return waits.reduce((a, w) => a + w.live * (w.fanDiscard >= 5 ? 1 : 0.5), 0);
}

/** Expected value of staying ready with this 13-tile hand. */
export function continuation(input: AnalyzerInput, hand13: Kind[], live: number[], threats: Threat[]): Continuation {
  const waits = waitsOf(input, hand13, live).filter((w) => Math.max(w.fanDiscard, w.fanSelf) >= 5);
  const liveWins = effectiveLive(waits);
  const turns = Math.max(0, Math.floor(input.wallLeft / 3));
  if (!liveWins || !turns) return { ev: 0, pWin: 0, pLose: 0, waits };

  const progress = 1 - Math.min(1, input.wallLeft / 40);
  const p = Math.min(0.9, P_PER_LIVE * liveWins);
  const h = Math.max(0.01, H_PER_THREAT * threats.reduce((a, t) => a + t.level, 0) + H_PER_PROGRESS * progress);
  const ends = 1 - Math.pow(Math.max(0, 1 - p - h), turns);
  const pWin = (p / (p + h)) * ends;
  const pLose = (h / (p + h)) * ends;

  // Value of a win, weighted by which tile it comes on. A tile that can come off a discard wins about
  // half the time that way (3V from the discarder) and half self-drawn (2V from each); a tile that can
  // only be drawn always pays self-drawn.
  let value = 0;
  for (const w of waits) {
    const self = 4 * handValue(w.fanSelf);
    const disc = w.fanDiscard >= 5 ? 3 * handValue(w.fanDiscard) : 0;
    const share = (w.live * (disc ? 1 : 0.5)) / liveWins;
    value += share * (disc ? 0.5 * disc + 0.5 * self : self);
  }
  const ev = pWin * value - pLose * LOSS_IF_OTHER_WINS * handValue(7);
  return { ev, pWin, pLose, waits };
}

export interface WinDecision {
  take: boolean;
  reason: string;
  /** If not taking a self-drawn win, the tile to discard instead. */
  discard?: Kind;
}

/**
 * Should the bot take the win on offer? `selfDrawn` wins have a 14-tile hand (it may discard to a better
 * wait instead); discard wins leave the 13-tile hand as it is.
 */
export function decideWin(input: AnalyzerInput, fan: number, selfDrawn: boolean): WinDecision {
  const takeNow = (selfDrawn ? 4 : 3) * handValue(fan);
  if (fan >= CAP) return { take: true, reason: 'Already 10 fan, the cap.' };

  resetWaitCache();
  const live = liveCounts(input);
  const threats = opponentThreats(input);

  let best: (Continuation & { discard?: Kind }) | null = null;
  if (selfDrawn) {
    for (const d of new Set(input.hand)) {
      if (d === JOKER) continue;
      const h = removeOne(input.hand, d);
      if (shanten(h, input.melds.length).best !== 0) continue;
      const c = continuation(input, h, live, threats);
      if (!best || c.ev > best.ev) best = { ...c, discard: d };
    }
  } else {
    best = continuation(input, input.hand, live, threats);
  }

  if (!best || best.ev <= takeNow * DECLINE_MARGIN) {
    return { take: true, reason: `Take ${fan} fan now (${takeNow} sen) over carrying on (about ${Math.round(best?.ev ?? 0)} sen).` };
  }
  return {
    take: false,
    discard: best.discard,
    reason: `Carrying on is worth about ${Math.round(best.ev)} sen (win first ${Math.round(best.pWin * 100)}%, ` +
      `someone else first ${Math.round(best.pLose * 100)}%) against ${takeNow} sen for ${fan} fan now.`,
  };
}

/**
 * Among discards that leave the hand ready, the one with the best expected payout after the risk of the
 * discard itself dealing in. `analysis` must be analyze(input) (its wait cache is reused).
 */
export function bestReadyDiscard(input: AnalyzerInput, analysis: Analysis): { tile: Kind; ev: number } | null {
  const live = liveCounts(input);
  let best: { tile: Kind; ev: number } | null = null;
  for (const o of analysis.options) {
    if (o.shanten !== 0) continue;
    const c = continuation(input, removeOne(input.hand, o.tile), live, analysis.threats);
    const ev = c.ev - o.safety.risk * 3 * handValue(7);
    if (!best || ev > best.ev) best = { tile: o.tile, ev };
  }
  return best;
}
