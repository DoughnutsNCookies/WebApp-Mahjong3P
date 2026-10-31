// Game server for training and evaluating a learning AI. Runs many rounds at once and talks to the
// Python trainer over stdin/stdout in small binary frames. The rules are the engine's: nothing is
// reimplemented on the Python side.
//
// Usage: npx tsx src/ai/server.ts '<json config>'
//   { "envs": 64, "seats": ["ai","ai","ai"], "seed": 1 }                       self-play
//   { "envs": 64, "seats": ["ai","normal","normal"], "seed": 1 }               AI against bots (seats rotate)
//   { "envs": 64, "seats": ["ai","normal","normal"], "evalDeals": 500, "seed": 7 }   duplicate evaluation
//
// Frames (little-endian), each preceded by its length in bytes as a Uint32:
//   server -> trainer: Int32 nDecisions, Int32 nDone, Int32 OBS, Int32 ACTIONS, Int32 PRIV,
//                      Int32 [envId, player] x nDecisions, Float32 obs x nDecisions*OBS,
//                      Float32 privileged x nDecisions*PRIV (hidden info, for the training coach only),
//                      Uint8 mask x nDecisions*ACTIONS, Float32 [envId, deal, aiSeat, r0, r1, r2] x nDone
//   trainer -> server: Int32 n, Int32 actionSlot x n   (one per decision, in the order received)
// A frame with nDecisions = 0 and no running games means evaluation is finished.
// Rewards are each player's money for the round in units of a 10-fan hand value (V at 10 fan).

import { appendFileSync, readFileSync } from 'node:fs';
import { botAction, BotLevel } from '../bots';
import { aiAction, parseModel, WEB_MODEL, WebModel } from './web';
import {
  applyActionInPlace, DEFAULT_RULES, GameState, handValue, makeRng, newRound, playerView, PlayerView, waitingFor,
} from '../engine';
import {
  ACTIONS, encodeHints, encodeOpponents, encodePrivileged, encodeView, encodeWall, HINTS, OBS as VIEW, OPP, PRIV as PRIV_BASE, PRIV_WALL,
  slotActions,
} from './encode';

// 'ai' is the learner (the trainer decides); 'frozen' is the trained AI shipped in the game (public/ai/),
// fixed, as a strong opponent or yardstick; the rest are the rule-based bots.
type Seat = 'ai' | 'frozen' | BotLevel;
interface Config { envs: number; seats: Seat[]; seed: number; evalDeals?: number; hints?: boolean; opp?: boolean; wall?: boolean; statsFile?: string }

const cfg: Config = { envs: 64, seats: ['ai', 'ai', 'ai'], seed: 1, hints: true, opp: false, ...JSON.parse(process.argv[2] ?? '{}') };
// v1 models see the view only (369 numbers, hints: false); v2 adds the analyzer's hints (431);
// v3 adds the opponent reading after them (563, opp: true).
if (cfg.opp && !cfg.hints) throw new Error('opp needs hints (the opponent block comes after the hints)');
const OBS = VIEW + (cfg.hints ? HINTS : 0) + (cfg.opp ? OPP : 0);
// wall: the coach also sees the whole wall (encodeWall), after the usual hidden block. Never the player.
const PRIV = PRIV_BASE + (cfg.wall ? PRIV_WALL : 0);
const rng = makeRng(cfg.seed);
const scale = handValue(10, DEFAULT_RULES);

interface Env { id: number; game: GameState | null; seats: Seat[]; deal: number; aiSeat: number }

// Evaluation: each deal is played with the AI in each of the three seats (bots in the other two).
const jobs: { deal: number; aiSeat: number }[] = [];
if (cfg.evalDeals) {
  for (let d = 0; d < cfg.evalDeals; d++) for (let s = 0; s < 3; s++) jobs.push({ deal: d, aiSeat: s });
}
const botLevel = cfg.seats.find((s) => s !== 'ai') ?? 'normal';
let frozen: WebModel | null = null;
if (cfg.seats.includes('frozen')) {
  const w = readFileSync(`public/ai/${WEB_MODEL.file}`);
  frozen = parseModel(w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength));
}

let rounds = 0;
function startRound(env: Env): boolean {
  if (cfg.evalDeals) {
    const job = jobs.shift();
    if (!job) { env.game = null; return false; }
    env.deal = job.deal;
    env.aiSeat = job.aiSeat;
    env.seats = [0, 1, 2].map((p) => (p === job.aiSeat ? 'ai' : botLevel)) as Seat[];
    env.game = newRound(cfg.seed * 100000 + job.deal, 0);
  } else {
    // Rotate the configured seats so every seat type plays every position over time.
    const shift = rounds % 3;
    env.seats = [0, 1, 2].map((p) => cfg.seats[(p + shift) % 3]);
    env.aiSeat = env.seats.indexOf('ai');
    env.deal = rounds;
    env.game = newRound(Math.floor(rng() * 2 ** 31), Math.floor(rng() * 3));
  }
  rounds++;
  return true;
}

