import { describe, expect, it } from 'vitest';
import { botAction } from '../src/bots';
import { Action, applyAction, GameState, legalActions, newRound, replay, waitingFor } from '../src/engine';
import { rotateState, seatView } from '../src/engine/seat';

function playedRounds(n: number): GameState[][] {
  const out: GameState[][] = [];
  for (let seed = 1; seed <= n; seed++) {
    const states = [newRound(seed, seed % 3)];
    while (states.at(-1)!.phase !== 'ended') {
      const s = states.at(-1)!;
      states.push(applyAction(s, botAction(s, waitingFor(s)[0], 'normal')));
    }
    out.push(states);
  }
  return out;
}
const rounds = playedRounds(12);
const rotA = (a: Action, me: number): Action => ({ ...a, player: (a.player - me + 3) % 3 });

describe('multiplayer seat views', () => {
  it('rotating is the same round with the dealer relabelled, at every step', { timeout: 60000 }, () => {
    for (const states of rounds) {
      const s0 = states[0];
      for (const me of [0, 1, 2]) {
        for (let i = 0; i < states.length; i += 7) {
          const g = states[i];
          const rotated = rotateState(g, me);
          const replayed = replay(s0.seed, (s0.dealer - me + 3) % 3, g.actions.map((a) => rotA(a, me)));
          expect(rotated).toEqual(replayed);
          // What player `me` may do is what player 0 may do in the rotated round.
          expect(legalActions(rotated, 0)).toEqual(legalActions(g, me).map((a) => rotA(a, me)));
        }
      }
    }
  });

  it('hides the other hands, the wall, the seed, their claim options, passes and draws', () => {
    let pendingChecked = 0;
    for (const states of rounds) {
      for (const g of states.filter((s) => s.phase !== 'ended')) {
        for (const me of [0, 1, 2]) {
          const v = seatView(g, me, 777);
          expect(v.seed).toBe(777);
          expect(v.players[0].hand).toEqual(g.players[me].hand);
          for (const q of [1, 2]) {
            expect(v.players[q].hand.length).toBe(g.players[(me + q) % 3].hand.length);
            expect(v.players[q].hand.every((t) => t === 0)).toBe(true);
          }
          expect(v.wall.every((t) => t === 0)).toBe(true);
          if (v.turn !== 0) expect(v.lastDrawn).toBeNull();
          if (v.pending) {
            expect(v.pending.options[1]).toEqual([]);
            expect(v.pending.options[2]).toEqual([]);
            pendingChecked++;
          }
          expect(v.actions.some((a) => a.type === 'pass' && a.player !== 0)).toBe(false);
          for (const ev of v.events) {
            if (ev.e === 'draw' && ev.player !== 0) expect(ev.tile).toBe(0);
            if (ev.e === 'deal') expect(ev.hands[1].every((t) => t === 0) && ev.hands[2].every((t) => t === 0)).toBe(true);
          }
          // Nothing about the hidden tiles leaks: two rounds that differ only in hidden tiles look the same.
          const other = structuredClone(g);
          other.players[(me + 1) % 3].hand.reverse();
          other.wall.reverse();
          expect(seatView(other, me, 777)).toEqual(v);
        }
      }
    }
    expect(pendingChecked).toBeGreaterThan(20);
  });

  it('shows everything once the round has ended (the seed is shared separately)', () => {
    const g = rounds[0].at(-1)!;
    const v = seatView(g, 2, 777);
    expect(v.seed).toBe(777);
    expect({ ...v, seed: g.seed }).toEqual(rotateState(g, 2));
  });
});
