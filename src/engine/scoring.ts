import { decompose, Group, groupJokers, groupKind, isPongLike, Slot } from './decompose';
import { Seat, WIND_PONG_FAN } from './rules';
import {
  bonusNumber, countHand, dotValue, EAST, isAnimal, isDot, isDragon, isFlower, isHonour, isNumberedBonus,
  isSeason, isTerminal, isWind, JOKER, Kind, NORTH, PLAYABLE, RED, SOUTH, WEST, WHITE,
} from './tiles';

/** A set on the table (or a declared concealed kong). */
export interface Meld extends Group {
  type: 'chow' | 'pong' | 'kong';
  /** How a kong was made. Concealed kongs have `concealed: true`. */
  kongType?: 'concealed' | 'added' | 'exposed';
  /** Player the claimed tile came from, if any. */
  from?: number;
}

export type ReplacementReason = 'kong' | 'bonus';

export interface WinInput {
  seat: Seat;
  /** Concealed tiles, including the winning tile and any jokers. */
  hand: Kind[];
  melds: Meld[];
  bonus: Kind[];
  discardedJokers: number;
  winTile: Kind;
  selfDrawn: boolean;
  robbedKong?: boolean;
  /** Replacement draws in this turn that led to the winning tile, oldest first. Empty for a normal draw. */
  replacementChain?: ReplacementReason[];
  heavenly?: boolean;
  earthly?: boolean;
  lastTile?: boolean;
  lastDiscard?: boolean;
  openingSlam?: boolean;
}

export interface FanItem {
  key: string;
  label: string;
  fan: number;
}

export type Pattern = 'standard' | 'sevenPairs' | 'thirteenWonders' | 'nineLanterns' | 'openingSlam';

export interface Score {
  /** Total after the house cap. */
  fan: number;
  /** Total before the cap. */
  rawFan: number;
  items: FanItem[];
  pattern: Pattern;
  /** The sets used, for standard hands (melds first). */
  groups?: Group[];
}

/** House cap: anything above 10 fan (the app's 15/25/40/50-fan hands) scores as 10. */
export const CAP = 10;
const item = (key: string, label: string, fan: number): FanItem => ({ key, label, fan });

export const windPongFan = (kind: Kind, seat: Seat) => WIND_PONG_FAN[kind - EAST][seat];

/** A wind that would not score for this player as a pong: allowed as the pair in Suit Flush / All Chows. */
const isDeadWind = (kind: Kind, seat: Seat) => isWind(kind) && windPongFan(kind, seat) === 0;

/** Section 6: fan from bonus tiles. Used for winners and for loser settlement. */
export function bonusItems(bonus: Kind[], seat: Seat): FanItem[] {
  const items: FanItem[] = [];
  const animals = bonus.filter(isAnimal).length;
  if (animals) items.push(item('animals', 'Bonus tiles (non-numbered)', animals));
  const own = seat + 1;
  for (const [label, test] of [['Flower', isFlower], ['Season', isSeason]] as const) {
    const nums = new Set(bonus.filter(test).map(bonusNumber));
    if (nums.has(1) && nums.has(2) && nums.has(3)) {
      // The 2 fan is the whole value of the set: the own-seat tile inside it adds nothing extra.
      items.push(item(`${label.toLowerCase()}Set`, `${label}s 1-2-3`, 2));
    } else if (nums.has(own)) {
      items.push(item(`${label.toLowerCase()}Own`, `${label} ${own} (own seat)`, 1));
    }
    // 4 counts for everyone: there is no North player.
    if (nums.has(4)) items.push(item(`${label.toLowerCase()}4`, `${label} 4`, 1));
  }
  return items;
}

