import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, fanPayout, feiPayout, handValue, loserSettlement, rm } from '../src/engine';

const sum = (d: number[]) => d.reduce((a, b) => a + b, 0);

describe('hand value V (unit RM0.20)', () => {
  it('5-9 fan is linear', () => {
    expect(handValue(5)).toBe(100);
    expect(handValue(9)).toBe(180);
  });
  it('10 fan pays double', () => {
    expect(handValue(10)).toBe(400);
  });
  it('the stake per fan is configurable', () => {
    expect(handValue(5, { ...DEFAULT_RULES, unitSen: 50 })).toBe(250);
  });
});

describe('fan payout: handover worked examples', () => {
  const cases = [
    { fan: 5, discard: 300, each: 200, total: 400 },
    { fan: 10, discard: 1200, each: 800, total: 1600 },
  ];
  for (const c of cases) {
    it(`${c.fan} fan: discard win ${rm(c.discard)}, self-drawn ${rm(c.each)} each`, () => {
      // East (0) wins off West's (2) discard: West pays 3V alone, South pays nothing.
      expect(fanPayout(0, c.fan, 'discard', 2)).toEqual([c.discard, 0, -c.discard]);
      // Self-drawn: each opponent pays 2V.
      expect(fanPayout(1, c.fan, 'self', undefined)).toEqual([-c.each, c.total, -c.each]);
    });
  }
  it('a discard win needs a payer', () => {
    expect(() => fanPayout(0, 5, 'discard', undefined)).toThrow();
  });
});

describe('fei (joker) money', () => {
  it('each opponent pays one unit per joker', () => {
    // East has 1 joker: South and West each pay 20 sen, East gets 40.
    expect(feiPayout([1, 0, 0])).toEqual([40, -20, -20]);
  });
  it('nets pairwise between all three players', () => {
    // East 2 jokers, South 1, West 1.
    // East: +2*20*2 - 20 - 20 = 40. South: +40 - 40 - 20 = -20. West: same as South.
    expect(feiPayout([2, 1, 1])).toEqual([40, -20, -20]);
    expect(sum(feiPayout([3, 0, 1]))).toBe(0);
  });
});

describe('loser settlement', () => {
  // East (0) won; South (1) and West (2) are the losers.
  it('both 5+: the lower pays the difference', () => {
    expect(loserSettlement(0, [0, 7, 5])).toEqual([0, 40, -40]);
    expect(loserSettlement(0, [0, 5, 9])).toEqual([0, -80, 80]);
  });
  it('only one 5+: the other pays their full fan value', () => {
    expect(loserSettlement(0, [0, 6, 4])).toEqual([0, 120, -120]);
    expect(loserSettlement(0, [0, 2, 5])).toEqual([0, -100, 100]);
  });
  it('neither 5+: nothing', () => {
    expect(loserSettlement(0, [0, 4, 3])).toEqual([0, 0, 0]);
  });
  it('equal fan: nothing', () => {
    expect(loserSettlement(0, [0, 6, 6])).toEqual([0, 0, 0]);
  });
  it('no doubling even at 10', () => {
    expect(loserSettlement(1, [10, 0, 0])).toEqual([200, 0, -200]);
  });
});

describe('formatting', () => {
  it('shows ringgit', () => {
    expect(rm(300)).toBe('RM3.00');
    expect(rm(-40)).toBe('-RM0.40');
  });
});
