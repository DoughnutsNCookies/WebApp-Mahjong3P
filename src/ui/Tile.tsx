'use client';

// Text-based tiles: a big character with a small English label underneath. Artwork can replace this later.

import { bonusNumber, isAnimal, isDot, isFlower, isSeason, JOKER, Kind } from '../engine';

const WIND = ['東', '南', '西', '北'];
const WIND_LABEL = ['East', 'South', 'West', 'North'];
const FLOWER = ['梅', '蘭', '菊', '竹'];
const SEASON = ['春', '夏', '秋', '冬'];

export function face(k: Kind): { main: string; sub: string; cls: string } {
  if (isDot(k)) return { main: String(k + 1), sub: 'dot', cls: 'dots' };
  if (k >= 9 && k <= 12) return { main: WIND[k - 9], sub: WIND_LABEL[k - 9], cls: 'wind' };
  if (k === 13) return { main: '中', sub: 'Red', cls: 'red' };
  if (k === 14) return { main: '發', sub: 'Green', cls: 'green' };
  if (k === 15) return { main: '白', sub: 'White', cls: 'white' };
  if (k === JOKER) return { main: '飛', sub: 'Joker', cls: 'joker' };
  if (isFlower(k)) return { main: FLOWER[bonusNumber(k) - 1], sub: `F${bonusNumber(k)}`, cls: 'bonus' };
  if (isSeason(k)) return { main: SEASON[bonusNumber(k) - 1], sub: `S${bonusNumber(k)}`, cls: 'bonus' };
  if (isAnimal(k)) return { main: '★', sub: `B${k - 24}`, cls: 'bonus' };
  return { main: '?', sub: '', cls: '' };
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
      <span className="main">{f.main}</span>
      <span className="sub">{joker ? 'joker' : f.sub}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} title={title ?? label(kind)} aria-pressed={selected}>
        {content}
      </button>
    );
  }
  return <span className={cls} title={title ?? label(kind)}>{content}</span>;
}

export function TileBack({ count }: { count: number }) {
  return <span className="tile small back" title={`${count} tiles`}>{count}</span>;
}
