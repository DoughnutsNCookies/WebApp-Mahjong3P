# Malaysian 3-Player Mahjong: rules engine and hand analyzer

A trainer for Malaysian 3-player mahjong (not Lami): one suit (dots), jokers (fei), a 5-fan minimum and a
10-fan cap. The goal is a hand analyzer that explains each decision, then a phone-friendly game against
two bots with hints and a post-hand review.

## Status

| Milestone | State |
|---|---|
| 1. Rules engine with tests | Done |
| 2. Hand analyzer (shanten, live tiles, reachable fan, safety) | Done |
| 3. Rule-based bots (easy / normal) | Done |
| 4. Playable game in the browser | Done, live at mahjong.schuahsolutions.com |
| 5. Self-play training | In progress: v2 beats the normal bot (see the journal) |

## Journal

`docs/JOURNAL.md` records what was built, the rule decisions, every training run and its results, and the bugs
found, day by day.

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
- `src/bots/`: rule-based bots that decide from their own player view only. Easy plays for speed;
  normal uses the analyzer (fan routes, safety, folding, joker advice, claims only into hands that can pay);
  advanced is normal plus money-based play once ready: it can turn down a win under 10 fan when holding
  out is worth more, using win/lose rates fitted to bot games (`scripts/calibrate.ts`).
- `src/ui/` and `src/app/`: the game. A static Next.js export (
pm run build` writes `out/`) that runs
  entirely in the browser; settings, the tally, the round in progress and saved hands live in localStorage.
- `tests/`: Vitest tests. Each rule and worked example from the house rules has its own test.
- `scripts/sim.ts`: plays random rounds in Node and counts what happened.

A round is fully determined by its seed, dealer and list of actions, so the action list is the hand log:
`replay(seed, dealer, actions)` rebuilds it.

## Commands

```
npm test                       # all tests
npm run typecheck
npm run lint
npm run dev                    # play locally at http://localhost:3000
npm run build && npm run ui-check   # build, then play a round in phone WebKit and desktop Chromium
npx tsx scripts/sim.ts 2000    # random rounds in Node
npx tsx scripts/bots.ts 500 normal,easy,easy     # bot vs bot, duplicate format
npx tsx scripts/calibrate.ts                      # refit the advanced bot's win/lose rates
npx tsx scripts/import.ts pasted.txt              # rebuild a hand from a 'Copy for Claude' export
npx tsx scripts/analyze.ts "12d 456d RdRd Gd 99d E S N J" --bonus "F1"   # analyze a hand
```

## Bot benchmark

Duplicate format (`scripts/bots.ts`): every deal is played in all 6 seatings, so tile luck and the dealer's
edge cancel out. 2,000 deals (12,000 rounds) each, result per round with a 95% margin:

| Matchup | Result |
|---|---|
| normal vs two easy | normal +RM0.32 +/- 0.11 |
| advanced vs two normal | advanced -RM0.01 +/- 0.06 (turned down 52 wins in 12,000 rounds) |

The game is a fast race under these rules: bonus tiles give most hands 5 fan early, about 97% of rounds
end in a win after roughly 12 discards, and wins are 5-7 fan about three quarters of the time. Holding out
for more fan is rarely worth it, which is why the advanced bot seldom does.

## Rules

House rules come first, then answers to rule questions (marked Q1-Q11 in the code), then the "Dragon Gate"
app's rules. Anything still assumed is marked `ASSUMPTION` in the code.

Kong money (added 2026-10-31, replacing the handover's "no instant kong payout"): a kong from a discard is
2 units from the discarder; a self kong or adding to a shown pong is 1 unit from each other player; a
robbed kong pays nothing (`kongDiscardUnits` / `kongSelfUnits` in `rules.ts`).
