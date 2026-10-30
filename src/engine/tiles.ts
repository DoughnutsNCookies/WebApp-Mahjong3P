// Tile kinds are small integers so hands can be counted in plain arrays.
//   0-8   dots 1-9 (the only suit)
//   9-12  winds East, South, West, North
//   13-15 dragons Red, Green, White
//   16    joker (fei)
//   17-20 flowers 1-4, 21-24 seasons 1-4, 25-32 the 8 non-numbered bonus tiles

export type Kind = number;

export const EAST = 9;
export const SOUTH = 10;
export const WEST = 11;
export const NORTH = 12;
export const RED = 13;
export const GREEN = 14;
export const WHITE = 15;
export const JOKER = 16;

/** Kinds that can sit in a hand as themselves (dots and honours). Jokers and bonus tiles are separate. */
export const PLAYABLE = 16;
export const KIND_COUNT = 33;

export const dot = (n: number): Kind => n - 1;
export const flower = (n: number): Kind => 16 + n;
export const season = (n: number): Kind => 20 + n;
export const animal = (n: number): Kind => 24 + n;

export const isDot = (k: Kind) => k >= 0 && k <= 8;
export const dotValue = (k: Kind) => k + 1;
export const isTerminal = (k: Kind) => k === 0 || k === 8;
export const isHonour = (k: Kind) => k >= 9 && k <= 15;
export const isWind = (k: Kind) => k >= 9 && k <= 12;
export const isDragon = (k: Kind) => k >= 13 && k <= 15;
export const isBonus = (k: Kind) => k >= 17;
export const isFlower = (k: Kind) => k >= 17 && k <= 20;
export const isSeason = (k: Kind) => k >= 21 && k <= 24;
export const isNumberedBonus = (k: Kind) => k >= 17 && k <= 24;
export const isAnimal = (k: Kind) => k >= 25;
/** 1-4 for flowers and seasons. */
export const bonusNumber = (k: Kind) => (isFlower(k) ? k - 16 : k - 20);

/** The 84 tiles in the set. */
export function fullSet(): Kind[] {
  const tiles: Kind[] = [];
  for (let k = 0; k < PLAYABLE; k++) for (let i = 0; i < 4; i++) tiles.push(k);
  for (let i = 0; i < 4; i++) tiles.push(JOKER);
  for (let k = 17; k < KIND_COUNT; k++) tiles.push(k);
  return tiles;
}

const HONOUR_CODES = ['E', 'S', 'W', 'N', 'Rd', 'Gd', 'Wd'];
const FLOWER_NAMES = ['Plum', 'Orchid', 'Chrysanthemum', 'Bamboo'];
const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];

/** Short code used in tests and logs: 5d, E, Rd, J, F1, S1, A1. */
export function code(k: Kind): string {
  if (isDot(k)) return `${dotValue(k)}d`;
  if (isHonour(k)) return HONOUR_CODES[k - 9];
  if (k === JOKER) return 'J';
  if (isFlower(k)) return `F${bonusNumber(k)}`;
  if (isSeason(k)) return `S${bonusNumber(k)}`;
  return `A${k - 24}`;
}

export function name(k: Kind): string {
  if (isDot(k)) return `${dotValue(k)} Dot`;
  if (isHonour(k)) return ['East', 'South', 'West', 'North', 'Red', 'Green', 'White'][k - 9];
  if (k === JOKER) return 'Joker';
  if (isFlower(k)) return `Flower ${bonusNumber(k)} (${FLOWER_NAMES[bonusNumber(k) - 1]})`;
  if (isSeason(k)) return `Season ${bonusNumber(k)} (${SEASON_NAMES[bonusNumber(k) - 1]})`;
  // The set has 8 non-numbered bonus tiles (animals etc.); which picture is which doesn't affect scoring.
  return `Bonus ${k - 24}`;
}

const TOKEN = /F[1-4]|S[1-4]|A[1-8]|Rd|Gd|Wd|[1-9]+d|[ESWNJ]/y;

/**
 * Parses tile codes. Spaces are optional: "123d" is 1d 2d 3d, "EEE" is three East, "RdRd" two Red.
 * Example: "111d 2345678d 999d EE J".
 */
export function parse(text: string): Kind[] {
  const out: Kind[] = [];
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    TOKEN.lastIndex = 0;
    while (TOKEN.lastIndex < word.length) {
      const at = TOKEN.lastIndex;
      const m = TOKEN.exec(word);
      if (!m) throw new Error(`Unknown tile code at "${word.slice(at)}"`);
      const tok = m[0];
      if (tok.endsWith('d') && /^[1-9]/.test(tok)) for (const ch of tok.slice(0, -1)) out.push(dot(Number(ch)));
      else if (tok === 'J') out.push(JOKER);
      else if (/^F\d$/.test(tok)) out.push(flower(Number(tok[1])));
      else if (/^S\d$/.test(tok)) out.push(season(Number(tok[1])));
      else if (/^A\d$/.test(tok)) out.push(animal(Number(tok[1])));
      else out.push(9 + HONOUR_CODES.indexOf(tok));
    }
  }
  return out;
}

export const format = (tiles: Kind[]) => tiles.map(code).join(' ');

/** Counts of the 16 playable kinds, plus the number of jokers. */
export function countHand(tiles: Kind[]): { counts: number[]; jokers: number } {
  const counts = new Array(PLAYABLE).fill(0);
  let jokers = 0;
  for (const t of tiles) {
    if (t === JOKER) jokers++;
    else if (t < PLAYABLE) counts[t]++;
    else throw new Error(`Bonus tile ${code(t)} cannot be in a hand`);
  }
  return { counts, jokers };
}
