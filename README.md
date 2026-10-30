# Malaysian 3-Player Mahjong: rules engine and hand analyzer

A trainer for Malaysian 3-player mahjong (not Lami): one suit (dots), jokers (fei), a 5-fan minimum and a
10-fan cap. The goal is a hand analyzer that explains each decision, then a phone-friendly game against
two bots with hints and a post-hand review.

## Status

| Milestone | State |
|---|---|
| 1. Rules engine with tests | Done |
| 2. Hand analyzer (shanten, live tiles, reachable fan, safety) | Done |
| 3. Rule-based bots (easy / normal) | Next |
| 4. Playable game in the browser | |
| 5. Self-play training (optional) | |

## Layout

- `src/engine/`: the rules engine. Pure TypeScript: no React, Next.js or browser APIs (enforced by ESLint),
  so it runs in the browser and in Node.
  - `tiles.ts`: the 84 tiles and the short codes used in tests (`123d EEE RdRd J F1 S4 A8`)
  - `rules.ts`: house-rule settings (stake per fan, minimum fan) and every rule decision, with its source
  - `decompose.ts`: every way to read a hand as 4 sets plus a pair, with jokers as wilds
  - `scoring.ts`: fan for winners, and for losers in end-of-round settlement
  - `money.ts`: fan payout, fei (joker) money, loser settlement
  - `game.ts`: one round as a state machine: deal, draws, claims, kongs, robbing, wall end, settlement
  - `view.ts`: what one player may see (for a future multiplayer server)
- `src/analyzer/`: the hand analyzer, also pure TypeScript. For each discard: shanten (tiles from ready),
  live tiles that improve the hand, the fan outlook (finished fan, open fan routes, every wait and what it
  pays once ready, whether 5 and 10 fan are realistic), a safety estimate against each opponent, joker
  keep/set-aside advice and loser-settlement fan. Every number comes with a plain-English reason.
- `tests/`: Vitest tests. Each rule and worked example from the house rules has its own test.
- `scripts/sim.ts`: plays random rounds in Node and counts what happened.

A round is fully determined by its seed, dealer and list of actions, so the action list is the hand log:
`replay(seed, dealer, actions)` rebuilds it.

## Commands

```
npm test                       # all tests
npm run typecheck
npm run lint
npx tsx scripts/sim.ts 2000    # random rounds in Node
npx tsx scripts/analyze.ts "12d 456d RdRd Gd 99d E S N J" --bonus "F1"   # analyze a hand
```

## Rules

House rules come first, then answers to rule questions (marked Q1-Q11 in the code), then the "Dragon Gate"
app's rules. Anything still assumed is marked `ASSUMPTION` in the code.
