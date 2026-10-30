'use client';

// The game lives entirely in the browser (it reads saved games from localStorage on start), so it is
// not prerendered: the static page shows a short placeholder until the script loads.

import dynamic from 'next/dynamic';

export const ClientApp = dynamic(() => import('./App').then((m) => m.App), {
  ssr: false,
  loading: () => <p style={{ padding: 16 }}>Loading the table…</p>,
});
