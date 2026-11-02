// Two-browser multiplayer check against a local server (see docs/MULTIPLAYER.md): a host creates a room on a
// desktop, a friend joins from the link on a phone, the host adds the AI and starts, discards, chats; the friend
// spams emoji. Needs: npm run build, and the server on port 3399 with ALLOWED_ORIGINS=http://localhost:3456.
// Usage: node scripts/multiplayer-check.mjs <screenshot folder>

import { chromium, webkit, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
const OUT = join(process.cwd(), 'out'); const DIR = process.argv[2];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const web = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (!p || p.endsWith('/') || p.endsWith('\\')) p += 'index.html';
  try { const b = await readFile(join(OUT, p)); res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404).end(); }
});
await new Promise((r) => web.listen(3456, r));
const SERVER = 'ws://localhost:3399/ws'; const errs = [];
const open = async (browser, ctx, name, url) => {
  const b = await browser.launch(); const c = await b.newContext(ctx); const page = await c.newPage();
  page.on('pageerror', (e) => errs.push(`${name}: ${e.message}`));
  await page.goto(`http://localhost:3456/?server=${encodeURIComponent(SERVER)}`);
  await page.evaluate((n) => localStorage.setItem('mj3p.v1.settings', JSON.stringify({ name: n, effects: 'calm', theme: 'ink', night: 'off' })), name);
  await page.goto(url); return { b, page };
};
// Sean (desktop) creates a room.
const host = await open(chromium, { viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] }, 'Sean', `http://localhost:3456/?server=${encodeURIComponent(SERVER)}`);
await host.page.getByRole('button', { name: 'Play with friends' }).click();
await host.page.getByRole('button', { name: 'Create a room' }).click();
const code = (await host.page.locator('.room-code').textContent()).trim();
console.log('room', code);
// Ali (phone) opens the shared link.
const friend = await open(webkit, devices['iPhone 13'], 'Ali', `http://localhost:3456/?room=${code}&server=${encodeURIComponent(SERVER)}`);
await friend.page.locator('.room-code').waitFor({ timeout: 10000 });
await host.page.getByText('Ali').first().waitFor();
await host.page.screenshot({ path: join(DIR, 'mp-1-lobby-host.png') });
// Sean fills the last seat with the AI and starts.
await host.page.getByRole('button', { name: 'Add bot' }).click();
await host.page.getByRole('button', { name: 'Start the game' }).click();
await host.page.locator('.table').waitFor({ timeout: 10000 }); await friend.page.locator('.table').waitFor({ timeout: 10000 });
// Sean is East (dealt first): discard by tapping a tile twice.
await host.page.locator('.hand-row.your-move').waitFor({ timeout: 10000 });
const t = host.page.locator('.hand-row .tile').last(); await t.evaluate((e) => e.click()); await t.evaluate((e) => e.click());
await friend.page.getByText(/Sean discarded/).waitFor({ timeout: 10000 });
console.log('Ali sees:', (await friend.page.locator('.caption').textContent()).trim());
const hidden = await friend.page.locator('.opp .tile.back').allTextContents();
console.log('Ali sees the other hands only as counts:', hidden.join(', '));
// Chat and emoji.
await host.page.getByRole('button', { name: /^Chat/ }).click();
await host.page.getByLabel('Message').fill('gg ali'); await host.page.getByLabel('Message').press('Enter');
await friend.page.locator('.chat-btn .badge').waitFor({ timeout: 5000 });
console.log('Ali unread badge:', await friend.page.locator('.chat-btn .badge').textContent());
for (let i = 0; i < 8; i++) await friend.page.getByRole('button', { name: 'Send 🔥' }).click();
await host.page.locator('.flying-emoji').first().waitFor({ timeout: 5000 });
console.log('emoji on Sean\'s screen:', await host.page.locator('.flying-emoji').count());
await host.page.screenshot({ path: join(DIR, 'mp-2-table-host.png') });
await friend.page.getByRole('button', { name: /^Chat/ }).click(); await friend.page.waitForTimeout(300);
await friend.page.screenshot({ path: join(DIR, 'mp-3-table-friend.png') });
// Ali drops out (closes the page): Sean sees it.
await friend.b.close();
await host.page.getByText('Disconnected').first().waitFor({ timeout: 5000 }).catch(() => {});
await host.b.close(); web.close(); console.log('errors:', errs.length ? errs : 'none');
