// Smoke test of the built site (run `npm run build` first): plays a full round in a phone-sized WebKit
// (iPhone Safari's engine) and a desktop Chromium window, following the hint, then checks the result,
// review, saved hands, replay, and resuming after a refresh. Screenshots go to .ui-check/.
// Usage: node scripts/ui-check.mjs [url]   (no url: serves the local out/ folder)

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium, devices, webkit } from 'playwright';

const OUT = join(process.cwd(), 'out');
const SHOTS = join(process.cwd(), '.ui-check');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain', '.ico': 'image/x-icon', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (!path || path.endsWith('/') || path.endsWith('\\')) path += 'index.html';
  try {
    const body = await readFile(join(OUT, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
const target = process.argv[2];
if (!target) await new Promise((r) => server.listen(0, r));
const base = target ?? `http://localhost:${server.address().port}/`;
await mkdir(SHOTS, { recursive: true });

const failures = [];
const runs = [
  { name: 'phone-webkit', browser: webkit, context: { ...devices['iPhone 13'] } },
  { name: 'desktop-chromium', browser: chromium, context: { viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] } },
];

for (const run of runs) {
  const browser = await run.browser.launch();
  const context = await browser.newContext(run.context);
  const page = await context.newPage();
  const errors = [];
  // Cloudflare injects its analytics beacon (/cdn-cgi/rum) on the live site; WebKit blocks it. Not ours.
  const ignored = (text) => text.includes('/cdn-cgi/');
  page.on('pageerror', (e) => { if (!ignored(e.message)) errors.push(`page error: ${e.message}`); });
  page.on('console', (m) => { if (m.type() === 'error' && !ignored(m.text())) errors.push(`console: ${m.text()}`); });
  const shot = (n) => page.screenshot({ path: join(SHOTS, `${run.name}-${n}.png`), fullPage: true });
  const fail = (msg) => failures.push(`${run.name}: ${msg}`);

  await page.goto(base);
  await page.evaluate(() => localStorage.setItem('mj3p.v1.settings', JSON.stringify({ speed: 'fast' })));
  await page.reload();
  await page.getByRole('navigation', { name: 'Main' }).waitFor();
  await shot('1-start');

  let hintShot = false;
  let refreshed = false;
  let moves = 0;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await page.getByRole('dialog', { name: 'Round result' }).isVisible()) break;

    const prompt = page.getByRole('group', { name: 'Your choice' });
    if (await prompt.isVisible()) {
      const hu = prompt.getByRole('button', { name: /^Hu!|Opening Slam/ });
      await ((await hu.count()) ? hu.first() : prompt.getByRole('button', { name: 'Pass' })).click();
      moves++;
      continue;
    }

    const discardBtn = page.getByRole('button', { name: /^Discard|^Jokers are set aside/ });
    if (await discardBtn.isVisible()) {
      const win = page.getByRole('button', { name: /^Hu!/ });
      if (await win.count()) { await win.first().click(); moves++; continue; }
      const hintBtn = page.getByRole('button', { name: 'Hint', exact: true });
      if (await hintBtn.isVisible()) await hintBtn.click();
      const best = page.locator('.hand-row .tile.mark-best').first();
      await best.waitFor({ timeout: 5000 }).catch(() => {});
      if (!hintShot) { await shot('2-hint'); hintShot = true; }
      if (await best.count()) {
        await best.click();
        await best.click();
      } else {
        // No hint target (e.g. only jokers left to act on): set a joker aside if offered.
        const aside = page.getByRole('button', { name: /^Set joker aside/ });
        if (await aside.count()) await aside.click();
        else { fail('my turn but no hint and no joker action'); break; }
      }
      moves++;
      // Once, part-way through, refresh and check the round resumes where it was.
      if (!refreshed && moves === 3) {
        const wallBefore = await page.locator('.status-line .muted').first().textContent();
        await page.reload();
        await page.getByRole('navigation', { name: 'Main' }).waitFor();
        const wallAfter = await page.locator('.status-line .muted').first().textContent();
        if (wallBefore !== wallAfter) fail(`refresh lost the round (${wallBefore} -> ${wallAfter})`);
        refreshed = true;
      }
      continue;
    }
    await page.waitForTimeout(150);
  }

  const result = page.getByRole('dialog', { name: 'Round result' });
  if (!(await result.isVisible())) fail('round did not finish within 2 minutes');
  else {
    await shot('3-result');
    if (run.name === 'desktop-chromium') {
      // Copy for Claude: the clipboard gets a report ending in a replay code.
      await result.getByRole('button', { name: 'Copy for Claude' }).click();
      await result.getByRole('button', { name: 'Copied ✓' }).waitFor({ timeout: 15000 }).catch(() => fail('Copy for Claude did not confirm'));
      const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
      if (!copied.startsWith('3P Mahjong hand') || !/^MJ3P1\|seed=\d+/m.test(copied)) fail('copied report is incomplete');
    }
    await result.getByRole('button', { name: 'Review my play' }).click();
    await page.getByRole('heading', { name: 'Review' }).waitFor();
    await page.getByText('Analysing your play…').waitFor({ state: 'detached', timeout: 20000 }).catch(() => fail('review never finished'));
    await shot('4-review');
    await page.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: 'Hands' }).click();
    const replayBtn = page.getByRole('button', { name: 'Replay' }).first();
    if (!(await replayBtn.count())) fail('finished hand was not saved');
    else {
      await replayBtn.click();
      const slider = page.getByRole('slider', { name: 'Move through the hand' });
      await slider.fill(String(Math.min(12, Number(await slider.getAttribute('max')))));
      await shot('5-replay');
    }
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Stake per fan (RM)').waitFor();
    await shot('6-settings');
  }

  // Horizontal overflow means something doesn't fit the screen.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) fail(`page is ${overflow}px wider than the screen`);
  for (const e of errors) fail(e);
  console.log(`${run.name}: ${moves} moves, ${errors.length} errors`);
  await browser.close();
}

if (!target) server.close();
if (failures.length) {
  console.log('\nFAILED:\n' + failures.join('\n'));
  process.exit(1);
}
console.log(`\nAll checks passed. Screenshots in ${SHOTS}`);
