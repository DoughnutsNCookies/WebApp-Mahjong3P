'use client';

// Play with friends: private rooms on the multiplayer server. Create a room (you get a 4-digit code and a
// link to share) or join one; the host fills empty seats with bots and starts. The table is the same game
// screen as Quick play: the server sends your view of the round with you as player 0. Chat and emoji on top.

import { useEffect, useMemo, useRef, useState } from 'react';
import { addLog, Settings } from '../storage';
import type { BotKind, RoomState } from '../../server/protocol';
import { EMOJIS } from '../../server/protocol';
import { Game } from '../Game';
import { rmShort } from '../format';
import { Review } from '../Review';
import { useRoom } from './useRoom';

const BOT_LEVELS: { value: BotKind; text: string }[] = [
  { value: 'ai', text: 'AI v2' },
  { value: 'normal', text: 'Normal bot' },
  { value: 'easy', text: 'Easy bot' },
];
const SEAT_WHERE = ['You', 'On your right (plays after you)', 'On your left (plays before you)'];

/** The room code from a shared link (?room=1234), if any. */
export function roomFromLink(): string | null {
  try {
    const code = new URLSearchParams(location.search).get('room');
    return code && /^\d{4}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

export function Online({ settings, onSettings, onClose }: { settings: Settings; onSettings: (s: Settings) => void; onClose: () => void }) {
  const name = settings.name.trim();
  const { status, room, chat, emojis, error, left, send } = useRoom(name || 'Player');
  const [code, setCode] = useState(() => roomFromLink() ?? '');
  const [nameDraft, setNameDraft] = useState(settings.name);
  const autoJoined = useRef(false);

  // Opened from a shared link: join as soon as we're connected (once a name is set).
  useEffect(() => {
    const link = roomFromLink();
    if (status !== 'online' || !link || !name || autoJoined.current || room) return;
    autoJoined.current = true;
    send({ t: 'join', code: link });
    history.replaceState(null, '', location.pathname); // the link has done its job
  }, [status, name, room, send]);

  const saveName = () => {
    const n = nameDraft.replace(/\s+/g, ' ').trim().slice(0, 20);
    if (n) onSettings({ ...settings, name: n });
  };

  if (!name) {
    return (
      <div className="online panel">
        <h2>Play with friends</h2>
        <p>First, the name other players will see.</p>
        <div className="online-row">
          <input aria-label="Your name" maxLength={20} placeholder="Your name" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveName()} />
          <button type="button" className="btn primary" onClick={saveName} disabled={!nameDraft.trim()}>Save</button>
        </div>
        <p className="muted">You can change it later in Settings.</p>
      </div>
    );
  }

  const conn = status === 'online' ? null : <p className="online-status">{status === 'connecting' ? 'Connecting to the server…' : 'Connection lost. Reconnecting…'}</p>;
  const toast = error ? <p className="online-error" role="alert">{error}</p> : null;

  if (!room) {
    return (
      <div className="online panel">
        <div className="panel-head"><h2>Play with friends</h2><button type="button" className="btn small" onClick={onClose}>Back</button></div>
        {conn}{toast}
        {left && <p className="muted">{left}</p>}
        <p>Playing as <strong>{name}</strong>.</p>
        <div className="online-choices">
          <section>
            <h3>Start a room</h3>
            <p className="muted">You get a 4-digit code and a link to share. Fill empty seats with bots.</p>
            <button type="button" className="btn primary cta" disabled={status !== 'online'} onClick={() => send({ t: 'create' })}>Create a room</button>
          </section>
          <section>
            <h3>Join a room</h3>
            <p className="muted">Enter the code the host gives you.</p>
            <div className="online-row">
              <input aria-label="Room code" inputMode="numeric" pattern="[0-9]*" maxLength={4} placeholder="1234" className="code-input"
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                onKeyDown={(e) => e.key === 'Enter' && code.length === 4 && send({ t: 'join', code })} />
              <button type="button" className="btn primary" disabled={status !== 'online' || code.length !== 4} onClick={() => send({ t: 'join', code })}>Join</button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="online-room">
      {conn}{toast}
      {room.phase === 'lobby' ? <Lobby room={room} send={send} /> : <Table room={room} settings={settings} send={send} />}
      <Social room={room} chat={chat} send={send} />
      <EmojiLayer emojis={emojis} />
    </div>
  );
}

type Send = ReturnType<typeof useRoom>['send'];

function shareLink(code: string) {
  const url = `${location.origin}/?room=${code}`;
  const text = `Join my 3P Mahjong table: room ${code}`;
  if (navigator.share) navigator.share({ title: '3P Mahjong', text, url }).catch(() => {});
  else navigator.clipboard?.writeText(`${text} ${url}`).catch(() => {});
}

function Lobby({ room, send }: { room: RoomState; send: Send }) {
  const [level, setLevel] = useState<BotKind>('ai');
  const [stake, setStake] = useState((room.unitSen / 100).toFixed(2));
  const full = room.seats.every((s) => s.kind !== 'empty');
  return (
    <div className="online panel">
      <div className="panel-head">
        <h2>Room <span className="room-code">{room.code}</span></h2>
        <button type="button" className="btn small" onClick={() => send({ t: 'leave' })}>Leave</button>
      </div>
      <div className="online-row">
        <button type="button" className="btn primary" onClick={() => shareLink(room.code)}>Share the link</button>
        <span className="muted">or tell them the code <strong>{room.code}</strong></span>
      </div>
      <ol className="seat-list">
        {room.seats.map((s, i) => (
          <li key={i} className={`seat-row ${s.kind}`}>
            <div>
              <strong>{s.kind === 'empty' ? 'Empty seat' : s.name}</strong>
              {i === 0 && <span className="chip">You</span>}
              {s.host && <span className="chip">Host</span>}
              {s.kind === 'bot' && <span className="chip">Bot</span>}
              {s.kind === 'human' && !s.connected && <span className="chip warn">Disconnected</span>}
              <div className="muted small-note">{SEAT_WHERE[i]}</div>
            </div>
            {room.youAreHost && s.kind === 'empty' && (
              <div className="online-row">
                <select aria-label="Bot level" value={level} onChange={(e) => setLevel(e.target.value as BotKind)}>
                  {BOT_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.text}</option>)}
                </select>
                <button type="button" className="btn small" onClick={() => send({ t: 'addBot', seat: i, level })}>Add bot</button>
              </div>
            )}
            {room.youAreHost && s.kind === 'bot' && <button type="button" className="btn small quiet" onClick={() => send({ t: 'removeBot', seat: i })}>Remove</button>}
            {room.youAreHost && s.kind === 'human' && i !== 0 && !s.connected && <button type="button" className="btn small quiet" onClick={() => send({ t: 'kick', seat: i })}>Remove</button>}
          </li>
        ))}
      </ol>
      {room.youAreHost ? (
        <>
          <label className="field online-stake">
            <span>Stake per fan (RM)</span>
            <input inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)}
              onBlur={() => { const sen = Math.round(Number(stake) * 100); if (sen > 0) send({ t: 'stake', unitSen: sen }); else setStake((room.unitSen / 100).toFixed(2)); }} />
          </label>
          <button type="button" className="btn primary cta start-btn" disabled={!full} onClick={() => send({ t: 'start' })}>
            {full ? 'Start the game' : 'Fill every seat to start'}
          </button>
        </>
      ) : (
        <p className="muted">Stake RM{(room.unitSen / 100).toFixed(2)} per fan. Waiting for the host to start…</p>
      )}
    </div>
  );
}

