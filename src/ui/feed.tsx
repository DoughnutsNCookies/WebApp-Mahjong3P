'use client';

// What just happened at the table: the caption under it, the call-outs on each player's box ("Pong!"),
// which tiles get the arrival animation, and the tile a round was won on. Everything is read from the
// round's own event log, so it works the same after a refresh or in a replay.

import { useState } from 'react';
import { GameEvent, GameState, isFlower, isSeason, Kind } from '../engine';
import { label, Tile } from './Tile';

export type What = 'discard' | 'fei' | 'pong' | 'chow' | 'kong' | 'bonus' | 'win' | 'selfWin';

export interface Happening {
  /** Index in game.events: a stable key for animations. */
  at: number;
  player: number;
  what: What;
  tile?: Kind;
  /** Whose discard was claimed or won on. */
  from?: number;
}

/** The tile on offer just before event `at`: the last discard, or a kong being declared (robbable). */
function tileOnOffer(events: GameEvent[], at: number): { tile: Kind; from: number } | null {
  for (let i = at - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.e !== 'action') continue;
    if (ev.action.type === 'discard') return { tile: ev.action.tile, from: ev.action.player };
    if (ev.action.type === 'kong') return { tile: ev.action.kind, from: ev.action.player };
  }
  return null;
}

function happeningAt(g: GameState, at: number): Happening | null {
  const ev = g.events[at];
  if (ev.e === 'bonus') return { at, player: ev.player, what: 'bonus', tile: ev.tile };
  if (ev.e === 'claim') {
    const a = ev.action;
    const what = a.type === 'pong' ? 'pong' : a.type === 'chow' ? 'chow' : 'kong';
    return { at, player: a.player, what, tile: tileOnOffer(g.events, at)?.tile, from: ev.from };
  }
  if (ev.e !== 'action') return null;
  const a = ev.action;
  switch (a.type) {
    case 'discard': return { at, player: a.player, what: 'discard', tile: a.tile };
    case 'discardJoker': return { at, player: a.player, what: 'fei' };
    case 'kong': return { at, player: a.player, what: 'kong', tile: a.kind };
    case 'selfWin': return { at, player: a.player, what: 'selfWin', tile: g.lastDrawn ?? undefined };
    case 'win': {
      const offer = tileOnOffer(g.events, at);
      return { at, player: a.player, what: 'win', tile: offer?.tile, from: offer?.from };
    }
    default: return null;
  }
}

/** Everything worth showing from event rom on, oldest first. */
export function happeningsSince(g: GameState, from: number): Happening[] {
  const out: Happening[] = [];
  for (let i = Math.max(0, from); i < g.events.length; i++) {
    const h = happeningAt(g, i);
    if (h) out.push(h);
  }
  return out;
}

/** The most recent thing worth showing, or null at the start of a round. */
export function latestHappening(g: GameState): Happening | null {
  for (let i = g.events.length - 1; i >= 0; i--) {
    const h = happeningAt(g, i);
    if (h) return h;
  }
  return null;
}

/** The tile the round was won on (self-drawn, or the discard or kong it was won off). */
export function winningTile(g: GameState): Kind | null {
  if (g.result?.type !== 'win') return null;
  const h = latestHappening(g);
  return h && (h.what === 'win' || h.what === 'selfWin') ? h.tile ?? null : null;
}

/** A tile in a player's discard row; `taken` when someone claimed it (it stays shown, greyed out). */
export interface RiverTile { tile: Kind; taken?: { by: number; how: 'pong' | 'chow' | 'kong' | 'win' } }

/**
 * Every player's discards in order, including the ones taken for a set or a win (the engine removes
 * those from the table, but everyone saw them thrown). Also which one is the newest still on the table.
 */
