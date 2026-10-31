# Project journal

A dated record of what was built, what was decided, what the measurements showed, and what went wrong.
Newest work is at the bottom. Money is at the default stake of RM0.20 per fan. "±" is a 95% margin.

## 30 October 2026

### Planning and rules

- Goal: help a player get better at Malaysian 3-player mahjong (not Lami). The priority is a hand
  analyzer that explains decisions, then bots, a playable game, and later a trained AI.
- Rules come from the owner's house rules, checked against the "Dragon Gate" app. Eleven unclear points
  were settled before any code (marked Q1-Q11 in the code). Two were corrected later:
  - Q2: a discarded fei (joker) is set aside like a bonus tile with a replacement draw, can never be
    claimed (not even to win), and doesn't count as a discard for Earthly Slam.
  - Q6: Steal Kong can rob any kong; a concealed kong's tile is shown when declared.
- All remaining judgement calls are marked `ASSUMPTION` in the code and were confirmed.

### Milestones 1-3: engine, analyzer, bots

- **M1, rules engine:** tiles, hand decomposition with fei, fan scoring with the 10-fan cap, payouts, fei
  money, loser settlement, and a round state machine (claims, kongs, kong robbing, fei swaps, wall end).
  A round is fully defined by its seed, dealer and action list, which doubles as the hand log.
- **M2, hand analyzer:** for each discard, shanten, live improving tiles, fan outlook (every wait and its
  fan once ready), a safety estimate, fei advice and loser-settlement fan, all with plain-English reasons.
- **M3, bots:** easy (speed only), normal (analyzer: fan routes, safety, folding), advanced (can turn down
  a small win to hold out for a bigger one; its win/lose rates were fitted to bot games).

What the bot measurements taught us:

- The first benchmark always made one bot the dealer, which inflated its edge (normal vs easy looked like
  +RM0.87/round). The fix is the **duplicate format**: every deal played in all 6 seatings, so tile luck
  and the dealer's edge cancel. Fair result: normal beats easy by **+0.32 ± 0.11**.
- 200-deal runs were pure noise; about 2,000 deals are needed to see differences of a few tenths.
- Advanced vs normal: **-0.01 ± 0.06** over 12,000 rounds. Holding out rarely pays because under these
  rules the game is a fast race: about 97% of rounds end in a win after roughly 12 discards, and most wins
  are 5-7 fan (bonus tiles give most hands 5 fan early).

### Milestone 4: the playable game

- A static Next.js app, phone first, live at mahjong.schuahsolutions.com. Play against two bots; hint
  button; post-hand review; saved hands with replay; running RM tally; stake setting.
- Added on request the same evening: numbers on flower/season tiles and names for the 8 non-numbered
  bonus tiles (cat, mouse, rooster, centipede, two boys, two girls); the hand in one row; a fan counter in
  each player's box; labelled sections (hand, sets, bonus, discards); a gold box for the winner;
  "Copy for Claude" (a text report of a hand with a replay code, rebuilt with `scripts/import.ts`).

### Training preparation

- A fast in-place engine path for simulations (2,549 rounds/s per core instead of 289), a fixed-size
  encoding of each player's view (369 numbers) and 42 move slots with a legal-move mask, a Node game
  server that runs many rounds at once, and a PyTorch PPO trainer on the RTX 5090.
