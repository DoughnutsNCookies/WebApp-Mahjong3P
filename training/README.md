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
| `train.py` | Self-play PPO; benchmarks against the normal bot every 25 updates; checkpoints; resumes |
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

## Running (not yet)

```
training\.venv\Scripts\python training\train.py                     # shows the plan, trains nothing
training\.venv\Scripts\python training\train.py --start --run main  # trains; resumes runs\main if it exists
```

- Pause: create an empty file `training\PAUSE`; delete it to resume. Stop: create `training\STOP` (it saves first).
- The GPU temperature is written to the log. Pausing when hot is off by default (Sean's choice; the card
  throttles itself); add `--pause-when-hot` to pause at 82 C and resume at 70 C.
- No power cap by default (Sean's choice). `gpu-power-cap.ps1` is there if wanted.
- It uses 8 game-server processes and 4 PyTorch threads by default, leaving cores for the CloudPanel VM.
- Progress: `training\runs\<run>\log.csv` (speed, losses, GPU temperature, and RM/round against the normal bot).

## Measured on BEAST (2026-10-30)

- Engine fast path: about 2,500 rounds/s per CPU core with random moves (6 microseconds per move).
- Game server with observation and hidden-block encoding: about 690 rounds/s per process.
- A random player loses about RM2-3 a round to two easy bots in the benchmark (sanity check).

## Not done yet

- Starting the AI by copying the normal bot first (imitation), which usually saves days of training.
- Exporting a trained model to run in the browser (ONNX) so the app can offer it as an opponent or hint.
