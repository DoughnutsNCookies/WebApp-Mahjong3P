'use client';

// Runs a match: you are player 0, bots are players 1 and 2. Bots move on a timer so their play can be
// followed; when a round ends the tally is updated and the hand is saved to the log once.

import { useCallback, useEffect, useRef, useState } from 'react';
import { aiAction, loadWebModel, WebModel } from '../ai/web';
import { botAction } from '../bots';
import { Action, applyAction, DEFAULT_RULES, GameState, newRound, replay, Rules, waitingFor } from '../engine';
import {
  addLog, loadCurrent, loadMatch, loadSettings, MatchState, NEW_MATCH, randomSeed, saveCurrent,
  saveMatch, saveSettings, Settings,
} from './storage';

const DELAY = { slow: 1100, normal: 650, fast: 250 };

export const rulesFor = (unitSen: number): Rules => ({ ...DEFAULT_RULES, unitSen });

/** Settings, tally and the round in progress from storage (the app only renders in the browser). */
function loadInitial() {
  const settings = loadSettings();
  const match = loadMatch();
  const c = loadCurrent();
  let game: GameState | null = null;
  if (c) {
    try {
      game = replay(c.seed, c.dealer, c.actions, rulesFor(c.unitSen));
    } catch {
      game = null; // saved by an older version and no longer replays
    }
  }
  // A round that had already ended before a refresh was already counted.
  const recorded = game?.phase === 'ended' ? `${game.seed}` : null;
  game ??= newRound(randomSeed(), match.dealer, rulesFor(settings.unitSen));
  return { settings, match, game, recorded };
}

export function useMatch() {
  const [initial] = useState(loadInitial);
  const [settings, setSettingsState] = useState<Settings>(initial.settings);
  const [match, setMatch] = useState<MatchState>(initial.match);
  const [game, setGame] = useState<GameState | null>(initial.game);
  const recorded = useRef<string | null>(initial.recorded);

  // Save the round in progress after every move.
  useEffect(() => {
    if (game) saveCurrent({ seed: game.seed, dealer: game.dealer, unitSen: game.rules.unitSen, actions: game.actions });
  }, [game]);

  // The trained AI's weights, fetched the first time a seat is set to it.
  const wantAi = settings.levels.includes('ai');
  const [ai, setAi] = useState<{ model: WebModel | null; error: string | null }>({ model: null, error: null });
  useEffect(() => {
    if (!wantAi || ai.model || ai.error) return;
    let live = true;
    loadWebModel()
      .then((model) => live && setAi({ model, error: null }))
      .catch((e: Error) => live && setAi({ model: null, error: e.message }));
    return () => { live = false; };
  }, [wantAi, ai.model, ai.error]);
  const aiStatus: 'off' | 'loading' | 'ready' | 'failed' = !wantAi ? 'off' : ai.model ? 'ready' : ai.error ? 'failed' : 'loading';

  // Bots take their turn.
  useEffect(() => {
    if (!game || game.phase === 'ended') return;
    const bot = waitingFor(game).find((p) => p !== 0);
    if (bot === undefined) return;
    const level = settings.levels[bot - 1];
    if (level === 'ai' && aiStatus === 'loading') return; // runs again once the weights arrive
    const move = (g: GameState) =>
      level !== 'ai' ? botAction(g, bot, level) : ai.model ? aiAction(g, bot, ai.model) : botAction(g, bot, 'normal');
    const delay = game.phase === 'turn' ? DELAY[settings.speed] : DELAY[settings.speed] / 3;
    const t = setTimeout(() => {
      setGame((g) => (g && g.phase !== 'ended' ? applyAction(g, move(g)) : g));
    }, delay);
    return () => clearTimeout(t);
  }, [game, settings.speed, settings.levels, ai.model, aiStatus]);

  // A round just ended: settle the tally and save the hand, once.
  useEffect(() => {
    if (!game || game.phase !== 'ended' || recorded.current === `${game.seed}`) return;
    recorded.current = `${game.seed}`;
    const r = game.result!;
    setMatch((m) => {
      const next = { tally: m.tally.map((x, p) => x + r.total[p]), rounds: m.rounds + 1, dealer: r.nextDealer };
      saveMatch(next);
      return next;
    });
    addLog({
      id: `${Date.now()}-${game.seed}`,
      date: new Date().toISOString(),
      seed: game.seed,
      dealer: game.dealer,
      unitSen: game.rules.unitSen,
      levels: settings.levels,
      actions: game.actions,
      summary: { type: r.type, winner: r.winner, fan: r.score?.fan, myTotal: r.total[0] },
    });
  }, [game, settings.levels]);

  const act = useCallback((a: Action) => setGame((g) => (g ? applyAction(g, a) : g)), []);

  const nextRound = useCallback(() => {
    setGame((g) => newRound(randomSeed(), g?.result?.nextDealer ?? match.dealer, rulesFor(settings.unitSen)));
  }, [match.dealer, settings.unitSen]);

  const setSettings = useCallback((s: Settings) => {
    setSettingsState(s);
    saveSettings(s);
  }, []);

  const resetTally = useCallback(() => {
    const m = { ...NEW_MATCH, dealer: match.dealer };
    setMatch(m);
    saveMatch(m);
  }, [match.dealer]);

  return { settings, setSettings, match, resetTally, game, act, nextRound, aiStatus, aiError: ai.error };
}
