// A private room: three seats (people or bots), the round in progress, the room's tally, chat and emoji.
// The server is the only place the real round exists; each person is sent seatView() of it. No network code
// here (main.ts does that), and timers come in through `deps`, so the whole room is tested in plain Node.

import { aiAction, WebModel } from '../ai/web';
import { botAction } from '../bots';
import { Action, applyAction, GameState, legalActions, newRound, sameAction, waitingFor } from '../engine/game';
import { DEFAULT_RULES } from '../engine/rules';
import { seatView } from '../engine/seat';
import { BotKind, ChatMessage, ClientMsg, EMOJIS, RoomState, SeatInfo, ServerMsg } from './protocol';

export interface Deps {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  random(): number;
  /** The trained AI, for AI bots; null plays them as Normal. */
  model: WebModel | null;
}

export interface Conn { send(msg: ServerMsg): void }

type Seat =
  | { kind: 'empty' }
  | { kind: 'bot'; level: BotKind; name: string }
  | { kind: 'human'; playerId: string; name: string; conn: Conn | null; autoplay: boolean; ready: boolean; lastChat: number; emojiAt: number[] };

/**
 * Bot pacing, as in single player at Normal speed, and how long a person may take before the bot decides.
 * emptyClose: how long a room with nobody connected waits for someone to come back before it closes.
 */
export const TIMING = { botTurn: 1150, botClaim: 380, humanTurn: 40_000, humanClaim: 15_000, dropToBot: 10_000, emptyClose: 60_000 };
const BOT_NAMES: Record<BotKind, string> = { easy: 'Easy bot', normal: 'Normal bot', ai: 'AI v2' };
const rel = (seat: number, viewer: number) => (seat - viewer + 3) % 3;

export class Room {
  readonly code: string;
  seats: Seat[] = [{ kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }];
  hostId: string;
  unitSen = DEFAULT_RULES.unitSen;
  tally = [0, 0, 0];
  rounds = 0;
  dealer = 0;
  game: GameState | null = null;
  phase: RoomState['phase'] = 'lobby';
  chat: ChatMessage[] = [];
  /** When the room last had someone connected (for clean-up). */
  lastActive: number;
  private roundId = 0;
  private timer: unknown = null;
  /** Each person deciding right now: when they run out of time, and how long they had. */
  private deadlines = new Map<number, { at: number; total: number }>();
  private dropTimers = new Map<string, unknown>();
  private emptyTimer: unknown = null;
  private chatId = 0;
  /** Called once when the room closes because everyone has gone; the server then forgets it. */
  onEmpty: (() => void) | null = null;
  closed = false;

  constructor(code: string, hostId: string, private deps: Deps) {
    this.code = code;
    this.hostId = hostId;
    this.lastActive = deps.now();
  }

  // ---------------------------------------------------------------------------------------------------
  // People

  seatOf(playerId: string): number {
    return this.seats.findIndex((s) => s.kind === 'human' && s.playerId === playerId);
  }

  /** Joins (or rejoins after a drop). Returns an error message, or null. */
  join(playerId: string, name: string, conn: Conn): string | null {
    let seat = this.seatOf(playerId);
    if (seat < 0) {
      if (this.phase !== 'lobby') return 'This room is in the middle of a game.';
      seat = this.seats.findIndex((s) => s.kind === 'empty');
      if (seat < 0) return 'This room is full.';
      this.seats[seat] = { kind: 'human', playerId, name, conn, autoplay: false, ready: false, lastChat: -Infinity, emojiAt: [] };
    } else {
      const s = this.seats[seat] as Extract<Seat, { kind: 'human' }>;
      s.conn = conn;
      s.name = name || s.name;
      s.autoplay = false; // back: the bot stops playing for them
      this.deps.clearTimeout(this.dropTimers.get(playerId));
      this.dropTimers.delete(playerId);
    }
    this.deps.clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
    this.lastActive = this.deps.now();
    conn.send({ t: 'chat', messages: this.chat });
    this.schedule();
    this.broadcast();
    return null;
  }

