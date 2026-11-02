import { describe, expect, it } from 'vitest';
import { botAction } from '../src/bots';
import { applyAction, legalActions, makeRng, newRound, waitingFor } from '../src/engine';
import { RoomState, ServerMsg } from '../src/server/protocol';
import { Deps, Room, TIMING } from '../src/server/room';

/** A fake clock: timers run when time is advanced. */
function fakeDeps(seed = 1): Deps & { advance(ms: number): void; t: number } {
  let t = 0;
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const rng = makeRng(seed);
  return {
    get t() { return t; },
    now: () => t,
    setTimeout: (fn, ms) => { timers.set(++id, { at: t + ms, fn }); return id; },
    clearTimeout: (h) => { timers.delete(h as number); },
    random: rng,
    model: null,
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = end;
    },
  };
}

/** A person's connection: keeps the last state and every message. */
function person() {
  const got: ServerMsg[] = [];
  return {
    got,
    send: (m: ServerMsg) => got.push(m),
    get state(): RoomState { return [...got].reverse().find((m) => m.t === 'state')!.room as RoomState; },
  };
}

/** Plays a person's moves (first legal move, as they see the table) until the round ends. */
function playOut(room: Room, deps: ReturnType<typeof fakeDeps>, people: { id: string; conn: ReturnType<typeof person> }[]) {
  for (let guard = 0; guard < 2000 && room.phase === 'playing'; guard++) {
    let moved = false;
    for (const p of people) {
      const g = p.conn.state.game;
      if (!g || g.phase === 'ended') continue;
      const legal = legalActions(g, 0);
      if (legal.length) {
        expect(room.handle(p.id, { t: 'act', action: legal.find((a) => a.type === 'pass') ?? legal[legal.length - 1] })).toBeNull();
        moved = true;
        break;
      }
    }
    if (!moved) deps.advance(TIMING.botTurn);
  }
}

