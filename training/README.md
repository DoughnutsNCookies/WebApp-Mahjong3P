# Training a mahjong AI (prepared, not started)

Self-play reinforcement learning (PPO) on BEAST's RTX 5090. The rules are not reimplemented here: Python
talks to the TypeScript engine through a game server (`src/ai/server.ts`), so the AI learns exactly the
game the app plays.

## Pieces

| File | What it does |
|---|---|
| `src/ai/encode.ts` | What the AI sees (369 numbers from its own player view only) and its 42 move slots with a legal-move mask |
| `src/ai/server.ts` | Runs many rounds at once; plays bot seats itself; duplicate-format evaluation mode |
| `mj_env.py` | Python side of the pipe to the game server |
| `model.py` | The network: shared body, policy head (42 slots, illegal ones masked), value head |
| `train.py` | Self-play PPO; benchmarks against the normal bot every 25 updates; checkpoints; resumes |
| `evaluate.py` | Fair benchmark of a checkpoint against bots, in RM per round with a 95% margin |
| `safety.py` | GPU temperature watchdog and the PAUSE / STOP files |
| `smoke.py` | Checks everything works without training anything |
| `gpu-power-cap.ps1` | Caps the GPU at 450 W for training (administrator) |

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
- It pauses by itself if the GPU reaches 82 C, and resumes at 70 C.
- It uses 8 game-server processes and 4 PyTorch threads by default, leaving cores for the CloudPanel VM.
- Progress: `training\runs\<run>\log.csv` (speed, losses, GPU temperature, and RM/round against the normal bot).

## Measured on BEAST (2026-10-30)

- Engine fast path: about 2,500 rounds/s per CPU core with random moves (6 microseconds per move).
- Game server with observation encoding: about 760 rounds/s per process.
- A random player loses about RM2-3 a round to two easy bots in the benchmark (sanity check).

## Not done yet

- Starting the AI by copying the normal bot first (imitation), which usually saves days of training.
- Exporting a trained model to run in the browser (ONNX) so the app can offer it as an opponent or hint.
