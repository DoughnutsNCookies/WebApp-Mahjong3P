import { describe, expect, it } from 'vitest';
import {
  Action, applyAction, applyActionInPlace, GameState, isBonus, JOKER, legalActions, makeRng, newRound, parse, playerView, replay,
  waitingFor, wallLeft,
} from '../src/engine';
import { meld } from './helpers';

const sorted = (s: string) => parse(s).sort((a, b) => a - b);

/**
 * A hand-made position: it is `turn`'s turn (with 14 tiles), draws come from `wall` in order.
 * Everyone holds one non-scoring flower so Flowerless doesn't make every finished hand a 10-fan win.
 */
function position(opts: { hands: string[]; wall: string; turn?: number; dealer?: number; bonus?: string[] }): GameState {
  const s = newRound(1, opts.dealer ?? 0);
  s.players.forEach((pl, p) => {
    pl.hand = sorted(opts.hands[p]);
    pl.bonus = parse(opts.bonus?.[p] ?? ['F2', 'F3', 'F1'][(p - s.dealer + 3) % 3]);
    pl.melds = [];
    pl.discards = [];
    pl.discardedJokers = 0;
  });
  s.wall = parse(opts.wall);
  s.head = 0;
  s.tail = s.wall.length;
  s.phase = 'turn';
  s.pending = null;
  s.turn = opts.turn ?? s.dealer;
  s.turnDrew = true;
  s.discardsMade = 5; // past the opening, so no Heavenly/Earthly unless a test sets it
  s.chain = [];
  return s;
}

const act = (s: GameState, a: Action) => applyAction(s, a);
const has = (s: GameState, p: number, type: Action['type']) => legalActions(s, p).some((a) => a.type === type);

describe('deal', () => {
  it('dealer has 14, others 13, no bonus tiles in hand, 84 tiles accounted for', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = newRound(seed, seed % 3);
      s.players.forEach((pl, p) => {
        expect(pl.hand.length).toBe(p === s.dealer ? 14 : 13);
        expect(pl.hand.some(isBonus)).toBe(false);
      });
      expect(tileTotal(s)).toBe(84);
    }
  });
});

describe('claims (section 3)', () => {
  const base = () => position({
    hands: [
      '1d 3d 6d 9d E S W N Rd Gd Wd 1d 9d E',
      '4d 5d 7d 9d S W N Rd Gd Wd 2d 6d 8d',
      '3d 3d 2d 6d 9d S W N Rd Gd 7d 8d 1d',
    ],
    wall: '2d 4d 5d 6d 7d 8d 9d 1d',
  });

  it('chow only from the player immediately before you', () => {
    const s = act(base(), { type: 'discard', player: 0, tile: parse('3d')[0] });
    expect(s.phase).toBe('claim');
    expect(has(s, 1, 'chow')).toBe(true);
    expect(has(s, 2, 'chow')).toBe(false);
    expect(has(s, 2, 'pong')).toBe(true);
  });

  it('pong beats chow', () => {
    let s = act(base(), { type: 'discard', player: 0, tile: parse('3d')[0] });
    const chow = legalActions(s, 1).find((a) => a.type === 'chow')!;
    s = act(s, chow);
    s = act(s, { type: 'pong', player: 2, jokers: 0 });
    expect(s.turn).toBe(2);
    expect(s.turnDrew).toBe(false);
    expect(s.players[2].melds[0].type).toBe('pong');
    expect(s.players[1].melds).toEqual([]);
    expect(s.players[0].discards).toEqual([]);
    expect(has(s, 2, 'selfWin')).toBe(false);
  });

  it('a chow can use a joker (Q5 for pongs, same for chows)', () => {
    const s0 = position({
      hands: ['1d 3d 6d 9d E S W N Rd Gd Wd 1d 9d E', '5d J 7d 9d S W N Rd Gd Wd 2d 6d 8d', 'EEE SSS WWW NNN Gd'],
      wall: '2d 4d',
    });
    const s = act(s0, { type: 'discard', player: 0, tile: parse('3d')[0] });
    const chows = legalActions(s, 1).filter((a) => a.type === 'chow');
    expect(chows).toContainEqual({ type: 'chow', player: 1, start: 2, jokerKinds: [3] });
  });

  it('two players can win on the same discard: the next in turn order gets it (Q4)', () => {
    let s = position({
      hands: ['1d 3d 6d 9d E S W N Rd Gd Wd 1d 9d E', '123d 123d EEE RdRdRd 5d', '789d 789d NNN GdGdGd 5d'],
      wall: '2d 4d',
      bonus: ['A1', '', ''],
    });
    s.players[0].hand = sorted('5d 3d 6d 9d E S W N Rd Gd Wd 1d 9d E');
    s = act(s, { type: 'discard', player: 0, tile: parse('5d')[0] });
    s = act(s, { type: 'win', player: 2 });
    s = act(s, { type: 'win', player: 1 });
    expect(s.result!.winner).toBe(1);
    expect(s.result!.payer).toBe(0);
    // Flowerless 10 fan: V = RM4.00, the discarder pays 3V = RM12.00. No jokers, no loser settlement at 10.
    expect(s.result!.score!.fan).toBe(10);
    expect(s.result!.total).toEqual([-1200, 1200, 0]);
  });
});

