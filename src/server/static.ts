// Serves the game itself (the static export in `out/`, deployed as `site/`) from the same Node server that
// runs the rooms, so the whole game lives on one domain.
//
// Caching: Next's fingerprinted files (/_next/static/...) and the AI's weights (the file name carries a hash)
// are kept by browsers and Cloudflare for a year; everything else is checked every time, so a deploy shows
// at once. Paths are resolved inside the folder only (no "../" escapes).

import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.bin': 'application/octet-stream', '.webmanifest': 'application/manifest+json',
};

const forever = (url: string) => url.startsWith('/_next/static/') || /^\/ai\/[^/]+-[0-9a-f]{8,}\.bin$/.test(url);

function file(root: string, urlPath: string): { path: string; size: number; mtime: Date } | null {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  const candidates = clean === '' || clean.endsWith(sep) || clean.endsWith('/')
    ? [join(clean, 'index.html')]
    : [clean, `${clean}.html`, join(clean, 'index.html')];
  for (const c of candidates) {
    const path = join(root, c);
    if (!path.startsWith(root + sep) && path !== root) continue; // stays inside the site folder
    try {
      const st = statSync(path);
      if (st.isFile()) return { path, size: st.size, mtime: st.mtime };
    } catch { /* try the next */ }
  }
  return null;
}

/** Answers a GET or HEAD from the site folder; false if it isn't one (the caller sends 404/405). */
export function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const url = new URL(req.url ?? '/', 'http://x').pathname;
  let f = file(root, url);
  let status = 200;
  if (!f) {
    f = file(root, '404.html');
    status = 404;
    if (!f) return false;
  }
  const headers = {
    'content-type': TYPES[extname(f.path)] ?? 'application/octet-stream',
    'content-length': f.size,
    'last-modified': f.mtime.toUTCString(),
    'cache-control': status === 200 && forever(url) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  };
  const since = req.headers['if-modified-since'];
  if (status === 200 && since && new Date(since).getTime() >= Math.floor(f.mtime.getTime() / 1000) * 1000) {
    res.writeHead(304, { 'last-modified': headers['last-modified'], 'cache-control': headers['cache-control'] as string });
    res.end();
    return true;
  }
  res.writeHead(status, headers);
  if (req.method === 'HEAD') res.end();
  else createReadStream(f.path).pipe(res);
  return true;
}
