import { describe, expect, it } from 'vitest';
import { analyze, AnalyzerInput, inputFromState, inputFromView, liveCounts, reviewRound, shanten, worstMistakes } from '../src/analyzer';
import {
  Action, applyAction, countHand, decompose, fullSet, JOKER, legalActions, makeRng, newRound, parse, playerView, PLAYABLE,
  Seat, shuffle, waitingFor,
} from '../src/engine';
import { meld } from './helpers';

const input = (hand: string, opts: Partial<AnalyzerInput> & { bonusCodes?: string } = {}): AnalyzerInput => ({
  seat: 0 as Seat,
  hand: parse(hand),
  melds: [],
  bonus: parse(opts.bonusCodes ?? 'F2'),
  discardedJokers: 0,
  ownDiscards: [],
  opponents: [
    { player: 1, seat: 1, melds: [], discards: [], discardedJokers: 0, bonusCount: 1 },
    { player: 2, seat: 2, melds: [], discards: [], discardedJokers: 0, bonusCount: 1 },
  ],
  wallLeft: 40,
  bonusSeen: 3,
  ...opts,
});
const option = (a: ReturnType<typeof analyze>, tile: string) => a.options.find((o) => o.tile === parse(tile)[0])!;

describe('shanten', () => {
  it('known hands', () => {
    expect(shanten(parse('123d 456d 789d EEE 99d'), 0).best).toBe(-1);
    expect(shanten(parse('123d 456d 789d EEE 9d'), 0).best).toBe(0);
    expect(shanten(parse('123d 456d 789d EE S N'), 0).best).toBe(1);
    expect(shanten(parse('123d 456d 78d E S W N 9d'), 0).best).toBe(2);
    expect(shanten(parse('11d 33d 55d 77d 99d EE S'), 0).sevenPairs).toBe(0);
    expect(shanten(parse('J J J E S W N Rd Gd Wd 1d 9d 5d'), 0).wonders).toBe(1);
  });
  it('a joker fills any gap', () => {
    // 3+3+3+2+2 = 13 tiles: two jokers make the 4th set, one tile short.
    expect(shanten(parse('123d 456d 789d EE J J'), 0).best).toBe(0);
    // 3+3+3+2+3 = 14 tiles: three jokers are the 4th set.
    expect(shanten(parse('123d 456d 789d EE J J J'), 0).best).toBe(-1);
    // 3+3+3+1+1+2 = 13 tiles: lone E and S plus two jokers -> one tile from ready.
    expect(shanten(parse('123d 456d 789d E S J J'), 0).best).toBe(0);
    // Same without the jokers' help (S, N instead): 3+3+3+1+1+1+1 = 13 -> two away.
    expect(shanten(parse('123d 456d 789d E S W N'), 0).best).toBe(2);
  });
  it('counts exposed melds', () => {
    expect(shanten(parse('456d 789d E'), 2).best).toBe(0);
  });

  it('agrees with the engine on 1500 random hands', { timeout: 60000 }, () => {
    const rng = makeRng(9);
    const pool = fullSet().filter((k) => k < PLAYABLE);
    for (let i = 0; i < 1500; i++) {
      const jokers = i % 3;
      const tiles = shuffle(pool.filter((k) => k < 9 || k === 9 || k === 13 || k === 15), rng).slice(0, 13 - jokers);
      const hand = [...tiles, ...Array(jokers).fill(JOKER)];
      const { counts } = countHand(tiles);
      if (jokers && counts.some((n) => n >= 4)) continue; // the 5th-copy limit is the engine's job
      const s13 = shanten(hand, 0).standard;
      // Ready means some 14th tile completes 4 sets and a pair.
      const ready = [...Array(PLAYABLE).keys()].some((t) => {
        const c = counts.slice();
        c[t]++;
        return c[t] <= 4 && decompose(c, jokers, 4).length > 0;
      });
      expect(s13 === 0, `${hand} ${s13}`).toBe(ready);
      // Never improves by more than one per tile.
      for (const t of [0, 4, 9]) expect(shanten([...hand, t], 0).standard).toBeGreaterThanOrEqual(s13 - 1);
    }
  });
});

describe('live tiles', () => {
  it('counts your hand, all discards and exposed melds', () => {
    const live = liveCounts(input('123d 456d 789d EE S', {
      ownDiscards: parse('E'),
      opponents: [
        { player: 1, seat: 1, melds: [meld('pong', 'SSS')], discards: parse('1d'), discardedJokers: 1, bonusCount: 0 },
        { player: 2, seat: 2, melds: [meld('chow', '1d 2d J')], discards: [], discardedJokers: 0, bonusCount: 0 },
      ],
    }));
    expect(live[parse('E')[0]]).toBe(1);
    expect(live[parse('S')[0]]).toBe(0);
    expect(live[parse('1d')[0]]).toBe(1);
    expect(live[JOKER]).toBe(2);
  });
});

