// Bot vs bot in Node, duplicate format: every deal is played 6 times, once with each seating of the
// three bots (player 0 always deals). Tile luck cancels out, so differences are down to play.
// Usage: npx tsx scripts/bots.ts [deals] [levels, e.g. normal,easy,easy or ai,normal,normal] [first seed]
// "ai" is the trained AI exactly as the web game runs it (public/ai/, see src/ai/web.ts).

import { readFileSync } from 'node:fs';
import { aiAction, parseModel, WEB_MODEL } from '../src/ai/web';
import { botAction, BotLevel } from '../src/bots';
import { applyAction, legalActions, newRound, rm, waitingFor } from '../src/engine';

const deals = Number(process.argv[2] ?? 200);
const levels = (process.argv[3] ?? 'normal,easy,easy').split(',') as (BotLevel | 'ai')[];
const weights = levels.includes('ai') ? readFileSync(`public/ai/${WEB_MODEL.file}`) : null;
const ai = weights && parseModel(weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength));
const firstSeed = Number(process.argv[4] ?? 1000);
const SEATINGS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

const perDeal: number[][] = [[], [], []]; // each bot's net per deal (summed over its 6 seatings)
const wins = [0, 0, 0];
const dealIns = [0, 0, 0];
const fanSum = [0, 0, 0];
const declined = [0, 0, 0];
let draws = 0;
const t0 = Date.now();

for (let d = 0; d < deals; d++) {
  const net = [0, 0, 0];
  for (const seating of SEATINGS) {
    const botAt = (p: number) => seating[p];
    let s = newRound(firstSeed + d, 0);
    while (s.phase !== 'ended') {
      const p = waitingFor(s)[0];
      const level = levels[botAt(p)];
      const a = level === 'ai' ? aiAction(s, p, ai!) : botAction(s, p, level);
      const canWin = legalActions(s, p).some((x) => x.type === 'win' || x.type === 'selfWin');
      if (canWin && a.type !== 'win' && a.type !== 'selfWin') declined[botAt(p)]++;
      s = applyAction(s, a);
    }
    const res = s.result!;
    res.total.forEach((x, p) => (net[botAt(p)] += x));
    if (res.type === 'draw') draws++;
    else {
      wins[botAt(res.winner!)]++;
      fanSum[botAt(res.winner!)] += res.score!.fan;
      if (res.payer !== undefined) dealIns[botAt(res.payer)]++;
    }
  }
  net.forEach((x, b) => perDeal[b].push(x));
}

const rounds = deals * 6;
console.log(`${deals} deals x 6 seatings = ${rounds} rounds in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${draws} draws\n`);
levels.forEach((l, b) => {
  const xs = perDeal[b];
  const mean = xs.reduce((a, x) => a + x, 0) / deals;
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, deals - 1));
  // Per round, with a 95% margin (2 standard errors).
  const perRound = mean / 6;
  const margin = (2 * sd) / Math.sqrt(deals) / 6;
  console.log(`bot ${b} (${l.padEnd(8)}): ${rm(Math.round(perRound)).padStart(7)}/round +/- ${rm(Math.round(margin))}, ` +
    `won ${wins[b]} (avg ${(fanSum[b] / Math.max(1, wins[b])).toFixed(1)} fan), dealt in ${dealIns[b]}, declined ${declined[b]} wins`);
});
