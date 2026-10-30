// Analyze a hand from the command line.
// Usage: npx tsx scripts/analyze.ts "<14 tiles>" [--seat 0|1|2] [--bonus "F1 A2"] [--wall 40]
// Example: npx tsx scripts/analyze.ts "123d 456d RdRdRd GdGdGd 9d 5d" --bonus "F1 S1 F4"

import { analyze } from '../src/analyzer';
import { code, parse, Seat } from '../src/engine';

const args = process.argv.slice(2);
const flag = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const a = analyze({
  seat: Number(flag('seat', '0')) as Seat,
  hand: parse(args[0] ?? ''),
  melds: [],
  bonus: parse(flag('bonus', '')),
  discardedJokers: 0,
  ownDiscards: [],
  opponents: [
    { player: 1, seat: 1, melds: [], discards: [], discardedJokers: 0, bonusCount: 0 },
    { player: 2, seat: 2, melds: [], discards: [], discardedJokers: 0, bonusCount: 0 },
  ],
  wallLeft: Number(flag('wall', '40')),
  bonusSeen: parse(flag('bonus', '')).length,
});

console.log(`Shanten now: ${a.shanten.best} (standard ${a.shanten.standard}, 7 pairs ${a.shanten.sevenPairs})\n`);
for (const o of a.options) {
  console.log(`Discard ${code(o.tile).padEnd(3)} shanten ${o.shanten}  live ${String(o.ukeireTotal).padStart(2)}  ` +
    `fan ~${o.fan.estimate} (5+: ${o.fan.reaches5})  risk ${o.safety.label}`);
  console.log(`    ${o.reasons.join('; ')}`);
  for (const p of o.fan.plans) console.log(`    plan: ${p.label} +${p.fan} (${p.status}) ${p.note}`);
}
console.log('\n' + a.advice.join('\n'));
