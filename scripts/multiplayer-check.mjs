// Two-browser multiplayer check (see docs/MULTIPLAYER.md): a host creates a room on a desktop, a friend joins
// from the link on a phone, the host adds the AI and starts, discards, chats; the friend spams emoji.
// Usage: node scripts/multiplayer-check.mjs <screenshot folder> [game address, default http://localhost:3399]

import { chromium, webkit, devices } from 'playwright';
import { join } from 'node:path';
const DIR = process.argv[2];
// The game and its rooms on one address (the Node server serving out/), default the local one.
const BASE = (process.argv[3] ?? 'http://localhost:3399').replace(/\/$/, '');
const errs = [];
const open = async (browser, ctx, name, url) => {
  const b = await browser.launch(); const c = await b.newContext(ctx); const page = await c.newPage();
  page.on('pageerror', (e) => errs.push(`${name}: ${e.message}`));
  await page.goto(`${BASE}/`);
  await page.evaluate((n) => localStorage.setItem('mj3p.v1.settings', JSON.stringify({ name: n, effects: 'calm', theme: 'ink', night: 'off' })), name);
  await page.goto(url); return { b, page };
};
// Sean (desktop) creates a room.
const host = await open(chromium, { viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] }, 'Sean', `${BASE}/`);
await host.page.getByRole('button', { name: 'Play with friends' }).click();
await host.page.getByRole('button', { name: 'Create a room' }).click();
const code = (await host.page.locator('.room-code').textContent()).trim();
console.log('room', code);
// Ali (phone) opens the shared link.
const friend = await open(webkit, devices['iPhone 13'], 'Ali', `${BASE}/?room=${code}`);
await friend.page.locator('.room-code').waitFor({ timeout: 10000 });
await host.page.getByText('Ali').first().waitFor();
await host.page.screenshot({ path: join(DIR, 'mp-1-lobby-host.png') });
// Sean fills the last seat with the AI and starts.
await host.page.getByRole('button', { name: 'Add bot' }).click();
await host.page.getByRole('button', { name: 'Start the game' }).click();
await host.page.locator('.table').waitFor({ timeout: 10000 }); await friend.page.locator('.table').waitFor({ timeout: 10000 });
// Sean is East (dealt first): discard by tapping a tile twice.
await host.page.locator('.hand-row.your-move').waitFor({ timeout: 10000 });
// The first tile is never a fei (they sort last, and can't be discarded).
const t = host.page.locator('.hand-row .tile').first(); await t.evaluate((e) => e.click()); await t.evaluate((e) => e.click());
// Ali sees Sean's discard in Sean's row (Sean sits on Ali's left), even if someone claimed it at once.
await friend.page.locator('.opp').first().locator('.zone', { hasText: 'Discards' }).locator('.tile').first().waitFor({ timeout: 10000 });
console.log('Ali sees Sean\'s discard row:', await friend.page.locator('.opp').first().locator('.zone', { hasText: 'Discards' }).locator('.tile').count(), 'tile(s)');
const hidden = await friend.page.locator('.opp .tile.back').allTextContents();
console.log('Ali sees the other hands only as counts:', hidden.join(', '));
// Chat and emoji.
await host.page.getByRole('button', { name: /^Chat/ }).click();
await host.page.getByLabel('Message').fill('gg ali'); await host.page.getByLabel('Message').press('Enter');
await friend.page.locator('.chat-btn .badge').waitFor({ timeout: 5000 });
console.log('Ali unread badge:', await friend.page.locator('.chat-btn .badge').textContent());
// On a phone the emoji row is folded behind one button.
await friend.page.getByRole('button', { name: 'Show emoji' }).click();
for (let i = 0; i < 8; i++) await friend.page.getByRole('button', { name: 'Send \u{1F525}' }).click();
await host.page.locator('.flying-emoji').first().waitFor({ timeout: 5000 });
console.log('emoji on Sean\'s screen:', await host.page.locator('.flying-emoji').count());
await host.page.screenshot({ path: join(DIR, 'mp-2-table-host.png') });
await friend.page.getByRole('button', { name: /^Chat/ }).click(); await friend.page.waitForTimeout(300);
await friend.page.screenshot({ path: join(DIR, 'mp-3-table-friend.png') });
// Ali drops out (closes the page): Sean sees it.
await friend.b.close();
await host.page.getByText('Disconnected').first().waitFor({ timeout: 5000 }).catch(() => {});
await host.b.close(); console.log('errors:', errs.length ? errs : 'none');
