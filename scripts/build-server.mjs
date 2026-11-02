// Bundles the multiplayer server (src/server/main.ts, the rules engine, the bots and the ws library) into one
// file, server-dist/server.mjs, so the server needs nothing but Node to run. Also copies the AI's weights.
// Usage: npm run build:server

import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';

await build({
  entryPoints: ['src/server/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'server-dist/server.mjs',
  // ws can use these optional native speed-ups; it works without them.
  external: ['bufferutil', 'utf-8-validate'],
  // ws is CommonJS: give it `require` inside the ES module bundle.
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});

const { file } = JSON.parse(readFileSync('src/ai/web-model.json', 'utf8'));
mkdirSync('server-dist/ai', { recursive: true });
copyFileSync(`public/ai/${file}`, `server-dist/ai/${file}`);
console.log(`copied the AI weights: server-dist/ai/${file}`);