export function riversOf(g: GameState): { rivers: RiverTile[][]; newest: { player: number; index: number } | null } {
  const rivers: RiverTile[][] = [[], [], []];
  let last: { player: number; index: number } | null = null;
  // What a win would be on: the newest discard, or a kong being declared (robbing it takes no discard).
  let offer: 'discard' | 'kong' | null = null;
  for (const ev of g.events) {
    if (ev.e === 'claim' && last && last.player === ev.from) {
      const how = ev.action.type === 'pong' ? 'pong' : ev.action.type === 'chow' ? 'chow' : 'kong';
      rivers[ev.from][last.index].taken = { by: ev.action.player, how };
      last = null;
    }
    if (ev.e !== 'action') continue;
    const a = ev.action;
    if (a.type === 'discard') {
      rivers[a.player].push({ tile: a.tile });
      last = { player: a.player, index: rivers[a.player].length - 1 };
      offer = 'discard';
    } else if (a.type === 'kong') {
      offer = 'kong';
    } else if (a.type === 'win' && offer === 'discard' && last && g.result?.winner === a.player) {
      // A win is logged when chosen but only takes the tile once the claim window closes and the round ends.
      rivers[last.player][last.index].taken = { by: a.player, how: 'win' };
      last = null;
    }
  }
  return { rivers, newest: last };
}

/** One line describing what just happened, with the tile drawn small. */
export function Caption({ h, names }: { h: Happening | null; names: string[] }) {
  if (!h) return <span className="muted">New round.</span>;
  const who = names[h.player];
  const whose = (p?: number) => (p === undefined ? 'a' : p === 0 ? 'your' : `${names[p]}'s`);
  const tile = h.tile !== undefined ? <Tile kind={h.tile} /> : null;
  switch (h.what) {
    case 'discard': return <>{who} discarded {tile}</>;
    case 'fei': return <>{who} set a fei aside (+1 fan) and drew again</>;
    case 'pong':
    case 'chow': return <>{who} took {whose(h.from)} {tile} for a {h.what}</>;
    case 'kong': return h.from !== undefined
      ? <>{who} took {whose(h.from)} {tile} for a kong</>
      : <>{who} declared a kong of {tile}</>;
    case 'bonus': return <>{who} drew a bonus tile {tile} and drew again</>;
    case 'win': return <>{who} won on {whose(h.from)} {tile}</>;
    case 'selfWin': return <>{who} drew {tile} for the win</>;
  }
}

export type Tone = 'set' | 'bonus' | 'fei';
export interface Callout { id: number; player: number; text: string; tone: Tone }

function calloutFor(h: Happening): Omit<Callout, 'id'> | null {
  switch (h.what) {
    case 'pong': return { player: h.player, text: 'Pong!', tone: 'set' };
    case 'chow': return { player: h.player, text: 'Chow!', tone: 'set' };
    case 'kong': return { player: h.player, text: 'Kong!', tone: 'set' };
    case 'fei': return { player: h.player, text: 'Fei +1', tone: 'fei' };
    case 'bonus': {
      const t = h.tile!;
      return { player: h.player, text: isFlower(t) ? 'Flower' : isSeason(t) ? 'Season' : label(t), tone: 'bonus' };
    }
    default: return null; // discards are shown on the table; a win gets the seal
  }
}

/**
 * Call-outs for events that happen while you watch (not for what was already there on load), at most
 * one per player: the newest. Each fades out by its own CSS animation, so nothing needs removing until
 * that player's next call-out replaces it or a new round starts.
 */
export function useCallouts(g: GameState): Callout[] {
  const [track, setTrack] = useState({ g, count: g.events.length, callouts: [] as Callout[] });
  if (track.g !== g) {
    // Adjusting state while rendering (React's pattern for deriving from a changed prop).
    let callouts = track.callouts;
    let count = track.count;
    if (track.g.seed !== g.seed || g.events.length < count) {
      callouts = [];
      count = g.events.length;
    }
    for (let i = count; i < g.events.length; i++) {
      const h = happeningAt(g, i);
      const c = h && calloutFor(h);
      if (c) callouts = [...callouts.filter((x) => x.player !== c.player), { ...c, id: g.seed * 1000 + i }];
    }
    setTrack({ g, count: g.events.length, callouts });
  }
  return track.callouts;
}