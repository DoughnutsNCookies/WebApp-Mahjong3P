// Everything is kept in the browser's localStorage: settings, the running tally, the round in progress
// (as seed + actions, so it resumes exactly after a refresh) and the saved hand logs.

import type { BotLevel } from '../bots';
import type { Action } from '../engine';

export type Speed = 'slow' | 'normal' | 'fast';

/** Who sits in a bot seat: a rule-based bot, or the trained AI (src/ai/web.ts). */
export type Opponent = BotLevel | 'ai';

export interface Settings {
  /** Stake per fan in sen (RM0.20 = 20). */
  unitSen: number;
  /** Levels of the two bots (players 1 and 2). */
  levels: [Opponent, Opponent];
  speed: Speed;
}

export const DEFAULT_SETTINGS: Settings = { unitSen: 20, levels: ['normal', 'normal'], speed: 'normal' };

export interface MatchState {
  /** Net sen per player since the tally was last reset. Player 0 is you. */
  tally: number[];
  rounds: number;
  dealer: number;
}

export const NEW_MATCH: MatchState = { tally: [0, 0, 0], rounds: 0, dealer: 0 };

export interface CurrentRound {
  seed: number;
  dealer: number;
  unitSen: number;
  actions: Action[];
}

export interface SavedRound {
  id: string;
  date: string;
  seed: number;
  dealer: number;
  unitSen: number;
  levels: [Opponent, Opponent];
  actions: Action[];
  /** Short summary for the list. */
  summary: { type: 'win' | 'draw'; winner?: number; fan?: number; myTotal: number };
}

const KEYS = { settings: 'mj3p.v1.settings', match: 'mj3p.v1.match', current: 'mj3p.v1.current', logs: 'mj3p.v1.logs' };
const MAX_LOGS = 300;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked (private browsing): the game still works, it just won't be saved.
  }
}

export const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(KEYS.settings, {}) });
export const saveSettings = (s: Settings) => write(KEYS.settings, s);
export const loadMatch = () => read<MatchState>(KEYS.match, NEW_MATCH);
export const saveMatch = (m: MatchState) => write(KEYS.match, m);
export const loadCurrent = () => read<CurrentRound | null>(KEYS.current, null);
export const saveCurrent = (c: CurrentRound | null) => write(KEYS.current, c);
export const loadLogs = () => read<SavedRound[]>(KEYS.logs, []);

export function addLog(r: SavedRound) {
  const logs = loadLogs();
  logs.unshift(r);
  write(KEYS.logs, logs.slice(0, MAX_LOGS));
}

export function deleteLog(id: string) {
  write(KEYS.logs, loadLogs().filter((l) => l.id !== id));
}

/** Downloads every saved hand as one JSON file (for keeping, or for checking bot findings later). */
export function exportLogs() {
  const blob = new Blob([JSON.stringify(loadLogs(), null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mahjong-hands-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}
