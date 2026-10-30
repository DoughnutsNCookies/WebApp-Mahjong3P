import { describe, expect, it } from 'vitest';
import { roundReport } from '../src/analyzer';
import { botAction, BotLevel } from '../src/bots';
import {
  Action, applyAction, decodeAction, decodeRound, encodeAction, encodeRound, newRound, parse, replay, waitingFor,
} from '../src/engine';

function botRound(seed: number, levels: BotLevel[] = ['easy', 'easy', 'easy']) {
  let s = newRound(seed, seed % 3);
  while (s.phase !== 'ended') {
    const p = waitingFor(s)[0];
    s = applyAction(s, botAction(s, p, levels[p]));
  }
  return s;
}

describe('round codes', () => {
  it('every kind of action survives encode and decode', () => {
    const samples: Action[] = [
      { type: 'discard', player: 0, tile: parse('Rd')[0] },
      { type: 'discardJoker', player: 1 },
      { type: 'selfWin', player: 2 },
      { type: 'win', player: 0 },
      { type: 'pass', player: 1 },
      { type: 'pong', player: 2, jokers: 1 },
      { type: 'claimKong', player: 0, jokers: 0 },
      { type: 'kong', player: 1, kind: parse('E')[0], kongType: 'concealed', jokers: 2 },
      { type: 'kong', player: 2, kind: parse('9d')[0], kongType: 'added', jokers: 0 },
      { type: 'chow', player: 0, start: parse('3d')[0], jokerKinds: [] },
      { type: 'chow', player: 1, start: parse('5d')[0], jokerKinds: parse('6d 7d') },
      { type: 'openingSlam', player: 2 },
    ];
    for (const a of samples) expect(decodeAction(encodeAction(a))).toEqual(a);
  });

  it('200 bot rounds rebuild exactly from their code', { timeout: 60000 }, () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const s = botRound(seed);
      const text = encodeRound({ seed: s.seed, dealer: s.dealer, unitSen: s.rules.unitSen, actions: s.actions });
      const back = decodeRound(`some pasted text before\n${text}\nand after`);
      expect(back.actions).toEqual(s.actions);
      expect(JSON.stringify(replay(back.seed, back.dealer, back.actions))).toBe(JSON.stringify(s));
      s.actions.forEach((a) => seen.add(a.type));
    }
    // The bots' games cover the common actions; the sample test above covers the rest.
    for (const t of ['discard', 'pass', 'pong', 'chow', 'win']) expect(seen.has(t)).toBe(true);
  });

  it('the report describes the round and ends with a working code', () => {
    const s = botRound(42, ['normal', 'normal', 'normal']);
    const text = roundReport({ seed: s.seed, dealer: s.dealer, actions: s.actions, levels: ['normal', 'normal'] });
    expect(text).toMatch(/^3P Mahjong hand/);
    expect(text).toMatch(/Result: /);
    expect(text).toMatch(/Your decisions \(analyzer\):|You made no discards\./);
    expect(text).toMatch(/Money: You [+-]RM/);
    const back = decodeRound(text);
    expect(back.actions).toEqual(s.actions);
  });
});
