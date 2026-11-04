// The game's server: serves the game itself (the static export) and runs the private rooms over WebSockets at
// /ws, so everything lives on one domain. Runs as a CloudPanel Node.js site (see docs/MULTIPLAYER.md), bundled
// into one file by `npm run build:server`.
//
//   PORT          where to listen (CloudPanel's app port), default 3500 (3200/3201, 3300 and 3400 are the other apps on the VM)
//   STATIC_DIR    the game's files (the `out/` folder of `npm run build`), default ./site
//   ALLOWED_ORIGINS  comma-separated page origins allowed to connect (default: the live game and localhost)
//   AI_MODEL      path to the trained AI's weights (public/ai/<file>); without it AI bots play as Normal
//
// Rooms live in memory and all go on a restart. A room closes as soon as its last person leaves, or five minutes
// after the last connection drops (play stops meanwhile, so bots never play on alone).

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { parseModel, WEB_MODEL, WebModel } from '../ai/web';
import { ClientMsg, ServerMsg } from './protocol';
import { cleanName, Conn, Deps, Room } from './room';
import { serveStatic } from './static';

const PORT = Number(process.env.PORT ?? 3500);
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'https://mahjong.schuahsolutions.com,http://localhost:3000').split(',').map((s) => s.trim());
const IDLE_MS = 60 * 60 * 1000;
const MAX_ROOMS = 500;
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? 'site');

function loadModel(): WebModel | null {
  const path = process.env.AI_MODEL ?? `public/ai/${WEB_MODEL.file}`;
  try {
    const b = readFileSync(path);
    return parseModel(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  } catch (e) {
    console.warn(`AI weights not loaded (${(e as Error).message}); AI bots will play as Normal.`);
    return null;
  }
}

const deps: Deps = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
  random: Math.random,
  model: loadModel(),
};

const rooms = new Map<string, Room>();
/** Which room each person is in (one at a time). */
const roomOf = new Map<string, string>();
/** People whose room closed while they were away, told why when they come back. */
const closedFor = new Map<string, string>();

function forget(code: string, reason: string) {
  rooms.get(code)?.close();
  rooms.delete(code);
  for (const [p, c] of roomOf) {
    if (c !== code) continue;
    roomOf.delete(p);
    closedFor.set(p, reason);
  }
  while (closedFor.size > 5000) closedFor.delete(closedFor.keys().next().value!);
}

function addRoom(code: string, hostId: string): Room {
  const r = new Room(code, hostId, deps);
  r.onEmpty = () => forget(code, `Room ${code} closed: everyone had left.`);
  rooms.set(code, r);
  return r;
}

function newCode(): string | null {
  for (let i = 0; i < 200; i++) {
    const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    if (!rooms.has(code)) return code;
  }
  return null;
}

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`ok, ${rooms.size} room${rooms.size === 1 ? '' : 's'}, AI ${deps.model ? 'loaded' : 'off'}\n`);
    return;
  }
  if (!serveStatic(STATIC_DIR, req, res)) res.writeHead(req.method === 'GET' || req.method === 'HEAD' ? 404 : 405).end();
});

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws: WebSocket, req) => {
  const origin = req.headers.origin ?? '';
  if (!ORIGINS.includes(origin)) {
    ws.close(1008, 'origin not allowed');
    return;
  }
  let playerId: string | null = null;
  let name = 'Player';
  const conn: Conn = { send: (m: ServerMsg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); } };
  const error = (message: string) => conn.send({ t: 'error', message });
  const room = () => (playerId ? rooms.get(roomOf.get(playerId) ?? '') : undefined);

  // Keep-alive: phones drop idle sockets silently; a ping every 25 s keeps the line open and finds dead ones.
  let alive = true;
  ws.on('pong', () => { alive = true; });
  const ping = setInterval(() => {
    if (!alive) { ws.terminate(); return; }
    alive = false;
    ws.ping();
  }, 25_000);

  ws.on('message', (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.t === 'hello') {
      if (typeof msg.playerId !== 'string' || !/^[\w-]{8,64}$/.test(msg.playerId)) return error('Bad hello.');
      playerId = msg.playerId;
      name = cleanName(String(msg.name ?? ''));
      conn.send({ t: 'welcome' });
      // Back after a drop or a refresh: straight back into your room.
      const r = room();
      if (r) r.join(playerId, name, conn);
      else if (closedFor.has(playerId)) conn.send({ t: 'left', reason: closedFor.get(playerId)! });
      closedFor.delete(playerId);
      return;
    }
    if (!playerId) return error('Say hello first.');
    switch (msg.t) {
      case 'create': {
        room()?.leave(playerId);
        if (rooms.size >= MAX_ROOMS) return error('The server is full right now. Try again later.');
        const code = newCode();
        if (!code) return error('No free room codes right now. Try again.');
        const r = addRoom(code, playerId);
        roomOf.set(playerId, code);
        r.join(playerId, name, conn);
        return;
      }
      case 'join': {
        const code = String(msg.code ?? '').trim();
        const r = rooms.get(code);
        if (!r) return error(`There is no room ${code}. Check the code with the host.`);
        if (roomOf.get(playerId) !== code) room()?.leave(playerId);
        const problem = r.join(playerId, name, conn);
        if (problem) return error(problem);
        roomOf.set(playerId, code);
        return;
      }
      case 'leave': {
        const r = room();
        roomOf.delete(playerId);
        r?.leave(playerId);
        return;
      }
      case 'name':
        name = cleanName(String(msg.name ?? ''));
        break;
    }
    const r = room();
    if (!r) return msg.t === 'name' ? undefined : error('You are not in a room.');
    const problem = r.handle(playerId, msg);
    if (problem) error(problem);
  });

  ws.on('close', () => {
    clearInterval(ping);
    if (playerId) room()?.disconnect(playerId);
  });
});

// A safety net: rooms normally close themselves (onEmpty); this catches one that somehow didn't.
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (r.hasPeople()) { r.lastActive = now; continue; }
    if (now - r.lastActive > IDLE_MS) forget(code, `Room ${code} closed: nobody was there.`);
  }
}, 60_000);

http.listen(PORT, () => console.log(`3P Mahjong on port ${PORT}: game from ${STATIC_DIR}, rooms at /ws; origins ${ORIGINS.join(', ')}; AI ${deps.model ? 'loaded' : 'off'}`));