describe('discard options', () => {
  it('a ready hand lists each winning tile with live count and fan', () => {
    // East: Red and Green pongs + own flower/season + flower 4 -> 1 + 2 + 3 = 6 fan on 9d.
    // Discarding 5d waits on 9d (3 live); discarding 9d would wait on 5d (also held, so fewer live).
    const a = analyze(input('123d 456d RdRdRd GdGdGd 9d 5d', { bonusCodes: 'F1 S1 F4' }));
    const best = a.options[0];
    expect(best.tile).toBe(parse('5d')[0]);
    expect(best.shanten).toBe(0);
    expect(best.fan.waits).toContainEqual({ tile: parse('9d')[0], live: 3, fanDiscard: 6, fanSelf: 6 });
    // Drawing a joker wins too.
    expect(best.fan.waits!.map((w) => w.tile).sort((x, y) => x - y)).toEqual([parse('9d')[0], JOKER]);
    expect(best.fan.reaches5).toBe('yes');
  });

  it('flags a ready hand whose waits can never reach 5 fan', () => {
    // At best All Chows + Suit Flush + win = 4 fan: ready but can't win.
    const a = analyze(input('123d 456d 789d 23d 55d E'));
    const e = option(a, 'E');
    expect(e.shanten).toBe(0);
    expect(e.fan.reaches5).toBe('no');
    expect(e.fan.waits!.every((w) => w.fanDiscard < 5)).toBe(true);
    expect(e.reasons.join(' ')).toContain('no wait reaches 5 fan');
  });

  it('prefers the discard that keeps more live tiles when everything else is equal', () => {
    // 1d vs 9d leftover: keeping 23d (waits 1d/4d) is wider than keeping a single.
    const a = analyze(input('23d 456d 789d RdRdRd 99d S', { bonusCodes: 'F1 S1 F4' }));
    expect(a.options[0].tile).toBe(parse('S')[0]);
    expect(a.options[0].ukeireTotal).toBeGreaterThan(0);
  });

  it('between equally fast discards, throws the tile with no fan value and says what others give up', () => {
    // 2+3+2+1+2+1+1+1+1 = 14 tiles. S, N, E and Gd are all equally efficient for East.
    const a = analyze(input('12d 456d RdRd Gd 99d E S N J', { bonusCodes: 'F1' }));
    expect(a.options[0].tile).toBe(parse('S')[0]);
    expect(a.options[0].reasons.join(' ')).toContain('South scores nothing for you');
    expect(option(a, 'Gd').reasons.join(' ')).toContain('Gives up Small Dragons');
    expect(option(a, 'Gd').value).toBeLessThan(option(a, 'E').value);
  });

  it('jokers are never offered as a discard', () => {
    const a = analyze(input('123d 456d 789d EE J S'));
    expect(a.options.some((o) => o.tile === JOKER)).toBe(false);
  });
});

describe('safety', () => {
  const threatening = [
    { player: 1, seat: 1 as Seat, melds: [meld('chow', '123d'), meld('chow', '456d'), meld('pong', '777d')], discards: parse('N'), discardedJokers: 0, bonusCount: 2 },
    { player: 2, seat: 2 as Seat, melds: [], discards: [], discardedJokers: 0, bonusCount: 1 },
  ];
  it('a middle dot into an opponent on dots is riskier than an honour with every other copy seen', () => {
    const a = analyze(input('5d 23d 456d 789d Wd 11d 99d', {
      opponents: threatening, wallLeft: 10,
      ownDiscards: parse('Wd Wd'),
    }));
    a.options.forEach(() => undefined);
    // Wd: we hold 1, discarded 2 -> 1 unseen... make it fully seen:
    const b = analyze(input('5d 23d 456d 789d Wd 11d 99d', {
      opponents: [{ ...threatening[0], discards: parse('N Wd') }, threatening[1]], wallLeft: 10, ownDiscards: parse('Wd Wd'),
    }));
    expect(option(b, 'Wd').safety.label).toBe('safe');
    expect(option(b, '5d').safety.risk).toBeGreaterThan(option(b, 'Wd').safety.risk);
    expect(['medium', 'high']).toContain(option(b, '5d').safety.label);
    expect(a.threats.find((t) => t.player === 1)!.label).toBe('high');
  });
});

