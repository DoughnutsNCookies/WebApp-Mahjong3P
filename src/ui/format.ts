import { Action, GameState, Kind } from '../engine';
import { WEB_MODEL } from '../ai/web';
import { label } from './Tile';
import type { Opponent } from './storage';

/** How a bot seat is named on the table and in hand logs. */
export const levelName = (l: Opponent) => (l === 'ai' ? `AI ${WEB_MODEL.name}` : l);

/** Signed ringgit for tallies: +RM3.00, -RM0.40, RM0.00. */
export function rmShort(sen: number): string {
  const s = `RM${(Math.abs(sen) / 100).toFixed(2)}`;
  return sen > 0 ? `+${s}` : sen < 0 ? `-${s}` : s;
}

/** Button text for a claim or turn action. */
export function actionLabel(a: Action, claimTile?: Kind | null): string {
  switch (a.type) {
    case 'pass': return 'Pass';
    case 'win': return 'Hu!';
    case 'selfWin': return 'Hu! (self-drawn)';
    case 'openingSlam': return 'Opening Slam (4 jokers)';
    case 'pong': return `Pong ${claimTile !== undefined && claimTile !== null ? label(claimTile) : ''}${a.jokers ? ` (+${a.jokers} joker)` : ''}`;
    case 'claimKong': return `Kong ${claimTile !== undefined && claimTile !== null ? label(claimTile) : ''}${a.jokers ? ` (+${a.jokers} joker)` : ''}`;
    case 'chow': {
      const tiles = [a.start, a.start + 1, a.start + 2].map((k) => (a.jokerKinds.includes(k) ? `J(${k + 1})` : String(k + 1)));
      return `Chow ${tiles.join('-')}`;
    }
    case 'kong': return `${a.kongType === 'added' ? 'Add to pong:' : 'Kong'} ${label(a.kind)}${a.jokers ? ` (+${a.jokers} joker)` : ''}`;
    case 'discardJoker': return 'Set joker aside (+1 fan)';
    case 'discard': return `Discard ${label(a.tile)}`;
  }
}

/** One line for a move in a replay or review, e.g. "Bot 1 discards 5 dot". */
export function describeAction(a: Action, names: string[], before: GameState): string {
  const who = a.player === 0 ? 'You' : names[a.player];
  const tile = before.pending?.tile ?? null;
  if (a.type === 'pass') return `${who}: pass`;
  if (a.type === 'discard') return `${who} discard${a.player === 0 ? '' : 's'} ${actionLabel(a).replace('Discard ', '')}`;
  return `${who}: ${actionLabel(a, tile)}`;
}
