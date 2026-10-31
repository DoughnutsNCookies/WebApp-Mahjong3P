// Benchmark of the look-ahead player (search on top of the web AI) in evaluate.py's format: every deal is
// played with the AI in each of the three seats against two normal bots; deals come from seed*100000+d
// with player 0 dealing, so results pair deal by deal with evaluate.py's for the same seed.
//
// Usage: npx tsx scripts/search-bench.ts [--deals 300] [--seed 777] [--workers 16] [--candidates 4]
//                                        [--rollouts 24] [--plain] [--vs training/runs/v2n/test-777.json]
//   --plain  the web AI without search (reproduces evaluate.py's numbers for the same checkpoint)
//   --vs     an evaluate.py --json result on the same deals, for a deal-by-deal comparison
// Writes training/runs/search-<label>.json with the per-deal results.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { searchAction } from '../src/ai/search';
import { aiAction, parseModel, WEB_MODEL } from '../src/ai/web';
import { botAction } from '../src/bots';
import { applyActionInPlace, newRound, waitingFor } from '../src/engine';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const deals = Number(opt('deals', '300'));
const seed = Number(opt('seed', '777'));
const workers = Number(opt('workers', '16'));
const candidates = Number(opt('candidates', '4'));
const rollouts = Number(opt('rollouts', '24'));
const plain = args.includes('--plain');
const vs = opt('vs', '');

if (args.includes('--worker')) {
  // One slice of deals; each finished round is one JSON line on stdout.
  const [from, to] = [Number(opt('worker', '0')), Number(opt('to', '0'))];
  const weights = readFileSync(`public/ai/${WEB_MODEL.file}`);
  const model = parseModel(weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength));
  for (let d = from; d < to; d++) {
    for (let s = 0; s < 3; s++) {
      const g = newRound(seed * 100000 + d, 0);
      let decisions = 0;
      const t0 = Date.now();
      while (g.phase !== 'ended') {
        const p = waitingFor(g)[0];
        let a;
        if (p !== s) a = botAction(g, p, 'normal');
        else if (plain || g.phase !== 'turn') a = aiAction(g, p, model);
        else { a = searchAction(g, p, model, { candidates, rollouts }); decisions++; }
        applyActionInPlace(g, a);
      }
      process.stdout.write(JSON.stringify({ d, s, rm: g.result!.total[s] / 100, decisions, ms: Date.now() - t0, won: g.result!.winner === s, fed: g.result!.payer === s && g.result!.winner !== s }) + '\n');
    }
  }
} else {
  void main();
}

async function main() {
  const perDeal: number[][] = Array.from({ length: deals }, () => []);
  let rounds = 0, decisions = 0, ms = 0, won = 0, fed = 0;
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
        perDeal[r.d].push(r.rm);
        rounds++; decisions += r.decisions; ms += r.ms; won += r.won ? 1 : 0; fed += r.fed ? 1 : 0;
        if (rounds % 50 === 0) process.stderr.write(`  ${rounds} of ${deals * 3} rounds, ${((Date.now() - t0) / 60000).toFixed(1)} min\n`);
      }
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${from}-${to} exited with ${code}`))));
  })));
  const dealRm = perDeal.map((xs) => xs.reduce((a, x) => a + x, 0) / xs.length);
  const mean = dealRm.reduce((a, x) => a + x, 0) / deals;
  const sd = Math.sqrt(dealRm.reduce((a, x) => a + (x - mean) ** 2, 0) / (deals - 1));
  const label = plain ? 'plain' : `search-c${candidates}-r${rollouts}`;
  console.log(`${WEB_MODEL.name} ${plain ? 'without search' : `with look-ahead (${candidates} candidates x ${rollouts} rollouts)`}: ` +
    `${rounds} rounds vs two normal bots: ${mean >= 0 ? '+' : ''}${mean.toFixed(2)} RM/round +/- ${(2 * sd / Math.sqrt(deals)).toFixed(2)}` +
    (plain ? '' : `; ${(ms / Math.max(1, decisions)).toFixed(0)} ms per searched decision`) + `; ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  console.log(`wins ${(100 * won / rounds).toFixed(1)}% of rounds, deals in ${(100 * fed / rounds).toFixed(1)}%`);
  if (vs) {
    const other: number[] = JSON.parse(readFileSync(vs, 'utf8')).per_deal.slice(0, deals);
    const d = dealRm.map((x, i) => x - other[i]);
    const dm = d.reduce((a, x) => a + x, 0) / deals;
    const dsd = Math.sqrt(d.reduce((a, x) => a + (x - dm) ** 2, 0) / (deals - 1));
    console.log(`deal by deal against ${vs}: ${dm >= 0 ? '+' : ''}${dm.toFixed(2)} +/- ${(2 * dsd / Math.sqrt(deals)).toFixed(2)} RM/round`);
  }
  mkdirSync('training/runs', { recursive: true });
  writeFileSync(`training/runs/search-${label}-${seed}.json`, JSON.stringify({ rm_per_round: mean, margin: 2 * sd / Math.sqrt(deals), rounds, per_deal: dealRm }));
}
