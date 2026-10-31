// The hand analyzer: for each possible discard, how close the hand gets to winning, how many live tiles
// improve it, whether 5 fan (and 10) is realistic, and how dangerous the discard is. Every number comes
// with a plain-English reason, because the point is to learn from it, not just to be told what to do.

import {
  code, CAP, EAST, groupJokers, isBonus, isDot, isDragon, isHonour, isWind, JOKER, Kind, loserFan, Meld, name,
  PLAYABLE, RED, scoreWin, Seat, SOUTH, WEST, windPongFan,
} from '../engine';
import { shanten, Shanten } from './shanten';

export interface OpponentInfo {
  player: number;
  seat: Seat;
  melds: Meld[];
  discards: Kind[];
  discardedJokers: number;
  bonusCount: number;
}

export interface AnalyzerInput {
  seat: Seat;
  /** Concealed tiles: 14 on your turn (before discarding), or 13. */
  hand: Kind[];
  melds: Meld[];
  bonus: Kind[];
  discardedJokers: number;
  ownDiscards: Kind[];
  opponents: OpponentInfo[];
  wallLeft: number;
  /** Bonus tiles seen anywhere (all players' bonus areas), to judge the chance of drawing more. */
  bonusSeen: number;
}

export interface LiveTile { tile: Kind; live: number }
/** A winning tile. `fanDiscard` is 0 when it can't come off a discard (a joker can only be drawn). */
export interface Wait { tile: Kind; live: number; fanDiscard: number; fanSelf: number }

export interface FanPlan {
  key: string;
  label: string;
  fan: number;
  status: 'on track' | 'possible';
  note: string;
}

export type Reach = 'yes' | 'likely' | 'unlikely' | 'no';

export interface FanOutlook {
  /** Fan you'd have if you won now with nothing more: the 1 for winning plus finished items. */
  locked: number;
  plans: FanPlan[];
  /** Locked plus the plans that look on track, capped at 10. */
  estimate: number;
  reaches5: Reach;
  /** The most promising route to 10 fan, if any. */
  pathTo10: string | null;
  /** When ready (shanten 0): every winning tile and what it pays. */
  waits?: Wait[];
  /** When one away (shanten 1): share of improving tiles that lead to a 5-fan wait. */
  goodDraws?: { live: number; total: number };
}

export interface Safety {
  risk: number;
  label: 'safe' | 'low' | 'medium' | 'high';
  reasons: string[];
}

export interface DiscardOption {
  tile: Kind;
  shanten: number;
  ukeire: LiveTile[];
  ukeireTotal: number;
  fan: FanOutlook;
  safety: Safety;
  /** Ranking value; higher is better. */
  value: number;
  reasons: string[];
}

export interface Threat {
  player: number;
  seat: Seat;
  level: number;
  label: 'low' | 'medium' | 'high';
  reasons: string[];
}

export interface JokerAdvice {
  jokers: number;
  /** Shanten keeping every joker (after your best discard). */
  keep: number;
  /** Average shanten after setting one aside and drawing its replacement. */
  setAside: number;
  recommend: 'keep' | 'set aside';
  reasons: string[];
}

export interface Analysis {
  shanten: Shanten;
  options: DiscardOption[];
  threats: Threat[];
  joker: JokerAdvice | null;
  /** Fan you'd count in loser settlement if someone else won now (5+ collects from the other loser). */
  loserFan: number;
  advice: string[];
}

const SEAT_NAMES = ['East', 'South', 'West'];
const sortTiles = (h: Kind[]) => h.slice().sort((a, b) => a - b);
const removeOne = (h: Kind[], t: Kind) => {
  const out = h.slice();
  out.splice(out.indexOf(t), 1);
  return out;
};

// ---------------------------------------------------------------------------------------------------
// Visible tiles

/** Unseen copies of each kind from this player's point of view. Index 16 is jokers. */
export function liveCounts(input: AnalyzerInput): number[] {
  const seen = new Array(PLAYABLE + 1).fill(0);
  const see = (k: Kind) => { if (k <= JOKER) seen[k]++; };
  input.hand.forEach(see);
  input.ownDiscards.forEach(see);
  seen[JOKER] += input.discardedJokers;
  for (const m of input.melds) for (const s of m.slots) see(s.joker ? JOKER : s.kind);
  for (const o of input.opponents) {
    o.discards.forEach(see);
    seen[JOKER] += o.discardedJokers;
    for (const m of o.melds) for (const s of m.slots) see(s.joker ? JOKER : s.kind);
  }
  return seen.map((n) => Math.max(0, 4 - n));
}