function Countdown({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.ceil((at - now) / 1000));
  return <span className={`countdown${s <= 5 ? ' low' : ''}`}>{s}s</span>;
}

function Table({ room, settings, send }: { room: RoomState; settings: Settings; send: Send }) {
  const [reviewing, setReviewing] = useState(false);
  const saved = useRef<number | null>(null);
  const g = room.game!;
  const names = useMemo(() => ['You', room.seats[1].name, room.seats[2].name], [room.seats]);

  // Keep each finished round in your hand history, like Quick play.
  useEffect(() => {
    if (g.phase !== 'ended' || room.seed === null || saved.current === g.seed) return;
    saved.current = g.seed;
    const r = g.result!;
    addLog({
      id: `${Date.now()}-${room.seed}`, date: new Date().toISOString(), seed: room.seed, dealer: g.dealer, unitSen: g.rules.unitSen,
      levels: ['normal', 'normal'], names, actions: g.actions,
      summary: { type: r.type, winner: r.winner, fan: r.score?.fan, myTotal: r.total[0] },
    });
  }, [g, room.seed, names]);

  if (reviewing && room.seed !== null) {
    return <Review seed={room.seed} dealer={g.dealer} actions={g.actions} unitSen={g.rules.unitSen} names={names} onClose={() => setReviewing(false)} />;
  }
  return (
    <>
      <div className="room-strip">
        <span>Room <strong>{room.code}</strong> · RM{(room.unitSen / 100).toFixed(2)}/fan · round {room.rounds + (room.phase === 'playing' ? 1 : 0)}</span>
        {room.deadline && <span>Your move <Countdown at={room.deadline} /></span>}
        {room.phase === 'between' && room.waitingFor.length > 0 && <span className="muted">Waiting for {room.waitingFor.join(', ')}</span>}
        <button type="button" className="btn small quiet" onClick={() => { if (confirm('Leave the room? A bot will take your seat.')) send({ t: 'leave' }); }}>Leave</button>
      </div>
      <Game
        game={g} names={names} levels={names.slice(1)} tally={room.tally} settings={settings} reportSeed={room.seed}
        onAct={(action) => send({ t: 'act', action })}
        onNext={() => send({ t: 'next' })}
        onReview={() => setReviewing(true)}
      />
      {room.phase === 'between' && (
        <p className="muted online-totals">Room totals after {room.rounds} round{room.rounds === 1 ? '' : 's'}: {names.map((n, i) => `${n} ${rmShort(room.tally[i])}`).join(' · ')}</p>
      )}
    </>
  );
}

