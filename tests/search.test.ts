import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { determinize, searchAction } from '../src/ai/search';
import { parseModel, WEB_MODEL } from '../src/ai/web';
import { botAction } from '../src/bots';
import { applyAction, applyActionInPlace, legalActions, makeRng, newRound, waitingFor } from '../src/engine';

const weights = readFileSync(`public/ai/${WEB_MODEL.file}`);
const model = parseModel(weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength));
const fast = { candidates: 3, rollouts: 4 };

describe('look-ahead search', () => {
  it('redeals exactly the unseen tiles, keeping every hand size', () => {
    const g = newRound(11, 0);
    for (let i = 0; i < 12; i++) applyActionInPlace(g, botAction(g, waitingFor(g)[0], 'easy'));
    const d = determinize(g, 0, makeRng(3));
    const multiset = (s: typeof g) => [...s.players[1].hand, ...s.players[2].hand, ...s.wall.slice(s.head, s.tail)].sort((a, b) => a - b);
    expect(multiset(d)).toEqual(multiset(g));
    for (let q = 0; q < 3; q++) expect(d.players[q].hand.length).toBe(g.players[q].hand.length);
    expect(d.players[0].hand).toEqual(g.players[0].hand);
    expect(d.players[0].discards).toEqual(g.players[0].discards);
  });

  it('plays legal moves through whole rounds and chooses from what it can see only', { timeout: 120000 }, () => {
    let searched = 0;
    for (let seed = 1; seed <= 3; seed++) {
      let s = newRound(seed, 0);
      while (s.phase !== 'ended') {
        const p = waitingFor(s)[0];
        if (p !== 0) { s = applyAction(s, botAction(s, p, 'normal')); continue; }
        const a = searchAction(s, 0, model, fast);
        expect(legalActions(s, 0)).toContainEqual(a);
        if (s.phase === 'turn') {
          // Rearranging the hidden tiles changes nothing: same decision.
          const altered = structuredClone(s);
          if (altered.players[1].hand.length === altered.players[2].hand.length) {
            [altered.players[1].hand, altered.players[2].hand] = [altered.players[2].hand, altered.players[1].hand];
          }
          altered.wall = [...altered.wall.slice(0, altered.head), ...altered.wall.slice(altered.head, altered.tail).reverse(), ...altered.wall.slice(altered.tail)];
          expect(searchAction(altered, 0, model, fast)).toEqual(a);
          searched++;
        }
        s = applyAction(s, a);
      }
    }
    expect(searched).toBeGreaterThan(10);
  });
});
