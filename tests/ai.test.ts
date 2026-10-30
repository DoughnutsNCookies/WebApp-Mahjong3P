import { describe, expect, it } from 'vitest';
import { ACTIONS, actionSlot, encodeView, OBS, slotActions } from '../src/ai/encode';
import { applyActionInPlace, legalActions, makeRng, newRound, playerView, waitingFor } from '../src/engine';

describe('AI encoding', () => {
  it('every legal action has a slot, every filled slot is legal, observations are sane', () => {
    const rng = makeRng(5);
    const obs = new Float32Array(OBS);
    let decisions = 0;
    const slotsUsed = new Set<number>();
    for (let seed = 1; seed <= 150; seed++) {
      const g = newRound(seed, seed % 3);
      while (g.phase !== 'ended') {
        const p = waitingFor(g)[0];
        const legal = legalActions(g, p);
        const view = playerView(g, p);
        const slots = slotActions(legal, view.claimTile);
        for (const a of legal) {
          const i = actionSlot(a, view.claimTile);
          expect(i).toBeGreaterThanOrEqual(0);
          expect(i).toBeLessThan(ACTIONS);
          expect(slots[i]).not.toBeNull();
          slotsUsed.add(i);
        }
        for (const a of slots) if (a) expect(legal).toContainEqual(a);
        encodeView(view, obs);
        let bad = 0;
        for (const x of obs) if (!(x >= 0 && x <= 1)) bad++;
        expect(bad).toBe(0);
        const filled = slots.filter(Boolean);
        applyActionInPlace(g, filled[Math.floor(rng() * filled.length)]!);
        decisions++;
      }
    }
    expect(decisions).toBeGreaterThan(3000);
    // Discards, set-aside, wins, passes, pongs and chows all come up in random play.
    for (const i of [16, 17, 18, 19, 20, 22]) expect(slotsUsed.has(i)).toBe(true);
  });

  it("the observation doesn't change when other players' hidden tiles do", () => {
    const g = newRound(9, 0);
    const before = new Float32Array(OBS);
    encodeView(playerView(g, 0), before);
    const altered = structuredClone(g);
    [altered.players[1].hand, altered.players[2].hand] = [altered.players[2].hand.slice(0, 13), altered.players[1].hand];
    altered.wall.reverse();
    const after = new Float32Array(OBS);
    encodeView(playerView(altered, 0), after);
    expect(Array.from(after)).toEqual(Array.from(before));
  });

  it('has the documented sizes', () => {
    expect(ACTIONS).toBe(42);
    // Changing the observation makes old trained models unusable: update this on purpose only.
    expect(OBS).toBe(369);
  });
});
