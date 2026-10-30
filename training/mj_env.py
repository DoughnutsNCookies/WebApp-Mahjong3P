"""Talks to the TypeScript game server (src/ai/server.ts). The rules live only in the engine; this file
just moves batches of observations, legal-move masks and chosen moves across a pipe."""

from __future__ import annotations

import json
import struct
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent


@dataclass
class Batch:
    env_player: np.ndarray  # (n, 2) int32: env id, player
    obs: np.ndarray         # (n, OBS) float32: the player's own view
    priv: np.ndarray        # (n, PRIV) float32: hidden info, for the training coach only
    mask: np.ndarray        # (n, ACTIONS) bool
    done: np.ndarray        # (m, 6) float32: env id, deal, ai seat, reward p0, p1, p2


class GameServer:
    """One Node process running many rounds at once.

    seats: e.g. ["ai", "ai", "ai"] for self-play, ["ai", "normal", "normal"] against bots.
    eval_deals: if set, plays each deal once with the AI in each seat, then stops (duplicate format).
    """

    def __init__(self, envs: int = 64, seats=("ai", "ai", "ai"), seed: int = 1, eval_deals: int | None = None,
                 hints: bool = True):
        # hints: v2 models also see the analyzer's hand-reading; v1 models (369 numbers) need hints=False.
        config = {"envs": envs, "seats": list(seats), "seed": seed, "hints": hints}
        if eval_deals:
            config["evalDeals"] = eval_deals
        self.proc = subprocess.Popen(
            ["node", "--import", "tsx", "src/ai/server.ts", json.dumps(config)],
            cwd=REPO, stdin=subprocess.PIPE, stdout=subprocess.PIPE, bufsize=0,
        )

    def _read_exact(self, n: int) -> bytes:
        chunks, got = [], 0
        while got < n:
            c = self.proc.stdout.read(n - got)
            if not c:
                raise RuntimeError("game server closed (see its error output above)")
            chunks.append(c)
            got += len(c)
        return b"".join(chunks)

    def read(self) -> Batch:
        (length,) = struct.unpack("<I", self._read_exact(4))
        frame = self._read_exact(length)
        n, n_done, obs_size, actions, priv_size = struct.unpack_from("<iiiii", frame, 0)
        o = 20
        # .copy(): frombuffer arrays are read-only, which PyTorch warns about.
        env_player = np.frombuffer(frame, np.int32, n * 2, o).reshape(n, 2).copy()
        o += n * 8
        obs = np.frombuffer(frame, np.float32, n * obs_size, o).reshape(n, obs_size).copy()
        o += n * obs_size * 4
        priv = np.frombuffer(frame, np.float32, n * priv_size, o).reshape(n, priv_size).copy()
        o += n * priv_size * 4
        mask = np.frombuffer(frame, np.uint8, n * actions, o).reshape(n, actions).astype(bool)
        o += n * actions
        done = np.frombuffer(frame, np.float32, n_done * 6, o).reshape(n_done, 6).copy()
        return Batch(env_player, obs, priv, mask, done)

    def send(self, slots: np.ndarray) -> None:
        slots = np.asarray(slots, dtype=np.int32)
        payload = struct.pack("<i", len(slots)) + slots.tobytes()
        self.proc.stdin.write(struct.pack("<I", len(payload)) + payload)
        self.proc.stdin.flush()

    def close(self) -> None:
        try:
            self.proc.stdin.close()
        except OSError:
            pass
        self.proc.wait(timeout=10)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def random_legal(mask: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """A uniformly random legal move for each row of the mask."""
    out = np.empty(len(mask), dtype=np.int32)
    for i, m in enumerate(mask):
        out[i] = rng.choice(np.flatnonzero(m))
    return out
