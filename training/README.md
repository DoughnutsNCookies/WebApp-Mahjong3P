# Training a mahjong AI (prepared, not started)

Self-play reinforcement learning (PPO) on BEAST's RTX 5090. The rules are not reimplemented here: Python
talks to the TypeScript engine through a game server (`src/ai/server.ts`), so the AI learns exactly the
game the app plays.

## Pieces

| File | What it does |
|---|---|
| `src/ai/encode.ts` | What the AI sees (369 numbers from its own player view only), its 42 move slots with a legal-move mask, and the hidden block for the coach (71 numbers: opponents' hands, the next wall tiles) |
| `src/ai/server.ts` | Runs many rounds at once; plays bot seats itself; duplicate-format evaluation mode |
| `mj_env.py` | Python side of the pipe to the game server |
| `model.py` | Two separate networks: the player (own view only, illegal moves masked) and the coach (view + hidden block, training only). They share no layers, so nothing hidden reaches the player |
| `train.py` | Self-play PPO against itself and a pool of its older versions; benchmarks run in a parallel process; checkpoints; resumes; `--dry-run` measures speed without learning |
| `evaluate.py` | Fair benchmark of a checkpoint against bots, in RM per round with a 95% margin |
| `safety.py` | GPU temperature watchdog and the PAUSE / STOP files |
| `smoke.py` | Checks everything works without training anything |
| `gpu-power-cap.ps1` | Caps the GPU at 450 W for training (administrator) |

## The coach (privileged critic)

Mahjong results are mostly luck in the short run, so judging a decision by how the round turned out is
noisy. During training the coach estimates each situation's value knowing the opponents' hands and the
coming tiles, which judges decisions far more fairly. Only the player plays; `smoke.py` checks that its
moves do not change at all when the hidden block does. If learning turns out slow, the next step would be
letting the player see the hidden block early in training and fading it out (as Microsoft's Suphx did).

## Setup (done once)

```
py -3.13 -m venv training\.venv
training\.venv\Scripts\python -m pip install torch --index-url https://download.pytorch.org/whl/cu128
training\.venv\Scripts\python -m pip install numpy
training\.venv\Scripts\python training\smoke.py
```

## Pilot (2026-10-30, 47 minutes, run `pilot`)

From scratch it went from -1.67 to the normal bot's level in about 25 minutes, then levelled off: final
benchmark +0.08 +/- 0.18 RM/round vs normal bots (3,000 rounds). Fixed afterwards: one GPU batch for all
servers and more of them (16 x 192 rounds; dry run 166k decisions/s vs the pilot's 46k), a stronger
exploration bonus (entropy 0.03; the pilot's 0.01 settled in minutes), older versions of itself in 1-2 seats
of a quarter of the rounds, benchmarks in a separate process, and saving every 25 updates with a kept
snapshot every 200 (the pilot wrote 1.9 GB in 47 minutes). The imitation head start was dropped: learning
from scratch reaches the normal bot in about half an hour.

## One-hour trial of the fixes (2026-10-30, run `pilot2`, started from the pilot)

About 80k decisions/s while training; exploration settled at ~0.6 instead of collapsing. Large benchmarks
(3,000 rounds): best version +0.29 +/- 0.20 RM/round vs normal bots, final version +0.19 +/- 0.19, and
+0.42 +/- 0.23 vs easy bots (pilot: +0.08 and +0.06). Fixed afterwards: every 300-deal check had reused the
same deals, which flattered the saved "best" version (checks averaged +0.34); each check now plays fresh
deals. Reaching the +0.50 target now needs a separate 1,000-deal confirming benchmark on its own deals. The
learning rate tapers to 20% over the time limit.

## Checks on fixed practice deals (2026-10-31)

Every regular check now plays the same 1,000 practice deals (`--eval-seed`, default 4242), and a new version
becomes `best.pt` only if it beats the best so far deal by deal on them. `best.pt` is now the exact weights
that were measured (it used to be saved a few updates later). Confirming uses its own fixed deals
(`--confirm-seed`), and results reported in the journal use a third set (seed 777) that nothing is ever picked
on, so picking on the practice deals can't flatter the reported numbers.

The same version on the same deals gives the identical result every time, but two versions agree only
weakly on the same deal (correlation about 0.4; one different discard changes every draw after it), so
pairing alone narrows a comparison by about a quarter. 1,000 deals instead of 300 brings a version-vs-version
comparison from about +/- 0.48 to about +/- 0.20 RM/round.

## Running

```
training\.venv\Scripts\python training\train.py                     # shows the plan, trains nothing
training\.venv\Scripts\python training\train.py --dry-run 60          # speed check: plays, learns and saves nothing
training\.venv\Scripts\python training\train.py --start --run main --init-from training\runs\pilot\latest.pt
                                                                     # trains; resumes runs\main if it exists
```

- Pause: in File Explorer, right-click in the `training` folder > New > Text Document, name it `PAUSE`
  (`PAUSE.txt` works too); delete it to resume. Stop: same, named `STOP` (it saves first, then quits;
  starting again resumes). Ctrl+C doesn't apply: training runs in the background without a window.
- The GPU temperature is written to the log. Pausing when hot is off by default (Sean's choice; the card
  throttles itself); add `--pause-when-hot` to pause at 82 C and resume at 70 C.
- No power cap by default (Sean's choice). `gpu-power-cap.ps1` is there if wanted.
- It uses 16 game-server processes and 4 PyTorch threads by default (about a third of BEAST's CPU), leaving room
  for the CloudPanel VM.
- Progress: `training\runs\<run>\log.csv` (speed, losses, GPU temperature, and RM/round against the normal bot).

## Measured on BEAST (2026-10-30)

- Engine fast path: about 2,500 rounds/s per CPU core with random moves (6 microseconds per move).
- Game server with observation and hidden-block encoding: about 690 rounds/s per process.
- A random player loses about RM2-3 a round to two easy bots in the benchmark (sanity check).

## Not done yet

- Exporting a trained model to run in the browser (ONNX) so the app can offer it as an opponent or hint.