/** Chat and emoji: a button that opens the chat, and a row of emoji to fire off. */
function Social({ room, chat, send }: { room: RoomState; chat: ReturnType<typeof useRoom>['chat']; send: Send }) {
  const [open, setOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false); // phones: the emoji row folds behind one button
  const [text, setText] = useState('');
  const [seen, setSeen] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const unread = open ? 0 : chat.filter((m) => m.id > seen && m.seat !== 0).length;
  // Everything up to now counts as read when the chat is opened or closed.
  const toggle = () => { setSeen(chat.at(-1)?.id ?? 0); setOpen((o) => !o); };
  useEffect(() => {
    if (open) list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [open, chat]);
  const sendChat = () => {
    if (!text.trim()) return;
    send({ t: 'chat', text });
    setText('');
  };
  return (
    <div className={`social${open ? ' open' : ''}${emojiOpen ? ' emoji-open' : ''}`}>
      {open && (
        <div className="chat-panel" role="dialog" aria-label="Chat">
          <div className="chat-list" ref={list}>
            {chat.length === 0 && <p className="muted">No messages yet. Say hi.</p>}
            {chat.map((m) => (
              <p key={m.id} className={m.seat === 0 ? 'mine' : ''}><strong>{m.seat === 0 ? 'You' : m.name}</strong> {m.text}</p>
            ))}
          </div>
          <div className="online-row">
            <input aria-label="Message" maxLength={200} placeholder={`Message room ${room.code}`} value={text}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendChat()} />
            <button type="button" className="btn primary small" onClick={sendChat}>Send</button>
          </div>
        </div>
      )}
      <div className="social-bar">
        <button type="button" className="emoji-btn emoji-toggle" aria-label={emojiOpen ? 'Hide emoji' : 'Show emoji'} aria-expanded={emojiOpen} onClick={() => setEmojiOpen((o) => !o)}>{emojiOpen ? '✕' : '😀'}</button>
        {EMOJIS.map((e) => (
          <button key={e} type="button" className="emoji-btn" aria-label={`Send ${e}`} onClick={() => send({ t: 'emoji', e })}>{e}</button>
        ))}
        <button type="button" className="btn small chat-btn" aria-expanded={open} onClick={toggle}>
          Chat{unread > 0 && <span className="badge">{unread}</span>}
        </button>
      </div>
    </div>
  );
}

/** Emoji float up the screen from the sender's side of the table, with their name. */
function EmojiLayer({ emojis }: { emojis: ReturnType<typeof useRoom>['emojis'] }) {
  return (
    <div className="emoji-layer" aria-hidden="true">
      {emojis.map((m) => (
        <span key={m.id} className={`flying-emoji from-${m.seat}`} style={{ '--drift': `${(m.id * 37) % 60 - 30}px`, '--x': `${(m.id * 53) % 14 - 7}%` } as React.CSSProperties}>
          {m.e}<small>{m.seat === 0 ? 'You' : m.name}</small>
        </span>
      ))}
    </div>
  );
}
