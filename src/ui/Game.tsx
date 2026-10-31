'use client';

// Live play: the table, your hand, your actions, claims, the hint and the end-of-round result.

import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { analyze, claimAdvice, inputFromView } from '../analyzer';
import { Action, GameState, JOKER, Kind, playerView, waitingFor } from '../engine';
import { actionLabel } from './format';
import { BonusLegend } from './BonusLegend';
import { Caption, latestHappening, riversOf, useCallouts, winningTile } from './feed';
import { FxLayer } from './Fx';
import type { Settings } from './storage';
import { ClaimHint, HintPanel } from './Hint';
import { ResultPanel } from './Result';
import { Table } from './Table';
import { label, Tile } from './Tile';

/** Your hand, with the drawn tile (or the tile you won on) set slightly apart. */
function HandRow({ hand, drawn, won, selected, best, yourMove, onTap }: {
  hand: Kind[];
  drawn: Kind | null;
  won?: Kind | null;
  selected: Kind | null;
  best: Kind | null;
  /** Your turn and nothing picked yet: a wave runs through the hand to say "tap a tile". */
  yourMove?: boolean;
  onTap?: (k: Kind) => void;
}) {
  const tiles = hand.slice();
  let drawnTile: Kind | null = null;
  const apart = won ?? drawn;
  if (apart !== null) {
    const i = tiles.lastIndexOf(apart);
    if (i >= 0) [drawnTile] = tiles.splice(i, 1);
  }
  // Only one copy shows as picked (discarding any copy is the same move); the drawn tile if it is one.
  const pickedKey = selected === null ? null : drawnTile === selected ? 'drawn' : `h${tiles.indexOf(selected)}`;
  const render = (k: Kind, key: string, i: number) => (
    <Tile
      key={key}
      style={{ '--i': i } as CSSProperties}
      kind={k}
      size="hand"
      selected={key === pickedKey}
      marked={best === k ? 'best' : undefined}
      fx={key === 'drawn' && won != null ? 'win' : undefined}
      onClick={onTap ? () => onTap(k) : undefined}
    />
  );
  return (
    <div className={`hand-row${yourMove ? ' your-move' : ''}`} aria-label="Your hand">
      {tiles.map((k, i) => render(k, `h${i}`, i))}
      {drawnTile !== null && <span className="drawn">{render(drawnTile, 'drawn', tiles.length)}</span>}
    </div>
  );
}

export function Game({ game, names, levels, tally, settings, onAct, onNext, onReview }: {
  game: GameState;
  settings: Settings;
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
  const happening = useMemo(() => latestHappening(game), [game]);
  const winTile = useMemo(() => winningTile(game), [game]);
  const rivers = useMemo(() => riversOf(game), [game]);
  const callouts = useCallouts(game);
  // "Bot 1 · normal" is just "Bot 1" in the caption, so it fits on a phone line.
  const shortNames = useMemo(() => names.map((n) => n.split(' · ')[0]), [names]);

  // When a round ends, let the seal and the winning tile land before the result panel opens.
  const [resultFor, setResultFor] = useState<number | null>(null);
  useEffect(() => {
    if (game.phase !== 'ended') return;
    // Full effects play the big Hu (about 2 s) first.
    const wait = settings.effects === 'full' ? 2100 : game.result?.winner === 0 || game.result?.type === 'draw' ? 450 : 1300;
    const t = setTimeout(() => setResultFor(game.seed), wait);
    return () => clearTimeout(t);
  }, [game, settings.effects]);

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
      : null;

  const turnButtons = myTurn ? view.legal.filter((a) => a.type !== 'discard') : [];
  const winFan = view.winScore?.fan;

  return (
    <>
      <FxLayer game={game} names={names} settings={settings} />
      <Table
        view={view}
        names={names}
        tally={tally}
        revealed={view.revealedHands}
        active={view.phase === 'turn' ? view.turn : undefined}
        winner={game.result?.winner}
        winTile={winTile}
        rivers={rivers.rivers}
        lastDiscard={rivers.newest}
        fresh={happening}
        callouts={callouts}
        thinking={view.phase === 'ended' ? [] : waiting}
        hand={
          <HandRow
            hand={view.hand}
            drawn={myTurn && game.turnDrew ? game.lastDrawn : null}
            won={game.result?.winner === 0 ? winTile : null}
            selected={selected}
            best={analysis?.options[0]?.tile ?? null}
            yourMove={myTurn && selected === null}
            onTap={myTurn ? tap : undefined}
          />
        }
      />

      {/* Outside .controls so it can stay pinned to the bottom of the screen over the whole table. */}
      <div className="status-line pinned">
        <p className="caption" key={happening?.at ?? -1} aria-live="polite"><Caption h={happening} names={shortNames} /></p>
        <span className="muted wall">Wall: {view.wallLeft}</span>
      </div>

      <div className="controls">
        {status && <p className="instruction">{status}</p>}

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
                  className={`btn ${a.type === 'win' || a.type === 'openingSlam' ? 'win cta' : a.type === 'pass' ? '' : 'primary cta'}`}
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
              <button key={i} type="button" className={`btn ${a.type === 'selfWin' ? 'win cta' : ''}`} onClick={() => doAct(a)}>
                {actionLabel(a)}{a.type === 'selfWin' && winFan ? ` ${winFan} fan` : ''}
              </button>
            ))}
            <button
              type="button"
              className="btn primary cta"
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

        {view.phase === 'ended' && game.result && resultFor === game.seed && (
          <ResultPanel
            result={game.result} names={names} onReview={onReview} onNext={onNext}
            report={{ seed: game.seed, dealer: game.dealer, actions: game.actions, rules: game.rules, levels, date: new Date().toISOString() }}
          />
        )}
      </div>
    </>
  );
}
