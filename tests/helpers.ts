import { Meld, parse, Seat, scoreWin, WinInput, JOKER, Kind } from '../src/engine';

/** A meld from codes. A "J" takes the kind it stands for: pong("E E J"), chow("3d J 5d"). */
export function meld(type: 'pong' | 'kong' | 'chow', tiles: string, opts: Partial<Meld> = {}): Meld {
  const ks = parse(tiles);
  const first = ks.findIndex((k) => k !== JOKER);
  const base = type === 'chow' ? ks[first] - first : ks[first];
  const slots = ks.map((k, i) => ({ kind: type === 'chow' ? base + i : base, joker: k === JOKER }));
  return { type, slots, concealed: false, ...opts };
}

export interface WinOpts extends Partial<Omit<WinInput, 'hand' | 'bonus' | 'winTile'>> {
  bonus?: string;
  win?: string;
}

/**
 * Scores a hand. Defaults: East seat, discard win on the last tile listed, and one flower that scores
 * nothing for that seat, so Flowerless does not apply unless a test asks for it with bonus: ''.
 */
export function score(hand: string, opts: WinOpts = {}) {
  const tiles = parse(hand);
  const winTile: Kind = opts.win ? parse(opts.win)[0] : tiles[tiles.length - 1];
  const seat = opts.seat ?? 0;
  const input: WinInput = {
    melds: [],
    discardedJokers: 0,
    selfDrawn: false,
    ...opts,
    seat: seat as Seat,
    hand: tiles,
    bonus: parse(opts.bonus ?? ['F2', 'F3', 'F1'][seat]),
    winTile,
  };
  return scoreWin(input);
}

/** Item keys with their fan, e.g. { win: 1, suitFlush: 2 }. */
export function items(hand: string, opts: WinOpts = {}): Record<string, number> {
  const s = score(hand, opts);
  if (!s) throw new Error(`Not a winning hand: ${hand}`);
  return Object.fromEntries(s.items.map((i) => [i.key, i.fan]));
}
