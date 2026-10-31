'use client';

// The table seen from one player's seat: the two opponents on top, your discards, melds, bonus tiles
// and hand at the bottom. Used for live play and, read-only, for replays.

import { ReactNode } from 'react';
import { JOKER, Kind, loserFan, Meld, PlayerView, SEAT_NAMES } from '../engine';
import { FanChip } from './FanChip';
import type { Callout, Happening, RiverTile } from './feed';
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
  /** The round's winner, whose box is shown in gold and stamped. */
  winner?: number;
  /** The tile the round was won on, lifted out of the winner's revealed hand. */
  winTile?: Kind | null;
  /** Every discard in order, taken ones included (greyed out). Without it, only tiles still on the table. */
  rivers?: RiverTile[][];
  /** The newest discard on the table, to highlight (an index into ivers when given). */
  lastDiscard?: { player: number; index: number } | null;
  /** What just happened: its set or bonus tile arrives with a short animation. */
  fresh?: Happening | null;
  /** Short call-outs on players' boxes ("Pong!"). */
  callouts?: Callout[];
  /** Bots deciding right now (thinking dots). */
  thinking?: number[];
  /** Your hand row, rendered by the caller (it handles selection and hints). */
  hand: ReactNode;
}

/** A labelled strip of tiles, separated from the one above by a thin line. */
function Zone({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="zone">
      <span className="zone-label">{label}</span>
      <div className="zone-tiles">{children}</div>
    </div>
  );
}

export function MeldRow({ melds, freshLast }: { melds: Meld[]; freshLast?: boolean }) {
  if (!melds.length) return null;
  return (
    <Zone label="Sets">
      {melds.map((m, i) => (
        <span
          key={i}
          className={`meld${m.concealed ? ' concealed' : ''}${freshLast && i === melds.length - 1 ? ' arrive' : ''}`}
          title={m.concealed ? 'Concealed kong' : m.type}
        >
          {m.slots.map((s, j) => (
            <Tile key={j} kind={s.joker ? JOKER : s.kind} joker={s.joker} title={s.joker ? `Fei as ${s.kind}` : undefined} />
          ))}
        </span>
      ))}
    </Zone>
  );
}

export function BonusRow({ bonus, jokers, fresh }: { bonus: Kind[]; jokers: number; fresh?: 'bonus' | 'fei' }) {
  if (!bonus.length && !jokers) return null;
  return (
    <Zone label="Bonus">
      {bonus.map((b, i) => <Tile key={i} kind={b} fx={fresh === 'bonus' && i === bonus.length - 1 ? 'arrive' : undefined} />)}
      {[...Array(jokers)].map((_, i) => (
        <Tile key={`j${i}`} kind={JOKER} title="Fei set aside (+1 fan)" fx={fresh === 'fei' && i === jokers - 1 ? 'arrive' : undefined} />
      ))}
    </Zone>
  );
}

function River({ tiles, newest, names }: { tiles: RiverTile[]; newest?: number; names: string[] }) {
  return (
    <Zone label="Discards">
      {tiles.length === 0 ? <span className="muted none">None yet</span> : tiles.map((t, i) => (
        <Tile
          key={i}
          kind={t.tile}
          dim={!!t.taken}
          fx={i === newest ? 'last' : undefined}
          title={t.taken ? `Taken by ${names[t.taken.by]} for a ${t.taken.how}` : i === newest ? 'Just discarded' : undefined}
        />
      ))}
    </Zone>
  );
}

/** A revealed hand, with the tile it was won on set apart and lifted. */
function RevealedHand({ tiles, winTile }: { tiles: Kind[]; winTile?: Kind | null }) {
  const rest = tiles.slice();
  const at = winTile != null ? rest.lastIndexOf(winTile) : -1;
  if (at >= 0) rest.splice(at, 1);
  return (
    <>
      {rest.map((t, i) => <Tile key={i} kind={t} />)}
      {at >= 0 && <span className="win-gap"><Tile kind={winTile!} fx="win" title="The winning tile" /></span>}
    </>
  );
}

