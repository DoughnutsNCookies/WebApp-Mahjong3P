'use client';

import { ChangeEvent, ReactNode, useState } from 'react';
import { WEB_MODEL } from '../ai/web';
import { rmShort } from './format';
import { setMusic, unlockMusic } from './music';
import { setSoundEnabled, unlockSound } from './sound';
import { Music, Opponent, Settings } from './storage';

// Easy, Normal and the AI are the opponents that play differently; the other rule-based levels (advanced,
// hard) exist for benchmarks only and are not offered here.
const LEVELS: { value: Opponent; text: string }[] = [
  { value: 'easy', text: 'Easy: plays for speed only' },
  { value: 'normal', text: 'Normal: speed, fan and defence' },
  { value: 'ai', text: `AI ${WEB_MODEL.name}: trained by playing itself` },
];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="set-group" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {note && <small className="muted">{note}</small>}
    </label>
  );
}

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
  const set = (key: 'speed' | 'theme' | 'night' | 'effects') => (e: ChangeEvent<HTMLSelectElement>) =>
    onChange({ ...settings, [key]: e.target.value });

  return (
    <div className="settings">
      <h2>Settings</h2>

      <Group title="Game">
        <Field label="Your name" note="What other players see at online tables.">
          <input maxLength={20} placeholder="Your name" defaultValue={settings.name}
            onBlur={(e) => { const name = e.target.value.replace(/\s+/g, ' ').trim().slice(0, 20); if (name !== settings.name) onChange({ ...settings, name }); }} />
        </Field>
        <Field label="Stake per fan (RM)" note={<>5 fan pays RM{(5 * settings.unitSen / 100).toFixed(2)} a share; 10 fan pays double. Applies from the next round.</>}>
          <input inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} onBlur={(e) => saveStake(e.target.value)} />
        </Field>
        <Field label="Bot speed">
          <select value={settings.speed} onChange={set('speed')}>
            <option value="slow">Slow</option>
            <option value="normal">Normal</option>
            <option value="fast">Fast</option>
          </select>
        </Field>
      </Group>

      <Group title="Opponents">
        {[0, 1].map((i) => (
          <Field key={i} label={`Bot ${i + 1}`}>
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
          </Field>
        ))}
        {aiStatus === 'loading' && <p className="muted span">Loading the AI (about 1.5 MB, once)…</p>}
        {aiStatus === 'failed' && <p className="muted span">The AI couldn&apos;t load ({aiError}), so its seat plays as Normal for now.</p>}
      </Group>

      <Group title="Table">
        <Field label="Table style">
          <select value={settings.theme} onChange={set('theme')}>
            <option value="ink">Ink and seal 水墨: paper, brush calls, red seal</option>
            <option value="macau">Macau 澳門: felt, gold calls, coin shower</option>
          </select>
        </Field>
        <Field label="Night mode">
          <select value={settings.night} onChange={set('night')}>
            <option value="auto">Match my phone</option>
            <option value="off">Off (day)</option>
            <option value="on">On (night)</option>
          </select>
        </Field>
        <Field label="Effects" note="Phones set to reduce motion always get Calm.">
          <select value={settings.effects} onChange={set('effects')}>
            <option value="full">Full: shakes, flashes, big calls and wins</option>
            <option value="calm">Calm: highlights only</option>
          </select>
        </Field>
      </Group>

      <Group title="Sound">
        <Field label="Sound effects">
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
        </Field>
        <Field label="Music" note="Played by the game itself on a Chinese pentatonic scale; it never repeats exactly.">
          <select
            value={settings.music}
            onChange={(e) => {
              const music = e.target.value as Music;
              onChange({ ...settings, music });
              setMusic(music);
              unlockMusic(); // inside the tap
            }}
          >
            <option value="off">Off</option>
            <option value="chill">Chill 靜: slow plucked strings over a soft drone</option>
            <option value="teahouse">Teahouse 茶館: plucked strings with a flute</option>
            <option value="upbeat">Upbeat 熱鬧: quicker, with light percussion</option>
          </select>
        </Field>
      </Group>

      <Group title="Tally">
        <div className="field span">
          <span>Running tally ({rounds} round{rounds === 1 ? '' : 's'})</span>
          <p>You {rmShort(tally[0])} · Bot 1 {rmShort(tally[1])} · Bot 2 {rmShort(tally[2])}</p>
          <button type="button" className="btn small quiet" onClick={() => { if (confirm('Reset the tally to zero?')) onResetTally(); }}>
            Reset tally
          </button>
        </div>
      </Group>
    </div>
  );
}
