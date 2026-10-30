'use client';

import { useState } from 'react';
import { Game } from './Game';
import { Hands } from './Hands';
import { rmShort } from './format';
import { Review } from './Review';
import { SettingsPanel } from './SettingsPanel';
import { useMatch } from './useMatch';

type Tab = 'play' | 'hands' | 'settings';

export function App() {
  const m = useMatch();
  const [tab, setTab] = useState<Tab>('play');
  const [reviewing, setReviewing] = useState(false);
  const names = ['You', `Bot 1 · ${m.settings.levels[0]}`, `Bot 2 · ${m.settings.levels[1]}`];

  return (
    <div className="app">
      <nav className="topbar" aria-label="Main">
        <h1>3P Mahjong</h1>
        {(['play', 'hands', 'settings'] as Tab[]).map((t) => (
          <button key={t} type="button" className={`tab${tab === t ? ' on' : ''}`} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
            {t === 'play' ? 'Play' : t === 'hands' ? 'Hands' : 'Settings'}
          </button>
        ))}
        <span className={`money ${m.match.tally[0] < 0 ? 'neg' : ''}`} title="Your running tally">{rmShort(m.match.tally[0])}</span>
      </nav>

      <main>
        {tab === 'play' && !m.game && <p className="muted">Shuffling…</p>}
        {tab === 'play' && m.game && !reviewing && (
          <Game
            game={m.game} names={names} levels={m.settings.levels} tally={m.match.tally}
            onAct={m.act}
            onNext={m.nextRound}
            onReview={() => setReviewing(true)}
          />
        )}
        {tab === 'play' && m.game && reviewing && (
          <Review
            seed={m.game.seed} dealer={m.game.dealer} actions={m.game.actions} unitSen={m.game.rules.unitSen}
            onClose={() => setReviewing(false)}
          />
        )}
        {tab === 'hands' && <Hands />}
        {tab === 'settings' && (
          <SettingsPanel
            settings={m.settings} onChange={m.setSettings}
            tally={m.match.tally} rounds={m.match.rounds} onResetTally={m.resetTally}
          />
        )}
      </main>

      <footer className="foot muted">
        House rules: dots only, jokers (fei), 5-fan minimum, 10-fan cap. Stake RM{(m.settings.unitSen / 100).toFixed(2)} per fan.
      </footer>
    </div>
  );
}