  /** The connection dropped: after a while a bot plays for them; between rounds the table waits for them. */
  disconnect(playerId: string, conn?: Conn) {
    const seat = this.seatOf(playerId);
    if (seat < 0) return;
    const s = this.seats[seat] as Extract<Seat, { kind: 'human' }>;
    // An old connection closing after a refresh's new one has joined: they are still here.
    if (conn && s.conn !== conn) return;
    s.conn = null;
    this.dropTimers.set(playerId, this.deps.setTimeout(() => {
      this.dropTimers.delete(playerId);
      if (s.conn) return;
      s.autoplay = true;
      this.schedule();
      this.broadcast();
    }, TIMING.dropToBot));
    if (!this.hasPeople()) {
      // Nobody left at the table: stop play (bots don't carry on alone) and close unless someone is back soon.
      this.schedule();
      this.disconnectedOnly();
    }
    this.broadcast();
  }

  /** Leaving on purpose: in the lobby the seat frees up; during a game a Normal bot takes the seat for good. */
  leave(playerId: string) {
    const seat = this.seatOf(playerId);
    if (seat < 0) return;
    const s = this.seats[seat] as Extract<Seat, { kind: 'human' }>;
    s.conn?.send({ t: 'left', reason: 'You left the room.' });
    this.deps.clearTimeout(this.dropTimers.get(playerId));
    this.seats[seat] = this.phase === 'lobby' ? { kind: 'empty' } : { kind: 'bot', level: 'normal', name: `${s.name} (bot)` };
    if (this.hostId === playerId) {
      const next = this.seats.find((x) => x.kind === 'human') as Extract<Seat, { kind: 'human' }> | undefined;
      if (next) this.hostId = next.playerId;
    }
    if (!this.seats.some((x) => x.kind === 'human')) return this.closeEmpty();
    if (!this.hasPeople()) this.disconnectedOnly();
    this.schedule();
    this.broadcast();
    this.maybeStartNext();
  }

  /** Everyone still seated is disconnected: close the room if nobody is back within TIMING.emptyClose. */
  private disconnectedOnly() {
    this.deps.clearTimeout(this.emptyTimer);
    this.emptyTimer = this.deps.setTimeout(() => { if (!this.hasPeople()) this.closeEmpty(); }, TIMING.emptyClose);
  }

  private closeEmpty() {
    if (this.closed) return;
    this.close();
    this.onEmpty?.();
  }

  hasPeople(): boolean {
    return this.seats.some((s) => s.kind === 'human' && s.conn);
  }

  // ---------------------------------------------------------------------------------------------------
  // Messages from a person