const kindsToTry = [...Array(PLAYABLE).keys(), JOKER];

function ukeireOf(hand13: Kind[], meldCount: number, live: number[]): LiveTile[] {
  const base = shanten(hand13, meldCount).best;
  return kindsToTry
    .filter((t) => live[t] > 0 && shanten([...hand13, t], meldCount).best < base)
    .map((t) => ({ tile: t, live: live[t] }));
}

// ---------------------------------------------------------------------------------------------------
// Fan

// Winning tiles per concealed hand, for one analyze() call (seat, melds and bonus tiles are fixed within
// it). Keyed on the hand alone so the one-draw lookahead reuses results; live counts are applied after.
let waitCache = new Map<string, Omit<Wait, 'live'>[]>();

/** Start a fresh wait cache (analyze() does this itself; call it before using waitsOf with a new input). */
export function resetWaitCache() {
  waitCache = new Map();
}

/** Every tile that completes a 13-tile hand, with live count and fan on a discard and self-drawn. */
export function waitsOf(input: AnalyzerInput, hand13: Kind[], live: number[]): Wait[] {
  const key = sortTiles(hand13).join(',');
  let all = waitCache.get(key);
  if (!all) {
    all = [];
    for (const t of kindsToTry) {
      // Cheap shanten check first; full scoring only for tiles that actually complete the hand.
      if (shanten([...hand13, t], input.melds.length).best !== -1) continue;
      const base = {
        seat: input.seat, hand: [...hand13, t], melds: input.melds, bonus: input.bonus,
        discardedJokers: input.discardedJokers, winTile: t,
      };
      const selfDrawn = scoreWin({ ...base, selfDrawn: true });
      if (!selfDrawn) continue;
      // Jokers are never discarded (Q2), so a joker wait can only be self-drawn.
      const onDiscard = t === JOKER ? null : scoreWin({ ...base, selfDrawn: false });
      all.push({ tile: t, fanDiscard: onDiscard?.fan ?? 0, fanSelf: selfDrawn.fan });
    }
    waitCache.set(key, all);
  }
  return all.filter((w) => live[w.tile] > 0).map((w) => ({ ...w, live: live[w.tile] }));
}

/** Chance of getting through the rest of the round without drawing a bonus tile (for Flowerless). */
function noBonusChance(input: AnalyzerInput): number {
  const unseenBonus = 16 - input.bonusSeen;
  const unseen = Math.max(1, input.wallLeft + 26); // wall plus roughly the opponents' hands
  const myDraws = Math.max(1, Math.round(input.wallLeft / 3));
  return Math.pow(1 - unseenBonus / unseen, Math.min(myDraws, 8));
}