describe('jokers in play (section 5)', () => {
  // Hand where South would win on any tile, to prove nobody can claim a joker.
  const jokerPosition = () => position({
    hands: ['J 3d 6d 9d E S W N Rd Gd Wd 1d 9d E', '123d 456d 789d EEE J', 'J J 2d 6d 9d S W N Rd Gd 7d 8d 1d'],
    wall: '2d 4d 7d',
    bonus: ['A1', '', 'A2'],
  });

  it('a joker is set aside like a bonus tile and replaced from the back of the wall (Q2)', () => {
    let s = jokerPosition();
    // Jokers never appear as normal discards.
    expect(legalActions(s, 0).some((a) => a.type === 'discard' && a.tile === JOKER)).toBe(false);
    s = act(s, { type: 'discardJoker', player: 0 });
    expect(s.players[0].discardedJokers).toBe(1);
    expect(s.players[0].hand).not.toContain(JOKER);
    expect(s.players[0].hand).toContain(parse('7d')[0]); // the replacement
    expect(s.players[0].hand.length).toBe(14);
    // Still East's turn: nobody got a claim window, and it doesn't count as a discard.
    expect(s.phase).toBe('turn');
    expect(s.turn).toBe(0);
    expect(s.discardsMade).toBe(5);
  });

  it('winning on the joker replacement is Flower Hu', () => {
    let s = position({
      hands: ['123d 456d 789d EEE 5d J', '4d 5d 7d 9d S W N Rd Gd Wd 2d 6d 8d', '2d 6d 9d S W N Rd Gd 7d 8d 1d 3d'],
      wall: '2d 5d',
      bonus: ['A1', 'A2', 'A3'],
    });
    s = act(s, { type: 'discardJoker', player: 0 });
    s = act(s, { type: 'selfWin', player: 0 });
    const keys = s.result!.score!.items.map((i) => i.key);
    expect(keys).toContain('flowerHu');
    expect(keys).toContain('discardedJokers');
  });

  it("a joker set aside doesn't use up East's first discard for Earthly Slam", () => {
    let s = position({
      hands: ['5d J 6d 9d E S W N Rd Gd Wd 1d 9d E', '123d 456d 789d EEE 5d', '2d 6d 9d S W N Rd Gd 7d 8d 1d 3d'],
      wall: '2d 3d',
      bonus: ['A1', '', 'A3'],
    });
    s.discardsMade = 0;
    s = act(s, { type: 'discardJoker', player: 0 });
    s = act(s, { type: 'discard', player: 0, tile: parse('5d')[0] });
    s = act(s, { type: 'win', player: 1 });
    expect(s.result!.score!.items.map((i) => i.key)).toContain('earthly');
  });

  it('a joker cannot be set aside once the wall is empty', () => {
    const s = jokerPosition();
    s.head = s.tail;
    expect(has(s, 0, 'discardJoker')).toBe(false);
  });

  it('drawing the real tile swaps out the joker in an exposed pong; the joker returns to hand (Q3)', () => {
    let s = position({
      hands: ['1d 3d 6d 9d S W N Rd Gd Wd 1d 9d 2d 4d', '5d 7d 9d W N Rd Gd Wd 2d 6d 8d', '2d 6d 9d S W N Rd Gd 7d 8d 1d 3d'],
      wall: 'E 5d 5d',
      turn: 1,
    });
    s.players[1].hand = sorted('5d 7d 9d W N Rd Gd Wd 2d 6d 8d 3d 4d 1d');
    s.players[2].hand = sorted('6d 9d S W N Rd Gd 7d 8d 1d');
    s.players[2].melds = [meld('pong', 'E E J')];
    s = act(s, { type: 'discard', player: 1, tile: parse('Wd')[0] });
    expect(s.turn).toBe(2);
    expect(s.players[2].melds[0].slots.every((x) => !x.joker)).toBe(true);
    expect(s.players[2].hand).toContain(JOKER);
    expect(s.events.some((e) => e.e === 'jokerSwap')).toBe(true);
  });
});

