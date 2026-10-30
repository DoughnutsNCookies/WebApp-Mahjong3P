'use client';

// "What are these?" for the bonus tiles, with what counts for your seat.

import { animal, flower, Seat, SEAT_NAMES, season } from '../engine';
import { Tile } from './Tile';

export function BonusLegend({ seat }: { seat: Seat }) {
  const own = seat + 1;
  return (
    <details className="legend">
      <summary>Bonus tiles explained</summary>
      <table>
        <thead><tr><th>No.</th><th>Flower</th><th>Season</th></tr></thead>
        <tbody>
          {[1, 2, 3, 4].map((n) => (
            <tr key={n} className={n === own || n === 4 ? 'yours' : ''}>
              <td>{n}{n === own ? ' (your seat)' : n === 4 ? ' (everyone)' : ''}</td>
              <td><Tile kind={flower(n)} /></td>
              <td><Tile kind={season(n)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        You are {SEAT_NAMES[seat]}, so flowers and seasons <strong>{own}</strong> and <strong>4</strong> are 1 fan each for
        you. Flowers 1-2-3 together are 2 fan, and so are seasons 1-2-3 (scored separately).
      </p>
      <p className="animals">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <Tile key={n} kind={animal(n)} />)}
      </p>
      <p>The cat, mouse, rooster, centipede, the two boys and the two girls are 1 fan each for everyone.</p>
      <p>A fei (飛) you set aside also sits with your bonus tiles: +1 fan.</p>
    </details>
  );
}
