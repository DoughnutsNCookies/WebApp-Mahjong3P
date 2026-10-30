// Measures, from normal-bot games, who actually wins first once a player is ready, and fits the advanced
// bot's rates (P_PER_LIVE, H_PER_THREAT, H_PER_PROGRESS in src/bots/advanced.ts) to it.
// Usage: npx tsx scripts/calibrate.ts [rounds]

import { inputFromState, liveCounts, opponentThreats, resetWaitCache, shanten, waitsOf } from '../src/analyzer';
import { botAction, effectiveLive } from '../src/bots';
import { applyAction, newRound, waitingFor, wallLeft } from '../src/engine';

type Rec = { live: number; wall: number; threat: number; out: 'me' | 'other' | 'draw' };
const rounds = Number(process.argv[2] ?? 1500);
const recs: Rec[] = [];

for (let r = 0; r < rounds; r++) {
  let s = newRound(20000 + r, r % 3);
  const pending: { p: number; rec: Omit<Rec, 'out'> }[] = [];
  const marked = new Set<number>();
  while (s.phase !== 'ended') {
    s = applyAction(s, botAction(s, waitingFor(s)[0], 'normal'));
    // The first time each player is ready (13 tiles, one away) this round, note the situation.
    for (let q = 0; q < 3; q++) {
      const pl = s.players[q];
      if (marked.has(q) || s.phase === 'ended' || pl.hand.length + 3 * pl.melds.length !== 13) continue;
      if (shanten(pl.hand, pl.melds.length).best !== 0) continue;
      const input = inputFromState(s, q);
      resetWaitCache();
      const live = effectiveLive(waitsOf(input, pl.hand, liveCounts(input)).filter((w) => Math.max(w.fanDiscard, w.fanSelf) >= 5));
      if (!live) continue;
      marked.add(q);
      const threat = opponentThreats(input).reduce((a, t) => a + t.level, 0);
      pending.push({ p: q, rec: { live, wall: wallLeft(s), threat } });
    }
  }
  const res = s.result!;
  for (const { p, rec } of pending) recs.push({ ...rec, out: res.type === 'draw' ? 'draw' : res.winner === p ? 'me' : 'other' });
}

const model = (r: Rec, a: number, b: number, c: number) => {
  const p = Math.min(0.9, a * r.live);
  const h = Math.max(0.01, c * r.threat + b * (1 - Math.min(1, r.wall / 40)));
  const ends = 1 - Math.pow(Math.max(0, 1 - p - h), Math.max(1, Math.floor(r.wall / 3)));
  return { me: (p / (p + h)) * ends, other: (h / (p + h)) * ends, draw: 1 - ends };
};
const loss = (a: number, b: number, c: number) =>
  recs.reduce((s, r) => s - Math.log(Math.max(1e-6, model(r, a, b, c)[r.out])), 0) / recs.length;

let best = { a: 0, b: 0, c: 0, l: Infinity };
for (let a = 0.01; a <= 0.12; a += 0.0025) {
  for (let b = 0; b <= 0.3; b += 0.01) {
    for (let c = 0; c <= 0.5; c += 0.01) {
      const l = loss(a, b, c);
      if (l < best.l) best = { a, b, c, l };
    }
  }
}

console.log(`${recs.length} ready hands from ${rounds} rounds`);
console.log(`P_PER_LIVE = ${best.a.toFixed(4)}, H_PER_THREAT = ${best.c.toFixed(2)}, H_PER_PROGRESS = ${best.b.toFixed(2)}\n`);
const buckets: [string, (r: Rec) => boolean][] = [
  ['live <= 3', (r) => r.live <= 3], ['live 4-7', (r) => r.live > 3 && r.live < 8], ['live >= 8', (r) => r.live >= 8],
  ['wall < 15', (r) => r.wall < 15], ['wall 15-29', (r) => r.wall >= 15 && r.wall < 30], ['wall >= 30', (r) => r.wall >= 30],
];
for (const [label, f] of buckets) {
  const rs = recs.filter(f);
  const actual = rs.filter((r) => r.out === 'me').length / rs.length;
  const predicted = rs.reduce((s, r) => s + model(r, best.a, best.b, best.c).me, 0) / rs.length;
  console.log(`${label.padEnd(11)} n=${String(rs.length).padStart(5)}  won first: actual ${(actual * 100).toFixed(0)}%, model ${(predicted * 100).toFixed(0)}%`);
}