/** The red seal stamped on the winner's box. */
export function Seal() {
  return <span className="seal" role="img" aria-label="Hu! Winner">胡</span>;
}

function Thinking() {
  return <span className="thinking" role="status" aria-label="thinking"><i /><i /><i /></span>;
}

export function Table({ view, names, tally, revealed, active, winner, winTile, rivers, lastDiscard, fresh, callouts, thinking, hand }: Props) {
  const riverOf = (p: number): RiverTile[] => rivers?.[p] ?? view.players[p].discards.map((tile) => ({ tile }));
  const me = view.me;
  // Turn order is East -> South -> West: the player after you sits on your right.
  const left = (me + 2) % 3;
  const right = (me + 1) % 3;

  const freshSet = (p: number) => fresh?.player === p && (fresh.what === 'pong' || fresh.what === 'chow' || fresh.what === 'kong');
  const freshBonus = (p: number) => (fresh?.player === p && (fresh.what === 'bonus' || fresh.what === 'fei') ? fresh.what : undefined);
  // The newest call-out for a player, keyed so a new one restarts its animation.
  const callout = (p: number) => {
    const c = callouts?.filter((x) => x.player === p).at(-1);
    return c ? <span key={c.id} className={`callout tone-${c.tone}`} aria-live="polite">{c.text}</span> : null;
  };
  const boxClass = (base: string, p: number) => `${base}${active === p ? ' active' : ''}${winner === p ? ' winner' : ''}`;

  const opponent = (p: number, side: string) => {
    const o = view.players[p];
    const f = loserFan(o.seat, revealed ? revealed[p] : [], o.melds, o.bonus, o.discardedJokers);
    return (
      <section className={boxClass('opp', p)} aria-label={`${names[p]}, on your ${side}${winner === p ? ', winner' : ''}`}>
        {callout(p)}
        <header>
          <strong>{names[p]}</strong>
          {winner === p && <Seal />}
          {thinking?.includes(p) && <Thinking />}
          <span className="seat">{SEAT_NAMES[o.seat]}{p === view.dealer ? ' · dealer' : ''}</span>
          <FanChip fan={f.fan} items={f.items} hiddenNote={!revealed} />
          {tally && <span className={`money ${tally[p] < 0 ? 'neg' : ''}`}>{rmShort(tally[p])}</span>}
        </header>
        <Zone label={revealed ? 'Hand' : `Hand (${side})`}>
          {revealed ? <RevealedHand tiles={revealed[p]} winTile={winner === p ? winTile : null} /> : <TileBack count={o.handSize} />}
        </Zone>
        <MeldRow melds={o.melds} freshLast={freshSet(p)} />
        <BonusRow bonus={o.bonus} jokers={o.discardedJokers} fresh={freshBonus(p)} />
        <River tiles={riverOf(p)} names={names} newest={lastDiscard?.player === p ? lastDiscard.index : undefined} />
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
      <section className={boxClass('me', me)} aria-label={winner === me ? 'Your area, winner' : 'Your area'}>
        {callout(me)}
        <header>
          <strong>{names[me]}</strong>
          {winner === me && <Seal />}
          <span className="seat">{SEAT_NAMES[view.seat]}{me === view.dealer ? ' · dealer' : ''}</span>
          <FanChip fan={mine.fan} items={mine.items} />
          {tally && <span className={`money ${tally[me] < 0 ? 'neg' : ''}`}>{rmShort(tally[me])}</span>}
        </header>
        <River tiles={riverOf(me)} names={names} newest={lastDiscard?.player === me ? lastDiscard.index : undefined} />
        <MeldRow melds={view.self.melds} freshLast={freshSet(me)} />
        <BonusRow bonus={view.self.bonus} jokers={view.self.discardedJokers} fresh={freshBonus(me)} />
        <Zone label="Your hand">{hand}</Zone>
      </section>
    </div>
  );
}
