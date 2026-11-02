// Post-hand review: replays a finished round and, for each of one player's discards, compares what was
// played with what the analyzer would have played, and why. Also reviews every discard offered to the
// player (take it for a pong/chow/kong, or let it go and draw), and flags wins that were passed up.

import { Action, availableWin, DEFAULT_RULES, GameState, Kind, legalActions, name, newRound, applyAction, Rules, sameAction } from '../engine';
import { analyze, DiscardOption } from './analyze';
import { ClaimAdvice, claimAdvice } from './claims';
import { inputFromState } from './inputs';

export type Verdict = 'best' | 'fine' | 'mistake' | 'big mistake';

export interface ReviewItem {
  /** Position in the action log, for jumping to it in the replay. */
  actionIndex: number;
  kind: 'discard' | 'claim' | 'missedWin';
  wallLeft: number;
  /** Your concealed hand at that moment. */
  hand: Kind[];
  verdict: Verdict;
  /** How much worse than the best play, in the analyzer's ranking units (0 = best). */
  loss: number;
  played?: Kind;
  best?: Kind;
  playedOption?: DiscardOption;
  bestOption?: DiscardOption;
  /** A claim decision: the tile offered, and what you did and the analyzer would have done ("Pong", "Let it go"). */
  claim?: { tile: Kind; from: number; took: string; best: string };
  note: string;
}

/** Short name for a claim choice. */
export function claimLabel(a: Action): string {
  switch (a.type) {
    case 'pass': return 'Let it go';
    case 'pong': return a.jokers ? `Pong (with ${a.jokers} fei)` : 'Pong';
    case 'claimKong': return a.jokers ? `Kong (with ${a.jokers} fei)` : 'Kong';
    case 'chow': return `Chow ${a.start + 1}-${a.start + 3}`;
    case 'win': return 'Win';
    default: return a.type;
  }
}

/** Judges a claim choice against the analyzer's advice; null when it can't be judged. */
function claimVerdict(chosen: ClaimAdvice, best: ClaimAdvice, now: number): { verdict: Verdict; loss: number; note: string } {
  if (chosen === best) {
    return { verdict: 'best', loss: 0, note: chosen.action.type === 'pass' ? `Letting it go was right: ${best.note.toLowerCase()}` : `Taking it was right: ${chosen.note.charAt(0).toLowerCase()}${chosen.note.slice(1)}` };
  }
  if (chosen.action.type === 'pass') {
    // Passed on a claim the analyzer wanted.
    const ready = best.shanten === 0;
    return {
      verdict: ready ? 'mistake' : 'fine', loss: ready ? 400 : 100,
      note: best.reaches5 === null
        ? `Taking it (${claimLabel(best.action)}) was better: ${best.note.charAt(0).toLowerCase()}${best.note.slice(1)}`
        : `Taking it (${claimLabel(best.action)}) would have got you from ${now} to ${best.shanten} away${ready ? ' (ready to win)' : ''}, and 5 fan was ${best.reaches5} from there.`,
    };
  }
  if (best.action.type === 'pass') {
    // Claimed when letting it go was better.
    const dead = chosen.reaches5 === 'no';
    return {
      verdict: dead ? 'big mistake' : 'mistake', loss: dead ? 800 : 300,
      note: `Better to let it go and draw: ${claimLabel(chosen.action).toLowerCase()} ${chosen.note.charAt(0).toLowerCase()}${chosen.note.slice(1)} It also exposes a set, which rules out the concealed hands.`,
    };
  }
  return {
    verdict: 'fine', loss: 100,
    note: chosen.action.type === 'claimKong' && chosen.action.jokers
      ? `Taking it was right, but as a ${claimLabel(best.action).toLowerCase()}: the kong ${chosen.note.charAt(0).toLowerCase()}${chosen.note.slice(1)}`
      : `Taking it was right, but ${claimLabel(best.action).toLowerCase()} was better: ${best.note.charAt(0).toLowerCase()}${best.note.slice(1)}`,
  };
}

function verdictFor(loss: number, same: boolean): Verdict {
  if (same || loss <= 25) return 'best';
  if (loss < 150) return 'fine';
  if (loss < 700) return 'mistake';
  return 'big mistake';
}

