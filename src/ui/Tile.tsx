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

// Dot positions and colours for 1-9 on a 30 x 40 face, following the traditional tiles Sean shared:
// g green, k black, r red. Each dot is drawn as concentric rings.
type Pip = [x: number, y: number, colour: 'g' | 'k' | 'r'];
const DOT_LAYOUTS: { r: number; pips: Pip[] }[] = [
  { r: 11, pips: [[15, 20, 'g']] },
  { r: 5.6, pips: [[15, 11, 'g'], [15, 29, 'k']] },
  { r: 5, pips: [[8, 8, 'g'], [15, 20, 'r'], [22, 32, 'k']] },
  { r: 5, pips: [[9, 12, 'g'], [21, 12, 'k'], [9, 28, 'k'], [21, 28, 'g']] },
  { r: 4.6, pips: [[8, 9, 'g'], [22, 9, 'k'], [15, 20, 'r'], [8, 31, 'k'], [22, 31, 'g']] },
  { r: 4.4, pips: [[9, 8, 'g'], [21, 8, 'g'], [9, 23, 'r'], [21, 23, 'r'], [9, 33, 'r'], [21, 33, 'r']] },
  { r: 4, pips: [[6, 6, 'g'], [15, 10, 'g'], [24, 14, 'g'], [9, 25, 'r'], [21, 25, 'r'], [9, 34, 'r'], [21, 34, 'r']] },
  { r: 4.2, pips: [[9, 6, 'k'], [21, 6, 'k'], [9, 15.5, 'k'], [21, 15.5, 'k'], [9, 25, 'k'], [21, 25, 'k'], [9, 34.5, 'k'], [21, 34.5, 'k']] },
  { r: 4, pips: [[6, 8, 'k'], [15, 8, 'k'], [24, 8, 'k'], [6, 20, 'r'], [15, 20, 'r'], [24, 20, 'r'], [6, 32, 'g'], [15, 32, 'g'], [24, 32, 'g']] },
];

/** The dots of a 1-9 dot tile, as a small drawing. */
function DotFace({ n }: { n: number }) {
  const { r, pips } = DOT_LAYOUTS[n - 1];
  return (
    <svg className="dot-face" viewBox="0 0 30 40" aria-hidden="true">
      {pips.map(([x, y, c], i) => (
        <g key={i} className={`pip-${c}`}>
          <circle cx={x} cy={y} r={r} className="ring" />
          <circle cx={x} cy={y} r={r * 0.68} className="gap" />
          <circle cx={x} cy={y} r={r * 0.46} className="ring" />
          <circle cx={x} cy={y} r={r * 0.2} className="gap" />
          {/* The 1 dot has a red centre, as on the real tile. */}
          {n === 1 && <circle cx={x} cy={y} r={r * 0.2} className="centre-red" />}
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
