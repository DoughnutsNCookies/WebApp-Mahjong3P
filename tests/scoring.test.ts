import { describe, expect, it } from 'vitest';
import { bonusItems, loserFan, parse, Seat } from '../src/engine';
import { items, meld, score } from './helpers';

const fan = (hand: string, opts = {}) => score(hand, opts)!.fan;
const raw = (hand: string, opts = {}) => score(hand, opts)!.rawFan;

describe('winning shapes', () => {
  it('rejects a hand that is not 4 sets and a pair', () => {
    expect(score('123d 456d 789d EE SS W')).toBeNull();
  });
  it('accepts jokers in pongs, chows and the pair', () => {
    expect(score('12d J 456d 789d E E J Rd J')).not.toBeNull();
    expect(score('123d 456d 789d EEE J J')).not.toBeNull(); // Q1: two jokers as the pair
  });
  it('never lets a joker be a 5th copy of a tile (section 5)', () => {
    // Four real 5d plus a joker that would need to be another 5d.
    expect(score('5555d J 123d 789d EEE')).toBeNull();
    // An exposed pong of 5d with a joker already stands for one 5d.
    expect(score('5d J 123d 789d EEE', { melds: [meld('pong', '5d 5d J')] })).toBeNull();
  });
});

describe('wind and dragon pongs (section 7)', () => {
  const windHand = (w: string) => `${w} ${w} ${w} 123d 456d 789d 99d`;
  const table: [string, number[]][] = [
    ['E', [2, 1, 1]],
    ['S', [0, 1, 0]],
    ['W', [0, 0, 1]],
    ['N', [1, 1, 1]],
  ];
  for (const [w, perSeat] of table) {
    it(`${w} pong scores ${perSeat.join('/')} for East/South/West`, () => {
      perSeat.forEach((expected, seat) => {
        const got = items(windHand(w), { seat: seat as Seat, win: '9d' });
        const key = Object.keys(got).find((k) => k.startsWith('wind'));
        expect(key ? got[key] : 0).toBe(expected);
      });
    });
  }
  it('each dragon pong scores 1 for everyone', () => {
    for (const seat of [0, 1, 2] as Seat[]) {
      expect(items('RdRdRd 123d 456d 789d 99d', { seat })).toMatchObject({ dragon13: 1 });
    }
  });
  it('a kong scores like a pong', () => {
    expect(items('123d 456d 789d 99d', { melds: [meld('kong', 'Gd Gd Gd Gd')] })).toMatchObject({ dragon14: 1 });
  });
  it('a joker in the pong still counts', () => {
    expect(items('Rd Rd J 123d 456d 789d 99d')).toMatchObject({ dragon13: 1 });
  });
});

describe('bonus tiles (section 6)', () => {
  const b = (tiles: string, seat: Seat) =>
    Object.fromEntries(bonusItems(parse(tiles), seat).map((i) => [i.key, i.fan]));
  it('East scores flower 1, season 1, flower 4 and season 4 at 1 fan each', () => {
    expect(b('F1 S1 F4 S4', 0)).toEqual({ flowerOwn: 1, seasonOwn: 1, flower4: 1, season4: 1 });
  });
  it('flower/season 2 or 3 alone give East nothing', () => {
    expect(b('F2 F3 S2 S3', 0)).toEqual({});
  });
  it('flowers 1-2-3 are 2 fan in total; the own-seat tile adds nothing extra', () => {
    expect(b('F1 F2 F3', 1)).toEqual({ flowerSet: 2 });
    expect(b('F1 F2 F3 F4', 2)).toEqual({ flowerSet: 2, flower4: 1 });
  });
  it('flower and season sets score separately', () => {
    expect(b('F1 F2 F3 S1 S2 S3', 0)).toEqual({ flowerSet: 2, seasonSet: 2 });
  });
  it('a partial set without the own seat is worth 0', () => {
    expect(b('F1 F3', 1)).toEqual({});
  });
  it('the 8 non-numbered tiles are 1 fan each for everyone', () => {
    expect(b('A1 A5 A8', 2)).toEqual({ animals: 3 });
  });
  it('7 Flowers: any 7 of the 8 numbered tiles is 10 fan', () => {
    expect(items('123d 456d 789d EEE 99d', { bonus: 'F1 F2 F3 F4 S1 S2 S3' })).toMatchObject({ sevenFlowers: 10 });
  });
});