  handle(playerId: string, msg: ClientMsg): string | null {
    const seat = this.seatOf(playerId);
    if (seat < 0) return 'You are not in this room.';
    const me = this.seats[seat] as Extract<Seat, { kind: 'human' }>;
    const host = playerId === this.hostId;
    const real = (relSeat: number) => (relSeat + seat) % 3;
    const settingUp = this.phase !== 'playing';
    switch (msg.t) {
      case 'name':
        me.name = cleanName(msg.name);
        break;
      case 'addBot': {
        if (!host || !settingUp) return 'Only the host can add bots, between rounds.';
        const at = real(msg.seat);
        if (this.seats[at].kind !== 'empty') return 'That seat is taken.';
        this.seats[at] = { kind: 'bot', level: msg.level, name: BOT_NAMES[msg.level] };
        break;
      }
      case 'removeBot': {
        const at = real(msg.seat);
        if (!host || !settingUp || this.seats[at].kind !== 'bot') return 'Only the host can remove a bot, between rounds.';
        if (this.phase !== 'lobby') return 'A bot can only be removed before the first round.';
        this.seats[at] = { kind: 'empty' };
        break;
      }
      case 'kick': {
        const at = real(msg.seat);
        const s = this.seats[at];
        if (!host || s.kind !== 'human' || at === seat) return 'Only the host can do that.';
        if (s.conn) return 'They are still connected.';
        this.seats[at] = this.phase === 'lobby' ? { kind: 'empty' } : { kind: 'bot', level: 'normal', name: `${s.name} (bot)` };
        this.maybeStartNext();
        break;
      }
      case 'stake':
        if (!host || !settingUp) return 'Only the host can change the stake, between rounds.';
        if (!Number.isInteger(msg.unitSen) || msg.unitSen < 1 || msg.unitSen > 100000) return 'That stake is not valid.';
        this.unitSen = msg.unitSen;
        break;
      case 'start':
        if (!host || this.phase !== 'lobby') return 'Only the host can start.';
        if (this.seats.some((s) => s.kind === 'empty')) return 'Fill every seat with a player or a bot first.';
        this.startRound();
        return null;
      case 'act':
        return this.act(seat, msg.action);
      case 'next':
        if (this.phase !== 'between') return null;
        me.ready = true;
        this.broadcast();
        this.maybeStartNext();
        return null;
      case 'chat': {
        const text = msg.text.replace(/\s+/g, ' ').trim().slice(0, 200);
        if (!text) return null;
        if (this.deps.now() - me.lastChat < 700) return 'Slow down a little.';
        me.lastChat = this.deps.now();
        const m: ChatMessage = { id: ++this.chatId, seat, name: me.name, text, at: this.deps.now() };
        this.chat = [...this.chat, m].slice(-60);
        this.forEachPerson((s, idx) => s.conn!.send({ t: 'chat', messages: [{ ...m, seat: rel(seat, idx) }] }));
        return null;
      }
      case 'emoji': {
        if (!EMOJIS.includes(msg.e)) return null;
        // Spam is the point, but not a flood: up to 6 a second each.
        const now = this.deps.now();
        me.emojiAt = me.emojiAt.filter((t) => now - t < 1000);
        if (me.emojiAt.length >= 6) return null;
        me.emojiAt.push(now);
        this.forEachPerson((s, idx) => s.conn!.send({ t: 'emoji', seat: rel(seat, idx), name: me.name, e: msg.e }));
        return null;
      }
      default:
        return null;
    }
    this.broadcast();
    return null;
  }

  // ---------------------------------------------------------------------------------------------------
  // The round

  private startRound() {
    this.roundId = Math.floor(this.deps.random() * 2 ** 31);
    const seed = Math.floor(this.deps.random() * 2 ** 32);
    this.game = newRound(seed, this.dealer, { ...DEFAULT_RULES, unitSen: this.unitSen });
    this.phase = 'playing';
    for (const s of this.seats) if (s.kind === 'human') s.ready = false;
    this.schedule();
    this.broadcast();
  }

  /** A move from the person in `seat`, given as they see the table (they are player 0). */
  private act(seat: number, action: Action): string | null {
    const g = this.game;
    if (!g || g.phase === 'ended' || this.phase !== 'playing') return 'There is no round in progress.';
    const real = { ...action, player: seat } as Action;
    if (!legalActions(g, seat).some((a) => sameAction(a, real))) return 'That move is not allowed right now.';
    this.apply(real);
    return null;
  }

  private apply(a: Action) {
    this.game = applyAction(this.game!, a);
    // Any move starts everyone's time again: a pong then a discard, or a kong then a discard, each get the full time.
    this.deadlines.clear();
    if (this.game.phase === 'ended') this.endRound();
    this.schedule();
    this.broadcast();
  }

  private endRound() {
    const r = this.game!.result!;
    this.tally = this.tally.map((x, p) => x + r.total[p]);
    this.rounds++;
    this.dealer = r.nextDealer;
    this.phase = 'between';
  }

  /** Next round once every person has pressed it and nobody is missing (the table waits for drop-outs). */
  private maybeStartNext() {
    if (this.phase !== 'between') return;
    const people = this.seats.filter((s): s is Extract<Seat, { kind: 'human' }> => s.kind === 'human');
    if (people.length && people.every((s) => s.ready && s.conn)) this.startRound();
  }

