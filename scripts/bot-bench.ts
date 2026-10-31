// Bot vs bot across worker processes, duplicate format: every deal is played 6 times, once with each seating
// of the three bots (player 0 always deals), so tile luck cancels and differences are down to play.
// Usage: npx tsx scripts/bot-bench.ts [--deals 600] [--levels hard,normal,normal] [--seed 1000] [--workers 16]
//                                    [--hard '{"ukeire2":0.5}'] [--json out.json]
//   --hard  overrides for the hard bot's tunable weights (src/bots/hard.ts), for scripts/tune-bot.ts

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { botAction, BotLevel } from '../src/bots';
import { HARD } from '../src/bots/hard';
import { applyActionInPlace, newRound, waitingFor } from '../src/engine';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const deals = Number(opt('deals', '600'));
const levels = opt('levels', 'hard,normal,normal').split(',') as BotLevel[];
const seed = Number(opt('seed', '1000'));
const workers = Number(opt('workers', '16'));
const hardJson = opt('hard', '');
if (hardJson) Object.assign(HARD, JSON.parse(hardJson));
const SEATINGS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

if (args.includes('--worker')) {
  const [from, to] = [Number(opt('worker', '0')), Number(opt('to', '0'))];
  for (let d = from; d < to; d++) {
    const net = [0, 0, 0];
    const won = [0, 0, 0];
    const fed = [0, 0, 0];
    for (const seating of SEATINGS) {
      const g = newRound(seed + d, 0);
      while (g.phase !== 'ended') {
        const p = waitingFor(g)[0];
        applyActionInPlace(g, botAction(g, p, levels[seating[p]]));
      }
      const r = g.result!;
      r.total.forEach((x, p) => { net[seating[p]] += x; });
      if (r.type === 'win') {
        won[seating[r.winner!]]++;
        if (r.payer !== undefined) fed[seating[r.payer]]++;
      }
    }
    process.stdout.write(JSON.stringify({ d, net, won, fed }) + '\n');
  }
} else {
  void main();
}

async function main() {
  const perDeal: number[][] = [[], [], []];
  const won = [0, 0, 0];
  const fed = [0, 0, 0];
  let done = 0;
  const t0 = Date.now();
  const per = Math.ceil(deals / workers);
  const jobs = Array.from({ length: workers }, (_, w) => [w * per, Math.min(deals, (w + 1) * per)]).filter(([a, b]) => a < b);
  await Promise.all(jobs.map(([from, to]) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', process.argv[1], ...args, '--worker', String(from), '--to', String(to)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop()!;
      for (const line of lines) {
        const r = JSON.parse(line);
        r.net.forEach((x: number, b: number) => perDeal[b].push(x));
        r.won.forEach((x: number, b: number) => { won[b] += x; });
        r.fed.forEach((x: number, b: number) => { fed[b] += x; });
        if (++done % 100 === 0) process.stderr.write(`  ${done} of ${deals} deals, ${((Date.now() - t0) / 60000).toFixed(1)} min\n`);
      }
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${from}-${to} exited with ${code}`))));
  })));
  const rounds = deals * 6;
  const out = levels.map((l, b) => {
    const xs = perDeal[b];
    const mean = xs.reduce((a, x) => a + x, 0) / deals;
    const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, deals - 1));
    return { level: l, rm: mean / 6 / 100, margin: (2 * sd) / Math.sqrt(deals) / 6 / 100, wins: won[b] / rounds, dealIns: fed[b] / rounds };
  });
  console.log(`${deals} deals x 6 seatings = ${rounds} rounds in ${((Date.now() - t0) / 60000).toFixed(1)} min` + (hardJson ? ` (hard: ${hardJson})` : ''));
  for (const o of out) {
    console.log(`bot ${o.level.padEnd(8)}: ${o.rm >= 0 ? '+' : ''}${o.rm.toFixed(2)} RM/round +/- ${o.margin.toFixed(2)}, wins ${(100 * o.wins).toFixed(1)}%, deals in ${(100 * o.dealIns).toFixed(1)}%`);
  }
  const json = opt('json', '');
  if (json) writeFileSync(json, JSON.stringify({ deals, seed, levels, hard: hardJson ? JSON.parse(hardJson) : null, bots: out }));
}
