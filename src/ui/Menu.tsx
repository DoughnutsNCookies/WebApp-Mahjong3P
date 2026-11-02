'use client';

// The main menu: a big fei tile that slowly grows and shrinks, the title, and the ways in.

import { JOKER } from '../engine';
import { rmShort } from './format';
import { Tile } from './Tile';

export function Menu({ inRound, rounds, tally, onPlay, onHistory, onSettings }: {
  /** A round is under way: the first button continues it. */
  inRound: boolean;
  rounds: number;
  tally: number;
  onPlay: () => void;
  onHistory: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="menu">
      <div className="menu-tile" aria-hidden="true"><Tile kind={JOKER} size="hero" /></div>
      <h2 className="menu-title">3P Mahjong</h2>
      <p className="menu-sub muted">Malaysian three-player mahjong · 三人麻將</p>
      <div className="menu-buttons">
        <button type="button" className="btn primary cta" onClick={onPlay}>{inRound ? 'Continue round' : 'Quick play'}</button>
        <button type="button" className="btn" onClick={onHistory}>History</button>
        <button type="button" className="btn" onClick={onSettings}>Settings</button>
      </div>
      {rounds > 0 && (
        <p className="menu-tally muted">
          {rounds} round{rounds === 1 ? '' : 's'} played · your tally <span className={`money ${tally < 0 ? 'neg' : ''}`}>{rmShort(tally)}</span>
        </p>
      )}
    </div>
  );
}
