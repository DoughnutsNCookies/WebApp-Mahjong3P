// Applies the table style from Settings to the page: html[data-theme], [data-mode] (day or night) and
// [data-effects]. Night "auto" follows the phone's dark mode and changes with it. The same logic runs
// before the first paint from layout.tsx; keep the two in step.

import { useEffect } from 'react';
import { setSoundEnabled } from './sound';
import type { Settings } from './storage';

const BAR = { ink: { day: '#f3eee3', night: '#15130f' }, macau: { day: '#17603f', night: '#0a2e20' } };

export function useLook(s: Settings) {
  useEffect(() => {
    const dark = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const d = document.documentElement;
      const mode = s.night === 'on' || (s.night === 'auto' && dark.matches) ? 'night' : 'day';
      d.dataset.theme = s.theme;
      d.dataset.mode = mode;
      d.dataset.effects = s.effects;
      // The phone's status bar colour follows the table.
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[s.theme][mode]);
    };
    apply();
    dark.addEventListener('change', apply);
    return () => dark.removeEventListener('change', apply);
  }, [s.theme, s.night, s.effects]);

  useEffect(() => setSoundEnabled(s.sound), [s.sound]);
}
