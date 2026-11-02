'use client';

// The connection to the multiplayer server: says hello with your id and name, reconnects by itself when the
// line drops (the server puts you straight back in your room), and keeps the room, chat and emoji.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ClientMsg, RoomState, ServerMsg } from '../../server/protocol';

/** Whether the game's own server runs the rooms: shows Play with friends on the menu. */
export const MULTIPLAYER_LIVE = true;

/** The rooms are on the same server as the game. For testing, ?server=ws://localhost:3300/ws overrides it. */
const LIVE_SERVER = typeof location === 'undefined' ? '' : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

export function serverUrl(): string {
  try {
    const q = new URLSearchParams(location.search).get('server');
    if (q) sessionStorage.setItem('mj3p.server', q);
    return sessionStorage.getItem('mj3p.server') ?? LIVE_SERVER;
  } catch {
    return LIVE_SERVER;
  }
}

/** Your id for the server (kept in this browser), so a refresh or a dropped line gets your seat back. */
function playerId(): string {
  const key = 'mj3p.v1.playerId';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export interface FlyingEmoji { id: number; seat: number; name: string; e: string }

export function useRoom(name: string) {
  const [status, setStatus] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [room, setRoom] = useState<RoomState | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [emojis, setEmojis] = useState<FlyingEmoji[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const nameRef = useRef(name);
  const emojiId = useRef(0);

  useEffect(() => {
    nameRef.current = name;
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ t: 'name', name }));
  }, [name]);

  useEffect(() => {
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      const sock = new WebSocket(serverUrl());
      ws.current = sock;
      sock.onopen = () => {
        retry = 0;
        sock.send(JSON.stringify({ t: 'hello', playerId: playerId(), name: nameRef.current }));
      };
      sock.onmessage = (ev) => {
        const m = JSON.parse(String(ev.data)) as ServerMsg;
        if (m.t === 'welcome') setStatus('online');
        else if (m.t === 'state') { setRoom(m.room); setLeft(null); }
        else if (m.t === 'chat') setChat((c) => [...c.filter((x) => !m.messages.some((y) => y.id === x.id)), ...m.messages].slice(-60));
        else if (m.t === 'emoji') {
          const id = ++emojiId.current;
          setEmojis((es) => [...es.slice(-40), { id, seat: m.seat, name: m.name, e: m.e }]);
          setTimeout(() => setEmojis((es) => es.filter((x) => x.id !== id)), 2600);
        } else if (m.t === 'error') {
          setError(m.message);
          setTimeout(() => setError((e) => (e === m.message ? null : e)), 4000);
        } else if (m.t === 'left') { setRoom(null); setChat([]); setLeft(m.reason); }
      };
      sock.onclose = () => {
        if (stopped) return;
        setStatus('offline');
        // Try again, a little slower each time (up to 10 s).
        timer = setTimeout(connect, Math.min(10_000, 1000 * 2 ** retry++));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws.current?.close();
    };
  }, []);

  const send = useCallback((msg: ClientMsg) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
    else setError('Not connected to the server right now. Reconnecting…');
  }, []);

  return { status, room, chat, emojis, error, left, send };
}