describe('1, 2 and 3 fan hands', () => {
  it('All Chows (1) with Suit Flush (2)', () => {
    expect(items('123d 456d 789d 234d 55d')).toEqual({ win: 1, allChows: 1, suitFlush: 2 });
  });
  it('Suit Flush and All Chows allow a wind pair that does not score for the player (Q9)', () => {
    // South and West winds score nothing for East.
    expect(items('123d 456d 789d 234d SS')).toMatchObject({ suitFlush: 2, allChows: 1 });
    // East wind scores for East; dragons and North never qualify.
    for (const pair of ['EE', 'NN', 'RdRd']) {
      const got = items(`123d 456d 789d 234d ${pair}`);
      expect(got.suitFlush).toBeUndefined();
      expect(got.allChows).toBeUndefined();
    }
    // South is a live wind for the South player.
    expect(items('123d 456d 789d 234d SS', { seat: 1 }).suitFlush).toBeUndefined();
  });
  it('All Pongs (2)', () => {
    expect(items('111d 333d 555d 777d 99d')).toMatchObject({ allPongs: 2, suitFlush: 2 });
  });
  it('Honours Terminal (1): honours plus 1 and 9 dot sets', () => {
    // One exposed pong, otherwise the concealed all-pong hand is also Hidden Treasures.
    expect(items('111d 999d EEE RdRd', { seat: 1, melds: [meld('pong', 'NNN')] })).toEqual({
      win: 1, wind9: 1, wind12: 1, honoursTerminal: 1, allPongs: 2,
    });
  });
  it('Small Dragons (3) stacks with the two dragon pongs', () => {
    expect(items('RdRdRd GdGdGd WdWd 123d 456d')).toEqual({ win: 1, dragon13: 1, dragon14: 1, smallDragons: 3 });
  });
  it('Small Winds (3) stacks with the wind pongs inside it (section 4 example)', () => {
    expect(items('EEE SSS WW 123d 456d', { seat: 2 })).toEqual({ win: 1, wind9: 1, smallWinds: 3 });
    expect(fan('EEE SSS WW 123d 456d', { seat: 2 })).toBe(5);
  });
  it('Steal Kong, Kong Hu and Flower Hu are 1 fan each', () => {
    expect(items('123d 456d 789d EEE 99d', { robbedKong: true })).toMatchObject({ stealKong: 1 });
    expect(items('123d 456d 789d EEE 99d', { selfDrawn: true, replacementChain: ['kong'] })).toMatchObject({ kongHu: 1 });
    expect(items('123d 456d 789d EEE 99d', { selfDrawn: true, replacementChain: ['bonus'] })).toMatchObject({ flowerHu: 1 });
  });
  it('each discarded joker is +1 fan', () => {
    expect(items('123d 456d 789d EEE 99d', { discardedJokers: 2 })).toMatchObject({ discardedJokers: 2 });
  });
});

