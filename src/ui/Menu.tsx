'use client';

// The main menu: a 3D scene of big tiles filling the screen behind the buttons. A huge fei in front, a
// Red and a Green dragon floating behind at different depths. The scene turns towards the mouse (or follows
// a drag on a phone) with eased, weighty motion, like orbiting a model in Blender, and drifts on its own when
// left alone. Plain CSS 3D (each tile is a box of six faces); one requestAnimationFrame loop sets two angles.

import { CSSProperties, useEffect, useRef } from 'react';
import { rmShort } from './format';

/** A mahjong tile as a 3D box: ivory face with the character, jade-green back layer showing on the edges. */
function Tile3D({ char, tone, style }: { char: string; tone: 'fei' | 'red' | 'green'; style?: CSSProperties }) {
  return (
    <div className={`t3d t3d-${tone}`} style={style} aria-hidden="true">
      {/* Back first and face last: Safari paints 3D faces in this order, so the face must come last to sit on
          top. The scene never turns far enough to show the back. */}
      <div className="t3d-face t3d-back" />
      <div className="t3d-face t3d-right" />
      <div className="t3d-face t3d-left" />
      <div className="t3d-face t3d-top" />
      <div className="t3d-face t3d-bottom" />
      <div className="t3d-face t3d-front"><span>{char}</span><i className="t3d-sheen" /></div>
    </div>
  );
}

export function Menu({ inRound, rounds, tally, onPlay, onHistory, onSettings }: {
  /** A round is under way: the first button continues it. */
  inRound: boolean;
  rounds: number;
  tally: number;
  onPlay: () => void;
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
        target.y = Math.max(-45, Math.min(45, drag.ay + (e.clientX - drag.x) * 0.25));
        target.x = Math.max(-30, Math.min(30, drag.ax - (e.clientY - drag.y) * 0.2));
        return;
      }
      if (e.pointerType !== 'mouse') return;
      // Hovering: the scene turns gently towards the pointer.
      target.y = ((e.clientX / innerWidth) - 0.5) * 34;
      target.x = -((e.clientY / innerHeight) - 0.5) * 24;
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
      // The light glints across the faces as they turn.
      el.style.setProperty('--glint', `${(50 + now.y * 1.6).toFixed(1)}%`);
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
        <div className="menu-scene">
          <Tile3D char="中" tone="red" style={{ '--tx': '-62%', '--ty': '-30%', '--tz': '-260px', '--rot': '-16deg' } as CSSProperties} />
          <Tile3D char="發" tone="green" style={{ '--tx': '64%', '--ty': '26%', '--tz': '-200px', '--rot': '14deg' } as CSSProperties} />
          <Tile3D char="飛" tone="fei" style={{ '--tx': '0%', '--ty': '0%', '--tz': '0px', '--rot': '-4deg' } as CSSProperties} />
        </div>
        <div className="menu-floor" />
      </div>

      <div className="menu-front">
        <h2 className="menu-title">3P Mahjong</h2>
        <p className="menu-sub">Malaysian three-player mahjong · 三人麻將</p>
        <div className="menu-buttons">
          <button type="button" className="btn primary cta" onClick={onPlay}>{inRound ? 'Continue round' : 'Quick play'}</button>
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
