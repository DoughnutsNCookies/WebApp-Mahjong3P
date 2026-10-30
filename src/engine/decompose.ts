import { Kind, PLAYABLE, isDot } from './tiles';

export type GroupType = 'pair' | 'pong' | 'kong' | 'chow';

/** One tile position in a group: the kind it counts as, and whether a joker stands in for it. */
export interface Slot {
  kind: Kind;
  joker: boolean;
}

export interface Group {
  type: GroupType;
  slots: Slot[];
  /** False only for melds exposed on the table. */
  concealed: boolean;
}

/** The kind of a pair/pong/kong, or the lowest tile of a chow. */
export const groupKind = (g: Group) => g.slots[0].kind;
export const groupJokers = (g: Group) => g.slots.filter((s) => s.joker).length;
export const isPongLike = (g: Group) => g.type === 'pong' || g.type === 'kong';

const slot = (kind: Kind, joker = false): Slot => ({ kind, joker });
const groupKey = (g: Group) => g.type + ':' + g.slots.map((s) => s.kind + (s.joker ? 'j' : '')).join(',');

/**
 * Every way to split concealed tiles into `sets` sets (pongs/chows) plus one pair, with jokers as wilds.
 *
 * `counts` holds the 16 playable kinds, `jokers` the jokers held. `outside[k]` is how many of kind k are
 * already used elsewhere in the player's hand (exposed melds, real or joker), so a joker never becomes a
 * 5th copy of a tile: "a joker cannot substitute for a tile you already hold 4 of" (section 5).
 * Q1: jokers can form or fill a pair, including a pair of two jokers.
 *
 * Returns distinct decompositions; the caller scores each and keeps the best.
 */
export function decompose(counts: number[], jokers: number, sets: number, outside?: number[]): Group[][] {
  const total = counts.reduce((a, b) => a + b, 0) + jokers;
  if (total !== 3 * sets + 2) return [];

  const c = counts.slice();
  // How many more of each kind a joker may still stand for.
  const room = c.map((n, k) => 4 - n - (outside ? outside[k] : 0));
  if (room.some((r) => r < 0)) return [];

  const out: Group[][] = [];
  const seen = new Set<string>();
  const cur: Group[] = [];

  const emit = () => {
    const key = cur.map(groupKey).sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cur.map((g) => ({ ...g, slots: g.slots.map((s) => ({ ...s })) })));
  };

  const withGroup = (g: Group, next: () => void) => {
    cur.push(g);
    next();
    cur.pop();
  };

  // Only jokers left: they can stand for any kind that still has room.
  const jokerOnly = (j: number, setsLeft: number, needPair: boolean) => {
    if (j !== 3 * setsLeft + (needPair ? 2 : 0)) return;
    if (setsLeft === 0 && !needPair) return emit();
    if (needPair) {
      for (let k = 0; k < PLAYABLE; k++) {
        if (room[k] < 2) continue;
        room[k] -= 2;
        withGroup({ type: 'pair', slots: [slot(k, true), slot(k, true)], concealed: true }, () =>
          jokerOnly(j - 2, setsLeft, false),
        );
        room[k] += 2;
      }
      return;
    }
    for (let k = 0; k < PLAYABLE; k++) {
      if (room[k] < 3) continue;
      room[k] -= 3;
      withGroup({ type: 'pong', slots: [slot(k, true), slot(k, true), slot(k, true)], concealed: true }, () =>
        jokerOnly(j - 3, setsLeft - 1, needPair),
      );
      room[k] += 3;
    }
    for (let s = 0; s <= 6; s++) {
      if (room[s] < 1 || room[s + 1] < 1 || room[s + 2] < 1) continue;
      room[s]--; room[s + 1]--; room[s + 2]--;
      withGroup({ type: 'chow', slots: [slot(s, true), slot(s + 1, true), slot(s + 2, true)], concealed: true }, () =>
        jokerOnly(j - 3, setsLeft - 1, needPair),
      );
      room[s]++; room[s + 1]++; room[s + 2]++;
    }
  };

  const rec = (j: number, setsLeft: number, needPair: boolean) => {
    let k = 0;
    while (k < PLAYABLE && c[k] === 0) k++;
    if (k === PLAYABLE) return jokerOnly(j, setsLeft, needPair);

    // k is the lowest real tile left, so it must start (or be the real part of) the next group.
    if (needPair) {
      if (c[k] >= 2) {
        c[k] -= 2;
        withGroup({ type: 'pair', slots: [slot(k), slot(k)], concealed: true }, () => rec(j, setsLeft, false));
        c[k] += 2;
      }
      if (j >= 1 && room[k] >= 1) {
        c[k]--; room[k]--;
        withGroup({ type: 'pair', slots: [slot(k), slot(k, true)], concealed: true }, () => rec(j - 1, setsLeft, false));
        c[k]++; room[k]++;
      }
    }
    if (setsLeft === 0) return;

    for (let real = Math.min(3, c[k]); real >= 1; real--) {
      const need = 3 - real;
      if (need > j || room[k] < need) continue;
      c[k] -= real; room[k] -= need;
      const slots = [...Array(real)].map(() => slot(k)).concat([...Array(need)].map(() => slot(k, true)));
      withGroup({ type: 'pong', slots, concealed: true }, () => rec(j - need, setsLeft - 1, needPair));
      c[k] += real; room[k] += need;
    }

    if (!isDot(k)) return;
    for (let s = Math.max(0, k - 2); s <= Math.min(k, 6); s++) {
      // Positions below k have no real tiles left, so they must be jokers; k itself is real.
      // Positions above k may be real or joker: try both, since a joker can free a real tile for elsewhere.
      const pick = (i: number, slots: Slot[], jUsed: number) => {
        if (i === 3) {
          withGroup({ type: 'chow', slots: slots.slice(), concealed: true }, () => rec(j - jUsed, setsLeft - 1, needPair));
          return;
        }
        const kind = s + i;
        if (kind >= k && c[kind] > 0) {
          c[kind]--;
          slots.push(slot(kind));
          pick(i + 1, slots, jUsed);
          slots.pop();
          c[kind]++;
        }
        if (kind !== k && jUsed < j && room[kind] > 0) {
          room[kind]--;
          slots.push(slot(kind, true));
          pick(i + 1, slots, jUsed + 1);
          slots.pop();
          room[kind]++;
        }
      };
      pick(0, [], 0);
    }
  };

  rec(jokers, sets, true);
  return out;
}

/** True if the tiles form `sets` sets plus a pair (cheap check, used by the game for legal moves). */
export function isStandardWin(counts: number[], jokers: number, sets: number, outside?: number[]): boolean {
  return decompose(counts, jokers, sets, outside).length > 0;
}