/** Fan from each scoring pong/kong (section 7). */
function pongItems(groups: Group[], seat: Seat): FanItem[] {
  const items: FanItem[] = [];
  for (const g of groups) {
    if (!isPongLike(g)) continue;
    const k = groupKind(g);
    const label = g.type === 'kong' ? 'kong' : 'pong';
    if (isWind(k)) {
      const fan = windPongFan(k, seat);
      if (fan) items.push(item(`wind${k}`, `${['East', 'South', 'West', 'North'][k - EAST]} ${label}`, fan));
    } else if (isDragon(k)) {
      items.push(item(`dragon${k}`, `${['Red', 'Green', 'White'][k - RED]} dragon ${label}`, 1));
    }
  }
  return items;
}

function sum(items: FanItem[]) {
  return items.reduce((a, b) => a + b.fan, 0);
}

/** Items that apply whatever the hand's shape: how it was won, bonus tiles, jokers. */
function commonItems(input: WinInput): FanItem[] {
  const items: FanItem[] = [item('win', 'Win', 1)];
  const chain = input.replacementChain ?? [];
  const last = chain[chain.length - 1];
  const prev = chain[chain.length - 2];

  if (input.robbedKong) items.push(item('stealKong', 'Steal Kong', 1));
  if (input.selfDrawn && last === 'kong') items.push(item('kongHu', 'Kong Hu', 1));
  if (input.selfDrawn && last === 'bonus') items.push(item('flowerHu', 'Flower Hu', 1));
  if (input.selfDrawn && prev === 'kong' && last === 'bonus') items.push(item('kongFlowerHu', 'Kong Flower Hu', CAP));
  if (input.selfDrawn && prev === 'bonus' && last === 'kong') items.push(item('flowerKongHu', 'Flower Kong Hu', CAP));
  if (input.selfDrawn && prev === 'kong' && last === 'kong') items.push(item('kongKongHu', 'Kong Kong Hu', CAP));

  items.push(...bonusItems(input.bonus, input.seat));
  if (input.discardedJokers) items.push(item('discardedJokers', 'Discarded jokers', input.discardedJokers));

  if (input.bonus.length === 0 && input.discardedJokers === 0) items.push(item('flowerless', 'Flowerless', CAP));
  if (input.bonus.filter(isNumberedBonus).length >= 7) items.push(item('sevenFlowers', '7 Flowers', CAP));

  const jokersHeld =
    input.hand.filter((t) => t === JOKER).length +
    input.melds.reduce((a, m) => a + groupJokers(m), 0) +
    input.discardedJokers;
  if (input.discardedJokers === 4) items.push(item('fourJokersDiscard', '4 Jokers Discard', CAP));
  if (jokersHeld === 4) items.push(item('jokerSlam', 'Joker Slam', CAP));

  if (input.heavenly) items.push(item('heavenly', 'Heavenly Slam', CAP));
  if (input.earthly) items.push(item('earthly', 'Earthly Slam', CAP));
  if (input.lastTile) items.push(item('lastTile', 'Last Tile', CAP));
  if (input.lastDiscard) items.push(item('lastDiscard', 'Last Discard', CAP));
  return items;
}

