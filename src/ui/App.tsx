'use client';

import { useState } from 'react';
import { JOKER } from '../engine';
import { Game } from './Game';
import { Hands } from './Hands';
import { levelName } from './format';
import { Money } from './Money';
import { Menu } from './Menu';
import { Review } from './Review';
import { SettingsPanel } from './SettingsPanel';
import { useLook } from './look';
import { Tile } from './Tile';
import { useMatch } from './useMatch';

type Tab = 'home' | 'play' | 'hands' | 'settings';
const TABS: [Tab, string][] = [['play', 'Quick play'], ['hands', 'History'], ['settings', 'Settings']];

// Opening the app shows the menu; a refresh keeps you where you were (kept for this browser tab only).
const TAB_KEY = 'mj3p.tab';
const initialTab = (): Tab => {
  try {
    const t = sessionStorage.getItem(TAB_KEY);
    return t === 'play' || t === 'hands' || t === 'settings' ? t : 'home';
  } catch {
    return 'home';
  }
};

export function App() {
  const m = useMatch();
  useLook(m.settings);
  const [tab, setTabState] = useState<Tab>(initialTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    try { sessionStorage.setItem(TAB_KEY, t); } catch { /* private browsing: fine */ }
  };
  const [reviewing, setReviewing] = useState(false);
  const levels = m.settings.levels.map(levelName);
  const names = ['You', `Bot 1 · ${levels[0]}`, `Bot 2 · ${levels[1]}`];

  return (
    <div className="app">
      <nav className="topbar" aria-label="Main">
        <span className="lanterns" aria-hidden="true"><span className="lantern">福</span><span className="lantern">發</span></span>
        <h1>
          <button type="button" className="home" aria-label="Main menu" aria-current={tab === 'home' ? 'page' : undefined} onClick={() => setTab('home')}>
            <span className="home-mark" aria-hidden="true"><Tile kind={JOKER} /></span>
            <span className="home-title">3P Mahjong</span>
          </button>
        </h1>
        {TABS.map(([t, text]) => (
          <button key={t} type="button" className={`tab${tab === t ? ' on' : ''}`} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
            {text}
          </button>
        ))}
        <Money value={m.liveTally[0]} title="Your running tally" />
      </nav>

      <main>
        {tab === 'home' && (
          <Menu
            inRound={!!m.game && m.game.phase !== 'ended' && m.game.actions.length > 0}
            rounds={m.match.rounds} tally={m.match.tally[0]}
            onPlay={() => setTab('play')} onHistory={() => setTab('hands')} onSettings={() => setTab('settings')}
          />
        )}
        {tab === 'play' && !m.game && <p className="muted">Shuffling…</p>}
        {tab === 'play' && m.game && !reviewing && (
          <Game
            game={m.game} names={names} levels={levels} tally={m.liveTally} settings={m.settings}
            onAct={m.act}
            onNext={m.nextRound}
            onReview={() => setReviewing(true)}
          />
        )}
        {tab === 'play' && m.game && reviewing && (
          <Review
            seed={m.game.seed} dealer={m.game.dealer} actions={m.game.actions} unitSen={m.game.rules.unitSen} names={names}
            onClose={() => setReviewing(false)}
          />
        )}
        {tab === 'hands' && <Hands />}
        {tab === 'settings' && (
          <SettingsPanel
            settings={m.settings} onChange={m.setSettings}
            tally={m.match.tally} rounds={m.match.rounds} onResetTally={m.resetTally}
            aiStatus={m.aiStatus} aiError={m.aiError}
          />
        )}
      </main>

      <footer className="foot muted">
        House rules: dots only, jokers (fei), 5-fan minimum, 10-fan cap. Stake RM{(m.settings.unitSen / 100).toFixed(2)} per fan.
      </footer>
    </div>
  );
}
