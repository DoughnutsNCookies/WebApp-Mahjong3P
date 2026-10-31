'use client';

import { useState } from 'react';
import { WEB_MODEL } from '../ai/web';
import { rmShort } from './format';
import { Opponent, Settings, Speed } from './storage';

const LEVELS: { value: Opponent; text: string }[] = [
  { value: 'easy', text: 'Easy: plays for speed only' },
  { value: 'normal', text: 'Normal: speed, fan and defence' },
  { value: 'advanced', text: 'Advanced: normal, and may hold out for bigger fan' },
  { value: 'ai', text: `AI ${WEB_MODEL.name}: trained by playing itself` },
];

export function SettingsPanel({ settings, onChange, tally, rounds, onResetTally, aiStatus, aiError }: {
  settings: Settings;
  onChange: (s: Settings) => void;
  tally: number[];
  rounds: number;
  onResetTally: () => void;
  aiStatus: 'off' | 'loading' | 'ready' | 'failed';
  aiError: string | null;
}) {
  const [stake, setStake] = useState((settings.unitSen / 100).toFixed(2));
  const saveStake = (v: string) => {
    const sen = Math.round(Number(v) * 100);
    if (Number.isFinite(sen) && sen > 0 && sen <= 100000) onChange({ ...settings, unitSen: sen });
    else setStake((settings.unitSen / 100).toFixed(2));
  };

  return (
    <div className="settings">
      <h2>Settings</h2>
      <label className="field">
        <span>Stake per fan (RM)</span>
        <input
          inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} onBlur={(e) => saveStake(e.target.value)}
          aria-describedby="stake-note"
        />
        <small id="stake-note" className="muted">
          5 fan pays RM{(5 * settings.unitSen / 100).toFixed(2)} a share; 10 fan pays double. Applies from the next round.
        </small>
      </label>
      {[0, 1].map((i) => (
        <label key={i} className="field">
          <span>Bot {i + 1}</span>
          <select
            value={settings.levels[i]}
            onChange={(e) => {
              const levels = [...settings.levels] as Settings['levels'];
              levels[i] = e.target.value as Opponent;
              onChange({ ...settings, levels });
            }}
          >
            {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.text}</option>)}
          </select>
        </label>
      ))}
      {aiStatus === 'loading' && <p className="muted">Loading the AI (about 1.5 MB, once)…</p>}
      {aiStatus === 'failed' && <p className="muted">The AI couldn&apos;t load ({aiError}), so its seat plays as Normal for now.</p>}
      <label className="field">
        <span>Bot speed</span>
        <select value={settings.speed} onChange={(e) => onChange({ ...settings, speed: e.target.value as Speed })}>
          <option value="slow">Slow</option>
          <option value="normal">Normal</option>
          <option value="fast">Fast</option>
        </select>
      </label>
      <div className="field">
        <span>Running tally ({rounds} round{rounds === 1 ? '' : 's'})</span>
        <p>You {rmShort(tally[0])} · Bot 1 {rmShort(tally[1])} · Bot 2 {rmShort(tally[2])}</p>
        <button type="button" className="btn small quiet" onClick={() => { if (confirm('Reset the tally to zero?')) onResetTally(); }}>
          Reset tally
        </button>
      </div>
    </div>
  );
}
