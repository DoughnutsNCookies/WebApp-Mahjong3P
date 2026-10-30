// Bot vs bot in Node. Seats rotate so every bot plays every seat equally.
// Usage: npx tsx scripts/bots.ts [rounds] [levels, e.g. normal,easy,easy]

import { botAction, BotLevel } from '../src/bots';
import { applyAction, newRound, rm, waitingFor } from '../src/engine';

const rounds = Number(process.argv[2] ?? 300);
const levels = (process.argv[3] ?? 'normal,easy,easy').split(',') as BotLevel[];

const money = [0, 0, 0];
const wins = [0, 0, 0];
const dealIns = [0, 0, 0];
const fanSum = [0, 0, 0];
let draws = 0;
const t0 = Date.now();

for (let r = 0; r < rounds; r++) {
  // Bot b sits in player slot (b + r) % 3, so each bot deals and plays each seat in turn.
  const botAt = (p: number) => (p - r + 3 * rounds) % 3;
  let s = newRound(1000 + r, r % 3);
  while (s.phase !== 'ended') {
    const p = waitingFor(s)[0];
    s = applyAction(s, botAction(s, p, levels[botAt(p)]));
  }
  const res = s.result!;
  res.total.forEach((d, p) => (money[botAt(p)] += d));
  if (res.type === 'draw') draws++;
  else {
    wins[botAt(res.winner!)]++;
    fanSum[botAt(res.winner!)] += res.score!.fan;
    if (res.payer !== undefined) dealIns[botAt(res.payer)]++;
  }
}

console.log(`${rounds} rounds in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${draws} draws\n`);
levels.forEach((l, b) => {
  console.log(`bot ${b} (${l.padEnd(6)}): ${rm(money[b]).padStart(10)} total, ${rm(Math.round(money[b] / rounds)).padStart(7)}/round, ` +
    `won ${wins[b]} (avg ${(fanSum[b] / Math.max(1, wins[b])).toFixed(1)} fan), dealt in ${dealIns[b]}`);
});
