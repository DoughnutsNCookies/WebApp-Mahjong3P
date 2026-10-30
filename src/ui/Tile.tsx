'use client';

// Text-based tiles: a big character with a small English label underneath. Artwork can replace this later.

import { bonusNumber, isAnimal, isDot, isFlower, isSeason, JOKER, Kind } from '../engine';

const WIND = ['東', '南', '西', '北'];
const WIND_LABEL = ['East', 'South', 'West', 'North'];
const FLOWER = ['梅', '蘭', '菊', '竹'];
const SEASON = ['春', '夏', '秋', '冬'];
// The 8 non-numbered bonus tiles in Sean's set: four animals, two boys and two girls (1 fan each).
const ANIMAL = ['貓', '鼠', '雞', '蜈', '男', '男', '女', '女'];
const ANIMAL_LABEL = ['Cat', 'Mouse', 'Rooster', 'Centipede', 'Boy', 'Boy', 'Girl', 'Girl'];

export function face(k: Kind): { main: string; sub: string; cls: string; num?: number } {
  // Dot tiles are drawn (DotFace), so they need no label underneath.
  if (isDot(k)) return { main: String(k + 1), sub: '', cls: 'dots' };
  if (k >= 9 && k <= 12) return { main: WIND[k - 9], sub: WIND_LABEL[k - 9], cls: 'wind' };
  if (k === 13) return { main: '中', sub: 'Red', cls: 'red' };
  if (k === 14) return { main: '發', sub: 'Green', cls: 'green' };
  if (k === 15) return { main: '白', sub: 'White', cls: 'white' };
  if (k === JOKER) return { main: '飛', sub: 'Joker', cls: 'joker' };
  if (isFlower(k)) return { main: FLOWER[bonusNumber(k) - 1], sub: `Flower ${bonusNumber(k)}`, cls: 'bonus', num: bonusNumber(k) };
  if (isSeason(k)) return { main: SEASON[bonusNumber(k) - 1], sub: `Season ${bonusNumber(k)}`, cls: 'bonus', num: bonusNumber(k) };
  if (isAnimal(k)) {
    const i = k - 25;
    return { main: ANIMAL[i], sub: ANIMAL_LABEL[i], cls: 'bonus animal' };
  }
  return { main: '?', sub: '', cls: '' };
}

// Dot positions for 1-9 on a 30 x 40 face, in the traditional patterns. "r" marks a red dot.
const DOT_LAYOUTS: [number, number, 'b' | 'r'][][] = [
  [[15, 20, 'r']],
  [[15, 11, 'b'], [15, 29, 'b']],
  [[7, 9, 'b'], [15, 20, 'b'], [23, 31, 'b']],
  [[8, 12, 'b'], [22, 12, 'b'], [8, 28, 'b'], [22, 28, 'b']],
  [[8, 10, 'b'], [22, 10, 'b'], [15, 20, 'r'], [8, 30, 'b'], [22, 30, 'b']],
  [[9, 8, 'b'], [21, 8, 'b'], [9, 20, 'b'], [21, 20, 'b'], [9, 32, 'b'], [21, 32, 'b']],
  [[6, 6, 'b'], [15, 11, 'b'], [24, 16, 'b'], [9, 25, 'b'], [21, 25, 'b'], [9, 34, 'b'], [21, 34, 'b']],
  [[9, 6, 'b'], [21, 6, 'b'], [9, 15, 'b'], [21, 15, 'b'], [9, 25, 'b'], [21, 25, 'b'], [9, 34, 'b'], [21, 34, 'b']],
  [[6, 8, 'b'], [15, 8, 'b'], [24, 8, 'b'], [6, 20, 'r'], [15, 20, 'r'], [24, 20, 'r'], [6, 32, 'b'], [15, 32, 'b'], [24, 32, 'b']],
];

/** The dots of a 1-9 dot tile, as a small drawing. */
function DotFace({ n }: { n: number }) {
  const r = n === 1 ? 9 : n <= 4 ? 5.2 : n <= 6 ? 4.6 : 4;
  return (
    <svg className="dot-face" viewBox="0 0 30 40" aria-hidden="true">
      {DOT_LAYOUTS[n - 1].map(([x, y, c], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={r} className={c === 'r' ? 'pip red' : 'pip'} />
          <circle cx={x} cy={y} r={r * 0.45} className="pip-core" />
        </g>
      ))}
    </svg>
  );
}

/** Plain-text tile name for buttons and notes, e.g. "5 dot", "Red", "Joker". */
export function label(k: Kind): string {
  const f = face(k);
  return isDot(k) ? `${f.main} dot` : f.sub;
}

interface Props {
  kind: Kind;
  size?: 'hand' | 'small';
  selected?: boolean;
  /** Ring used by the hint to point at a tile. */
  marked?: 'best' | 'bad';
  /** A joker standing in a meld for this kind. */
  joker?: boolean;
  dim?: boolean;
  onClick?: () => void;
  title?: string;
}

export function Tile({ kind, size = 'small', selected, marked, joker, dim, onClick, title }: Props) {
  const f = face(kind);
  const cls = ['tile', size, f.cls, selected && 'selected', marked && `mark-${marked}`, joker && 'as-joker', dim && 'dim']
    .filter(Boolean).join(' ');
  const content = (
    <>
      {f.num !== undefined && <span className="num" aria-hidden="true">{f.num}</span>}
      {isDot(kind) ? <DotFace n={kind + 1} /> : <span className="main">{f.main}</span>}
      <span className="sub">{joker ? 'joker' : f.sub}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} title={title ?? label(kind)} aria-label={title ?? label(kind)} aria-pressed={selected}>
        {content}
      </button>
    );
  }
  return <span className={cls} title={title ?? label(kind)} role="img" aria-label={title ?? label(kind)}>{content}</span>;
}

export function TileBack({ count }: { count: number }) {
  return <span className="tile small back" title={`${count} tiles`}>{count}</span>;
}
