// Table sounds, made in the browser (no audio files): a tile clack for each discard, a drum thump for a
// pong or chow (deeper for a kong), and a gong for a win. Off until turned on in Settings; browsers only
// allow sound after a tap, so the audio starts on the first tap once it is on.

let ctx: AudioContext | null = null;
let enabled = false;

export function setSoundEnabled(on: boolean) {
  enabled = on;
  if (!on || ctx || typeof window === 'undefined') return;
  const start = () => {
    if (!enabled || ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    window.removeEventListener('pointerdown', start);
  };
  window.addEventListener('pointerdown', start);
}

/** Starts the audio from a tap the caller is handling (the Settings switch), so the first sound plays now. */
export function unlockSound() {
  if (!enabled || ctx || typeof window === 'undefined') return;
  ctx = new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
}

export function playSound(kind: 'clack' | 'thump' | 'gong', level = 1) {
  if (!enabled || !ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.connect(ctx.destination);
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
