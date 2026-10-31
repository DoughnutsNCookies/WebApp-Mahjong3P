'use client';

// The big moments, over the whole screen: a pong or kong is stamped on the table with a shake, a win
// gets the giant seal (ink) or a coin shower (Macau). Sound plays here too. Only for events that happen
// while you watch; nothing replays after a refresh. Effects: Calm (or reduced motion) skips the visuals.

import { useEffect, useRef } from 'react';
import type { GameState } from '../engine';
import { happeningsSince, Happening } from './feed';
import { rmShort } from './format';
import { playSound } from './sound';
import type { Settings } from './storage';

type Big = 'pong' | 'chow' | 'kong' | 'hu' | 'draw';
const CHARS: Record<Big, [string, string]> = {
  pong: ['碰', 'PONG!'], chow: ['吃', 'CHOW!'], kong: ['槓', 'KONG!'], hu: ['胡', 'HU!'], draw: ['流局', 'DRAW'],
};
const LEVEL: Record<Big, 1 | 2 | 3> = { pong: 1, chow: 1, kong: 2, hu: 3, draw: 1 };
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const BLOT = 'M131 14c38 2 58 30 86 40 30 11 38 52 22 80-14 25-6 54-38 66-33 12-60-6-92 2-34 9-70-6-82-38-11-30 6-48 2-76-4-30 22-54 52-62 18-5 32-13 50-12z';

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const el = (cls: string, html = '') => Object.assign(document.createElement('div'), { className: cls, innerHTML: html });

function shake(level: number) {
  const t = document.querySelector('.table');
  if (!t) return;
  t.classList.remove('shake-1', 'shake-2', 'shake-3');
  void (t as HTMLElement).offsetWidth; // restart the animation
  t.classList.add(`shake-${level}`);
}

function flash(layer: HTMLElement, color: string, peak: number, ms: number) {
  const f = layer.appendChild(el('fx-flash'));
  f.style.background = color;
  f.animate([{ opacity: 0 }, { opacity: peak, offset: 0.12 }, { opacity: 0 }], { duration: ms, easing: 'ease-out' }).onfinish = () => f.remove();
}

/** Ink drops or gold coins flying out from the middle. */
function burst(layer: HTMLElement, gold: boolean, n: number) {
  for (let i = 0; i < n; i++) {
    const p = layer.appendChild(el(`fx-bit ${gold ? 'fx-coin' : 'fx-drop'}`));
    if (!gold) {
      const s = 4 + Math.random() * 12;
      Object.assign(p.style, { width: `${s}px`, height: `${s}px`, background: ['#111', '#a3242a', '#333'][i % 3] });
    }
    const a = Math.random() * Math.PI * 2;
    const d = 120 + Math.random() * 240;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d * 0.8 - (gold ? 140 : 0);
    const fall = gold ? 460 + Math.random() * 240 : 0;
    p.animate([
      { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 1 },
      { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(1) rotate(${Math.random() * 540}deg)`, opacity: 1, offset: 0.35 },
      { transform: `translate(calc(-50% + ${x * 1.1}px), calc(-50% + ${y + fall}px)) rotate(${Math.random() * 900}deg)`, opacity: gold ? 0.85 : 0 },
    ], { duration: 1500 + Math.random() * 700, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' }).onfinish = () => p.remove();
  }
}

function countUp(node: HTMLElement, label: string, sen: number) {
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / 1100);
    node.textContent = `${label} ${rmShort(Math.round(sen * (1 - (1 - k) ** 3)))}`;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function play(layer: HTMLElement, theme: Settings['theme'], kind: Big, who: string, won?: number) {
  const gold = theme === 'macau';
  const level = LEVEL[kind];
  const [ch, word] = CHARS[kind];
  if (kind !== 'draw') shake(level);
  const night = document.documentElement.dataset.mode === 'night';
  flash(layer, gold ? '#ffe9a0' : kind === 'hu' ? (night ? '#fff3d6' : '#ffffff') : '#000000', [0.12, 0.25, 0.8][level - 1], 300 + level * 150);
  if (kind === 'hu') burst(layer, gold, gold ? 44 : 26);

  const b = layer.appendChild(el(`fx-banner ${gold ? 'fx-gold' : 'fx-ink'}`));
  const sealed = kind === 'hu' && !gold;
  b.innerHTML = sealed
    ? `<div class="fx-seal">${ch}</div><div class="who"></div>`
    : gold
      ? `<div class="rays"></div><div class="char">${ch}</div><div class="word">${kind === 'hu' ? '恭喜發財 HU!' : word}</div><div class="who"></div>`
      : `<svg class="blot" viewBox="0 0 260 220" aria-hidden="true"><path d="${BLOT}"/></svg><div class="char">${ch}</div><div class="word">${word}</div><div class="who"></div>`;
  const whoNode = b.querySelector<HTMLElement>('.who')!;
  if (kind === 'hu' && won !== undefined) countUp(whoNode, who, won);
  else whoNode.textContent = who;

  const tilt = sealed ? ' rotate(-8deg)' : '';
  b.animate(
    [{ transform: `scale(${gold ? 0.3 : 2.4})${tilt}`, opacity: 0 }, { transform: `scale(1)${tilt}`, opacity: 1 }],
    { duration: 260 + level * 60, easing: EASE, fill: 'forwards' },
  );
  setTimeout(() => {
    const target = sealed ? document.querySelector('.winner .seal') : null;
    if (target) {
      // The giant seal flies into the winner's box, where the small seal is stamped as it lands.
      const to = target.getBoundingClientRect();
      const from = b.getBoundingClientRect();
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      b.animate([{ transform: 'scale(1) rotate(-8deg)', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(0.15) rotate(-8deg)`, opacity: 0.6 }],
        { duration: 460, easing: 'cubic-bezier(0.6, 0, 0.2, 1)', fill: 'forwards' }).onfinish = () => b.remove();
    } else {
      b.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' }).onfinish = () => b.remove();
    }
  }, 520 + level * 230);
}

function bigOf(h: Happening): Big | null {
  if (h.what === 'pong' || h.what === 'chow' || h.what === 'kong') return h.what;
  if (h.what === 'win' || h.what === 'selfWin') return 'hu';
  return null;
}

export function FxLayer({ game, names, settings }: { game: GameState; names: string[]; settings: Settings }) {
  const layer = useRef<HTMLDivElement>(null);
  const seen = useRef({ seed: game.seed, count: game.events.length });

  useEffect(() => {
    if (seen.current.seed !== game.seed) {
      seen.current = { seed: game.seed, count: game.events.length };
      return;
    }
    const ended = game.events.slice(seen.current.count).some((e) => e.e === 'end');
    const fresh = happeningsSince(game, seen.current.count);
    seen.current.count = game.events.length;
    const visuals = settings.effects === 'full' && !reducedMotion() && layer.current;
    const short = (p: number) => names[p].split(' · ')[0];
    for (const h of fresh) {
      const big = bigOf(h);
      if (h.what === 'discard') playSound('clack');
      else if (big === 'hu') playSound('gong');
      else if (big) playSound('thump', LEVEL[big]);
      if (big && visuals) {
        const won = big === 'hu' ? game.result?.total[h.player] : undefined;
        play(layer.current!, settings.theme, big, short(h.player), won);
      }
    }
    if (ended && game.result?.type === 'draw' && visuals) play(layer.current!, settings.theme, 'draw', 'The wall ran out');
  }, [game, names, settings.effects, settings.theme]);

  return <div className="fx-layer" ref={layer} aria-hidden="true" />;
}
