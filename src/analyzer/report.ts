// A plain-text report of one round from player 0's seat, for copying into a chat: the result and every
// payment, each of your decisions next to the analyzer's, and a replay code that rebuilds the round.

import {
  Action, applyAction, CAP, code, DEFAULT_RULES, encodeRound, format, GameState, newRound, rm, Rules, SEAT_NAMES,
  seatOf,
} from '../engine';
import { reviewRound } from './review';

export interface ReportInput {
  seed: number;
  dealer: number;
  actions: Action[];
  rules?: Rules;
  /** Bot levels for players 1 and 2. */
  levels?: string[];
  date?: string;
}

const VERDICT = { best: 'ok', fine: 'fine', mistake: 'MISTAKE', 'big mistake': 'BIG MISTAKE' } as const;

export function roundReport(r: ReportInput): string {
  const rules = r.rules ?? DEFAULT_RULES;
  const names = ['You', `Bot 1${r.levels ? ` (${r.levels[0]})` : ''}`, `Bot 2${r.levels ? ` (${r.levels[1]})` : ''}`];
  const states: GameState[] = [newRound(r.seed, r.dealer, rules)];
  for (const a of r.actions) states.push(applyAction(states[states.length - 1], a));
  const end = states[states.length - 1];
  const res = end.result;
  const lines: string[] = [];

  lines.push(`3P Mahjong hand${r.date ? `, ${r.date.slice(0, 16).replace('T', ' ')}` : ''}`);
  lines.push(`You: ${SEAT_NAMES[seatOf(end, 0)]}${r.dealer === 0 ? ' (dealer)' : ''}. Stake ${rm(rules.unitSen)}/fan. ` +
    `Bots: ${names.slice(1).join(', ')}.`);

  if (!res) {
    lines.push(`Result: not finished (${r.actions.length} moves so far, wall ${end.tail - end.head}).`);
  } else if (res.type === 'draw') {
    lines.push('Result: draw, the wall ran out. Only fei and kong money settled.');
  } else {
    const how = res.payment === 'self' ? 'self-drawn' : `off ${res.payer === 0 ? 'your' : names[res.payer!] + "'s"} discard`;
    lines.push(`Result: ${names[res.winner!]} won ${res.score!.fan} fan, ${how}: ` +
      res.score!.items.map((i) => `${i.label} ${i.fan}`).join(', ') +
      (res.score!.rawFan > CAP ? ` (${res.score!.rawFan}, capped at ${CAP})` : '') + '.');
  }
  if (res) {
    const money = (d: number[]) => d.map((x, p) => `${names[p]} ${x >= 0 ? '+' : ''}${rm(x)}`).join(', ');
    lines.push(`Money: ${money(res.total)} (fan payout: ${money(res.fanPayout)}; fei: ${money(res.fei)}; loser settlement: ${money(res.loser)}; kong money: ${money(res.kong ?? [0, 0, 0])}).`);
    if (res.loserFans) lines.push(`Loser settlement fan: ${res.loserFans.map((l, p) => (p === res.winner ? null : `${names[p]} ${l.fan}`)).filter(Boolean).join(', ')}.`);
    lines.push(`Final hands: ${end.players.map((pl, p) => `${names[p]} ${format(pl.hand)}` +
      (pl.melds.length ? ` + ${pl.melds.map((m) => `[${m.slots.map((s) => (s.joker ? 'J' : code(s.kind))).join(' ')}]`).join(' ')}` : '') +
      (pl.bonus.length || pl.discardedJokers ? ` | bonus ${format(pl.bonus)}${pl.discardedJokers ? ` +${pl.discardedJokers} fei set aside` : ''}` : '')).join('; ')}.`);
  }

  const items = reviewRound(r.seed, r.dealer, r.actions, 0, rules);
  lines.push('');
  lines.push(items.length ? 'Your decisions (analyzer):' : 'You made no discards.');
  items.forEach((it, n) => {
    const before = states[it.actionIndex];
    const drew = before.phase === 'turn' && before.turn === 0 && before.turnDrew && before.lastDrawn !== null ? ` drew ${code(before.lastDrawn)},` : '';
    const melds = before.players[0].melds.length
      ? ` + ${before.players[0].melds.map((m) => `[${m.slots.map((s) => (s.joker ? 'J' : code(s.kind))).join(' ')}]`).join(' ')}`
      : '';
    if (it.kind === 'missedWin') {
      lines.push(`${n + 1}. Wall ${it.wallLeft}: MISSED WIN. ${it.note}`);
      return;
    }
    const verdict = VERDICT[it.verdict];
    const alt = it.best !== it.played ? ` analyzer: ${code(it.best!)}.` : '';
    lines.push(`${n + 1}. Wall ${it.wallLeft}: ${format(it.hand)}${melds},${drew} played ${code(it.played!)}.${alt} [${verdict}]` +
      (it.verdict === 'best' ? '' : ` ${it.note}`));
  });

  lines.push('');
  lines.push('Tiles: 1d-9d dots, E S W N winds, Rd Gd Wd dragons, J fei, F1-F4 flowers, S1-S4 seasons, A1-A8 other bonus tiles.');
  lines.push(encodeRound({ seed: r.seed, dealer: r.dealer, unitSen: rules.unitSen, actions: r.actions }));
  return lines.join('\n');
}
