// Messages between the game and the multiplayer server (JSON over a WebSocket). Seats in messages are
// relative to the receiver: 0 is always "you", 1 the next player, 2 the previous one, as on the table.

import type { Action, GameState } from '../engine/game';

export type BotKind = 'easy' | 'normal' | 'ai';

export interface SeatInfo {
  kind: 'empty' | 'human' | 'bot';
  name: string;
  /** Bots: their level. Humans: whether a bot is playing for them right now (they dropped out). */
  level?: BotKind;
  connected?: boolean;
  autoplay?: boolean;
  /** Between rounds: pressed "Next round". */
  ready?: boolean;
  host?: boolean;
}

export interface RoomState {
  code: string;
  phase: 'lobby' | 'playing' | 'between';
  /** Seats relative to you (index 0 is you). */
  seats: SeatInfo[];
  youAreHost: boolean;
  unitSen: number;
  /** Money per seat (relative), live: kong money as it happens, the round's result as soon as it ends. */
  tally: number[];
  rounds: number;
  /** The round as you may see it (you are player 0), or null in the lobby. */
  game: GameState | null;
  /** When the current decision of yours times out (ms since 1970), if you have one. */
  deadline: number | null;
  /** The round's real seed, once it has ended (for the review, replay and saved hand). */
  seed: number | null;
  /** Between rounds: who the table is waiting for (names). */
  waitingFor: string[];
}

export interface ChatMessage { id: number; seat: number; name: string; text: string; at: number }

export type ClientMsg =
  | { t: 'hello'; playerId: string; name: string }
  | { t: 'name'; name: string }
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'addBot'; seat: number; level: BotKind }
  | { t: 'removeBot'; seat: number }
  | { t: 'kick'; seat: number }
  | { t: 'stake'; unitSen: number }
  | { t: 'start' }
  | { t: 'act'; action: Action }
  | { t: 'next' }
  | { t: 'chat'; text: string }
  | { t: 'emoji'; e: string };

export type ServerMsg =
  | { t: 'welcome' }
  | { t: 'error'; message: string }
  | { t: 'state'; room: RoomState }
  | { t: 'chat'; messages: ChatMessage[] }
  | { t: 'emoji'; seat: number; name: string; e: string }
  | { t: 'left'; reason: string };

/** The reactions on offer (kept short so they fit one row on a phone). */
export const EMOJIS = ['😂', '👏', '🔥', '😭', '😱', '💸', '🙏', '😡'];