describe('10-fan hands', () => {
  const ten = (key: string, hand: string, opts = {}) => {
    const got = items(hand, opts);
    expect(got[key]).toBe(10);
    expect(fan(hand, opts)).toBe(10);
  };
  it('13 Wonders', () => ten('thirteenWonders', 'J J J J E S W N Rd Gd Wd 1d 9d 9d', { selfDrawn: true }));
  it('Real 9 Lanterns (concealed, no jokers)', () => ten('realNineLanterns', '111d 2345678d 999d 5d'));
  it('9 Lanterns with jokers', () => ten('nineLanterns', '111d 234d J 678d 999d 5d'));
  it('9 Lanterns needs a concealed hand', () => {
    expect(items('2345678d 999d 5d', { melds: [meld('pong', '1d 1d 1d')] }).nineLanterns).toBeUndefined();
  });
  it('4 Jokers Discard', () => ten('fourJokersDiscard', '123d 456d 789d EEE 99d', { discardedJokers: 4 }));
  it('Joker Slam counts discarded jokers', () =>
    ten('jokerSlam', '123d 456d 789d EEE J J', { discardedJokers: 2 }));
  it('18 Arhats: 4 kongs', () => ten('eighteenArhats', '99d', {
    melds: [meld('kong', 'EEEE', { concealed: true, kongType: 'concealed' }), meld('kong', 'SSSS'), meld('kong', '1111d'), meld('kong', '5555d')],
  }));
  it('Triple Kong: 3 kongs and a chow', () => ten('tripleKong', '123d 99d', {
    melds: [meld('kong', 'EEEE'), meld('kong', 'SSSS'), meld('kong', '5555d')],
  }));
  it('7 Stars: 7 different honour pairs, no jokers', () => ten('sevenStars', 'EE SS WW NN RdRd GdGd WdWd'));
  it('Big Wheel: pairs of 2-8', () => ten('bigWheel', '22334455667788d'));
  it('7 Pairs, with four of a kind counting as two pairs (Q7)', () => {
    ten('sevenPairs', '11d 33d 55d 77d 99d EE SS');
    ten('sevenPairs', '1111d 55d 77d 99d EE SS');
  });
  it('7 Pairs allows no jokers', () => {
    expect(score('11d 33d 55d 77d 99d EE S J')).toBeNull();
  });
  it('Flowerless: no bonus tiles and no discarded jokers', () => {
    ten('flowerless', '123d 456d 789d EEE 99d', { bonus: '' });
    expect(items('123d 456d 789d EEE 99d', { bonus: '', discardedJokers: 1 }).flowerless).toBeUndefined();
  });
  it('Heavenly, Earthly, Last Tile and Last Discard', () => {
    ten('heavenly', '123d 456d 789d EEE 99d', { selfDrawn: true, heavenly: true });
    ten('earthly', '123d 456d 789d EEE 99d', { earthly: true });
    ten('lastTile', '123d 456d 789d EEE 99d', { selfDrawn: true, lastTile: true });
    ten('lastDiscard', '123d 456d 789d EEE 99d', { lastDiscard: true });
  });
  it('Hidden Treasures: 4 concealed pongs, self-drawn', () =>
    ten('hiddenTreasures', '111d 333d EEE RdRdRd 99d', { selfDrawn: true }));
  it('Hidden Treasures on a discard only if the discard completes the pair', () => {
    expect(items('111d 333d EEE RdRdRd 99d', { win: '9d' }).hiddenTreasures).toBe(10);
    expect(items('111d 333d EEE RdRdRd 99d', { win: 'E' }).hiddenTreasures).toBeUndefined();
  });
  it('Hidden Treasures allows concealed kongs, not exposed pongs', () => {
    expect(items('333d EEE RdRdRd 99d', {
      selfDrawn: true, melds: [meld('kong', '1111d', { concealed: true, kongType: 'concealed' })],
    }).hiddenTreasures).toBe(10);
    expect(items('333d EEE RdRdRd 99d', { selfDrawn: true, melds: [meld('pong', '111d')] }).hiddenTreasures).toBeUndefined();
  });
  it('All Honours', () => ten('allHonours', 'EEE SSS NNN RdRdRd GdGd'));
  it('3 Dragons, jokers allowed', () => ten('threeDragons', 'Rd Rd J GdGdGd WdWdWd 123d 99d'));
  it('Big Winds, jokers allowed', () => ten('bigWinds', 'EEE SSS W W J 123d 99d'));
  it('Hundred Dots: all dots adding up to 100+, pair included (Q8)', () => {
    ten('hundredDots', '777d 888d 999d 789d 66d');
    expect(items('123d 456d 789d 789d 99d').hundredDots).toBeUndefined();
  });
  it('Kong Flower Hu, Flower Kong Hu, Kong Kong Hu', () => {
    const h = '123d 456d 789d EEE 99d';
    ten('kongFlowerHu', h, { selfDrawn: true, replacementChain: ['kong', 'bonus'] });
    ten('flowerKongHu', h, { selfDrawn: true, replacementChain: ['bonus', 'kong'] });
    ten('kongKongHu', h, { selfDrawn: true, replacementChain: ['kong', 'kong'] });
  });
});

describe('stacking and the 10-fan cap (section 4)', () => {
  it('fans add up and the total is capped at 10', () => {
    // Small Dragons 3 + two dragon pongs 2 + East pong 2 + win 1 + bonus: F1 S1 F4 S4 = 4 -> 12, capped.
    const opts = { bonus: 'F1 S1 F4 S4' };
    expect(raw('RdRdRd GdGdGd WdWd EEE 123d', opts)).toBe(12);
    expect(fan('RdRdRd GdGdGd WdWd EEE 123d', opts)).toBe(10);
  });
  it('picks the reading of the hand that scores most', () => {
    // 111222333d can be three pongs or three chows; pongs + East pong gives All Pongs.
    expect(items('111d 222d 333d EEE 99d')).toMatchObject({ allPongs: 2 });
  });
});

describe('loser settlement fan (section 9)', () => {
  it('handover example: exposed Red pong + 2 bonus animals + 1 discarded joker = 4', () => {
    const r = loserFan(0, parse('123d 45d EE'), [meld('pong', 'RdRdRd')], parse('A1 A2'), 1);
    expect(r.fan).toBe(4);
  });
  it('a pair or partial set counts for nothing', () => {
    expect(loserFan(0, parse('EE 123d 4d 5d 7d 9d SS W'), [], [], 0).fan).toBe(0);
  });
  it('concealed scoring pongs count, jokers included', () => {
    expect(loserFan(0, parse('EEE Rd Rd J 123d'), [], [], 0).fan).toBe(3);
  });
  it('no 1 fan for winning and no whole-hand patterns', () => {
    const r = loserFan(1, parse('123d 456d 789d 234d 5d'), [], parse('F2'), 0);
    expect(r.fan).toBe(1); // only South's own flower
  });
});
