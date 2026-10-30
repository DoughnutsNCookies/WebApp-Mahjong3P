'use client';

// The analyzer's view of your hand: every discard ranked, with the reasons, plus joker advice and how
// threatening each opponent looks.

import { Analysis, ClaimAdvice } from '../analyzer';
import { Kind } from '../engine';
import { actionLabel } from './format';
import { Tile } from './Tile';

const REACH: Record<string, string> = { yes: 'yes', likely: 'likely', unlikely: 'unlikely', no: 'no' };

export function HintPanel({ analysis, names }: { analysis: Analysis; names: string[] }) {
  const sh = analysis.shanten.best;
  return (
    <div className="panel hint" aria-live="polite">
      <p className="lead">
        {sh <= -1 ? 'You have a winning hand.' : sh === 0 ? 'You are ready (one tile from winning).' : `You are ${sh} tile${sh === 1 ? '' : 's'} from ready.`}
      </p>
      <ol className="options">
        {analysis.options.slice(0, 6).map((o, i) => (
          <li key={o.tile} className={i === 0 ? 'top' : ''}>
            <div className="opt-head">
              <Tile kind={o.tile} marked={i === 0 ? 'best' : undefined} />
              <span>
                {o.shanten === 0 ? 'ready' : `${o.shanten} away`} · {o.ukeireTotal} live · 5 fan: {REACH[o.fan.reaches5]}
                {o.fan.waits ? '' : ` · ~${o.fan.estimate} fan`} · risk {o.safety.label}
              </span>
            </div>
            <p className="why">{o.reasons.join('. ')}.</p>
            {o.fan.waits && o.fan.waits.length > 0 && (
              <div className="waits">
                Waits: {o.fan.waits.map((w) => (
                  <span key={w.tile} className="wait">
                    <Tile kind={w.tile} /> {w.live} left, {w.fanDiscard >= 5 ? `${w.fanDiscard} fan` : w.fanSelf >= 5 ? `${w.fanSelf} fan self-drawn only` : `${Math.max(w.fanDiscard, w.fanSelf)} fan (too few)`}
                  </span>
                ))}
              </div>
            )}
            {i === 0 && o.fan.plans.length > 0 && (
              <ul className="plans">
                {o.fan.plans.map((p) => <li key={p.key}>{p.label} +{p.fan} ({p.status}): {p.note}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {analysis.joker && (
        <p className="note"><strong>Joker:</strong> {analysis.joker.recommend}. {analysis.joker.reasons.join(' ')}</p>
      )}
      <p className="note">
        <strong>Opponents:</strong>{' '}
        {analysis.threats.map((t) => `${names[t.player]} ${t.label}${t.reasons.length ? ` (${t.reasons.join(', ')})` : ''}`).join('; ')}.
      </p>
      {analysis.loserFan > 0 && (
        <p className="note">
          <strong>If someone else wins:</strong> you hold {analysis.loserFan} fan of finished items
          {analysis.loserFan >= 5 ? ', enough to collect in loser settlement.' : ' (5 needed to collect in loser settlement).'}
        </p>
      )}
    </div>
  );
}

export function ClaimHint({ advice, claimTile }: { advice: ClaimAdvice[]; claimTile: Kind | null }) {
  return (
    <div className="panel hint">
      <ul className="claim-advice">
        {advice.map((a, i) => (
          <li key={i} className={a.recommended ? 'top' : ''}>
            <strong>{actionLabel(a.action, claimTile)}{a.recommended ? ' (suggested)' : ''}:</strong> {a.note}
          </li>
        ))}
      </ul>
    </div>
  );
}
