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
        model = PolicyValue(b.obs.shape[1], b.mask.shape[1], b.priv.shape[1]).to(device)
        obs_t, mask_t = torch.from_numpy(b.obs).to(device), torch.from_numpy(b.mask).to(device)
        priv_t = torch.from_numpy(b.priv).to(device)
        with torch.no_grad():
            logits = model.logits(obs_t, mask_t)
            value = model.value(obs_t, priv_t)
            # Leak check: the player's move scores must not depend on the hidden information at all.
            other = model.value(obs_t, torch.rand_like(priv_t))
            same_logits = torch.equal(model.logits(obs_t, mask_t), logits)
        print(f"   view {b.obs.shape[1]} numbers, hidden block {b.priv.shape[1]} (coach only), {b.mask.shape[1]} move slots")
        print(f"   player ignores hidden info: {same_logits}; coach uses it: {not torch.equal(other, value)}")
        assert same_logits and not torch.equal(other, value)
        a, _, _ = model.act(obs_t, mask_t)
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

    print("6. Code check of the update step: one pass on a throwaway network with made-up rewards (discarded)")
    from argparse import Namespace
    from train import Rollouts, ppo_update
    with GameServer(envs=64, seats=["ai", "ai", "ai"], seed=5) as srv:
        b = srv.read()
    scratch = PolicyValue(b.obs.shape[1], b.mask.shape[1], b.priv.shape[1]).to(device)
    obs_t, mask_t, priv_t = (torch.from_numpy(x).to(device) for x in (b.obs, b.mask, b.priv))
    a, logp, value = scratch.act(obs_t, mask_t, priv_t)
    roll = Rollouts(lam=0.95)
    value_np = value.cpu().numpy()
    cid = roll.add_chunk(obs=b.obs, priv=b.priv, mask=b.mask, action=a.cpu().numpy().astype(np.int64), logp=logp.cpu().numpy())
    for i, (env, p) in enumerate(b.env_player):
        key = (0, int(env), int(p))
        roll.add(key, cid, i, float(value_np[i]))
        roll.finish(key, float(rng.normal()))
    stats = ppo_update(scratch, torch.optim.Adam(scratch.parameters()), roll.take(device),
                       Namespace(epochs=1, minibatch=32, clip=0.2, entropy=0.01))
    print(f"   update step runs: policy loss {stats['policy']:.3f}, value loss {stats['value']:.3f}")
    del scratch
    print("\nAll checks done. Nothing was trained or saved.")


if __name__ == "__main__":
    main()
