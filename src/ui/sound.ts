// Table sounds, made in the browser (no audio files): a soft wooden thud for any button, a click for picking
// a tile, a tile clack for each discard, a drum thump for a pong or chow (deeper for a kong), a gong for a
// win, and a cascade of coins when money changes hands (falling and lower when it's yours going out). Off until turned on in Settings; browsers only
// allow sound after a tap, so the audio starts on the first tap once it is on.

let ctx: AudioContext | null = null;
let enabled = false;

export function setSoundEnabled(on: boolean) {
  enabled = on;
  if (!on || ctx || typeof window === 'undefined') return;
  const start = () => {
    if (!enabled || ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    window.removeEventListener('pointerdown', start);
  };
  window.addEventListener('pointerdown', start);
}

/** Starts the audio from a tap the caller is handling (the Settings switch), so the first sound plays now. */
export function unlockSound() {
  if (!enabled || ctx || typeof window === 'undefined') return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AC) ctx = new AC();
}

export type SoundKind = 'tap' | 'pick' | 'clack' | 'thump' | 'gong' | 'coins';

/** level: thump 1 (pong/chow) or 2 (kong); coins: how many (1-10), negative for money going out. */
export function playSound(kind: SoundKind, level = 1) {
  if (!enabled || !ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.connect(ctx.destination);
  if (kind === 'tap') {
    // A soft wooden thud: a quick low knock with a touch of noise for the wood.
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.08);
    out.gain.setValueAtTime(0.35, t);
    out.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(out);
    o.start(t);
    o.stop(t + 0.13);
    knock(out, t, 1200, 0.15, 0.02);
    return;
  }
  if (kind === 'pick') {
    // Lifting a tile: a short, brighter tock.
    knock(out, t, 2600, 0.35, 0.025);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(620, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.07);
    return;
  }
  if (kind === 'coins') {
    // Coins: bright metallic pings (two inharmonic partials each), one after another, rising in pitch when
    // money comes in and falling (and lower) when it goes out.
    const n = Math.max(1, Math.min(10, Math.abs(level)));
    const gaining = level > 0;
    out.gain.value = 0.5;
    for (let i = 0; i < n; i++) {
      const at = t + i * (0.055 + Math.random() * 0.03);
      const base = (gaining ? 2200 + i * 90 : 1700 - i * 70) * (0.95 + Math.random() * 0.1);
      for (const [mult, amp] of [[1, 0.22], [2.76, 0.1]]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = base * mult;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(amp, at + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
        o.connect(g);
        g.connect(out);
        o.start(at);
        o.stop(at + 0.3);
      }
      knock(out, at, 5000, 0.08, 0.01);
    }
    return;
  }
  if (kind === 'clack') {
    // A short burst of filtered noise: a tile set down on the table.
    const len = Math.floor(ctx.sampleRate * 0.06);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 4;
    const src = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2400;
    f.Q.value = 2;
    src.buffer = buf;
    src.connect(f);
    f.connect(out);
    out.gain.value = 0.8;
    src.start(t);
  } else if (kind === 'thump') {
    // A drum hit falling in pitch; a kong is deeper and louder.
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(level >= 2 ? 140 : 190, t);
    o.frequency.exponentialRampToValueAtTime(level >= 2 ? 45 : 70, t + 0.25);
    out.gain.setValueAtTime(level >= 2 ? 1 : 0.7, t);
    out.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(out);
    o.start(t);
    o.stop(t + 0.42);
  } else {
    // A gong: inharmonic partials settling in pitch, with a long shimmer.
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
    out.gain.exponentialRampToValueAtTime(0.001, t + 3.2);
    for (const [hz, amp] of [[98, 1], [147.5, 0.6], [196.3, 0.5], [262, 0.35], [331, 0.25], [427, 0.15]]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(hz * 1.02, t);
      o.frequency.exponentialRampToValueAtTime(hz, t + 1.2);
      g.gain.value = amp;
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + 3.3);
    }
  }
}

/** A tiny burst of filtered noise: the "wood" in a knock or the "clink" on a coin. */
function knock(out: GainNode, at: number, hz: number, gain: number, len: number) {
  const n = Math.floor(ctx!.sampleRate * len);
  const buf = ctx!.createBuffer(1, n, ctx!.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
  const src = ctx!.createBufferSource();
  const f = ctx!.createBiquadFilter();
  const g = ctx!.createGain();
  f.type = 'bandpass';
  f.frequency.value = hz;
  f.Q.value = 1.5;
  g.gain.value = gain;
  src.buffer = buf;
  src.connect(f);
  f.connect(g);
  g.connect(out);
  src.start(at);
}