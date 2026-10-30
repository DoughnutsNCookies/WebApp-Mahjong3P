'use client';

// The table seen from one player's seat: the two opponents on top, your discards, melds, bonus tiles
// and hand at the bottom. Used for live play and, read-only, for replays.

import { ReactNode } from 'react';
import { JOKER, Kind, loserFan, Meld, PlayerView, SEAT_NAMES } from '../engine';
import { FanChip } from './FanChip';
import { Tile, TileBack } from './Tile';
import { rmShort } from './format';

interface Props {
  view: PlayerView;
  names: string[];
  tally?: number[];
  /** Hands to show face up (end of round, or a replay with everything revealed). */
  revealed?: Kind[][] | null;
  /** Player whose turn it is, for highlighting. */
  active?: number;
  /** The newest discard on the table, to highlight. */
  lastDiscard?: { player: number; index: number } | null;
  /** Your hand row, rendered by the caller (it handles selection and hints). */
  hand: ReactNode;
}

export function MeldRow({ melds }: { melds: Meld[] }) {
  if (!melds.length) return null;
  return (
    <div className="melds">
      {melds.map((m, i) => (
        <span key={i} className={`meld${m.concealed ? ' concealed' : ''}`} title={m.concealed ? 'Concealed kong' : m.type}>
          {m.slots.map((s, j) => (
            <Tile key={j} kind={s.joker ? JOKER : s.kind} joker={s.joker} title={s.joker ? `Joker as ${s.kind}` : undefined} />
          ))}
        </span>
      ))}
    </div>
  );
}

export function BonusRow({ bonus, jokers }: { bonus: Kind[]; jokers: number }) {
  if (!bonus.length && !jokers) return null;
  return (
    <div className="bonus-row" aria-label="Bonus tiles">
      {bonus.map((b, i) => <Tile key={i} kind={b} />)}
      {[...Array(jokers)].map((_, i) => <Tile key={`j${i}`} kind={JOKER} title="Joker set aside (+1 fan)" />)}
    </div>
  );
}

function River({ tiles, highlight }: { tiles: Kind[]; highlight?: number }) {
  return (
    <div className="river">
      {tiles.length === 0 ? <span className="muted">No discards</span> : tiles.map((t, i) => (
        <Tile key={i} kind={t} marked={i === highlight ? 'best' : undefined} />
      ))}
    </div>
  );
}

export function Table({ view, names, tally, revealed, active, lastDiscard, hand }: Props) {
  const me = view.me;
  // Turn order is East -> South -> West: the player after you sits on your right.
  const left = (me + 2) % 3;
  const right = (me + 1) % 3;

  const opponent = (p: number, side: string) => {
    const o = view.players[p];
    const f = loserFan(o.seat, revealed ? revealed[p] : [], o.melds, o.bonus, o.discardedJokers);
    return (
      <section className={`opp${active === p ? ' active' : ''}`} aria-label={`${names[p]}, on your ${side}`}>
        <header>
          <strong>{names[p]}</strong>
          <span className="seat">{SEAT_NAMES[o.seat]}{p === view.dealer ? ' · dealer' : ''}</span>
          <FanChip fan={f.fan} items={f.items} hiddenNote={!revealed} />
          {tally && <span className={`money ${tally[p] < 0 ? 'neg' : ''}`}>{rmShort(tally[p])}</span>}
        </header>
        <div className="opp-hand">
          {revealed ? revealed[p].map((t, i) => <Tile key={i} kind={t} />) : <TileBack count={o.handSize} />}
          <span className="muted side">{side}</span>
        </div>
        <MeldRow melds={o.melds} />
        <BonusRow bonus={o.bonus} jokers={o.discardedJokers} />
        <River tiles={o.discards} highlight={lastDiscard?.player === p ? lastDiscard.index : undefined} />
      </section>
    );
  };

  const mine = loserFan(view.seat, view.hand, view.self.melds, view.self.bonus, view.self.discardedJokers);

  return (
    <div className="table">
      <div className="opponents">
        {opponent(left, 'left')}
        {opponent(right, 'right')}
      </div>
      <section className={`me${active === me ? ' active' : ''}`} aria-label="Your area">
        <header>
          <strong>{names[me]}</strong>
          <span className="seat">{SEAT_NAMES[view.seat]}{me === view.dealer ? ' · dealer' : ''}</span>
          <FanChip fan={mine.fan} items={mine.items} />
          {tally && <span className={`money ${tally[me] < 0 ? 'neg' : ''}`}>{rmShort(tally[me])}</span>}
        </header>
        <River tiles={view.self.discards} highlight={lastDiscard?.player === me ? lastDiscard.index : undefined} />
        <MeldRow melds={view.self.melds} />
        <BonusRow bonus={view.self.bonus} jokers={view.self.discardedJokers} />
        {hand}
      </section>
    </div>
  );
}
