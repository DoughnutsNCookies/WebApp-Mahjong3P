'use client';

// Post-hand review: each of your discards against the analyzer's choice, biggest mistakes first.

import { useEffect, useState } from 'react';
import { ReviewItem, reviewRound, worstMistakes } from '../analyzer';
import { Action } from '../engine';
import { rulesFor } from './useMatch';
import { label, Tile } from './Tile';

const VERDICT_LABEL = { best: 'Best', fine: 'Fine', mistake: 'Mistake', 'big mistake': 'Big mistake' } as const;

function Item({ item, onReplay }: { item: ReviewItem; onReplay?: (actionIndex: number) => void }) {
  return (
    <li className={`review-item v-${item.verdict.replace(' ', '-')}`}>
      <div className="review-head">
        <span className="chip">{item.kind === 'missedWin' ? 'Missed win' : VERDICT_LABEL[item.verdict]}</span>
        <span className="muted">Wall {item.wallLeft}</span>
        {item.played !== undefined && (
          <span>
            You: <Tile kind={item.played} marked={item.verdict === 'mistake' || item.verdict === 'big mistake' ? 'bad' : undefined} />
            {item.best !== item.played && <> Analyzer: <Tile kind={item.best!} marked="best" /></>}
          </span>
        )}
      </div>
      <div className="review-hand">
        {item.hand.map((k, i) => (
          <Tile key={i} kind={k} marked={k === item.best ? 'best' : k === item.played && item.best !== item.played ? 'bad' : undefined} />
        ))}
      </div>
      <p className="why">{item.note}</p>
      {item.playedOption && item.bestOption && item.best !== item.played && (
        <p className="why muted">
          {label(item.played!)}: {item.playedOption.reasons.join('; ')}.<br />
          {label(item.best!)}: {item.bestOption.reasons.join('; ')}.
        </p>
      )}
      {onReplay && (
        <button type="button" className="btn small" onClick={() => onReplay(item.actionIndex)}>See it in the replay</button>
      )}
    </li>
  );
}

export function Review({ seed, dealer, actions, unitSen, onReplay, onClose }: {
  seed: number;
  dealer: number;
  actions: Action[];
  unitSen: number;
  onReplay?: (actionIndex: number) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ReviewItem[] | null>(null);

  useEffect(() => {
    // Let "Analysing…" paint first: reviewing a round runs the analyzer on every discard.
    const t = setTimeout(() => setItems(reviewRound(seed, dealer, actions, 0, rulesFor(unitSen))), 30);
    return () => clearTimeout(t);
  }, [seed, dealer, actions, unitSen]);

  const worst = items ? worstMistakes(items) : [];
  const counts = items
    ? (['best', 'fine', 'mistake', 'big mistake'] as const).map((v) => [v, items.filter((x) => x.verdict === v && x.kind === 'discard').length] as const)
    : [];

  return (
    <div className="panel review">
      <div className="panel-head">
        <h2>Review</h2>
        <button type="button" className="btn small" onClick={onClose}>Close</button>
      </div>
      {!items ? <p className="muted">Analysing your play…</p> : (
        <>
          <p className="lead">
            {items.length === 0 ? 'You made no discards this round.' : counts.map(([v, n]) => `${n} ${VERDICT_LABEL[v].toLowerCase()}`).join(' · ')}
          </p>
          {worst.length > 0 && (
            <>
              <h3>Biggest mistakes</h3>
              <ol className="review-list">{worst.map((it) => <Item key={`w${it.actionIndex}`} item={it} onReplay={onReplay} />)}</ol>
            </>
          )}
          <h3>Every decision</h3>
          <ol className="review-list">{items.map((it) => <Item key={`${it.kind}${it.actionIndex}`} item={it} onReplay={onReplay} />)}</ol>
        </>
      )}
    </div>
  );
}
