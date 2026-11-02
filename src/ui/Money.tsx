'use client';

// An amount of money that rolls to its new value instead of jumping, with the change floating up from it
// ("+RM0.40" in green, "-RM0.40" in red). Used for every player's money on the table and your tally.

import { useEffect, useRef, useState } from 'react';
import { rmShort } from './format';

const ROLL_MS = 900;

export function Money({ value, title }: { value: number; title?: string }) {
  const [shown, setShown] = useState(value);
  const [delta, setDelta] = useState<{ id: number; sen: number } | null>(null);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    from.current = value;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = reduced ? 1 : Math.min(1, (t - t0) / ROLL_MS);
      const eased = 1 - (1 - k) ** 3;
      setShown(Math.round(start + (value - start) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame((t) => {
      setDelta({ id: t, sen: value - start });
      step(t);
    });
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <span className={`money${shown < 0 ? ' neg' : ''}`} title={title}>
      {rmShort(shown)}
      {delta && (
        <span key={delta.id} className={`money-delta${delta.sen < 0 ? ' neg' : ''}`} aria-hidden="true">
          {delta.sen > 0 ? '+' : ''}{rmShort(delta.sen).replace(/^\+/, '')}
        </span>
      )}
    </span>
  );
}