  /**
   * Who moves next and when. Bots (and people a bot is standing in for) move after a pause; every person who
   * is deciding has their own deadline, which starts again whenever anyone makes a move.
   */
  private schedule() {
    this.deps.clearTimeout(this.timer);
    this.timer = null;
    const g = this.game;
    if (!g || g.phase === 'ended' || this.phase !== 'playing' || !this.hasPeople()) {
      this.deadlines.clear();
      return;
    }
    const now = this.deps.now();
    const waiting = waitingFor(g);
    const isPerson = (p: number) => { const s = this.seats[p]; return s.kind === 'human' && !s.autoplay; };
    for (const p of [...this.deadlines.keys()]) if (!waiting.includes(p) || !isPerson(p)) this.deadlines.delete(p);
    const ms = g.phase === 'turn' ? TIMING.humanTurn : TIMING.humanClaim;
    for (const p of waiting) if (isPerson(p) && !this.deadlines.has(p)) this.deadlines.set(p, { at: now + ms, total: ms });

    const auto = waiting.find((p) => !isPerson(p));
    const botAt = auto === undefined ? Infinity : now + (g.phase === 'turn' ? TIMING.botTurn : TIMING.botClaim);
    const [person, due] = [...this.deadlines.entries()].sort((a, b) => a[1].at - b[1].at)[0] ?? [-1, { at: Infinity }];
    const at = Math.min(botAt, due.at);
    if (at === Infinity) return;
    this.timer = this.deps.setTimeout(() => {
      if (botAt <= due.at) return this.apply(this.botMove(auto!));
      // Out of time: on a claim, let it go; on a turn, the Normal bot discards for them.
      const pass = legalActions(this.game!, person).find((a) => a.type === 'pass');
      this.apply(this.game!.phase === 'turn' || !pass ? botAction(this.game!, person, 'normal') : pass);
    }, at - now);
  }

  private botMove(p: number): Action {
    const s = this.seats[p];
    const g = this.game!;
    if (s.kind === 'bot' && s.level === 'ai' && this.deps.model) return aiAction(g, p, this.deps.model);
    return botAction(g, p, s.kind === 'bot' && s.level === 'easy' ? 'easy' : 'normal');
  }

  // ---------------------------------------------------------------------------------------------------
  // Telling everyone

  private forEachPerson(fn: (s: Extract<Seat, { kind: 'human' }>, seat: number) => void) {
    this.seats.forEach((s, i) => { if (s.kind === 'human' && s.conn) fn(s, i); });
  }

  /** The room as `viewer` sees it. */
  view(viewer: number): RoomState {
    const g = this.game;
    const live = !g || this.phase !== 'playing' ? this.tally : this.tally.map((x, p) => x + g.kongMoney[p]);
    const seats: SeatInfo[] = this.seats.map((s): SeatInfo => {
      if (s.kind === 'empty') return { kind: 'empty', name: 'Empty seat' };
      if (s.kind === 'bot') return { kind: 'bot', name: s.name, level: s.level };
      return { kind: 'human', name: s.name, connected: !!s.conn, autoplay: s.autoplay, ready: s.ready, host: s.playerId === this.hostId };
    });
    const relArr = <T>(a: T[]) => [0, 1, 2].map((q) => a[(q + viewer) % 3]);
    const me = this.seats[viewer] as Extract<Seat, { kind: 'human' }>;
    return {
      code: this.code,
      phase: this.phase,
      seats: relArr(seats),
      youAreHost: me.playerId === this.hostId,
      unitSen: this.unitSen,
      tally: relArr(live),
      rounds: this.rounds,
      game: g && seatView(g, viewer, this.roundId),
      deadline: this.deadlines.get(viewer)?.at ?? null,
      // Timers: your own always; someone else's only on their turn (on a claim it would show they can claim).
      timers: relArr([0, 1, 2].map((q) => {
        const d = this.deadlines.get(q);
        return d && (q === viewer || (g!.phase === 'turn' && g!.turn === q)) ? d : null;
      })),
      now: this.deps.now(),
      seed: g && g.phase === 'ended' ? g.seed : null,
      waitingFor: this.phase === 'between'
        ? this.seats.flatMap((s) => (s.kind === 'human' && (!s.ready || !s.conn) ? [s.name + (s.conn ? '' : ' (disconnected)')] : []))
        : [],
    };
  }

  broadcast() {
    this.forEachPerson((s, i) => s.conn!.send({ t: 'state', room: this.view(i) }));
  }

  close() {
    this.closed = true;
    this.deps.clearTimeout(this.timer);
    this.deps.clearTimeout(this.emptyTimer);
    for (const t of this.dropTimers.values()) this.deps.clearTimeout(t);
  }
}

export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 20) || 'Player';
}
