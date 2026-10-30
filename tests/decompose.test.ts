import { describe, expect, it } from 'vitest';
import { countHand, decompose, format, fullSet, isBonus, JOKER, makeRng, parse, PLAYABLE, shuffle } from '../src/engine';

describe('tiles', () => {
  it('the set has 84 tiles: 36 dots, 28 honours, 16 bonus, 4 jokers', () => {
    const set = fullSet();
    expect(set.length).toBe(84);
    expect(set.filter((k) => k < 9).length).toBe(36);
    expect(set.filter((k) => k >= 9 && k <= 15).length).toBe(28);
    expect(set.filter(isBonus).length).toBe(16);
    expect(set.filter((k) => k === JOKER).length).toBe(4);
  });
  it('parses and formats codes', () => {
    expect(format(parse('123d EEE RdRd J F1 S4 A8 SS'))).toBe('1d 2d 3d E E E Rd Rd J F1 S4 A8 S S');
    expect(() => parse('10d')).toThrow();
  });
  it('the same seed gives the same wall', () => {
    expect(shuffle(fullSet(), makeRng(7))).toEqual(shuffle(fullSet(), makeRng(7)));
    expect(shuffle(fullSet(), makeRng(7))).not.toEqual(shuffle(fullSet(), makeRng(8)));
  });
});

/** Independent check: try every joker assignment, then a plain no-joker 4-sets-plus-pair search. */
function bruteWin(counts: number[], jokers: number): boolean {
  const plain = (c: number[], sets: number, pair: boolean): boolean => {
    const k = c.findIndex((n) => n > 0);
    if (k < 0) return sets === 0 && !pair;
    if (pair && c[k] >= 2) {
      c[k] -= 2;
      const ok = plain(c, sets, false);
      c[k] += 2;
      if (ok) return true;
    }
    if (sets > 0 && c[k] >= 3) {
      c[k] -= 3;
      const ok = plain(c, sets - 1, pair);
      c[k] += 3;
      if (ok) return true;
    }
    if (sets > 0 && k <= 6 && c[k + 1] > 0 && c[k + 2] > 0) {
      c[k]--; c[k + 1]--; c[k + 2]--;
      const ok = plain(c, sets - 1, pair);
      c[k]++; c[k + 1]++; c[k + 2]++;
      if (ok) return true;
    }
    return false;
  };
  const assign = (j: number, from: number): boolean => {
    if (j === 0) return plain(counts.slice(), 4, true);
    for (let k = from; k < PLAYABLE; k++) {
      if (counts[k] >= 4) continue;
      counts[k]++;
      const ok = assign(j - 1, k);
      counts[k]--;
      if (ok) return true;
    }
    return false;
  };
  return assign(jokers, 0);
}

describe('decompose', () => {
  it('finds both readings of 111222333d', () => {
    const ways = decompose(parse('111222333d').concat(parse('EEE 99d')).reduce((c, k) => (c[k]++, c), new Array(16).fill(0)), 0, 4);
    const types = ways.map((w) => w.filter((g) => g.type !== 'pair').map((g) => g.type).sort().join(','));
    expect(types).toContain('pong,pong,pong,pong');
    expect(types).toContain('chow,chow,chow,pong');
  });

  it('agrees with a brute-force check on 3000 random hands with 0-2 jokers', () => {
    const rng = makeRng(42);
    const pool = fullSet().filter((k) => k < PLAYABLE);
    let wins = 0;
    for (let i = 0; i < 3000; i++) {
      const jokers = i % 3;
      // Bias toward dots and a few honours so a fair share of hands win.
      const tiles = shuffle(pool.filter((k) => k < 9 || k === 9 || k === 13), rng).slice(0, 14 - jokers);
      const { counts } = countHand(tiles);
      const expected = bruteWin(counts.slice(), jokers);
      expect(decompose(counts, jokers, 4).length > 0, format(tiles) + ' +' + jokers + 'J').toBe(expected);
      if (expected) wins++;
    }
    expect(wins).toBeGreaterThan(50);
  });
});