/** Items from the shape of a standard 4-sets-plus-pair hand. */
function standardItems(groups: Group[], input: WinInput): FanItem[] {
  const { seat } = input;
  const items = pongItems(groups, seat);
  const sets = groups.filter((g) => g.type !== 'pair');
  const pair = groups.find((g) => g.type === 'pair')!;
  const pairKind = groupKind(pair);
  const pongKinds = new Set(sets.filter(isPongLike).map(groupKind));
  const allSlots: Slot[] = groups.flatMap((g) => g.slots);

  const dragons = [RED, RED + 1, WHITE];
  const dragonPongs = dragons.filter((k) => pongKinds.has(k)).length;
  if (dragonPongs === 3) items.push(item('threeDragons', '3 Dragons', CAP));
  else if (dragonPongs === 2 && isDragon(pairKind)) items.push(item('smallDragons', 'Small Dragons', 3));

  const seatWinds = [EAST, SOUTH, WEST];
  const windPongs = seatWinds.filter((k) => pongKinds.has(k)).length;
  if (windPongs === 3) items.push(item('bigWinds', 'Big Winds', CAP));
  else if (windPongs === 2 && seatWinds.includes(pairKind) && !pongKinds.has(pairKind)) {
    items.push(item('smallWinds', 'Small Winds', 3));
  }

  if (allSlots.every((s) => isHonour(s.kind))) items.push(item('allHonours', 'All Honours', CAP));
  else if (allSlots.every((s) => isHonour(s.kind) || isTerminal(s.kind))) {
    items.push(item('honoursTerminal', 'Honours Terminal', 1));
  }

  const pairOk = isDot(pairKind) || isDeadWind(pairKind, seat);
  if (sets.every((g) => isDot(groupKind(g))) && pairOk) items.push(item('suitFlush', 'Suit Flush', 2));
  if (sets.every(isPongLike)) items.push(item('allPongs', 'All Pongs', 2));
  if (sets.every((g) => g.type === 'chow') && pairOk) items.push(item('allChows', 'All Chows', 1));

  // Q8: the pair must be dots too and counts toward the 100; a joker counts as the value it stands for.
  if (allSlots.every((s) => isDot(s.kind)) && allSlots.reduce((a, s) => a + dotValue(s.kind), 0) >= 100) {
    items.push(item('hundredDots', 'Hundred Dots', CAP));
  }

  // ASSUMPTION: on a discard win, the winning tile must complete the pair, otherwise the pong it
  // completes is exposed and the hand is no longer 4 concealed pongs.
  const concealedSets = sets.every((g) => g.concealed && isPongLike(g));
  const winInPair = pair.slots.some((s) => (input.winTile === JOKER ? s.joker : !s.joker && s.kind === input.winTile));
  if (concealedSets && (input.selfDrawn || winInPair)) items.push(item('hiddenTreasures', 'Hidden Treasures', CAP));

  // ASSUMPTION: any kong counts, including one claimed from a discard.
  const kongs = sets.filter((g) => g.type === 'kong').length;
  if (kongs === 4) items.push(item('eighteenArhats', '18 Arhats', CAP));
  else if (kongs === 3) items.push(item('tripleKong', 'Triple Kong', CAP));
  return items;
}

/** 1112345678999 dots plus one more dot. Jokers fill gaps unless `real` is set. */
function isNineLanterns(counts: number[], jokers: number, real: boolean): boolean {
  if (real && jokers > 0) return false;
  for (let k = 9; k < PLAYABLE; k++) if (counts[k]) return false;
  const need = [3, 1, 1, 1, 1, 1, 1, 1, 3];
  let deficit = 0;
  for (let k = 0; k < 9; k++) deficit += Math.max(0, need[k] - counts[k]);
  return deficit <= jokers;
}

/** Real kinds and joker stand-ins already used by the melds, for the 4-copies limit. */
function meldUse(melds: Meld[]): number[] {
  const use = new Array(PLAYABLE).fill(0);
  for (const m of melds) for (const s of m.slots) use[s.kind]++;
  return use;
}

/**
 * Scores a winning hand. Returns null if the tiles are not a winning shape.
 * The caller checks `fan >= rules.minFan` before allowing the win.
 */
