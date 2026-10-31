import { describe, expect, it } from 'vitest';
import { AnalyzerInput, claimAdvice, inputFromState } from '../src/analyzer';
import { botAction, BotLevel, decideWin } from '../src/bots';
import { Action, applyAction, decodeRound, GameState, legalActions, Meld, newRound, parse, replay, Seat, waitingFor } from '../src/engine';
import { meld } from './helpers';

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
      const { s } = playRound(seed, (['easy', 'normal', 'advanced', 'hard'] as BotLevel[]).map((_, i, l) => l[(i + seed) % 4]).slice(0, 3) as BotLevel[], seed % 3);
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

  it("doesn't spend a fei on a kong when a pong does the same (Sean's hand, 2026-10-30)", () => {
    // Bot 1 (South) holds E E + a fei when East is discarded. It used to kong with the fei.
    const r = decodeRound('MJ3P1|seed=1838498445|dealer=1|unit=20|1dW 2- 0p1 0dE');
    const s = replay(r.seed, r.dealer, r.actions);
    expect(legalActions(s, 1)).toContainEqual({ type: 'claimKong', player: 1, jokers: 1 });
    for (const level of ['normal', 'advanced'] as BotLevel[]) {
      const a = botAction(s, 1, level);
      expect(a.type === 'claimKong' && a.jokers > 0).toBe(false);
    }
    const advice = claimAdvice(inputFromState(s, 1), legalActions(s, 1), s.pending!.tile);
    const kong = advice.find((x) => x.action.type === 'claimKong')!;
    expect(kong.recommended).toBe(false);
    expect(kong.note).toMatch(/uses up your fei/);
  });

  it('with a hand of nothing but fei, every level sets one aside (they used to crash)', () => {
    const s = newRound(3, 0);
    s.players[0].hand = parse('J J');
    s.players[0].melds = [meld('pong', '111d'), meld('pong', '555d'), meld('chow', '789d'), meld('pong', 'EEE')];
    s.players[0].bonus = parse('A1');
    s.phase = 'turn';
    s.turn = 0;
    s.turnDrew = true;
    s.discardsMade = 5;
    for (const level of ['easy', 'normal', 'advanced', 'hard'] as BotLevel[]) {
      const a = botAction(s, 0, level);
      expect(a.type === 'discardJoker' || a.type === 'selfWin').toBe(true);
    }
  });

  it('an all-fei hand with the wall empty still has a move, and the round ends as a draw', () => {
    let s = newRound(3, 0);
    s.players[0].hand = parse('J J');
    s.players[0].melds = [meld('pong', '111d'), meld('pong', '555d'), meld('chow', '789d'), meld('pong', 'EEE')];
    s.players[0].bonus = parse('A1 A2 A3 A4 A5');
    s.players[0].discardedJokers = 0;
    s.phase = 'turn';
    s.turn = 0;
    s.turnDrew = false; // no self-drawn win possible
    s.head = s.tail;    // wall empty
    const legal = legalActions(s, 0);
    expect(legal).toContainEqual({ type: 'discardJoker', player: 0 });
    s = applyAction(s, { type: 'discardJoker', player: 0 });
    expect(s.phase).toBe('ended');
    expect(s.result!.type).toBe('draw');
  });

  describe('advanced: turning down a win', () => {
    // 2+2+3+3+3 = 13 tiles, waiting on Rd (3 Dragons, 10 fan) or 5d (Small Dragons, 6 fan).
    // East just discarded 5d, so 1 5d and 2 Rd are still unseen.
    const ready = (wall: number, oppMelds: Meld[] = []): AnalyzerInput => ({
      seat: 1 as Seat,
      hand: parse('RdRd 55d GdGdGd WdWdWd 123d'),
      melds: [],
      bonus: parse('F1'),
      discardedJokers: 0,
      ownDiscards: [],
      opponents: [
        { player: 0, seat: 0 as Seat, melds: oppMelds, discards: parse('5d'), discardedJokers: 0, bonusCount: 1 },
        { player: 2, seat: 2 as Seat, melds: oppMelds, discards: [], discardedJokers: 0, bonusCount: 1 },
      ],
      wallLeft: wall,
      bonusSeen: 3,
    });

    it('holds out early for the 10-fan tile instead of 6 fan now', () => {
      const d = decideWin(ready(40), 6, false);
      expect(d.take).toBe(false);
      expect(d.reason).toMatch(/Carrying on is worth about \d+ sen/);
    });
    it('takes the 6 fan at the very end of the round', () => {
      expect(decideWin(ready(3), 6, false).take).toBe(true);
    });
    it('takes the 6 fan when opponents look close to winning', () => {
      const melds = [meld('pong', 'EEE'), meld('chow', '456d'), meld('pong', 'NNN')];
      expect(decideWin(ready(40, melds), 6, false).take).toBe(true);
    });
    it('always takes 10 fan', () => {
      expect(decideWin(ready(40), 10, false).take).toBe(true);
    });
  });

  // Bot strength is measured with the duplicate benchmark (scripts/bots.ts, results in the README), not
  // here: the edges are a few tenths of a ringgit a round and need ~2000 deals to show reliably.
});
