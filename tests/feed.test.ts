import { describe, expect, it } from 'vitest';
import { botAction } from '../src/bots';
import { applyAction, newRound, waitingFor } from '../src/engine';
import { riversOf } from '../src/ui/feed';

describe('discard rows (riversOf)', () => {
  it('keep every discard in order, mark the ones taken, and match the table for the rest', { timeout: 60000 }, () => {
    const seen = { pong: 0, chow: 0, kong: 0, win: 0 };
    for (let seed = 1; seed <= 60; seed++) {
      let s = newRound(seed, seed % 3);
      while (s.phase !== 'ended') {
        s = applyAction(s, botAction(s, waitingFor(s)[0], 'normal'));
        const { rivers, newest } = riversOf(s);
        for (let p = 0; p < 3; p++) {
          // Untaken tiles are exactly what the engine still has on the table, in the same order.
          expect(rivers[p].filter((t) => !t.taken).map((t) => t.tile)).toEqual(s.players[p].discards);
          const thrown = s.actions.filter((a) => a.type === 'discard' && a.player === p).length;
          expect(rivers[p].length).toBe(thrown);
        }
        if (newest) expect(rivers[newest.player][newest.index].taken).toBeUndefined();
      }
      for (const row of riversOf(s).rivers) for (const t of row) if (t.taken) seen[t.taken.how]++;
      // A discard win marks the tile it was won on.
      if (s.result?.type === 'win' && s.result.payment !== 'self' && !s.result.score!.items.some((i) => i.key === 'stealKong')) {
        expect(riversOf(s).rivers[s.result.payer!].some((t) => t.taken?.how === 'win' && t.taken.by === s.result!.winner)).toBe(true);
      }
    }
    expect(seen.pong).toBeGreaterThan(0);
    expect(seen.win).toBeGreaterThan(0);
  });
});
