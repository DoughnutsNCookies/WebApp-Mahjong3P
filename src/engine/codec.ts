// A compact text form of a round, so a hand can be pasted into a chat and rebuilt exactly.
//
//   MJ3P1|seed=123|dealer=0|unit=20|0d5d 1- 2p0 2dE 0K c5d0 ...
//
// One token per action, starting with the player (0-2):
//   d<tile> discard          j  set a joker aside      H  self-drawn win     h  win on a discard / rob
//   -  pass                  p<n> pong using n jokers   k<n> kong a discard using n jokers
//   Kc<tile><n> / Ka<tile><n> concealed / added kong using n jokers
//   c<tile>[:<tile>,...]     chow starting at <tile>, with jokers standing in for the listed tiles
//   O  Joker Opening Slam
// Tiles use the short codes from tiles.ts (5d, E, Rd, J ...).

import type { Action } from './game';
import { code, parse } from './tiles';

const PREFIX = 'MJ3P1';

function tile(text: string): number {
  const ks = parse(text);
  if (ks.length !== 1) throw new Error(`Expected one tile, got "${text}"`);
  return ks[0];
}

export function encodeAction(a: Action): string {
  const p = String(a.player);
  switch (a.type) {
    case 'discard': return `${p}d${code(a.tile)}`;
    case 'discardJoker': return `${p}j`;
    case 'selfWin': return `${p}H`;
    case 'win': return `${p}h`;
    case 'pass': return `${p}-`;
    case 'pong': return `${p}p${a.jokers}`;
    case 'claimKong': return `${p}k${a.jokers}`;
    case 'kong': return `${p}K${a.kongType === 'concealed' ? 'c' : 'a'}${code(a.kind)}${a.jokers}`;
    case 'chow': return `${p}c${code(a.start)}${a.jokerKinds.length ? ':' + a.jokerKinds.map(code).join(',') : ''}`;
    case 'openingSlam': return `${p}O`;
  }
}

export function decodeAction(tok: string): Action {
  const m = /^([0-2])(.)(.*)$/.exec(tok);
  if (!m) throw new Error(`Bad action "${tok}"`);
  const player = Number(m[1]);
  const [, , t, rest] = m;
  switch (t) {
    case 'd': return { type: 'discard', player, tile: tile(rest) };
    case 'j': return { type: 'discardJoker', player };
    case 'H': return { type: 'selfWin', player };
    case 'h': return { type: 'win', player };
    case '-': return { type: 'pass', player };
    case 'p': return { type: 'pong', player, jokers: Number(rest) };
    case 'k': return { type: 'claimKong', player, jokers: Number(rest) };
    case 'K': {
      const k = /^([ca])(.+?)(\d)$/.exec(rest);
      if (!k) throw new Error(`Bad kong "${tok}"`);
      return { type: 'kong', player, kind: tile(k[2]), kongType: k[1] === 'c' ? 'concealed' : 'added', jokers: Number(k[3]) };
    }
    case 'c': {
      const [start, jokers] = rest.split(':');
      return { type: 'chow', player, start: tile(start), jokerKinds: jokers ? jokers.split(',').map(tile) : [] };
    }
    case 'O': return { type: 'openingSlam', player };
  }
  throw new Error(`Unknown action "${tok}"`);
}

export interface EncodedRound {
  seed: number;
  dealer: number;
  unitSen: number;
  actions: Action[];
}

export function encodeRound(r: EncodedRound): string {
  return `${PREFIX}|seed=${r.seed}|dealer=${r.dealer}|unit=${r.unitSen}|${r.actions.map(encodeAction).join(' ')}`;
}

/** Finds and decodes a round code anywhere in a block of text (e.g. a pasted export). */
export function decodeRound(text: string): EncodedRound {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith(PREFIX + '|'));
  if (!line) throw new Error(`No ${PREFIX} code found`);
  const [, ...parts] = line.split('|');
  const fields: Record<string, string> = {};
  let actions = '';
  for (const part of parts) {
    const eq = /^(\w+)=(.*)$/.exec(part);
    if (eq && !part.includes(' ')) fields[eq[1]] = eq[2];
    else actions = part;
  }
  return {
    seed: Number(fields.seed),
    dealer: Number(fields.dealer),
    unitSen: Number(fields.unit),
    actions: actions.trim() ? actions.trim().split(/\s+/).map(decodeAction) : [],
  };
}