describe('kongs', () => {
  it('a concealed kong can be robbed (Q6); the konger pays 3V', () => {
    let s = position({
      hands: ['1d 3d 6d 9d E S W N Rd Gd Wd 2d 2d E', '5555d 1d 9d S W N Rd Gd Wd 7d 8d', '123d 678d NNN 34d 99d'],
      wall: '2d 4d 6d',
      turn: 1,
      bonus: ['A1', 'A2', ''],
    });
    s.players[1].hand = sorted('5555d 1d 9d S W N Rd Gd Wd 7d 8d');
    s.players[0].hand = sorted('1d 3d 6d 9d E S W N Rd Gd Wd 2d 2d');
    s = act(s, { type: 'kong', player: 1, kind: parse('5d')[0], kongType: 'concealed', jokers: 0 });
    expect(s.phase).toBe('robKong');
    s = act(s, { type: 'win', player: 2 });
    expect(s.result!.winner).toBe(2);
    expect(s.result!.payer).toBe(1);
    expect(s.result!.score!.items.map((i) => i.key)).toContain('stealKong');
    expect(s.result!.fanPayout).toEqual([0, -1200, 1200]);
  });

  it('a kong replacement that completes the hand is Kong Hu', () => {
    let s = position({
      hands: ['EEEE 123d 456d 78d SS','1d 9d S W N Rd Gd Wd 2d 4d 7d 8d 6d', '2d 6d 9d S W N Rd Gd 7d 8d 1d 3d 4d'],
      wall: '2d 9d',
      bonus: ['', 'A1', 'A2'],
    });
    s = act(s, { type: 'kong', player: 0, kind: parse('E')[0], kongType: 'concealed', jokers: 0 });
    expect(s.players[0].hand).toContain(parse('9d')[0]); // replacement comes from the back of the wall
    s = act(s, { type: 'selfWin', player: 0 });
    expect(s.result!.score!.items.map((i) => i.key)).toContain('kongHu');
    expect(s.result!.payment).toBe('self');
  });
});

describe('end of the wall (section 2)', () => {
  it('a draw settles fei only, and the last player who drew deals next', () => {
    let s = position({
      hands: ['J 3d 6d 9d E S W N Rd Gd Wd 1d 9d E', '4d 5d 7d 9d S W N Rd Gd Wd 2d 6d 8d', '2d 6d 9d S W N Rd Gd 7d 8d 1d 3d'],
      wall: 'A3 Gd',
    });
    s = act(s, { type: 'discard', player: 0, tile: parse('E')[0] });
    // South drew the bonus tile, then its replacement: the last tile.
    expect(s.turn).toBe(1);
    expect(wallLeft(s)).toBe(0);
    expect(s.lastDrawWasLast).toBe(true);
    s = act(s, { type: 'discard', player: 1, tile: parse('Gd')[0] });
    expect(s.phase).toBe('ended');
    expect(s.result!.type).toBe('draw');
    expect(s.result!.nextDealer).toBe(1);
    expect(s.result!.fanPayout).toEqual([0, 0, 0]);
    expect(s.result!.total).toEqual([40, -20, -20]);
  });
});