const envs: Env[] = [...Array(cfg.envs)].map((_, id) => ({ id, game: null, seats: cfg.seats, deal: 0, aiSeat: 0 }));
envs.forEach(startRound);

// Pending AI decisions from the last frame, in order.
let pending: { env: Env; player: number; view: PlayerView; slots: ReturnType<typeof slotActions> }[] = [];
const done: number[] = [];

/** Plays bot moves until an AI player must decide (or the round ends, then starts the next one). */
function advance(env: Env) {
  while (env.game) {
    const g = env.game;
    if (g.phase === 'ended') {
      const t = g.result!.total;
      // Optional per-round details for measurements (off unless statsFile is given; training never sets it).
      if (cfg.statsFile) {
        const r = g.result!;
        appendFileSync(cfg.statsFile, JSON.stringify({ deal: env.deal, aiSeat: env.aiSeat, type: r.type, winner: r.winner ?? null,
          payer: r.payer ?? null, payment: r.payment ?? null, fan: r.score?.fan ?? null, total: r.total }) + '\n');
      }
      done.push(env.id, env.deal, env.aiSeat, t[0] / scale, t[1] / scale, t[2] / scale);
      if (!startRound(env)) return;
      continue;
    }
    const waiting = waitingFor(g);
    const bot = waiting.find((p) => env.seats[p] !== 'ai');
    if (bot !== undefined) {
      const seat = env.seats[bot];
      applyActionInPlace(g, seat === 'frozen' ? aiAction(g, bot, frozen!) : botAction(g, bot, seat as BotLevel));
      continue;
    }
    // Views are built once, without a copy, and encoded before any further move is made.
    for (const p of waiting) {
      const view = playerView(g, p, { copy: false });
      pending.push({ env, player: p, view, slots: slotActions(view.legal, view.claimTile) });
    }
    return;
  }
}

function sendFrame() {
  const n = pending.length;
  const nDone = done.length / 6;
  const bytes = 20 + n * 8 + n * OBS * 4 + n * PRIV * 4 + n * ACTIONS + nDone * 6 * 4;
  const buf = Buffer.alloc(4 + bytes);
  buf.writeUInt32LE(bytes, 0);
  buf.writeInt32LE(n, 4);
  buf.writeInt32LE(nDone, 8);
  buf.writeInt32LE(OBS, 12);
  buf.writeInt32LE(ACTIONS, 16);
  buf.writeInt32LE(PRIV, 20);
  let o = 24;
  for (const d of pending) { buf.writeInt32LE(d.env.id, o); buf.writeInt32LE(d.player, o + 4); o += 8; }
  const obs = new Float32Array(n * OBS);
  pending.forEach((d, i) => {
    encodeView(d.view, obs, i * OBS);
    if (cfg.hints) encodeHints(d.view, obs, i * OBS + VIEW);
    if (cfg.opp) encodeOpponents(d.view, obs, i * OBS + VIEW + HINTS);
  });
  Buffer.from(obs.buffer).copy(buf, o);
  o += obs.byteLength;
  const priv = new Float32Array(n * PRIV);
  pending.forEach((d, i) => {
    encodePrivileged(d.env.game!, d.player, priv, i * PRIV);
    if (cfg.wall) encodeWall(d.env.game!, d.player, priv, i * PRIV + PRIV_BASE);
  });
  Buffer.from(priv.buffer).copy(buf, o);
  o += priv.byteLength;
  for (const d of pending) { for (let a = 0; a < ACTIONS; a++) buf[o + a] = d.slots[a] ? 1 : 0; o += ACTIONS; }
  const fin = new Float32Array(done);
  Buffer.from(fin.buffer).copy(buf, o);
  done.length = 0;
  process.stdout.write(buf);
}

function onActions(slots: Int32Array) {
  if (slots.length !== pending.length) throw new Error(`Expected ${pending.length} actions, got ${slots.length}`);
  const touched = new Set<Env>();
  pending.forEach((d, i) => {
    const a = d.slots[slots[i]];
    if (!a) throw new Error(`Illegal slot ${slots[i]} for env ${d.env.id} player ${d.player}`);
    applyActionInPlace(d.env.game!, a);
    touched.add(d.env);
  });
  pending = [];
  // An env may still be waiting on another AI player in the same claim window: advance() re-asks it.
  for (const env of touched) advance(env);
  sendFrame();
}

// Read length-prefixed frames from stdin.
let inbox = Buffer.alloc(0);
process.stdin.on('data', (chunk: Buffer) => {
  inbox = Buffer.concat([inbox, chunk]);
  while (inbox.length >= 4) {
    const len = inbox.readUInt32LE(0);
    if (inbox.length < 4 + len) break;
    const frame = inbox.subarray(4, 4 + len);
    inbox = inbox.subarray(4 + len);
    const n = frame.readInt32LE(0);
    const slots = new Int32Array(n);
    for (let i = 0; i < n; i++) slots[i] = frame.readInt32LE(4 + i * 4);
    onActions(slots);
  }
});
process.stdin.on('end', () => process.exit(0));

for (const env of envs) advance(env);
sendFrame();