function explain(played: DiscardOption, best: DiscardOption): string {
  if (played.shanten > best.shanten) {
    return `${name(played.tile)} left you ${played.shanten} away from ready; ${name(best.tile)} kept you ${best.shanten} away.`;
  }
  const lost = best.reasons.find((r) => r.startsWith('Gives up')) ? null : played.reasons.find((r) => r.startsWith('Gives up'));
  if (lost) return `${name(played.tile)}: ${lost.toLowerCase()}. ${name(best.tile)} kept that open.`;
  if (best.fan.reaches5 !== played.fan.reaches5 && ['no', 'unlikely'].includes(played.fan.reaches5)) {
    return `After ${name(played.tile)}, reaching 5 fan was ${played.fan.reaches5 === 'no' ? 'out of reach' : 'unlikely'}; after ${name(best.tile)} it was ${best.fan.reaches5}.`;
  }
  if (played.safety.risk > best.safety.risk + 0.15 && played.safety.label !== best.safety.label) {
    return `${name(played.tile)} was ${played.safety.label} risk to discard; ${name(best.tile)} was ${best.safety.label}.`;
  }
  if (best.ukeireTotal > played.ukeireTotal) {
    return `${name(best.tile)} kept ${best.ukeireTotal} live improving tiles against ${played.ukeireTotal} after ${name(played.tile)}.`;
  }
  return `${name(best.tile)} ranked higher: ${best.reasons.join('; ')}.`;
}

/** Reviews every decision `player` made in a finished (or partly played) round. */
export function reviewRound(
  seed: number, dealer: number, actions: Action[], player: number, rules: Rules = DEFAULT_RULES,
): ReviewItem[] {
  const items: ReviewItem[] = [];
  let s: GameState = newRound(seed, dealer, rules);
  actions.forEach((a, i) => {
    if (a.player === player) {
      const win = availableWin(s, player);
      if (win && a.type !== 'win' && a.type !== 'selfWin') {
        items.push({
          actionIndex: i, kind: 'missedWin', wallLeft: s.tail - s.head, hand: s.players[player].hand.slice(), verdict: 'mistake', loss: 0,
          note: `You passed up a ${win.fan}-fan win (${win.items.map((x) => x.label).join(', ')}).`,
        });
      }
      // A discard offered to you: take it or let it go (a passed-up win is already flagged above).
      if (s.phase === 'claim' && s.pending && !win && ['pass', 'pong', 'chow', 'claimKong'].includes(a.type)) {
        const input = inputFromState(s, player);
        const advice = claimAdvice(input, legalActions(s, player), s.pending.tile);
        const chosen = advice.find((x) => sameAction(x.action, a));
        const best = advice.find((x) => x.recommended);
        if (chosen && best) {
          const now = advice.find((x) => x.action.type === 'pass')?.shanten ?? 0;
          const v = claimVerdict(chosen, best, now);
          items.push({
            actionIndex: i, kind: 'claim', wallLeft: s.tail - s.head, hand: s.players[player].hand.slice(), ...v,
            claim: { tile: s.pending.tile, from: s.pending.from, took: claimLabel(a), best: claimLabel(best.action) },
          });
        }
      }
      if (a.type === 'discard' && s.phase === 'turn') {
        const options = analyze(inputFromState(s, player)).options;
        const best = options[0];
        const played = options.find((o) => o.tile === a.tile);
        if (best && played) {
          const loss = Math.max(0, best.value - played.value);
          const same = best.tile === played.tile;
          items.push({
            actionIndex: i, kind: 'discard', wallLeft: s.tail - s.head, hand: s.players[player].hand.slice(), verdict: verdictFor(loss, same), loss,
            played: a.tile, best: best.tile, playedOption: played, bestOption: best,
            note: same ? `${name(a.tile)} was the analyzer's choice too.` : explain(played, best),
          });
        }
      }
    }
    s = applyAction(s, a);
  });
  return items;
}

/** The biggest mistakes first, at most `n`. */
export function worstMistakes(items: ReviewItem[], n = 3): ReviewItem[] {
  return items
    .filter((x) => x.verdict === 'mistake' || x.verdict === 'big mistake')
    .sort((a, b) => (b.kind === 'missedWin' ? 1e9 : b.loss) - (a.kind === 'missedWin' ? 1e9 : a.loss))
    .slice(0, n);
}