- A **coach** (privileged critic): during training the value estimate also sees hidden information
  (opponents' hands, the coming wall tiles) to judge decisions more fairly; the player part never does.
  A leak check confirms the player's moves don't change when the hidden information does.
- Safety: PAUSE / STOP files, saves that resume, an automatic stop rule (a confirmed +0.50 RM/round
  against normal bots, 12 hours without a new best, or 7 days). The owner chose no GPU power cap and no
  pause on GPU temperature (both available as options).

### v1 training runs

| Run | When | What happened |
|---|---|---|
| pilot | 20:23, 47 min, from zero | -1.67 RM/round vs normal bots after 1 min, normal-bot level after ~25 min, then flat. Final: **+0.08 ± 0.18** |
| pilot2 | 21:44, 1 h, from pilot | Best version **+0.29 ± 0.20**, final +0.19 ± 0.19; +0.42 vs easy bots |
| check | 23:00, 15 min | Deliberately low target to test the stop-and-confirm path end to end: it rejected four lucky streaks and stopped on the fifth |
| main | 23:10, 1.5 h, from pilot2 | **Flat**: the same 1,000 deals gave +0.17 at the start and +0.17 after 1.2 h. Stopped |

Fixed along the way: CPU mostly idle (one GPU batch for all servers, more servers), exploration
collapsing (bigger entropy bonus), only ever playing itself (opponent pool of older versions),
benchmarks pausing training (run in parallel), far too many saves, and a progress check that reused the
same 300 deals every time and so flattered the saved "best" version.

## 31 October 2026

### v2: give the AI the analyzer's hand-reading

v1 had to discover hand-reading from raw tiles and stalled. v2 changes:

- **Hints:** for each possible discard, shanten after it, whether it's the best, and live improving tiles;
  for each claim, shanten after it (62 more numbers).
- 4x the decisions per update (262,144) with a smaller learning rate, to average out luck.
- Game servers no longer wait for each other; 4 extra servers play against easy bots.
- The hints were later made 2.4x faster (shanten from tile counts, a cache of finished answers, and
  importing hot modules directly: under tsx every `index.ts` re-export costs a lookup per use).

| Run | When | What happened |
|---|---|---|
| v2trial | 00:48, 1 h, from zero | Normal-bot level after ~9 min (v1: ~25). Paired: **+0.26 / +0.24 ± 0.17** |
| v2 | 02:04, 38 min, from v2trial | Climbing (checks +0.56, +0.49, +0.86); stopped for the kong-money rule |
| v2k | 02:47, 41 min, from v2 | **Stopped at the target: a 1,000-deal confirmation gave +0.65 ± 0.19 RM/round** |

### Kong money (rule added 02:43)

Replaces the handover's "no instant kong payout". A kong from a discard: the discarder pays 2 units
(RM0.40). A self kong or adding the 4th tile to a shown pong: each other player pays 1 unit. A robbed
kong pays nothing. Assumed: paid even if the round ends in a draw; fei kongs pay the same.

Re-measured on the same 1,000 deals under the new rule: v1 best **+0.17 ± 0.20**, v2 trial
**+0.25 ± 0.17**, v2 after about 2 hours of training **+0.43 ± 0.18**: the first result clearly ahead of v1.

### Where v2's edge comes from

v2k at update 376, 1,500 rounds against two normal bots, compared with a normal bot in the same seat:

| | v2k | normal bot |
|---|---|---|
| Wins | 36.7% of rounds | 32.7% |
| Average fan when winning | 7.3 | 7.2 |
| Deals in (pays 3V alone) | 18.7% | 19.1% |

All of the edge is attack. Its defence is no better than the normal bot's simple rule of thumb, and it
deals in about one round in five. That points to v3.

### Bugs found and fixed (both days)

- Legal moves were compared as JSON text, so the same move with its fields in a different order was
  rejected (found when rebuilding pasted hands).
- The analyzer's wait cache was global and ignored bonus tiles, so two hands could share a wrong answer.
- A fei wait was shown as winnable off a discard; fei are never discarded, so it is self-drawn only.
- The hint showed "~10 fan" whenever Flowerless was still possible, counting a 56% chance as earned.
- A CSS class name clash pushed every hand tile's character off-centre.
- Bots spent a fei to kong a discard when a pong scored the same.
- The progress page said "still improving" on a run that was flat (it trusted one lucky high point; it
  now judges the trend of the last 6 checks).
- **A hand of nothing but fei crashed the bots.** In training this silently killed the easy-bot game
  servers 3-4 times per v2 run, so v2 trained almost only against itself. Fixed in the bots and the
  engine (with the wall empty, an all-fei hand now ends the round as a draw), and the trainer now reports
  and restarts any game server that dies (tested by killing one mid-run).

### The overnight run, v2n

Paired benchmark (same 1,000 deals) of v2k: best **+0.52 ± 0.18**, final **+0.48 ± 0.18**. Its +0.65 at the
stop came from different deals that suited it.

v2n continued from v2k's final version at 03:45, the first run with the all-fei fix (so the easy-bot
opponents stayed up all night), with no target and a 3-hour patience stop. It stopped itself at 07:35
after 3,165 updates. Its regular checks bounced between +0.28 and +1.10 with no clear trend after the
first hour. Paired: best **+0.60 ± 0.19**, final **+0.71 ± 0.19**, the best result so far but improving
slowly: v2 has largely levelled off, which is the case for v3.

