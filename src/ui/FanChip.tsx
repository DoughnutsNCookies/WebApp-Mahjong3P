'use client';

// "3 fan" in a player's box: fan they have already locked in (bonus tiles for their seat, fei set aside,
// scoring pongs/kongs), the same count loser settlement uses. Tap for the breakdown.

import { useState } from 'react';
import { FanItem } from '../engine';

export function FanChip({ fan, items, hiddenNote }: { fan: number; items: FanItem[]; hiddenNote?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="fan-chip-wrap">
      <button
        type="button"
        className={`fan-chip${fan >= 5 ? ' five' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="Fan locked in so far. Tap for details."
      >
        {fan} fan
      </button>
      {open && (
        <span className="fan-pop" role="note">
          {items.length === 0 ? 'Nothing locked in yet.' : `${items.map((i) => `${i.label} ${i.fan}`).join(' · ')}.`}
          {hiddenNote ? ' Counted from tiles on the table only; their hidden hand is not shown.' : ''}
          {' '}A win adds 1 fan for Hu, plus any hand patterns.
        </span>
      )}
    </span>
  );
}
