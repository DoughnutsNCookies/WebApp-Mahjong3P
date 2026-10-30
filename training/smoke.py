"""Checks every piece of the training setup works, without training anything:
the GPU and PyTorch, one forward pass of the network, game-server speed with random moves, the benchmark
against bots, and the GPU sensors used by the watchdog.

    py training/smoke.py
"""

from __future__ import annotations

import time

import numpy as np
import torch

from evaluate import evaluate
from mj_env import GameServer, random_legal
from model import PolicyValue
from safety import gpu_status


def main():
    print("1. GPU and PyTorch")
    print(f"   torch {torch.__version__}, CUDA available: {torch.cuda.is_available()}")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cuda":
        print(f"   {torch.cuda.get_device_name(0)}, compute capability {torch.cuda.get_device_capability(0)}")

    print("2. Game server and one forward pass (no learning)")
    rng = np.random.default_rng(0)
    with GameServer(envs=128, seats=["ai", "ai", "ai"], seed=3) as srv:
        b = srv.read()
        model = PolicyValue(b.obs.shape[1], b.mask.shape[1]).to(device)
        with torch.no_grad():
            logits, value = model(torch.from_numpy(b.obs).to(device), torch.from_numpy(b.mask).to(device))
        print(f"   observation {b.obs.shape[1]} numbers, {b.mask.shape[1]} move slots, logits {tuple(logits.shape)}, value {tuple(value.shape)}")
        a, _, _ = model.act(torch.from_numpy(b.obs).to(device), torch.from_numpy(b.mask).to(device))
        chosen_legal = b.mask[np.arange(len(b.mask)), a.cpu().numpy()].all()
        print(f"   untrained network only picks legal moves: {bool(chosen_legal)}")
        assert chosen_legal

        print("3. Speed: random legal moves for 10 seconds on one server")
        decisions = rounds = 0
        t0 = time.time()
        while time.time() - t0 < 10:
            srv.send(random_legal(b.mask, rng))
            decisions += len(b.mask)
            b = srv.read()
            rounds += len(b.done)
        dt = time.time() - t0
        print(f"   {decisions / dt:,.0f} decisions/s, {rounds / dt:,.0f} rounds/s on one server process")

    print("4. Benchmark: a random player vs two easy bots, 30 deals x 3 seats")
    r = evaluate(lambda obs, mask: random_legal(mask, rng), deals=30, bots="easy")
    print(f"   {r['rounds']} rounds: {r['rm_per_round']:+.2f} RM/round +/- {r['margin']:.2f} (a random player should lose)")

    print("5. GPU sensors for the watchdog")
    print(f"   {gpu_status() or 'nvidia-smi not available'}")
    print("\nAll checks done. Nothing was trained.")


if __name__ == "__main__":
    main()