### Measuring better

Regular training checks were 300 fresh deals each, so two checks could differ by +/- 0.48 RM/round on luck
alone, and best.pt was saved a few updates after the version actually measured. Now every check plays the same
1,000 practice deals and is compared deal by deal with the best version (about +/- 0.20), best.pt is the
measured weights, and reported results still come from the separate test deals. Pairing helps less than hoped:
two versions on the same deal agree only weakly (correlation 0.4), because one different discard changes every
draw after it.

### The game

Play against the trained AI in the browser (v2n, 1.5 MB, the same moves as PyTorch on 5,017 test positions);
animations for discards, calls and wins; two table styles (Ink and seal, Macau), each with a night mode; big
effects and sound, both switchable; taken discards stay on the table greyed out.

### v3 (opponent reading)

Trained 2.3 h from v2n with 132 more inputs about each opponent (danger per tile, early and recent discards,
tiles they let go). On two separate sets of 1,000 deals it stayed about 0.1 RM/round behind v2n at every check
(+0.61 vs +0.71 and +0.86 vs +0.97 at update 1,500) and was stopped. v2n stays in the game.

### A coach that sees the whole wall (v2w)

The coach (training-only critic) was given the next 8 draws of every player and the make-up of the whole
remaining wall, on the theory that most of a round's money is luck the coach could then see through. Run
1.7 h from v2n, stopped by the patience rule. The coach used the new inputs (their weights grew from zero)
but its error never dropped (1.05 vs v2n's 1.06), and on the test deals the final version was level with v2n:
**+0.68 / +1.08** against +0.71 / +0.97, both within the margin. So the unpredictable part of a round is what
the other players do, not the wall. The version picked as best on the practice deals (update 300) tested
worse than the final one again: picking a best among near-equal versions mostly picks luck.

### Look-ahead search on top of v2n: worse, not better

Before each discard, try the network's top moves in imagined continuations (unseen tiles redealt at random,
everyone then playing with the network) and pick the best average. Fast (0.2-0.4 s a decision; a 3,000-round
test takes 8 minutes on 16 cores) and leak-free (rearranging the hidden tiles never changes the choice), but
it plays much worse than the network alone on the test deals: 4 candidates x 24 rollouts **-0.81** against
+0.71 (1.52 worse); 2 candidates x 64 rollouts +0.13 on 300 deals, 0.61 worse. With search the AI wins 29% of
rounds instead of 38%. The rollout estimates are too noisy to tell the best discard from the second best
(a win swings RM4, a difference between discards is a few tenths), so the search ends up roughly tossing a
coin between them, and the second-best discard is often a hand-breaking one. The network's own judgement is
the better guide. The harness (scripts/search-bench.ts) reproduces evaluate.py exactly without search and
reports win and deal-in rates, so it stays.

### A stronger scripted opponent, 1 November

Two attempts. A **hard bot**: the normal bot plus a second step of look-ahead on discards (how good the hand is
after its next improvement) and weights tuned by coordinate search in the duplicate format (`scripts/bot-bench.ts`
plays 6,000 rounds in a minute across 16 workers; `scripts/tune-bot.ts`). Result: **+0.08 +/- 0.10 RM/round**
over the normal bot on fresh deals; the second step alone added nothing. The scripted bot's level is set by
its heuristics, not by its weights. It is in the game as "Hard" but is not meaningfully stronger.

The stronger fixed opponent we actually have is the trained AI itself: a **`frozen` seat** now lets the game's
AI (public/ai/, v2n) sit as an opponent in training (`--bot-level frozen`) and as a yardstick
(`evaluate.py --bots frozen`). It beats the normal bot by RM0.7-1.0 a round and costs less to run.

## Next

- **v3: opponent-aware hints** for defence: for each possible discard, whether it gives an opponent a
  pong, kong or win; whether that opponent already threw the tile; a danger rating; plus each opponent's
  discard order, early versus late discards, and claims they passed on. Built on top of v2k's best
  version (new inputs start switched off), with a 1-hour from-scratch trial alongside as a check.
- Test the owner's own playing habits as bot switches with the duplicate benchmark (big hands with many
  flowers, throwing non-scoring winds first, following opponents' honour discards, holding fei late,
  rarely folding), then compare them with what the trained AI does.
- Later: run a trained model in the browser as an opponent and as a "deep hint".
