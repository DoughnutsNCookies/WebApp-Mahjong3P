'use client';

// Live play: the table, your hand, your actions, claims, the hint and the end-of-round result.

import { useMemo, useState } from 'react';
import { analyze, claimAdvice, inputFromView } from '../analyzer';
import { Action, GameState, JOKER, Kind, playerView, waitingFor } from '../engine';
import { actionLabel } from './format';
import { BonusLegend } from './BonusLegend';
import { ClaimHint, HintPanel } from './Hint';
import { ResultPanel } from './Result';
import { Table } from './Table';
import { label, Tile } from './Tile';

export function lastDiscardOf(g: GameState): { player: number; index: number } | null {
  for (let i = g.actions.length - 1; i >= 0; i--) {
    const a = g.actions[i];
    if (a.type !== 'discard') continue;
    const d = g.players[a.player].discards;
    // Only if it is still on the table (not claimed).
    return d[d.length - 1] === a.tile ? { player: a.player, index: d.length - 1 } : null;
  }
  return null;
}

/** Your hand, with the drawn tile set slightly apart. */
function HandRow({ hand, drawn, selected, best, onTap }: {
  hand: Kind[];
  drawn: Kind | null;
  selected: Kind | null;
  best: Kind | null;
  onTap?: (k: Kind) => void;
}) {
  const tiles = hand.slice();
  let drawnTile: Kind | null = null;
  if (drawn !== null) {
    const i = tiles.lastIndexOf(drawn);
    if (i >= 0) [drawnTile] = tiles.splice(i, 1);
  }
  const render = (k: Kind, key: string) => (
    <Tile
      key={key}
      kind={k}
      size="hand"
      selected={selected === k}
      marked={best === k ? 'best' : undefined}
      onClick={onTap ? () => onTap(k) : undefined}
    />
  );
  return (
    <div className="hand-row" aria-label="Your hand">
      {tiles.map((k, i) => render(k, `h${i}`))}
      {drawnTile !== null && <span className="drawn">{render(drawnTile, 'drawn')}</span>}
    </div>
  );
}

export function Game({ game, names, levels, tally, onAct, onNext, onReview }: {
  game: GameState;
  levels: string[];
  names: string[];
  tally: number[];
  onAct: (a: Action) => void;
  onNext: () => void;
  onReview: () => void;
}) {
  const [selected, setSelected] = useState<Kind | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
  const view = useMemo(() => playerView(game, 0), [game]);

  const myTurn = view.phase === 'turn' && view.turn === 0;
  const prompt = view.phase !== 'turn' && view.phase !== 'ended' && view.legal.length > 0;
  const input = useMemo(() => inputFromView(view), [view]);
  const analysis = useMemo(() => (hintOpen && myTurn ? analyze(input) : null), [hintOpen, myTurn, input]);
  const advice = useMemo(
    () => (hintOpen && prompt && view.claimTile !== null ? claimAdvice(input, view.legal, view.claimTile) : null),
    [hintOpen, prompt, input, view],
  );

  const discardable = (k: Kind) => view.legal.some((a) => a.type === 'discard' && a.tile === k);
  const tap = (k: Kind) => {
    if (!myTurn) return;
    if (selected === k && discardable(k)) {
      onAct({ type: 'discard', player: 0, tile: k });
      setSelected(null);
      return;
    }
    setSelected(k);
  };
  const doAct = (a: Action) => {
    setSelected(null);
    onAct(a);
  };

  const waiting = waitingFor(game).filter((p) => p !== 0);
  const status = view.phase === 'ended' ? null
    : myTurn ? (game.turnDrew ? 'Your turn: tap a tile, tap again to discard.' : 'Your turn: discard a tile.')
      : prompt ? null
        : `${names[waiting[0] ?? view.turn]} is thinking…`;

  const turnButtons = myTurn ? view.legal.filter((a) => a.type !== 'discard') : [];
  const winFan = view.winScore?.fan;

  return (
    <>
      <Table
        view={view}
        names={names}
        tally={tally}
        revealed={view.revealedHands}
        active={view.phase === 'turn' ? view.turn : undefined}
        lastDiscard={lastDiscardOf(game)}
        hand={
          <HandRow
            hand={view.hand}
            drawn={myTurn && game.turnDrew ? game.lastDrawn : null}
            selected={selected}
            best={analysis?.options[0]?.tile ?? null}
            onTap={myTurn ? tap : undefined}
          />
        }
      />

      <div className="controls">
        <div className="status-line">
          <span>{status}</span>
          <span className="muted">Wall: {view.wallLeft}</span>
        </div>

        {prompt && (
          <div className="prompt" role="group" aria-label="Your choice">
            <p>
              {view.phase === 'opening' && 'You were dealt all 4 jokers.'}
              {view.phase === 'robKong' && <>{names[game.pending!.from]} declared a kong of {label(view.claimTile!)}. Rob it?</>}
              {view.phase === 'claim' && <>{names[game.pending!.from]} discarded <Tile kind={view.claimTile!} />.</>}
            </p>
            <div className="actions">
              {view.legal.map((a, i) => (
                <button
                  key={i}
                  type="button"
                  className={`btn ${a.type === 'win' || a.type === 'openingSlam' ? 'win' : a.type === 'pass' ? '' : 'primary'}`}
                  onClick={() => doAct(a)}
                >
                  {actionLabel(a, view.claimTile)}{a.type === 'win' && winFan ? ` ${winFan} fan` : ''}
                </button>
              ))}
            </div>
          </div>
        )}

        {myTurn && (
          <div className="actions">
            {turnButtons.map((a, i) => (
              <button key={i} type="button" className={`btn ${a.type === 'selfWin' ? 'win' : ''}`} onClick={() => doAct(a)}>
                {actionLabel(a)}{a.type === 'selfWin' && winFan ? ` ${winFan} fan` : ''}
              </button>
            ))}
            <button
              type="button"
              className="btn primary"
              disabled={selected === null || selected === JOKER || !discardable(selected)}
              onClick={() => selected !== null && doAct({ type: 'discard', player: 0, tile: selected })}
            >
              {selected === JOKER ? 'Jokers are set aside, not discarded' : selected !== null ? `Discard ${label(selected)}` : 'Discard'}
            </button>
          </div>
        )}

        {(myTurn || prompt) && (
          <button type="button" className="btn hint-toggle" aria-expanded={hintOpen} onClick={() => setHintOpen((h) => !h)}>
            {hintOpen ? 'Hide hint' : 'Hint'}
          </button>
        )}
        {analysis && <HintPanel analysis={analysis} names={names} />}
        {advice && <ClaimHint advice={advice} claimTile={view.claimTile} />}

        <BonusLegend seat={view.seat} />

        {view.phase === 'ended' && game.result && (
          <ResultPanel
            result={game.result} names={names} onReview={onReview} onNext={onNext}
            report={{ seed: game.seed, dealer: game.dealer, actions: game.actions, rules: game.rules, levels, date: new Date().toISOString() }}
          />
        )}
      </div>
    </>
  );
}