describe('opening', () => {
  it('Heavenly Slam: the dealer wins on the starting 14 tiles', () => {
    let s = position({
      hands: ['123d 456d 789d EEE 99d', '4d 5d 7d 9d S W N Rd Gd Wd 2d 6d 8d', '2d 6d 9d S W N Rd Gd 7d 8d 1d 3d'],
      wall: '2d',
    });
    s.discardsMade = 0;
    s = act(s, { type: 'selfWin', player: 0 });
    expect(s.result!.score!.items.map((i) => i.key)).toContain('heavenly');
    expect(s.result!.total).toEqual([1600, -800, -800]);
  });

  it("Earthly Slam: winning on East's first discard", () => {
    let s = position({
      hands: ['5d 3d 6d 9d E S W N Rd Gd Wd 1d 9d E', '123d 456d 789d EEE 5d', '2d 6d 9d S W N Rd Gd 7d 8d 1d 3d'],
      wall: '2d',
    });
    s.discardsMade = 0;
    s = act(s, { type: 'discard', player: 0, tile: parse('5d')[0] });
    s = act(s, { type: 'win', player: 1 });
    expect(s.result!.score!.items.map((i) => i.key)).toContain('earthly');
  });
});

describe('more claim and kong paths', () => {
  it('an added kong can be robbed; the pong goes back and the konger pays', () => {
    let s = position({
      hands: ['1d 3d 6d 9d E S W N Rd Gd Wd 2d 2d', '5d 1d 9d S W N Rd Gd Wd 7d 8d', '123d 678d NNN 34d 99d'],
      wall: '2d 4d 6d',
      turn: 1,
      bonus: ['A1', 'A2', ''],
    });
    s.players[1].melds = [meld('pong', '555d')];
    s = act(s, { type: 'kong', player: 1, kind: parse('5d')[0], kongType: 'added', jokers: 0 });
    s = act(s, { type: 'win', player: 2 });
    expect(s.players[1].melds[0].type).toBe('pong');
    expect(s.players[1].melds[0].slots.length).toBe(3);
    expect(s.result!.payer).toBe(1);
  });

  it('a pong claim never makes a 5th copy with a joker', () => {
    let s = position({
      hands: ['5d 3d 6d 9d E S W N Rd Gd Wd 1d 9d E', '5d J 7d 9d S W N Rd Gd Wd 2d 6d 8d', 'EEE SSS WWW NNN Gd'],
      wall: '2d 4d',
    });
    s.players[1].melds = [meld('pong', '5d 5d J')];
    s.players[1].hand = sorted('J 7d 9d S W N Rd Gd Wd 2d');
    s = act(s, { type: 'discard', player: 0, tile: parse('5d')[0] });
    // South already has 5d 5d + a joker standing for 5d; the discard would be the 4th, so no joker can join.
    expect(legalActions(s, 1).filter((a) => a.type === 'pong')).toEqual([]);
  });

  it('after the last wall tile only a win can be claimed, and it is Last Discard', () => {
    let s = position({
      hands: ['5d 3d 6d 9d E S W N Rd Gd Wd 1d 9d E', '123d 456d 789d EE 5d', '2d 6d 9d S W N Rd Gd 7d 8d 1d 3d'],
      wall: '',
      bonus: ['A1', 'A2', 'A3'],
    });
    s.players[1].hand = sorted('123d 456d 789d EE 5d 1d 1d');
    s.players[1].hand = sorted('123d 456d 789d EEE 5d');
    s = act(s, { type: 'discard', player: 0, tile: parse('5d')[0] });
    expect(legalActions(s, 1).map((a) => a.type).sort()).toEqual(['pass', 'win']);
    s = act(s, { type: 'win', player: 1 });
    expect(s.result!.score!.items.map((i) => i.key)).toContain('lastDiscard');
  });

  it('Joker Opening Slam: 4 jokers in the starting hand is an instant win, paid as self-drawn', () => {
    // Find a seed where someone is dealt all 4 jokers.
    let seed = 1;
    let s = newRound(seed);
    while (s.phase !== 'opening') s = newRound(++seed);
    const p = waitingFor(s)[0];
    s = act(s, { type: 'openingSlam', player: p });
    expect(s.result!.winner).toBe(p);
    expect(s.result!.payment).toBe('self');
    expect(s.result!.score!.fan).toBe(10);
  });
});

