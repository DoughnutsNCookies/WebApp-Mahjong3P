import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '3P Mahjong trainer',
  description: 'Malaysian 3-player mahjong against two bots, with a hand analyzer, hints and post-hand review.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f3eee3',
};

// Applies the saved table style before the first paint (the app itself renders in the browser only).
// Keep in step with applyLook() in src/ui/look.ts.
const LOOK = `try{var s=JSON.parse(localStorage.getItem('mj3p.v1.settings')||'{}'),d=document.documentElement,n=s.night||'auto';
d.dataset.theme=s.theme||'ink';d.dataset.effects=s.effects||'full';
d.dataset.mode=n==='on'||(n==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches)?'night':'day';}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="ink" data-mode="day" data-effects="full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LOOK }} />
        <link rel="preload" href="/fonts/brush-subset.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/serif-heavy-subset.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body>{children}</body>
    </html>
  );
}
