// Plays random legal rounds in Node and counts what happened. Usage: npx tsx scripts/sim.ts [rounds]
// A sanity check that the engine runs outside the browser; real bots come in a later milestone.

import { applyAction, legalActions, makeRng, newRound, waitingFor } from '../src/engine';

const rounds = Number(process.argv[2] ?? 2000);
const rng = makeRng(1);
const counts: Record<string, number> = {};
const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

for (let seed = 1; seed <= rounds; seed++) {
  let s = newRound(seed, seed % 3);
  while (s.phase !== 'ended') {
    const p = waitingFor(s)[0];
    const legal = legalActions(s, p);
    const win = legal.find((a) => a.type === 'win' || a.type === 'selfWin' || a.type === 'openingSlam');
    // Claim and kong whenever possible to exercise those paths; otherwise discard at random.
    const claim = legal.find((a) => ['pong', 'claimKong', 'chow', 'kong'].includes(a.type));
    const a = win ?? (claim && rng() < 0.7 ? claim : legal[Math.floor(rng() * legal.length)]);
    bump(`action: ${a.type}`);
    s = applyAction(s, a);
  }
  const r = s.result!;
  bump(r.type === 'win' ? `result: win (${r.payment})` : 'result: draw');
  for (const it of r.score?.items ?? []) bump(`fan: ${it.label}`);
  if (r.loser.some((x) => x !== 0)) bump('loser settlement paid');
}

for (const k of Object.keys(counts).sort()) console.log(`${String(counts[k]).padStart(7)}  ${k}`);
