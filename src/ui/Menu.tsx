'use client';

// The main menu: a 3D scene of big tiles filling the screen behind the buttons. A huge fei in front, a
// Red and a Green dragon floating behind at different depths. The scene turns towards the mouse (or follows
// a drag on a phone) with eased, weighty motion, like orbiting a model in Blender, and drifts on its own when
// left alone. Plain CSS 3D, one requestAnimationFrame loop.
//
// Each tile is an extruded block: the face, then a stack of thin rounded layers behind it (ivory, then the
// jade-green back half), so the thickness follows the rounded corners from any angle and the sides shade
// darker towards the back. Lighting follows the turn: a glint slides across each face and the shadow on the
// floor moves with the scene.

import { CSSProperties, useEffect, useRef } from 'react';
import { rmShort } from './format';

const SPACING = 6; // px between layers (fewer layers = smoother on phones; 6px still reads as solid)

/** Blends two hex colours; k from 0 (a) to 1 (b). */
function mix(a: string, b: string, k: number): string {
  const c = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [c(a), c(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(' ')})`;
}

function Tile3D({ char, tone, ivory, green, style }: { char: string; tone: 'fei' | 'red' | 'green'; ivory: number; green: number; style?: CSSProperties }) {
  const layers = [];
  for (let i = 1; i <= ivory + green; i++) {
    const isIvory = i <= ivory;
    const k = isIvory ? i / ivory : (i - ivory) / green;
    layers.push(
      <div
        key={i}
        className="t3d-layer"
        style={{ '--z': `${-i * SPACING}px`, background: isIvory ? mix('#e9dfc3', '#cdbf9a', k) : mix('#2a8a5a', '#0f4530', k) } as CSSProperties}
      />,
    );
  }
  return (
    <div className={`t3d t3d-${tone}`} style={{ ...style, '--depth': `${(ivory + green + 1) * SPACING}px` } as CSSProperties} aria-hidden="true">
      {layers}
      <div className="t3d-back" style={{ '--z': `${-(ivory + green + 1) * SPACING}px` } as CSSProperties} />
      <div className="t3d-front">
        <span className="t3d-char">{char}</span>
        <i className="t3d-grain" />
        <i className="t3d-sheen" />
        <i className="t3d-spot" />
      </div>
    </div>
  );
}

export function Menu({ inRound, rounds, tally, onPlay, onFriends, onHistory, onSettings }: {
  /** A round is under way: the first button continues it. */
  inRound: boolean;
  rounds: number;
  tally: number;
  onPlay: () => void;
  onFriends: () => void;
  onHistory: () => void;
  onSettings: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Target and current angles (degrees); the scene eases towards the target every frame.
    const target = { x: 0, y: 0 };
    const now = { x: -8, y: 18 };
    let lastInput = -1e9;
    let drag: { x: number; y: number; ax: number; ay: number } | null = null;
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      lastInput = performance.now();
      if (drag) {
        // Dragging (touch or mouse button held): orbit further, like grabbing the model.
        target.y = Math.max(-50, Math.min(50, drag.ay + (e.clientX - drag.x) * 0.25));
        target.x = Math.max(-32, Math.min(32, drag.ax - (e.clientY - drag.y) * 0.2));
        return;
      }
      if (e.pointerType !== 'mouse') return;
      // Hovering: the scene turns gently towards the pointer.
      target.y = ((e.clientX / innerWidth) - 0.5) * 36;
      target.x = -((e.clientY / innerHeight) - 0.5) * 26;
    };
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      drag = { x: e.clientX, y: e.clientY, ax: target.x, ay: target.y };
      lastInput = performance.now();
    };
    const onUp = () => { drag = null; };

    const frame = (t: number) => {
      // Left alone for a few seconds: a slow drift, so the scene is never quite still.
      if (!drag && t - lastInput > 3000 && !still) {
        target.y = Math.sin(t / 4200) * 16;
        target.x = Math.sin(t / 5300) * 7 - 3;
      }
      const k = still ? 1 : 0.06; // easing: the weight of the model
      now.x += (target.x - now.x) * k;
      now.y += (target.y - now.y) * k;
      el.style.setProperty('--rx', `${now.x.toFixed(2)}deg`);
      el.style.setProperty('--ry', `${now.y.toFixed(2)}deg`);
      // Light from the top left: the glint slides across the faces, the highlight spot moves, and the
      // shadow on the floor shifts the other way as the scene turns.
      el.style.setProperty('--glint', `${(50 + now.y * 1.5).toFixed(1)}%`);
      el.style.setProperty('--spot-x', `${(38 - now.y * 0.9).toFixed(1)}%`);
      el.style.setProperty('--spot-y', `${(30 + now.x * 0.9).toFixed(1)}%`);
      el.style.setProperty('--shadow-x', `${(-now.y * 2.2).toFixed(1)}px`);
      el.style.setProperty('--shadow-w', `${(1 + Math.abs(now.y) / 120).toFixed(3)}`);
      raf = requestAnimationFrame(frame);
    };
    const onVisible = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };

    addEventListener('pointermove', onMove);
    addEventListener('pointerdown', onDown);
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onUp);
    document.addEventListener('visibilitychange', onVisible);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerdown', onDown);
      removeEventListener('pointerup', onUp);
      removeEventListener('pointercancel', onUp);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return (
    <div className="menu">
      <div className="menu-stage" ref={stage} aria-hidden="true">
        <div className="menu-floor" />
        <div className="menu-scene">
          <Tile3D char="中" tone="red" ivory={9} green={7} style={{ '--tx': '-66%', '--ty': '-26%', '--tz': '-300px', '--rot': '-14deg', '--bob': '7s' } as CSSProperties} />
          <Tile3D char="發" tone="green" ivory={9} green={7} style={{ '--tx': '68%', '--ty': '24%', '--tz': '-230px', '--rot': '12deg', '--bob': '8.5s' } as CSSProperties} />
          <Tile3D char="飛" tone="fei" ivory={15} green={11} style={{ '--tx': '0%', '--ty': '0%', '--tz': '0px', '--rot': '-3deg', '--bob': '6s' } as CSSProperties} />
        </div>
      </div>

      <div className="menu-front">
        <h2 className="menu-title">3P Mahjong</h2>
        <p className="menu-sub">Malaysian three-player mahjong · 三人麻將</p>
        <div className="menu-buttons">
          <button type="button" className="btn primary cta" onClick={onPlay}>{inRound ? 'Continue round' : 'Quick play'}</button>
          <button type="button" className="btn" onClick={onFriends}>Play with friends</button>
          <button type="button" className="btn" onClick={onHistory}>History</button>
          <button type="button" className="btn" onClick={onSettings}>Settings</button>
        </div>
        {rounds > 0 && (
          <p className="menu-tally">
            {rounds} round{rounds === 1 ? '' : 's'} played · your tally <span className={`money ${tally < 0 ? 'neg' : ''}`}>{rmShort(tally)}</span>
          </p>
        )}
      </div>
    </div>
  );
}
