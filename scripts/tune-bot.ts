// Tunes the hard bot's weights by playing it against two normal bots in the duplicate format (bot-bench.ts)
// and keeping any change that earns more: coordinate search, each weight tried larger and smaller in turn.
// Usage: npx tsx scripts/tune-bot.ts [--deals 600] [--passes 2] [--step 1.5] [--workers 16]
// Prints every trial and ends with the best weights found; paste them into HARD in src/bots/hard.ts.

import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { HARD } from '../src/bots/hard';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const deals = opt('deals', '600');
const passes = Number(opt('passes', '2'));
const step = Number(opt('step', '1.5'));
const workers = opt('workers', '16');
const PARAMS = ['ukeire2', 'ukeire', 'fan', 'defence'] as const;

function measure(weights: Record<string, number>): { rm: number; margin: number } {
  const out = `tune-${Date.now()}.json`;
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/bot-bench.ts', '--deals', deals, '--workers', workers, '--levels', 'hard,normal,normal',
    '--hard', JSON.stringify(weights), '--json', out], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) throw new Error('bot-bench failed');
  const bot = JSON.parse(readFileSync(out, 'utf8')).bots[0];
  unlinkSync(out);
  return { rm: bot.rm, margin: bot.margin };
}

const show = (w: Record<string, number>) => JSON.stringify(Object.fromEntries(PARAMS.map((p) => [p, +w[p].toFixed(3)])));
let best: Record<string, number> = { ukeire2: HARD.ukeire2, ukeire: HARD.ukeire, fan: HARD.fan, defence: HARD.defence };
let bestRm = measure(best).rm;
console.log(`start ${show(best)}: ${bestRm >= 0 ? '+' : ''}${bestRm.toFixed(3)} RM/round vs two normal bots`);
for (let pass = 1; pass <= passes; pass++) {
  for (const p of PARAMS) {
    for (const factor of [step, 1 / step]) {
      const trial = { ...best, [p]: best[p] === 0 ? (factor > 1 ? 0.25 : 0) : best[p] * factor };
      const { rm, margin } = measure(trial);
      const better = rm > bestRm;
      console.log(`pass ${pass} ${p} x${factor.toFixed(2)} -> ${show(trial)}: ${rm >= 0 ? '+' : ''}${rm.toFixed(3)} +/- ${margin.toFixed(3)}${better ? '  <- kept' : ''}`);
      if (better) { best = trial; bestRm = rm; break; }
    }
  }
}
console.log(`\nbest ${show(best)}: ${bestRm >= 0 ? '+' : ''}${bestRm.toFixed(3)} RM/round. Paste into HARD in src/bots/hard.ts.`);
