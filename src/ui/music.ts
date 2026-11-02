// Background music, made in the browser: a small generative player, no audio files. Three moods on the
// Chinese gong (宫) pentatonic scale, with plucked strings rendered like a guzheng (Karplus-Strong), a soft
// drone for the chill mood, a flute-like lead for the teahouse mood, and light percussion for the upbeat one.
// Every phrase is improvised from a few rules, so it never loops exactly. Off by default; starts on a tap
// (browsers require one) and pauses while the tab is hidden.

export type Music = 'off' | 'chill' | 'teahouse' | 'upbeat';

interface Mood { bpm: number; rest: number; low: number; span: number; drone: boolean; lead: boolean; drums: boolean; gain: number }
const MOODS: Record<Exclude<Music, 'off'>, Mood> = {
  chill: { bpm: 56, rest: 0.5, low: 60, span: 10, drone: true, lead: false, drums: false, gain: 0.2 },
  teahouse: { bpm: 84, rest: 0.3, low: 64, span: 10, drone: false, lead: true, drums: false, gain: 0.22 },
  upbeat: { bpm: 118, rest: 0.18, low: 67, span: 8, drone: false, lead: false, drums: true, gain: 0.24 },
};
const SCALE = [0, 2, 4, 7, 9]; // C D E G A
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const scaleNote = (low: number, degree: number) => low + 12 * Math.floor(degree / 5) + SCALE[((degree % 5) + 5) % 5];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let mood: Music = 'off';
let timer: ReturnType<typeof setTimeout> | null = null;
let step = 0;
let nextTime = 0;
let degree = 0;
let drone: { osc: OscillatorNode[]; gain: GainNode } | null = null;
const plucks = new Map<number, AudioBuffer>();

/** A plucked string, Karplus-Strong: a burst of noise through a short averaging delay line. */
function pluck(midi: number): AudioBuffer {
  let buf = plucks.get(midi);
  if (buf) return buf;
  const sr = ctx!.sampleRate;
  const n = Math.round(sr / hz(midi));
  const len = Math.floor(sr * 2.2);
  buf = ctx!.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const ring = new Float32Array(n);
  for (let i = 0; i < n; i++) ring[i] = Math.random() * 2 - 1;
  const damp = midi > 72 ? 0.992 : 0.996;
  for (let i = 0, k = 0; i < len; i++, k = (k + 1) % n) {
    const next = (k + 1) % n;
    d[i] = ring[k];
    ring[k] = damp * 0.5 * (ring[k] + ring[next]);
  }
  plucks.set(midi, buf);
  return buf;
}

function playPluck(midi: number, at: number, gain: number) {
  const src = ctx!.createBufferSource();
  src.buffer = pluck(midi);
  const g = ctx!.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(master!);
  src.start(at);
}

/** A breathy flute: a sine with a slow start and a little vibrato. */
function playFlute(midi: number, at: number, dur: number) {
  const o = ctx!.createOscillator();
  const v = ctx!.createOscillator();
  const vg = ctx!.createGain();
  const g = ctx!.createGain();
  o.frequency.value = hz(midi);
  v.frequency.value = 5;
  vg.gain.value = hz(midi) * 0.004;
  v.connect(vg);
  vg.connect(o.frequency);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.09, at + 0.12);
  g.gain.setValueAtTime(0.09, at + dur - 0.1);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g);
  g.connect(master!);
  o.start(at); v.start(at);
  o.stop(at + dur); v.stop(at + dur);
}