function fanPlans(input: AnalyzerInput, hand13: Kind[], live: number[]): FanPlan[] {
  const plans: FanPlan[] = [];
  const c = new Array(PLAYABLE).fill(0);
  let jokers = 0;
  for (const t of hand13) if (t === JOKER) jokers++; else c[t]++;
  const pongMelds = input.melds.filter((m) => m.type !== 'chow').map((m) => m.slots[0].kind);
  const has = (k: Kind) => c[k] + (pongMelds.includes(k) ? 3 : 0);

  // Pairs of scoring honours that could still become pongs.
  for (let k = EAST; k <= RED + 2; k++) {
    const fan = isWind(k) ? windPongFan(k, input.seat) : 1;
    if (!fan || c[k] !== 2) continue;
    if (live[k] > 0) {
      plans.push({ key: `pong${k}`, label: `Pong of ${name(k)}`, fan, status: 'possible',
        note: `You hold a pair; ${live[k]} more unseen.` });
    }
  }

  if (input.bonus.length === 0 && input.discardedJokers === 0) {
    const p = noBonusChance(input);
    plans.push({ key: 'flowerless', label: 'Flowerless', fan: CAP, status: p >= 0.5 ? 'on track' : 'possible',
      note: `No bonus tiles yet. About ${Math.round(p * 100)}% chance you don't draw one before the round ends. Setting a joker aside would end it.` });
  }

  const honourTiles = hand13.filter((t) => t !== JOKER && isHonour(t) && !(isWind(t) && windPongFan(t, input.seat) === 0));
  const meldsAllDots = input.melds.every((m) => isDot(m.slots[0].kind));
  if (meldsAllDots) {
    const n = honourTiles.length;
    if (n === 0) plans.push({ key: 'suitFlush', label: 'Suit Flush', fan: 2, status: 'on track', note: 'Every tile is dots (or a wind that scores nothing for you).' });
    else if (n <= 3) plans.push({ key: 'suitFlush', label: 'Suit Flush', fan: 2, status: 'possible', note: `Drop your ${n} scoring honour tile${n > 1 ? 's' : ''}.` });
  }

  if (input.melds.every((m) => m.type !== 'chow')) {
    const pongish = c.filter((n) => n >= 2).length + pongMelds.length + Math.floor(jokers / 2);
    if (pongish >= 5) plans.push({ key: 'allPongs', label: 'All Pongs', fan: 2, status: 'on track', note: 'Enough pairs and pongs for 4 pongs and a pair.' });
    else if (pongish >= 4) plans.push({ key: 'allPongs', label: 'All Pongs', fan: 2, status: 'possible', note: `${pongish} pairs/pongs so far; you need 5 groups.` });
  }

  const dragons = [RED, RED + 1, RED + 2];
  const started = (k: Kind) => has(k) >= 2 || (has(k) >= 1 && jokers > 0);
  const dragonPairs = dragons.filter(started).length;
  const thirdDragon = dragons.find((k) => !started(k));
  if (dragonPairs === 3) plans.push({ key: 'threeDragons', label: '3 Dragons', fan: CAP, status: 'possible', note: 'You have pairs (or a tile and a joker) in all three dragons.' });
  else if (dragonPairs === 2 && thirdDragon !== undefined && has(thirdDragon) + live[thirdDragon] >= 2) {
    plans.push({ key: 'smallDragons', label: 'Small Dragons', fan: 3, status: 'possible', note: `Two dragons started; you need a pair of ${name(thirdDragon)}.` });
  }

  const winds = [EAST, SOUTH, WEST];
  const windPairs = winds.filter((k) => has(k) >= 2).length;
  if (windPairs === 3) plans.push({ key: 'bigWinds', label: 'Big Winds', fan: CAP, status: 'possible', note: 'Pairs or pongs of East, South and West.' });
  else if (windPairs === 2) plans.push({ key: 'smallWinds', label: 'Small Winds', fan: 3, status: 'possible', note: 'Two of East/South/West started; the third as the pair.' });

  if (input.melds.length === 0) {
    const pairs = c.reduce((a, n) => a + Math.floor(n / 2), 0);
    if (pairs >= 5) plans.push({ key: 'sevenPairs', label: '7 Pairs', fan: CAP, status: pairs >= 6 ? 'on track' : 'possible',
      note: `${pairs} pairs. No jokers allowed: set any aside (free replacement).` });
  }

  const jokersOwned = jokers + input.discardedJokers + input.melds.reduce((a, m) => a + groupJokers(m), 0);
  if (jokersOwned >= 3) plans.push({ key: 'jokerSlam', label: 'Joker Slam', fan: CAP, status: 'possible', note: `You have ${jokersOwned} of the 4 jokers.` });

  const dotsOnly = hand13.every((t) => t === JOKER || isDot(t)) && input.melds.every((m) => isDot(m.slots[0].kind));
  if (dotsOnly) {
    const total = hand13.reduce((a, t) => a + (t === JOKER ? 9 : t + 1), 0) +
      input.melds.reduce((a, m) => a + m.slots.reduce((b, s) => b + s.kind + 1, 0), 0);
    if (total >= 80) plans.push({ key: 'hundredDots', label: 'Hundred Dots', fan: CAP, status: 'possible', note: `Your dots add up to about ${total}; 100 wins 10 fan.` });
  }

  if (jokers > 0) {
    plans.push({ key: 'setAsideJokers', label: 'Set jokers aside', fan: jokers, status: 'possible',
      note: `+1 fan each, but you lose the wild tile${jokers > 1 ? 's' : ''}.` });
  }
  return plans;
}