describe('joker advice', () => {
  it('keeps the joker while Flowerless is still on', () => {
    const a = analyze(input('123d 456d 78d EE J S N', { bonusCodes: '' }));
    expect(a.joker!.recommend).toBe('keep');
    expect(a.joker!.reasons.join(' ')).toContain('Flowerless');
  });
  it('reports the cost of setting a joker aside', () => {
    const a = analyze(input('123d 456d 789d EE J S'));
    expect(a.joker!.setAside).toBeGreaterThan(a.joker!.keep);
  });
});

describe('post-hand review', () => {
  // Player 0 deliberately discards the analyzer's worst option every turn; the others play normally.
  function badRound(seed: number) {
    let s = newRound(seed, 0);
    while (s.phase !== 'ended') {
      const p = waitingFor(s)[0];
      const legal = legalActions(s, p);
      let a: Action | null = legal.find((x) => x.type === 'win' || x.type === 'selfWin') ?? null;
      if (!a && p === 0 && s.phase === 'turn') {
        const opts = analyze(inputFromState(s, 0)).options;
        if (opts.length) a = { type: 'discard', player: 0, tile: opts[opts.length - 1].tile };
      }
      s = applyAction(s, a ?? legal.find((x) => x.type === 'pass') ?? legal.find((x) => x.type === 'discard') ?? legal[0]);
    }
    return s;
  }

  it('flags deliberately bad discards and explains them', () => {
    let flagged = 0;
    let total = 0;
    for (const seed of [11, 12, 13]) {
      const s = badRound(seed);
      const items = reviewRound(s.seed, s.dealer, s.actions, 0);
      const discards = items.filter((x) => x.kind === 'discard');
      total += discards.length;
      flagged += discards.filter((x) => x.verdict === 'mistake' || x.verdict === 'big mistake').length;
      for (const x of discards) {
        expect(x.note.length).toBeGreaterThan(10);
        if (x.verdict !== 'best') expect(x.best).not.toBe(x.played);
      }
      const worst = worstMistakes(items);
      expect(worst.length).toBeLessThanOrEqual(3);
      for (let i = 1; i < worst.length; i++) expect(worst[i - 1].loss).toBeGreaterThanOrEqual(worst[i].loss);
    }
    expect(total).toBeGreaterThan(0);
    expect(flagged / total).toBeGreaterThan(0.5);
  });

  it('finds no mistakes when you follow the analyzer', () => {
    let s = newRound(21, 0);
    while (s.phase !== 'ended') {
      const p = waitingFor(s)[0];
      const legal = legalActions(s, p);
      let a: Action | null = legal.find((x) => x.type === 'win' || x.type === 'selfWin') ?? null;
      if (!a && p === 0 && s.phase === 'turn') {
        const best = analyze(inputFromState(s, 0)).options[0];
        if (best) a = { type: 'discard', player: 0, tile: best.tile };
      }
      s = applyAction(s, a ?? legal.find((x) => x.type === 'pass') ?? legal.find((x) => x.type === 'discard') ?? legal[0]);
    }
    const items = reviewRound(s.seed, s.dealer, s.actions, 0);
    expect(items.filter((x) => x.kind === 'discard').every((x) => x.verdict === 'best')).toBe(true);
  });
});

describe('in a real game', () => {
  it('analyzes every turn of 30 random rounds without errors, quickly', () => {
    const rng = makeRng(3);
    let turns = 0;
    let slowest = 0;
    for (let seed = 1; seed <= 30; seed++) {
      let s = newRound(seed, 0);
      while (s.phase !== 'ended') {
        const p = waitingFor(s)[0];
        if (s.phase === 'turn' && p === 0) {
          const t0 = performance.now();
          const a = analyze(inputFromView(playerView(s, 0)));
          slowest = Math.max(slowest, performance.now() - t0);
          const discardable = new Set(s.players[0].hand.filter((t) => t !== JOKER));
          expect(a.options.length).toBe(discardable.size);
          expect(JSON.stringify(analyze(inputFromState(s, 0)).options.map((o) => o.tile)))
            .toBe(JSON.stringify(a.options.map((o) => o.tile)));
          turns++;
        }
        const legal = legalActions(s, p);
        const win = legal.find((x) => x.type === 'win' || x.type === 'selfWin');
        s = applyAction(s, win ?? legal[Math.floor(rng() * legal.length)]);
      }
    }
    expect(turns).toBeGreaterThan(30);
    console.log(`analyzed ${turns} turns, slowest ${slowest.toFixed(0)} ms`);
    expect(slowest).toBeLessThan(1500);
  });
});
