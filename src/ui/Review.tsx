'use client';

// Post-hand review on the board: a slider through the whole round (every hand shown by default), with a
// coloured marker above it for each of your decisions (green best, grey-green fine, amber mistake, red big
// mistake or missed win). Tap a marker to jump there: your hand marks the analyzer's pick and your discard,
// and the verdict with its reasons sits under the slider. Opens on your biggest mistake.

import { useEffect, useMemo, useState } from 'react';
import { ReviewItem, reviewRound, worstMistakes } from '../analyzer';
import { Action, applyLogged, GameState, Kind, newRound, playerView, rulesForLog } from '../engine';
import { latestHappening, riversOf, winningTile } from './feed';
import { describeAction } from './format';
import { Table } from './Table';
import { label, Tile } from './Tile';
import { rulesFor } from './useMatch';

const VERDICT_LABEL = { best: 'Best', fine: 'Fine', mistake: 'Mistake', 'big mistake': 'Big mistake' } as const;
const verdictClass = (it: ReviewItem) => (it.kind === 'missedWin' ? 'v-big-mistake' : `v-${it.verdict.replace(' ', '-')}`);
const verdictText = (it: ReviewItem) => (it.kind === 'missedWin' ? 'Missed win' : `${VERDICT_LABEL[it.verdict]}${it.kind === 'claim' ? ' · take or leave' : ''}`);

/** The verdict and its reasons, with the hand row marked (the analyzer's pick green, yours red). */
function Item({ item, withHand, onShow }: { item: ReviewItem; withHand?: boolean; onShow?: () => void }) {
  return (
    <li className={`review-item ${verdictClass(item)}`}>
      <div className="review-head">
        <span className="chip">{verdictText(item)}</span>
        <span className="muted">Wall {item.wallLeft}</span>
        {item.claim && (
          <span>
            Offered <Tile kind={item.claim.tile} /> · You: <strong>{item.claim.took}</strong>
            {item.claim.best !== item.claim.took && <> · Analyzer: <strong>{item.claim.best}</strong></>}
          </span>
        )}
        {item.played !== undefined && (
          <span>
            You: <Tile kind={item.played} marked={item.verdict === 'mistake' || item.verdict === 'big mistake' ? 'bad' : undefined} />
            {item.best !== item.played && <> Analyzer: <Tile kind={item.best!} marked="best" /></>}
          </span>
        )}
      </div>
      {withHand && (
        <div className="review-hand">
          {item.hand.map((k, i) => (
            <Tile key={i} kind={k} marked={k === item.best ? 'best' : k === item.played && item.best !== item.played ? 'bad' : undefined} />
          ))}
        </div>
      )}
      <p className="why">{item.note}</p>
      {item.playedOption && item.bestOption && item.best !== item.played && (
        <p className="why muted">
          {label(item.played!)}: {item.playedOption.reasons.join('; ')}.<br />
          {label(item.best!)}: {item.bestOption.reasons.join('; ')}.
        </p>
      )}
      {onShow && <button type="button" className="btn small" onClick={onShow}>Show on the board</button>}
    </li>
  );
}

/** Your hand on the board at a decision: the analyzer's pick in green, your discard in red (one copy each). */
function MarkedHand({ hand, item }: { hand: Kind[]; item?: ReviewItem }) {
  const bestAt = item?.best !== undefined ? hand.indexOf(item.best) : -1;
  const badAt = item?.played !== undefined && item.best !== item.played ? hand.indexOf(item.played) : -1;
  return (
    <div className="hand-row">
      {hand.map((k, i) => <Tile key={i} kind={k} size="hand" marked={i === bestAt ? 'best' : i === badAt ? 'bad' : undefined} />)}
    </div>
  );
}

