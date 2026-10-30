// Rebuilds a hand from a "Copy for Claude" export and prints the full report plus every move, with all
// hands visible. Usage: npx tsx scripts/import.ts <file with the pasted text>   (or pipe it on stdin)

import { readFileSync } from 'node:fs';
import { roundReport } from '../src/analyzer';
import { applyAction, code, decodeRound, DEFAULT_RULES, encodeAction, format, newRound } from '../src/engine';

const text = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : readFileSync(0, 'utf8');
const r = decodeRound(text);
const rules = { ...DEFAULT_RULES, unitSen: r.unitSen };

console.log(roundReport({ ...r, rules }));
console.log('\nEvery move (all hands visible):');
let s = newRound(r.seed, r.dealer, rules);
console.log(`Deal: ${s.players.map((p, i) => `P${i} ${format(p.hand)} | bonus ${format(p.bonus)}`).join('  /  ')}`);
r.actions.forEach((a, i) => {
  const before = s;
  s = applyAction(s, a);
  const drew = s.phase === 'turn' && s.turnDrew && s.lastDrawn !== null && s.turn !== before.turn ? `  -> P${s.turn} draws ${code(s.lastDrawn)}` : '';
  console.log(`${String(i + 1).padStart(3)}. ${encodeAction(a).padEnd(10)} wall ${String(s.tail - s.head).padStart(2)}${drew}`);
});
console.log(`End hands: ${s.players.map((p, i) => `P${i} ${format(p.hand)}`).join('  /  ')}`);
