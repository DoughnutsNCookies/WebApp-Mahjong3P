import { describe, expect, it } from 'vitest';
import { analyze, inputFromView } from '../src/analyzer';
import { ACTIONS, actionSlot, encodeHints, encodeOpponents, encodePrivileged, encodeView, encodeWall, HINTS, OBS, OPP, PRIV, PRIV_WALL, slotActions } from '../src/ai/encode';
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

  it('the hidden block (coach only) is in range and does reflect hidden tiles', () => {
    const rng = makeRng(8);
    const priv = new Float32Array(PRIV);
    for (let seed = 1; seed <= 60; seed++) {
      const g = newRound(seed, 0);
      while (g.phase !== 'ended') {
        const p = waitingFor(g)[0];
        encodePrivileged(g, p, priv);
        let bad = 0;
        for (const x of priv) if (!(x >= 0 && x <= 1)) bad++;
        expect(bad).toBe(0);
        const legal = legalActions(g, p);
        applyActionInPlace(g, legal[Math.floor(rng() * legal.length)]);
      }
    }
    // Unlike the observation, it changes when an opponent's hidden hand does.
    const g = newRound(9, 0);
    const a = new Float32Array(PRIV);
    const b = new Float32Array(PRIV);
    encodePrivileged(g, 0, a);
    const altered = structuredClone(g);
    altered.players[1].hand = altered.players[2].hand.slice(0, 13);
    encodePrivileged(altered, 0, b);
    expect(Array.from(b)).not.toEqual(Array.from(a));
  });

  it('hints (v2) are in range, match the analyzer, and use only the player view', () => {
    const rng = makeRng(12);
    const h = new Float32Array(HINTS);
    let turns = 0;
    let claims = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const g = newRound(seed, seed % 3);
      while (g.phase !== 'ended') {
        const p = waitingFor(g)[0];
        const v = playerView(g, p);
        encodeHints(v, h);
        let bad = 0;
        for (const x of h) if (!(x >= 0 && x <= 1)) bad++;
        expect(bad).toBe(0);
        if (v.phase === 'turn' && v.turn === p) {
          // The discards flagged best are exactly those leaving the fewest tiles from ready.
          const opts = analyze(inputFromView(v)).options;
          const fewest = Math.min(...opts.map((o) => o.shanten));
          for (const o of opts) expect(h[8 + o.tile * 3 + 1]).toBe(o.shanten === fewest ? 1 : 0);
          turns++;
        } else if (v.phase === 'claim') {
          expect(h.slice(0, 8 + 48).every((x) => x === 0)).toBe(true);
          claims++;
        }
        const legal = legalActions(g, p);
        applyActionInPlace(g, legal[Math.floor(rng() * legal.length)]);
      }
    }
    expect(turns).toBeGreaterThan(300);
    expect(claims).toBeGreaterThan(50);
    // Built from the view: other players' hidden tiles change nothing.
    const g = newRound(9, 0);
    const a = new Float32Array(HINTS);
    const b = new Float32Array(HINTS);
    encodeHints(playerView(g, 0), a);
    const altered = structuredClone(g);
    altered.players[1].hand = altered.players[2].hand.slice(0, 13);
    altered.wall.reverse();
    encodeHints(playerView(altered, 0), b);
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it('opponent reading (v3) is in range, tracks the discard order, and uses only the player view', () => {
    const rng = makeRng(21);
    const o = new Float32Array(OPP);
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const g = newRound(seed, seed % 3);
      while (g.phase !== 'ended') {
        // The engine keeps one timestamp per tile on the table, earlier ones first.
        for (const pl of g.players) {
          expect(pl.discardAt.length).toBe(pl.discards.length);
          for (let j = 1; j < pl.discardAt.length; j++) expect(pl.discardAt[j]).toBeGreaterThan(pl.discardAt[j - 1]);
        }
        const p = waitingFor(g)[0];
        encodeOpponents(playerView(g, p), o);
        let bad = 0;
        for (const x of o) if (!(x >= 0 && x <= 1)) bad++;
        expect(bad).toBe(0);
        checked++;
        const legal = legalActions(g, p);
        applyActionInPlace(g, legal[Math.floor(rng() * legal.length)]);
      }
    }
    expect(checked).toBeGreaterThan(1000);

    // Play until a discard is passed by everyone, then read it from the next player's seat.
    const g = newRound(4, 0);
    const first = g.players[0].hand.find((t) => t < 16)!;
    applyActionInPlace(g, { type: 'discard', player: 0, tile: first });
    while (g.phase === 'claim') applyActionInPlace(g, { type: 'pass', player: waitingFor(g)[0] });
    expect(g.players[0].discards).toEqual([first]);
    encodeOpponents(playerView(g, 1), o); // player 0 is player 1's previous player: the second block
    const prev = 16 * 4 + 2;
    expect(o[prev + first * 4 + 1]).toBe(1); // thrown early by player 0
    expect(o[prev + first * 4 + 2]).toBe(1); // just now
    expect(o[first * 4 + 3]).toBe(1); // player 2 (the next player) let it go

    // Built from the view: other players' hidden tiles change nothing.
    const a = new Float32Array(OPP);
    const b = new Float32Array(OPP);
    encodeOpponents(playerView(g, 1), a);
    const altered = structuredClone(g);
    [altered.players[0].hand, altered.players[2].hand] = [altered.players[2].hand, altered.players[0].hand];
    altered.wall.reverse();
    encodeOpponents(playerView(altered, 1), b);
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it('the whole-wall block (coach only) is in range and gives each draw to the right player', () => {
    const rng = makeRng(31);
    const w = new Float32Array(PRIV_WALL);
    for (let seed = 1; seed <= 30; seed++) {
      const g = newRound(seed, seed % 3);
      while (g.phase !== 'ended') {
        const p = waitingFor(g)[0];
        encodeWall(g, p, w);
        expect(Array.from(w).every((x) => x >= 0 && x <= 1)).toBe(true);
        // The three players' upcoming draws add up to the tiles counted (up to 8 each).
        const counted = Math.min(g.tail - g.head, 24);
        const sum = Array.from(w.subarray(0, 54)).reduce((a, x) => a + x, 0) * 8;
        expect(Math.round(sum)).toBe(counted);
        const legal = legalActions(g, p);
        applyActionInPlace(g, legal[Math.floor(rng() * legal.length)]);
      }
    }
    // Dealer (player 0) to discard: the next wall tile goes to player 1, i.e. player 0's "next player" block.
    const g = newRound(5, 0);
    encodeWall(g, 0, w);
    const first = g.wall[g.head];
    const slot = first === 16 ? 16 : first > 16 ? 17 : first;
    expect(w[18 + slot]).toBeGreaterThan(0);
    expect(PRIV_WALL).toBe(72);
  });

  it('has the documented sizes', () => {
    expect(ACTIONS).toBe(42);
    // Changing the observation makes old trained models unusable: update this on purpose only.
    expect(OBS).toBe(369);
    expect(PRIV).toBe(71);
    expect(HINTS).toBe(62);
    expect(OPP).toBe(132);
  });
});
