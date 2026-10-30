'use client';

// Saved hands: the list, a step-by-step replay of any hand, and its review.

import { useMemo, useState } from 'react';
import { Action, applyAction, GameState, newRound, playerView } from '../engine';
import { actionLabel, rmShort } from './format';
import { Review } from './Review';
import { deleteLog, exportLogs, loadLogs, SavedRound } from './storage';
import { Table } from './Table';
import { Tile } from './Tile';
import { rulesFor } from './useMatch';
import { lastDiscardOf } from './Game';

const namesFor = (log: SavedRound) => ['You', `Bot 1 · ${log.levels[0]}`, `Bot 2 · ${log.levels[1]}`];

function describe(a: Action, names: string[], before: GameState): string {
  const who = a.player === 0 ? 'You' : names[a.player];
  const tile = before.pending?.tile ?? null;
  if (a.type === 'pass') return `${who}: pass`;
  if (a.type === 'discard') return `${who} discard${a.player === 0 ? '' : 's'} ${actionLabel(a).replace('Discard ', '')}`;
  return `${who}: ${actionLabel(a, tile)}`;
}

export function Replay({ log, start = 0, onClose }: { log: SavedRound; start?: number; onClose: () => void }) {
  const names = namesFor(log);
  // Every state from the deal to the end, so the slider can move both ways instantly.
  const states = useMemo(() => {
    const out: GameState[] = [newRound(log.seed, log.dealer, rulesFor(log.unitSen))];
    for (const a of log.actions) out.push(applyAction(out[out.length - 1], a));
    return out;
  }, [log]);
  const [step, setStep] = useState(Math.min(start, states.length - 1));
  const [revealAll, setRevealAll] = useState(false);
  const s = states[step];
  const view = playerView(s, 0);
  const last = step > 0 ? describe(log.actions[step - 1], names, states[step - 1]) : 'The deal';

  return (
    <div className="replay">
      <div className="panel-head">
        <h2>Replay</h2>
        <button type="button" className="btn small" onClick={onClose}>Close</button>
      </div>
      <div className="replay-controls">
        <button type="button" className="btn small" onClick={() => setStep((x) => Math.max(0, x - 1))} disabled={step === 0}>Back</button>
        <input
          type="range" min={0} max={states.length - 1} value={step} aria-label="Move through the hand"
          onChange={(e) => setStep(Number(e.target.value))}
        />
        <button type="button" className="btn small" onClick={() => setStep((x) => Math.min(states.length - 1, x + 1))} disabled={step === states.length - 1}>Next</button>
      </div>
      <p className="status-line"><span>{step}/{states.length - 1}: {last}</span>
        <label className="muted"><input type="checkbox" checked={revealAll} onChange={(e) => setRevealAll(e.target.checked)} /> Show all hands</label>
      </p>
      <Table
        view={view}
        names={names}
        revealed={revealAll || s.phase === 'ended' ? s.players.map((p) => p.hand) : null}
        active={s.phase === 'turn' ? s.turn : undefined}
        lastDiscard={lastDiscardOf(s)}
        hand={<div className="hand-row">{view.hand.map((k, i) => <Tile key={i} kind={k} size="hand" />)}</div>}
      />
    </div>
  );
}

export function Hands() {
  const [logs, setLogs] = useState<SavedRound[]>(() => (typeof window === 'undefined' ? [] : loadLogs()));
  const [open, setOpen] = useState<{ log: SavedRound; mode: 'review' | 'replay'; start?: number } | null>(null);

  if (open?.mode === 'replay') return <Replay log={open.log} start={open.start} onClose={() => setOpen(null)} />;
  if (open?.mode === 'review') {
    const { log } = open;
    return (
      <Review
        seed={log.seed} dealer={log.dealer} actions={log.actions} unitSen={log.unitSen}
        onReplay={(i) => setOpen({ log, mode: 'replay', start: i })}
        onClose={() => setOpen(null)}
      />
    );
  }

  return (
    <div className="hands">
      <div className="panel-head">
        <h2>Saved hands</h2>
        {logs.length > 0 && <button type="button" className="btn small" onClick={exportLogs}>Download all</button>}
      </div>
      {logs.length === 0 ? <p className="muted">Finished hands appear here, so you can replay and review them.</p> : (
        <ul className="log-list">
          {logs.map((l) => {
            const names = namesFor(l);
            const outcome = l.summary.type === 'draw' ? 'Draw'
              : `${l.summary.winner === 0 ? 'You' : names[l.summary.winner!]} won, ${l.summary.fan} fan`;
            return (
              <li key={l.id}>
                <div>
                  <strong>{outcome}</strong>
                  <span className={`money ${l.summary.myTotal < 0 ? 'neg' : ''}`}>{rmShort(l.summary.myTotal)}</span>
                </div>
                <div className="muted">{new Date(l.date).toLocaleString()} · RM{(l.unitSen / 100).toFixed(2)}/fan</div>
                <div className="actions">
                  <button type="button" className="btn small" onClick={() => setOpen({ log: l, mode: 'review' })}>Review</button>
                  <button type="button" className="btn small" onClick={() => setOpen({ log: l, mode: 'replay' })}>Replay</button>
                  <button
                    type="button" className="btn small quiet"
                    onClick={() => { if (confirm('Delete this hand?')) { deleteLog(l.id); setLogs(loadLogs()); } }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