function playDrum(kind: 'kick' | 'hat' | 'block', at: number) {
  if (kind === 'kick') {
    const o = ctx!.createOscillator();
    const g = ctx!.createGain();
    o.frequency.setValueAtTime(150, at);
    o.frequency.exponentialRampToValueAtTime(50, at + 0.12);
    g.gain.setValueAtTime(0.5, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
    o.connect(g); g.connect(master!);
    o.start(at); o.stop(at + 0.22);
    return;
  }
  if (kind === 'block') {
    const o = ctx!.createOscillator();
    const g = ctx!.createGain();
    o.frequency.value = 1900;
    g.gain.setValueAtTime(0.18, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
    o.connect(g); g.connect(master!);
    o.start(at); o.stop(at + 0.06);
    return;
  }
  const len = Math.floor(ctx!.sampleRate * 0.04);
  const buf = ctx!.createBuffer(1, len, ctx!.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = ctx!.createBufferSource();
  const f = ctx!.createBiquadFilter();
  const g = ctx!.createGain();
  src.buffer = buf; f.type = 'highpass'; f.frequency.value = 6000; g.gain.value = 0.12;
  src.connect(f); f.connect(g); g.connect(master!);
  src.start(at);
}

/** The chill mood's drone: root and fifth, low and soft, changing chord every 8 bars. */
function setDrone(root: number | null, at: number) {
  if (drone) {
    const old = drone;
    old.gain.gain.setTargetAtTime(0, at, 1.2);
    old.osc.forEach((o) => o.stop(at + 5));
    drone = null;
  }
  if (root === null) return;
  const gain = ctx!.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.setTargetAtTime(0.07, at, 1.5);
  const f = ctx!.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 700;
  gain.connect(f); f.connect(master!);
  const osc = [[root - 12, 'sine'], [root - 5, 'triangle'], [root, 'sine']].map(([m, type]) => {
    const o = ctx!.createOscillator();
    o.type = type as OscillatorType;
    o.frequency.value = hz(m as number);
    o.detune.value = Math.random() * 6 - 3;
    o.connect(gain);
    o.start(at);
    return o;
  });
  drone = { osc, gain };
}

/** Schedules the next few steps (eighth notes) just ahead of real time. */
function tick() {
  if (mood === 'off' || !ctx) return;
  const m = MOODS[mood];
  const stepLen = 60 / m.bpm / 2;
  while (nextTime < ctx.currentTime + 0.5) {
    const bar = Math.floor(step / 8);
    const inBar = step % 8;
    const phraseStart = step % 32 === 0;
    // Melody: a random walk on the scale, mostly stepwise, landing on the tonic at phrase starts.
    if (phraseStart) degree = [0, 5, 2][bar / 4 % 3 | 0];
    else {
      const r = Math.random();
      degree += r < 0.4 ? 1 : r < 0.8 ? -1 : r < 0.9 ? 2 : -2;
      degree = Math.max(0, Math.min(m.span - 1, degree));
    }
    const rest = !phraseStart && Math.random() < m.rest;
    if (!rest) playPluck(scaleNote(m.low, degree), nextTime, inBar % 4 === 0 ? 0.5 : 0.35);
    if (m.drums) {
      if (inBar === 0 || inBar === 4) playDrum('kick', nextTime);
      if (inBar === 2 || inBar === 6) playDrum('block', nextTime);
      if (inBar % 2 === 1) playDrum('hat', nextTime);
      if (inBar === 0 || inBar === 5) playPluck(m.low - 24 + (bar % 4 === 3 ? 9 : 0), nextTime, 0.45);
    }
    if (m.drone && step % 64 === 0) setDrone(m.low + [0, 9, 5, 0][(bar / 8) % 4 | 0], nextTime);
    if (m.lead && step % 32 === 16) {
      // A short flute answer: three or four slow notes drifting down to the tonic.
      let d = 5 + Math.floor(Math.random() * 4);
      for (let i = 0, t = nextTime; i < 3 + Math.floor(Math.random() * 2); i++, t += stepLen * 2) {
        playFlute(scaleNote(m.low + 12, d), t, stepLen * 2.2);
        d = Math.max(0, d - 1 - Math.floor(Math.random() * 2));
      }
    }
    nextTime += stepLen;
    step++;
  }
  timer = setTimeout(tick, 120);
}

function start() {
  if (!ctx || mood === 'off') return;
  if (ctx.state === 'suspended') void ctx.resume();
  master!.gain.cancelScheduledValues(ctx.currentTime);
  master!.gain.setTargetAtTime(MOODS[mood].gain, ctx.currentTime, 0.4);
  if (timer === null) {
    step = 0;
    nextTime = ctx.currentTime + 0.1;
    tick();
  }
}

function stop() {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  if (!ctx) return;
  master!.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
  setDrone(null, ctx.currentTime);
}

function create() {
  if (ctx || typeof window === 'undefined') return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return; // no Web Audio here: the setting is kept, nothing plays
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else if (mood !== 'off') void ctx.resume();
  });
}

const onFirstTap = () => { create(); start(); window.removeEventListener('pointerdown', onFirstTap); };

/** Chooses the music. Starts at once if called from a tap; otherwise on the next tap. */
export function setMusic(next: Music) {
  if (next === mood) return;
  stop();
  mood = next;
  if (next === 'off') { window.removeEventListener('pointerdown', onFirstTap); return; }
  if (ctx) start();
  else window.addEventListener('pointerdown', onFirstTap);
}

/** Starts the audio from a tap the caller is handling (the Settings control). */
export function unlockMusic() {
  if (mood === 'off') return;
  create();
  window.removeEventListener('pointerdown', onFirstTap);
  start();
}
