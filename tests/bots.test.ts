import { describe, expect, it } from 'vitest';
import { botAction, BotLevel } from '../src/bots';
import { Action, applyAction, GameState, newRound, waitingFor } from '../src/engine';

function playRound(seed: number, levels: BotLevel[], dealer = 0): { s: GameState; actions: Action[] } {
  let s = newRound(seed, dealer);
  while (s.phase !== 'ended') {
    const p = waitingFor(s)[0];
    s = applyAction(s, botAction(s, p, levels[p])); // applyAction throws on an illegal move
  }
  return { s, actions: s.actions };
}

describe('bots', () => {
  it('play complete legal rounds at both levels', { timeout: 60000 }, () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { s } = playRound(seed, seed % 2 ? ['easy', 'normal', 'easy'] : ['normal', 'normal', 'easy'], seed % 3);
      expect(s.result!.total.reduce((a, b) => a + b, 0)).toBe(0);
    }
  });

  it('are deterministic: same seed, same game', { timeout: 30000 }, () => {
    const a = playRound(7, ['normal', 'easy', 'normal']);
    const b = playRound(7, ['normal', 'easy', 'normal']);
    expect(b.actions).toEqual(a.actions);
  });

  it("decide only from what they can see: changing other players' hidden tiles changes nothing", { timeout: 30000 }, () => {
    let checked = 0;
    for (let seed = 1; seed <= 10; seed++) {
      let s = newRound(seed, 0);
      while (s.phase !== 'ended') {
        const p = waitingFor(s)[0];
        const decision = botAction(s, p, 'normal');
        // Swap the two opponents' concealed hands and reverse the unseen wall: hidden info only.
        const altered = structuredClone(s);
        const [o1, o2] = [(p + 1) % 3, (p + 2) % 3];
        if (altered.players[o1].hand.length === altered.players[o2].hand.length) {
          [altered.players[o1].hand, altered.players[o2].hand] = [altered.players[o2].hand, altered.players[o1].hand];
        }
        altered.wall = [...altered.wall.slice(0, altered.head), ...altered.wall.slice(altered.head, altered.tail).reverse(), ...altered.wall.slice(altered.tail)];
        // Legal claims depend on your own hand only, so the same decision must still be legal and chosen.
        if (altered.phase === 'turn' || altered.pending?.options[p].length) {
          expect(botAction(altered, p, 'normal')).toEqual(decision);
          checked++;
        }
        s = applyAction(s, decision);
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('easy never sets a joker aside; normal sometimes does', { timeout: 60000 }, () => {
    let easy = 0;
    let normal = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const levels: BotLevel[] = ['easy', 'normal', 'normal'];
      const { actions } = playRound(seed, levels);
      for (const a of actions) {
        if (a.type !== 'discardJoker') continue;
        if (levels[a.player] === 'easy') easy++;
        else normal++;
      }
    }
    expect(easy).toBe(0);
    expect(normal).toBeGreaterThan(0);
  });

  it('normal beats easy over 300 rounds (seats rotate)', { timeout: 120000 }, () => {
    const money = { normal: 0, easy: 0 };
    for (let r = 0; r < 300; r++) {
      // One normal bot against two easy ones; the normal bot moves seat every round.
      const levels: BotLevel[] = ['easy', 'easy', 'easy'];
      levels[r % 3] = 'normal';
      const { s } = playRound(5000 + r, levels, r % 3);
      s.result!.total.forEach((d, p) => (money[levels[p]] += d));
    }
    // Per bot: the normal bot's total against the average easy bot's.
    expect(money.normal).toBeGreaterThan(money.easy / 2);
    expect(money.normal).toBeGreaterThan(0);
  });
});