export function Review({ seed, dealer, actions, unitSen, names = ['You', 'Bot 1', 'Bot 2'], onClose }: {
  seed: number;
  dealer: number;
  actions: Action[];
  unitSen: number;
  names?: string[];
  onClose: () => void;
}) {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [step, setStep] = useState(0);
  const [revealAll, setRevealAll] = useState(true);

  // Every state from the deal to the end, so the slider moves both ways instantly.
  const states = useMemo(() => {
    const out: GameState[] = [newRound(seed, dealer, rulesForLog(rulesFor(unitSen), actions))];
    for (const a of actions) out.push(applyLogged(out[out.length - 1], a));
    return out;
  }, [seed, dealer, actions, unitSen]);
  const max = states.length - 1;

  useEffect(() => {
    // Let "Analysing…" paint first: reviewing a round runs the analyzer on every discard.
    const t = setTimeout(() => {
      const found = reviewRound(seed, dealer, actions, 0, rulesFor(unitSen));
      setItems(found);
      // Open on the biggest mistake, else the first decision.
      const start = worstMistakes(found)[0] ?? found[0];
      if (start) setStep(start.actionIndex);
    }, 30);
    return () => clearTimeout(t);
  }, [seed, dealer, actions, unitSen]);

  const decisions = useMemo(() => (items ?? []).slice().sort((a, b) => a.actionIndex - b.actionIndex), [items]);
  const current = decisions.find((x) => x.actionIndex === step);
  const prev = [...decisions].reverse().find((x) => x.actionIndex < step);
  const next = decisions.find((x) => x.actionIndex > step);
  const counts = items
    ? (['best', 'fine', 'mistake', 'big mistake'] as const).map((v) => [v, items.filter((x) => x.verdict === v && x.kind !== 'missedWin').length] as const)
    : [];

  const s = states[step];
  const view = playerView(s, 0);
  const rivers = riversOf(s);
  // On one of your decisions, say what you did next; elsewhere, the move that led here.
  const what = current && step < max
    ? `Your move: ${describeAction(actions[step], names, states[step]).replace(/^You:? /, 'you ')}`
    : step > 0 ? describeAction(actions[step - 1], names, states[step - 1]) : 'The deal';
  const show = (i: number) => { setStep(i); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  return (
    <div className="panel review">
      <div className="panel-head">
        <h2>Review</h2>
        <button type="button" className="btn small" onClick={onClose}>Close</button>
      </div>
      {!items ? <p className="muted">Analysing your play…</p> : (
        <>
          <p className="lead">
            {items.length === 0 ? 'You made no decisions to review this round.' : counts.map(([v, n]) => `${n} ${VERDICT_LABEL[v].toLowerCase()}`).join(' · ')}
            {items.some((x) => x.kind === 'claim') && <span className="muted"> (discards, and tiles offered to you)</span>}
          </p>

          <div className="replay-controls">
            <button type="button" className="btn small" onClick={() => setStep((x) => Math.max(0, x - 1))} disabled={step === 0}>Back</button>
            <div className="scrub">
              <div className="review-track">
                {decisions.map((it) => (
                  <button
                    key={`${it.kind}${it.actionIndex}`}
                    type="button"
                    className={`mark ${verdictClass(it)}${it.actionIndex === step ? ' on' : ''}`}
                    style={{ left: `calc(9px + (100% - 18px) * ${it.actionIndex / Math.max(1, max)})` }}
                    title={`${verdictText(it)}, wall ${it.wallLeft}`}
                    aria-label={`${verdictText(it)} at wall ${it.wallLeft}`}
                    onClick={() => setStep(it.actionIndex)}
                  />
                ))}
              </div>
              <input type="range" min={0} max={max} value={step} aria-label="Move through the hand" onChange={(e) => setStep(Number(e.target.value))} />
            </div>
            <button type="button" className="btn small" onClick={() => setStep((x) => Math.min(max, x + 1))} disabled={step === max}>Next</button>
          </div>

          <div className="status-line">
            <span>{step}/{max}: {what}</span>
            <label className="muted"><input type="checkbox" checked={revealAll} onChange={(e) => setRevealAll(e.target.checked)} /> Show all hands</label>
          </div>
          <div className="review-nav">
            <button type="button" className="btn small" disabled={!prev} onClick={() => prev && setStep(prev.actionIndex)}>‹ Previous decision</button>
            <button type="button" className="btn small" disabled={!next} onClick={() => next && setStep(next.actionIndex)}>Next decision ›</button>
          </div>
          {current
            ? <ol className="review-list"><Item item={current} withHand /></ol>
            : <p className="muted review-hint">Not one of your decisions. Tap a coloured marker above the slider to jump to one.</p>}

          <Table
            view={view}
            names={names}
            revealed={revealAll || s.phase === 'ended' ? s.players.map((p) => p.hand) : null}
            active={s.phase === 'turn' ? s.turn : undefined}
            winner={s.result?.winner}
            winTile={winningTile(s)}
            rivers={rivers.rivers}
            lastDiscard={rivers.newest}
            fresh={latestHappening(s)}
            hand={<MarkedHand hand={view.hand} item={current} />}
          />

          <details className="legend">
            <summary>Every decision as a list</summary>
            <ol className="review-list">
              {decisions.map((it) => <Item key={`${it.kind}${it.actionIndex}`} item={it} withHand onShow={() => show(it.actionIndex)} />)}
            </ol>
          </details>
        </>
      )}
    </div>
  );
}