export function scoreWin(input: WinInput): Score | null {
  const { counts, jokers } = countHand(input.hand);
  const common = commonItems(input);
  const candidates: Score[] = [];
  const make = (pattern: Pattern, items: FanItem[], groups?: Group[]): Score => {
    const all = [...common, ...items];
    const rawFan = sum(all);
    return { fan: Math.min(CAP, rawFan), rawFan, items: all, pattern, groups };
  };

  if (input.openingSlam) candidates.push(make('openingSlam', [item('openingSlam', 'Joker Opening Slam', CAP)]));

  const sets = 4 - input.melds.length;
  const meldGroups: Group[] = input.melds;
  for (const groups of decompose(counts, jokers, sets, meldUse(input.melds))) {
    const all = [...meldGroups, ...groups];
    candidates.push(make('standard', standardItems(all, input), all));
  }

  const concealedHand = input.melds.length === 0 && input.hand.length === 14;
  if (concealedHand) {
    // 7 Pairs, 7 Stars and Big Wheel allow no jokers. Q7: four identical tiles count as two pairs.
    if (jokers === 0 && counts.every((n) => n % 2 === 0)) {
      const items = [item('sevenPairs', '7 Pairs', CAP)];
      if (counts.every((n, k) => (isHonour(k) ? n === 2 : n === 0))) items.push(item('sevenStars', '7 Stars', CAP));
      // ASSUMPTION: Big Wheel is one pair of each of 2-8.
      if (counts.every((n, k) => (k >= 1 && k <= 7 ? n === 2 : n === 0))) items.push(item('bigWheel', 'Big Wheel', CAP));
      candidates.push(make('sevenPairs', items));
    }

    const wonders = [EAST, SOUTH, WEST, NORTH, RED, RED + 1, WHITE, 0, 8];
    if (
      jokers === 4 &&
      wonders.every((k) => counts[k] >= 1) &&
      counts.every((n, k) => (wonders.includes(k) ? n <= 2 : n === 0))
    ) {
      candidates.push(make('thirteenWonders', [item('thirteenWonders', '13 Wonders', CAP)]));
    }
  }

  // ASSUMPTION: 9 Lanterns (with jokers) must be concealed, like Real 9 Lanterns.
  const lanternsAllowed = input.melds.length === 0 && input.hand.length === 14;
  if (lanternsAllowed && isNineLanterns(counts, jokers, true)) {
    candidates.push(make('nineLanterns', [item('realNineLanterns', 'Real 9 Lanterns', CAP)]));
  } else if (lanternsAllowed && isNineLanterns(counts, jokers, false)) {
    candidates.push(make('nineLanterns', [item('nineLanterns', '9 Lanterns', CAP)]));
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.fan - a.fan || b.rawFan - a.rawFan);
  return candidates[0];
}

/**
 * Loser settlement fan (section 9): finished items only, never the 1 fan for winning or whole-hand
 * patterns. Counts scoring pongs/kongs (exposed, declared, or complete in the concealed hand, using
 * jokers where that helps), bonus tiles and discarded jokers. Q11: every hand is shown at the end.
 */
export function loserFan(
  seat: Seat,
  hand: Kind[],
  melds: Meld[],
  bonus: Kind[],
  discardedJokers: number,
): { fan: number; items: FanItem[] } {
  const items = [...pongItems(melds, seat), ...bonusItems(bonus, seat)];
  if (discardedJokers) items.push(item('discardedJokers', 'Discarded jokers', discardedJokers));

  // Best set of complete scoring pongs inside the concealed hand.
  const { counts, jokers } = countHand(hand);
  const used = meldUse(melds);
  const scoring = [EAST, SOUTH, WEST, NORTH, RED, RED + 1, WHITE].filter((k) =>
    isWind(k) ? windPongFan(k, seat) > 0 : true,
  );
  let best: Group[] = [];
  let bestFan = 0;
  const chosen: Group[] = [];
  const search = (i: number, j: number) => {
    const fan = sum(pongItems(chosen, seat));
    if (fan > bestFan) {
      bestFan = fan;
      best = chosen.slice();
    }
    for (let x = i; x < scoring.length; x++) {
      const k = scoring[x];
      const real = Math.min(3, counts[k]);
      const need = 3 - real;
      if (real === 0 || need > j || used[k] + counts[k] + need > 4) continue;
      const slots = [...Array(real)].map(() => ({ kind: k, joker: false }))
        .concat([...Array(need)].map(() => ({ kind: k, joker: true })));
      chosen.push({ type: 'pong', slots, concealed: true });
      search(x + 1, j - need);
      chosen.pop();
    }
  };
  search(0, jokers);
  items.push(...pongItems(best, seat));
  return { fan: Math.min(CAP, sum(items)), items };
}