describe('loser settlement in a round', () => {
  it('applies after a win under 10 fan', () => {
    // South wins with 6 fan off East's discard. Loser West holds a Red pong, North pong, F4 and S4 = 4 fan
    // (under 5); loser East has an exposed East pong (2) + F1 S1 F4... see below.
    let s = position({
      hands: ['5d 3d 6d 9d S W 1d 9d 2d 2d 7d', '123d 456d 789d SSS 5d', 'RdRdRd NNN 1d 2d 4d 6d 8d 9d 9d'],
      wall: '2d',
      bonus: ['F1 S1 F4', 'S2 F2 A1 A2', 'F3 S3'],
    });
    s.players[0].melds = [meld('pong', 'EEE')];
    s = act(s, { type: 'discard', player: 0, tile: parse('5d')[0] });
    s = act(s, { type: 'win', player: 1 });
    const r = s.result!;
    // South: win 1 + South pong 1 + own flower 1 + own season 1 + 2 animals = 6.
    expect(r.score!.fan).toBe(6);
    // East: East pong 2 + flower 1 + season 1 + flower 4 = 5. West: Red 1 + North 1 + flower 3 + season 3 = 4.
    expect(r.loserFans!.map((x) => x.fan)).toEqual([5, 0, 4]);
    // East pays 3V = 3 * RM1.20; West, under 5, pays East's full 5 fan = RM1.00.
    expect(r.fanPayout).toEqual([-360, 360, 0]);
    expect(r.loser).toEqual([100, 0, -100]);
  });
});

// ---------------------------------------------------------------------------------------------------

function tileTotal(s: GameState): number {
  return wallLeft(s) + s.players.reduce(
    (a, pl) => a + pl.hand.length + pl.bonus.length + pl.discards.length + pl.discardedJokers +
      pl.melds.reduce((b, m) => b + m.slots.length, 0),
    0,
  );
}

describe('fast path for training', () => {
  it('applyActionInPlace plays exactly the same games as applyAction', () => {
    const rng = makeRng(77);
    for (let seed = 1; seed <= 100; seed++) {
      let safe = newRound(seed, seed % 3);
      const fast = newRound(seed, seed % 3);
      while (safe.phase !== 'ended') {
        const p = waitingFor(safe)[0];
        const legal = legalActions(safe, p);
        const a = legal[Math.floor(rng() * legal.length)];
        safe = applyAction(safe, a);
        applyActionInPlace(fast, a);
      }
      expect(JSON.stringify(fast)).toBe(JSON.stringify(safe));
    }
  });
});

describe('random games', () => {
  it('500 rounds of random legal play keep every invariant', () => {
    const rng = makeRng(2026);
    let wins = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const dealer = seed % 3;
      let s = newRound(seed, dealer);
      let steps = 0;
      while (s.phase !== 'ended') {
        const p = waitingFor(s)[0];
        const legal = legalActions(s, p);
        expect(legal.length).toBeGreaterThan(0);
        // Always take a win; otherwise play at random, mostly discards.
        const win = legal.find((a) => a.type === 'win' || a.type === 'selfWin' || a.type === 'openingSlam');
        const a = win ?? legal[Math.floor(rng() * legal.length)];
        s = applyAction(s, a);
        expect(tileTotal(s)).toBe(84);
        if (s.phase !== 'ended') {
          s.players.forEach((pl, q) => {
            const size = pl.hand.length + 3 * pl.melds.length;
            expect(size).toBe(s.phase === 'turn' && q === s.turn ? 14 : 13);
          });
          // A player's view never shows another player's hand.
          const v = playerView(s, (p + 1) % 3);
          expect(v.revealedHands).toBeNull();
        }
        if (++steps > 500) throw new Error('round did not end');
      }
      const r = s.result!;
      expect(r.total.reduce((a, b) => a + b, 0)).toBe(0);
      expect(r.fei.reduce((a, b) => a + b, 0)).toBe(0);
      if (r.type === 'win') {
        wins++;
        expect(r.score!.fan).toBeGreaterThanOrEqual(5);
        expect(r.nextDealer).toBe(r.winner);
      } else {
        expect(r.fanPayout).toEqual([0, 0, 0]);
        expect(r.loser).toEqual([0, 0, 0]);
      }
      // The action log rebuilds the exact same round.
      expect(JSON.stringify(replay(seed, dealer, s.actions))).toBe(JSON.stringify(s));
    }
    expect(wins).toBeGreaterThan(0);
  });
});