describe('multiplayer room', () => {
  it('plays a whole round with a host and two bots, and settles the tally', () => {
    const deps = fakeDeps();
    const room = new Room('1234', 'A', deps);
    const a = person();
    expect(room.join('A', 'Sean', a)).toBeNull();
    expect(room.handle('A', { t: 'addBot', seat: 1, level: 'normal' })).toBeNull();
    expect(room.handle('A', { t: 'addBot', seat: 2, level: 'easy' })).toBeNull();
    expect(room.handle('A', { t: 'start' })).toBeNull();
    expect(a.state.phase).toBe('playing');
    expect(a.state.seats.map((s) => s.name)).toEqual(['Sean', 'Normal bot', 'Easy bot']);
    playOut(room, deps, [{ id: 'A', conn: a }]);
    expect(room.phase).toBe('between');
    expect(room.tally.reduce((x, y) => x + y, 0)).toBe(0);
    expect(a.state.game!.phase).toBe('ended');
    expect(a.state.tally).toEqual(room.tally);
  });

  it('two people at one table each see only their own tiles, and each moves as player 0', () => {
    const deps = fakeDeps(2);
    const room = new Room('5678', 'A', deps);
    const a = person();
    const b = person();
    room.join('A', 'Sean', a);
    expect(room.join('B', 'Ali', b)).toBeNull();
    room.handle('A', { t: 'addBot', seat: 2, level: 'normal' });
    room.handle('A', { t: 'start' });
    const real = room.game!;
    expect(a.state.game!.players[0].hand).toEqual(real.players[0].hand);
    expect(b.state.game!.players[0].hand).toEqual(real.players[1].hand);
    expect(a.state.game!.players[1].hand.every((t) => t === 0)).toBe(true);
    expect(a.state.game!.seed).not.toBe(real.seed);
    expect(b.state.seats[0].name).toBe('Ali');
    expect(b.state.seats[2].name).toBe('Sean'); // Sean sits before Ali
    expect(b.state.youAreHost).toBe(false);
    playOut(room, deps, [{ id: 'A', conn: a }, { id: 'B', conn: b }]);
    expect(room.phase).toBe('between');
    expect(a.state.seed).toBe(room.game!.seed); // revealed once the round is over
    expect(a.state.game!.seed).not.toBe(room.game!.seed);
  });

  it('a bot plays for someone who drops out mid-round, and they get the seat back', () => {
    const deps = fakeDeps(3);
    const room = new Room('1111', 'A', deps);
    const a = person();
    const b = person();
    room.join('A', 'Sean', a);
    room.join('B', 'Ali', b);
    room.handle('A', { t: 'addBot', seat: 2, level: 'normal' });
    room.handle('A', { t: 'start' });
    room.disconnect('B');
    expect(a.state.seats[1].connected).toBe(false);
    deps.advance(TIMING.dropToBot + 1);
    expect(a.state.seats[1].autoplay).toBe(true);
    const b2 = person();
    expect(room.join('B', 'Ali', b2)).toBeNull();
    expect(b2.state.seats[0].autoplay).toBe(false);
    expect(b2.state.game).not.toBeNull();
  });

  it('between rounds the table waits for a missing person', () => {
    const deps = fakeDeps(4);
    const room = new Room('2222', 'A', deps);
    const a = person();
    const b = person();
    room.join('A', 'Sean', a);
    room.join('B', 'Ali', b);
    room.handle('A', { t: 'addBot', seat: 2, level: 'normal' });
    room.handle('A', { t: 'start' });
    playOut(room, deps, [{ id: 'A', conn: a }, { id: 'B', conn: b }]);
    room.disconnect('B');
    room.handle('A', { t: 'next' });
    deps.advance(60_000);
    expect(room.phase).toBe('between');
    expect(a.state.waitingFor).toEqual(['Ali (disconnected)']);
    const b2 = person();
    room.join('B', 'Ali', b2);
    room.handle('B', { t: 'next' });
    expect(room.phase).toBe('playing');
  });

  it('a person who runs out of time has a move made for them', () => {
    const deps = fakeDeps(5);
    const room = new Room('3333', 'A', deps);
    const a = person();
    room.join('A', 'Sean', a);
    room.handle('A', { t: 'addBot', seat: 1, level: 'normal' });
    room.handle('A', { t: 'addBot', seat: 2, level: 'normal' });
    room.handle('A', { t: 'start' }); // player 0 deals: Sean moves first
    expect(a.state.deadline).toBe(deps.t + TIMING.humanTurn);
    const before = room.game!.actions.length;
    deps.advance(TIMING.humanTurn + 1);
    expect(room.game!.actions.length).toBeGreaterThan(before);
  });

  it('chat reaches everyone; emoji are limited to a few a second', () => {
    const deps = fakeDeps(6);
    const room = new Room('4444', 'A', deps);
    const a = person();
    const b = person();
    room.join('A', 'Sean', a);
    room.join('B', 'Ali', b);
    expect(room.handle('A', { t: 'chat', text: '  hello   there ' })).toBeNull();
    const msg = b.got.filter((m) => m.t === 'chat').flatMap((m) => (m.t === 'chat' ? m.messages : [])).at(-1)!;
    expect(msg.text).toBe('hello there');
    expect(msg.seat).toBe(2); // from Ali's point of view, Sean sits before him
    for (let i = 0; i < 20; i++) room.handle('A', { t: 'emoji', e: '🔥' });
    expect(b.got.filter((m) => m.t === 'emoji').length).toBe(6);
    expect(room.handle('A', { t: 'emoji', e: 'not an emoji' })).toBeNull();
  });

  it('only the host changes the table, and nobody joins mid-game', () => {
    const deps = fakeDeps(7);
    const room = new Room('5555', 'A', deps);
    room.join('A', 'Sean', person());
    room.join('B', 'Ali', person());
    expect(room.handle('B', { t: 'addBot', seat: 1, level: 'normal' })).not.toBeNull();
    room.handle('A', { t: 'addBot', seat: 2, level: 'normal' });
    room.handle('A', { t: 'start' });
    expect(room.join('C', 'Late', person())).toMatch(/middle of a game/);
  });

  it('timers: yours always, an opponent only on their turn, never on a claim', () => {
    let claimSeen = false;
    for (let seed = 1; seed <= 40 && !claimSeen; seed++) {
      const deps = fakeDeps(seed);
      const room = new Room('6666', 'A', deps);
      const a = person();
      const b = person();
      room.join('A', 'Sean', a);
      room.join('B', 'Ali', b);
      room.handle('A', { t: 'addBot', seat: 2, level: 'normal' });
      room.handle('A', { t: 'start' });
      // Sean (East) moves first: his own bar, and Ali sees Sean's turn bar on Sean's box (Ali's seat 2).
      expect(a.state.timers[0]).not.toBeNull();
      expect(b.state.timers[2]).not.toBeNull();
      expect(b.state.timers[0]).toBeNull();
      // Play on until both people are deciding on the same discard.
      for (let guard = 0; guard < 400 && room.phase === 'playing'; guard++) {
        const g = room.game!;
        if (g.phase === 'claim') {
          const deciding = [0, 1].filter((p) => g.pending!.options[p].length && !g.pending!.responses[p]);
          if (deciding.length === 2) {
            expect(a.state.timers[0]).not.toBeNull();
            expect(b.state.timers[0]).not.toBeNull();
            // Neither sees the other's claim timer: it would give away that they can claim.
            expect(a.state.timers[1]).toBeNull();
            expect(b.state.timers[2]).toBeNull();
            // One answers; the other's deadline keeps running (not reset).
            const before = b.state.deadline;
            room.handle('A', { t: 'act', action: { type: 'pass', player: 0 } });
            if (room.game!.phase === 'claim') expect(b.state.deadline).toBe(before);
            claimSeen = true;
            break;
          }
        }
        const mover = [{ id: 'A', c: a }, { id: 'B', c: b }].find((x) => x.c.state.game && legalActions(x.c.state.game, 0).length);
        if (mover) {
          const legal = legalActions(mover.c.state.game!, 0);
          room.handle(mover.id, { t: 'act', action: legal.find((x) => x.type === 'pass') ?? legal[legal.length - 1] });
        } else deps.advance(TIMING.botTurn);
      }
    }
    expect(claimSeen).toBe(true);
  });

  it('in a room, when both opponents can Hu on a discard, the next player wins even if the other taps first', () => {
    // A real double-win discard from bot games, played out in a room of three people.
    let s = null as unknown as NonNullable<Room['game']>;
    for (let seed = 1; seed <= 800 && !s; seed++) {
      let g = newRound(seed, seed % 3);
      while (g.phase !== 'ended' && !s) {
        if (g.phase === 'claim' && g.pending!.responses.every((r) => r === null)
          && [0, 1, 2].filter((q) => g.pending!.options[q].some((a) => a.type === 'win')).length === 2) s = g;
        else g = applyAction(g, botAction(g, waitingFor(g)[0], 'easy'));
      }
    }
    const deps = fakeDeps(9);
    const room = new Room('7777', 'A', deps);
    const conns = { A: person(), B: person(), C: person() };
    room.join('A', 'Sean', conns.A);
    room.join('B', 'Ali', conns.B);
    room.join('C', 'Mei', conns.C);
    room.handle('A', { t: 'start' });
    room.game = s; // the double-win moment
    room.phase = 'playing';
    const ids = ['A', 'B', 'C'] as const;
    const next = ids[(s.pending!.from + 1) % 3];
    const later = ids[(s.pending!.from + 2) % 3];
    // The later player is quicker: their Hu has to wait for the next player.
    expect(room.handle(later, { t: 'act', action: { type: 'win', player: 0 } })).toBeNull();
    expect(room.game!.phase).toBe('claim');
    // Their screen keeps the choice, waiting (they answered, the round goes on).
    expect(conns[later].state.game!.pending!.responses[0]?.type).toBe('win');
    expect(room.handle(next, { t: 'act', action: { type: 'win', player: 0 } })).toBeNull();
    expect(room.game!.result!.winner).toBe((s.pending!.from + 1) % 3);
    // Everyone sees the next player as the winner (each from their own seat).
    for (const id of ids) {
      const v = conns[id].state;
      expect(v.seats[v.game!.result!.winner!].name).toBe({ A: 'Sean', B: 'Ali', C: 'Mei' }[next]);
    }
  });
});
