'use client';

import { useState } from 'react';
import { WEB_MODEL } from '../ai/web';
import { rmShort } from './format';
import { setSoundEnabled, unlockSound } from './sound';
import { Effects, Night, Opponent, Settings, Speed, Theme } from './storage';

const LEVELS: { value: Opponent; text: string }[] = [
  { value: 'easy', text: 'Easy: plays for speed only' },
  { value: 'normal', text: 'Normal: speed, fan and defence' },
  { value: 'advanced', text: 'Advanced: normal, and may hold out for bigger fan' },
  { value: 'hard', text: 'Hard: normal, and looks one step further ahead' },
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
        <span>Table style</span>
        <select value={settings.theme} onChange={(e) => onChange({ ...settings, theme: e.target.value as Theme })}>
          <option value="ink">Ink and seal 水墨: paper table, brush calls, red seal</option>
          <option value="macau">Macau 澳門: felt table, gold calls, coin shower</option>
        </select>
      </label>
      <label className="field">
        <span>Night mode</span>
        <select value={settings.night} onChange={(e) => onChange({ ...settings, night: e.target.value as Night })}>
          <option value="auto">Match my phone</option>
          <option value="off">Off (day)</option>
          <option value="on">On (night)</option>
        </select>
      </label>
      <label className="field">
        <span>Effects</span>
        <select value={settings.effects} onChange={(e) => onChange({ ...settings, effects: e.target.value as Effects })}>
          <option value="full">Full: shakes, flashes, big calls and wins</option>
          <option value="calm">Calm: highlights only</option>
        </select>
        <small className="muted">Phones set to reduce motion always get Calm.</small>
      </label>
      <label className="field">
        <span>Sound</span>
        <select
          value={settings.sound ? 'on' : 'off'}
          onChange={(e) => {
            const sound = e.target.value === 'on';
            onChange({ ...settings, sound });
            setSoundEnabled(sound);
            if (sound) unlockSound(); // inside the tap, so the browser allows it
          }}
        >
          <option value="off">Off</option>
          <option value="on">On: tile clacks, drum for calls, gong for a win</option>
        </select>
      </label>
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