function fanOutlook(input: AnalyzerInput, hand13: Kind[], sh: number, live: number[]): FanOutlook {
  const locked = Math.min(CAP, 1 + loserFan(input.seat, hand13, input.melds, input.bonus, input.discardedJokers).fan);
  const plans = fanPlans(input, hand13, live);
  const onTrack = plans.filter((p) => p.status === 'on track' && p.key !== 'setAsideJokers');
  // Shape plans don't all fit together; count the best of them.
  const shape = new Set(['suitFlush', 'allPongs', 'sevenPairs']);
  const bestShape = Math.max(0, ...onTrack.filter((p) => shape.has(p.key)).map((p) => p.fan));
  const others = onTrack.filter((p) => !shape.has(p.key));
  // `planned` (for judging whether 5 fan is likely) counts Flowerless when it's on track; the estimate
  // shown to the player doesn't, because one bonus draw ends it.
  const planned = Math.min(CAP, locked + bestShape + others.reduce((a, p) => a + p.fan, 0));
  const estimate = Math.min(CAP, locked + bestShape + others.filter((p) => p.key !== 'flowerless').reduce((a, p) => a + p.fan, 0));
  const possibleMax = Math.min(CAP, planned + plans.filter((p) => p.status === 'possible').reduce((a, p) => a + p.fan, 0));
  const ten = plans.filter((p) => p.fan >= CAP).sort((a, b) => (a.status === 'on track' ? -1 : 1) - (b.status === 'on track' ? -1 : 1));
  const pathTo10 = estimate >= CAP ? 'Already at 10' : ten[0] ? `${ten[0].label} (${ten[0].status})` : null;

  const out: FanOutlook = { locked, plans, estimate, reaches5: 'no', pathTo10 };

  if (sh === 0) {
    out.waits = waitsOf(input, hand13, live);
    const good = out.waits.filter((w) => w.fanDiscard >= 5);
    const selfOnly = out.waits.filter((w) => w.fanDiscard < 5 && w.fanSelf >= 5);
    out.reaches5 = good.length ? 'yes' : selfOnly.length ? 'unlikely' : 'no';
    out.estimate = Math.max(0, ...out.waits.map((w) => w.fanDiscard));
    if (out.waits.some((w) => w.fanDiscard >= CAP)) out.pathTo10 = 'A 10-fan wait';
    return out;
  }

  if (sh === 1) {
    // Look one draw ahead: for each improving tile, the best ready hand after the best discard.
    let goodLive = 0;
    let totalLive = 0;
    for (const { tile, live: n } of ukeireOf(hand13, input.melds.length, live)) {
      totalLive += n;
      const h14 = [...hand13, tile];
      const after = live.slice();
      after[tile]--;
      let ok = false;
      for (const d of new Set(h14)) {
        const h = removeOne(h14, d);
        if (shanten(h, input.melds.length).best !== 0) continue;
        if (waitsOf(input, h, after).some((w) => w.fanDiscard >= 5 && w.live > 0)) { ok = true; break; }
      }
      if (ok) goodLive += n;
    }
    out.goodDraws = { live: goodLive, total: totalLive };
    out.reaches5 = totalLive && goodLive / totalLive >= 0.5 ? 'likely' : goodLive > 0 ? 'unlikely' : 'no';
    return out;
  }

  out.reaches5 = planned >= 5 ? 'likely' : possibleMax >= 5 ? 'unlikely' : 'no';
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Defence

/** How close each opponent looks to winning, from what is on the table. */
export function opponentThreats(input: AnalyzerInput): Threat[] {
  const progress = 1 - Math.min(1, input.wallLeft / 40);
  return input.opponents.map((o) => {
    const reasons: string[] = [];
    let level = 0.1 + 0.3 * progress;
    if (progress > 0.5) reasons.push('late in the round');
    if (o.melds.length) {
      level += 0.18 * o.melds.length;
      reasons.push(`${o.melds.length} exposed set${o.melds.length > 1 ? 's' : ''}`);
    }
    const scoring = o.melds.filter((m) => m.type !== 'chow' && (isDragon(m.slots[0].kind) || (isWind(m.slots[0].kind) && windPongFan(m.slots[0].kind, o.seat) > 0)));
    if (scoring.length) {
      level += 0.1 * scoring.length;
      reasons.push(`scoring pong${scoring.length > 1 ? 's' : ''} on show`);
    }
    level = Math.min(1, level);
    const label = level >= 0.6 ? 'high' : level >= 0.35 ? 'medium' : 'low';
    return { player: o.player, seat: o.seat, level, label, reasons };
  });
}

/** How risky discarding `tile` is against one opponent, 0-1 (their threat level times how likely the tile
 *  fits a hand like theirs). Used by the safety estimate and by the v3 AI's inputs. */
export function dangerTo(o: AnalyzerInput['opponents'][number], tile: Kind, live: number[], threat: Threat): number {
  let danger: number;
  // live[] counts this tile as yours, so unseen copies elsewhere are exactly live[tile].
  const unseen = live[tile];
  if (isHonour(tile)) danger = unseen === 0 ? 0.05 : unseen === 1 ? 0.3 : 0.6;
  else danger = tile === 0 || tile === 8 ? 0.6 : tile === 1 || tile === 7 ? 0.8 : 1;
  if (dotsOnlyLook(o)) danger *= isDot(tile) ? 1.3 : 0.5;
  // No furiten at this table: a tile they threw earlier can still win for them, it's just less likely.
  if (o.discards.includes(tile)) danger *= 0.4;
  return Math.min(1, threat.level * danger);
}

export const dotsOnlyLook = (o: AnalyzerInput['opponents'][number]) =>
  o.melds.length >= 2 && o.melds.every((m) => isDot(m.slots[0].kind));

function safetyOf(input: AnalyzerInput, tile: Kind, live: number[], th: Threat[]): Safety {
  const reasons: string[] = [];
  let risk = 0;
  for (const o of input.opponents) {
    const t = th.find((x) => x.player === o.player)!;
    const dotsOnly = dotsOnlyLook(o);
    const r = dangerTo(o, tile, live, t);
    if (r > risk) risk = r;
    if (r >= 0.3) {
      const why = [o.discards.includes(tile) ? 'they discarded it before' : '', dotsOnly && isDot(tile) ? 'they look to be on dots' : '']
        .filter(Boolean).join(', ');
      reasons.push(`${SEAT_NAMES[o.seat]} (${t.label} threat)${why ? ': ' + why : ''}`);
    }
  }
  if (isHonour(tile) && live[tile] === 0) reasons.push('every other copy is visible');
  else if (isHonour(tile) && live[tile] === 1) reasons.push('only one other copy unseen');
  const label = risk < 0.12 ? 'safe' : risk < 0.25 ? 'low' : risk < 0.45 ? 'medium' : 'high';
  return { risk, label, reasons };
}

// ---------------------------------------------------------------------------------------------------
// Putting it together

const REACH_VALUE: Record<Reach, number> = { yes: 150, likely: 80, unlikely: -60, no: -250 };

/**
 * How much each consideration counts when ranking discards (1 = as designed). Tuned by playing bots
 * against each other in the duplicate format (scripts/bots.ts); scripts may change these for experiments.
 */
export const WEIGHTS = { ukeire: 1, fan: 1, defence: 1 };

/** Fan a single tile could still turn into: an honour that scores as a pong is worth holding on to. */
function keepValue(tile: Kind, seat: Seat): number {
  if (isWind(tile)) return windPongFan(tile, seat);
  if (isDragon(tile)) return 1;
  return 0;
}

export function analyze(input: AnalyzerInput): Analysis {
  waitCache = new Map();
  const meldCount = input.melds.length;
  const live = liveCounts(input);
  const th = opponentThreats(input);
  const maxThreat = Math.max(0, ...th.map((t) => t.level));
  const sh = shanten(input.hand, meldCount);
  const onTurn = input.hand.length + 3 * meldCount === 14;

  const options: DiscardOption[] = [];
  // Fan routes open before discarding; a discard that closes one is marked down and says so.
  const openPlans = onTurn ? fanPlans(input, input.hand, live) : [];
  if (onTurn) {
    for (const tile of new Set(input.hand)) {
      if (tile === JOKER) continue; // jokers are set aside, not discarded: see the joker advice
      const hand13 = removeOne(input.hand, tile);
      const s = shanten(hand13, meldCount).best;
      const ukeire = ukeireOf(hand13, meldCount, live);
      const ukeireTotal = ukeire.reduce((a, u) => a + u.live, 0);
      const fan = fanOutlook(input, hand13, s, live);
      const safety = safetyOf(input, tile, live, th);

      let reachValue = REACH_VALUE[fan.reaches5];
      if (s === 0 && fan.reaches5 === 'no') reachValue = -1200; // a wait that can never pay out
      const defence = maxThreat * (s >= 2 ? 700 : s === 1 ? 350 : 150);
      const lost = openPlans.filter((p) => p.key !== 'setAsideJokers' && !fan.plans.some((q) => q.key === p.key));
      const lostValue = lost.reduce((a, p) => a + p.fan * (p.status === 'on track' ? 25 : 10), 0);
      const w = WEIGHTS;
      const value = -1000 * s + w.ukeire * 8 * ukeireTotal
        + w.fan * (reachValue + (fan.pathTo10 ? 40 : 0) - lostValue - 6 * keepValue(tile, input.seat))
        - w.defence * defence * safety.risk;

      const reasons: string[] = [];
      reasons.push(s === -1 ? 'Winning hand' : s === 0 ? 'Ready (one tile from winning)' : `${s} away from ready`);
      reasons.push(`${ukeireTotal} live tile${ukeireTotal === 1 ? '' : 's'} improve it`);
      if (lost.length) reasons.push(`Gives up ${lost.map((p) => `${p.label} (+${p.fan})`).join(', ')}`);
      else if (isWind(tile) && windPongFan(tile, input.seat) === 0) reasons.push(`${name(tile)} scores nothing for you`);
      if (fan.waits) {
        const good = fan.waits.filter((w) => w.fanDiscard >= 5);
        const drawOnly = fan.waits.filter((w) => w.fanDiscard < 5 && w.fanSelf >= 5);
        const parts = [
          ...good.map((w) => `${code(w.tile)} (${w.live} left, ${w.fanDiscard} fan)`),
          ...drawOnly.map((w) => `${code(w.tile)} (${w.live} left, ${w.fanSelf} fan, self-drawn only)`),
        ];
        reasons.push(good.length
          ? `Waits that pay: ${parts.join(', ')}`
          : fan.waits.length ? 'Ready, but no wait reaches 5 fan on a discard' : 'No live winning tiles');
      } else if (fan.goodDraws) {
        reasons.push(`${fan.goodDraws.live} of ${fan.goodDraws.total} improving tiles lead to a 5-fan wait`);
      } else {
        reasons.push(`About ${fan.estimate} fan on current plans (5 needed)`);
      }
      if (safety.label === 'medium' || safety.label === 'high') reasons.push(`${safety.label} risk to discard`);
      options.push({ tile, shanten: s, ukeire, ukeireTotal, fan, safety, value, reasons });
    }
    options.sort((a, b) => b.value - a.value);
  }

  const joker = jokerAdvice(input, live, options[0]?.shanten ?? sh.best);
  const lf = loserFan(input.seat, input.hand, input.melds, input.bonus, input.discardedJokers).fan;

  const advice: string[] = [];
  const best = options[0];
  if (best) {
    advice.push(`Discard ${name(best.tile)}: ${best.reasons.join('; ')}.`);
    if (maxThreat >= 0.6 && best.shanten >= 2) {
      const safest = options.slice().sort((a, b) => a.safety.risk - b.safety.risk)[0];
      advice.push(`An opponent looks close and you are far off: consider folding with safe tiles like ${name(safest.tile)}.`);
    }
  }
  if (joker) advice.push(`Joker: ${joker.recommend}. ${joker.reasons.join(' ')}`);
  if (lf > 0) advice.push(`Loser settlement: you hold ${lf} fan of finished items${lf >= 5 ? ', enough to collect if someone else wins under 10' : ''}.`);

  return { shanten: sh, options, threats: th, joker, loserFan: lf, advice };
}

function jokerAdvice(input: AnalyzerInput, live: number[], keep: number): JokerAdvice | null {
  const jokers = input.hand.filter((t) => t === JOKER).length;
  if (!jokers || input.wallLeft === 0) return null;
  const meldCount = input.melds.length;
  // Set one aside, draw a replacement (bonus draws are replaced again, so ignore them), then discard.
  const without = removeOne(input.hand, JOKER);
  let weighted = 0;
  let total = 0;
  for (let t = 0; t <= JOKER; t++) {
    if (isBonus(t) || live[t] === 0) continue;
    weighted += live[t] * shanten([...without, t], meldCount).best;
    total += live[t];
  }
  const setAside = total ? weighted / total : keep;
  const reasons: string[] = [];
  const flowerless = input.bonus.length === 0 && input.discardedJokers === 0;
  reasons.push(`Keeping it: ${keep} from ready. Setting it aside: about ${setAside.toFixed(1)} from ready, +1 fan.`);
  reasons.push('Fei money is the same either way.');
  if (flowerless) reasons.push('Setting it aside ends Flowerless (10 fan).');
  if (input.melds.length === 0 && shanten(input.hand, 0).sevenPairs <= 1) reasons.push('7 Pairs needs every joker set aside.');
  const recommend = !flowerless && setAside - keep <= 0.35 ? 'set aside' : 'keep';
  return { jokers, keep, setAside, recommend, reasons };
}
