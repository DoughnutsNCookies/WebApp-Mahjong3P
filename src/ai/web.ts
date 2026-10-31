// The trained AI as a player in the game. It runs in the browser (or Node): the player half of the
// network is a small file of weights (public/ai/, written by training/export_web.py), and choosing a move
// is three layers of multiply-and-add over the same inputs the AI saw in training. No server needed.

import type { Action, GameState } from '../engine/game';
import { playerView } from '../engine/view';
import { ACTIONS, encodeHints, encodeOpponents, encodeView, HINTS, OBS as VIEW, slotActions } from './encode';
import info from './web-model.json';

export const WEB_MODEL = info;

interface Layer { w: Float32Array; b: Float32Array; inp: number; out: number }
export interface WebModel { layers: Layer[]; obs: number; hints: boolean; opp: boolean; name: string }

/** Half-precision (16-bit) float to a normal number. */
function half(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}

export function parseModel(buf: ArrayBuffer): WebModel {
  const raw = new DataView(buf);
  let at = 0;
  const take = (n: number) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++, at += 2) out[i] = half(raw.getUint16(at, true));
    return out;
  };
  const layers = info.layers.map(([inp, out]) => ({ inp, out, w: take(inp * out), b: take(out) }));
  if (at !== buf.byteLength) throw new Error(`AI file is ${buf.byteLength} bytes, expected ${at}`);
  return { layers, obs: info.obs, hints: info.hints, opp: info.opp, name: info.name };
}

/** Fetches the AI's weights (about 1.5 MB, cached by the browser; the file name changes with the model). */
export async function loadWebModel(): Promise<WebModel> {
  const res = await fetch(`/ai/${info.file}`);
  if (!res.ok) throw new Error(`Couldn't load the AI (${res.status})`);
  return parseModel(await res.arrayBuffer());
}

/** Move scores for one observation. */
export function forward(m: WebModel, x: Float32Array): Float32Array {
  let v = x;
  m.layers.forEach((l, li) => {
    const out = new Float32Array(l.out);
    for (let o = 0; o < l.out; o++) {
      let sum = l.b[o];
      const row = o * l.inp;
      for (let i = 0; i < l.inp; i++) sum += l.w[row + i] * v[i];
      out[o] = li < m.layers.length - 1 && sum < 0 ? 0 : sum; // ReLU between layers, none on the last
    }
    v = out;
  });
  return v;
}

/** The legal move with the highest score (the AI plays its best move, as in the benchmarks). */
export function bestSlot(scores: Float32Array, legal: ArrayLike<unknown>): number {
  let best = -1;
  for (let a = 0; a < ACTIONS; a++) if (legal[a] && (best < 0 || scores[a] > scores[best])) best = a;
  return best;
}

/** Every legal move for `player` with the AI's score for it, from that player's own view only. */
export function scoreMoves(s: GameState, player: number, m: WebModel): { slots: (Action | null)[]; scores: Float32Array } {
  const view = playerView(s, player, { copy: false });
  const x = new Float32Array(m.obs);
  encodeView(view, x, 0);
  if (m.hints) encodeHints(view, x, VIEW);
  if (m.opp) encodeOpponents(view, x, VIEW + HINTS);
  return { slots: slotActions(view.legal, view.claimTile), scores: forward(m, x) };
}

/** The AI's move for `player`, from that player's own view only. */
export function aiAction(s: GameState, player: number, m: WebModel): Action {
  const { slots, scores } = scoreMoves(s, player, m);
  return slots[bestSlot(scores, slots)]!;
}
