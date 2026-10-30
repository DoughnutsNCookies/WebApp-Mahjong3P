"""Fair benchmark of an AI against two bots: every deal is played three times, with the AI in each seat,
so tile luck and the dealer's edge cancel out. Reports the AI's money per round in RM with a 95% margin.

    py training/evaluate.py --checkpoint training/runs/main/latest.pt --deals 500 --bots normal
    py training/evaluate.py --random --deals 50 --bots easy        (a random player, for testing)
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from mj_env import GameServer, random_legal
from model import PolicyValue

RM_PER_UNIT = 4.00  # one reward unit is a 10-fan hand value at RM0.20/fan (10 x 0.20 x 2)


V1_OBS = 369  # models trained before the hints were added


def evaluate(policy, deals: int = 300, bots: str = "normal", envs: int = 64, seed: int = 7, hints: bool = True) -> dict:
    """policy(obs, mask) -> action slots. Returns mean RM per round and a 95% margin."""
    per_deal = np.zeros(deals)
    rounds = 0
    with GameServer(envs, ["ai", bots, bots], seed=seed, eval_deals=deals, hints=hints) as srv:
        while True:
            b = srv.read()
            for env, deal, ai_seat, r0, r1, r2 in b.done:
                per_deal[int(deal)] += (r0, r1, r2)[int(ai_seat)]
                rounds += 1
            if len(b.obs) == 0:
                break
            srv.send(policy(b.obs, b.mask))
    per_round = per_deal / 3 * RM_PER_UNIT
    margin = 2 * per_round.std(ddof=1) / np.sqrt(deals)
    return {"rm_per_round": float(per_round.mean()), "margin": float(margin), "rounds": rounds}


def model_policy(model: PolicyValue, device: str):
    def policy(obs, mask):
        with torch.no_grad():
            a, _, _ = model.act(torch.from_numpy(obs).to(device), torch.from_numpy(mask).to(device), greedy=True)
        return a.cpu().numpy()
    return policy


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", type=Path)
    ap.add_argument("--random", action="store_true")
    ap.add_argument("--deals", type=int, default=300)
    ap.add_argument("--bots", default="normal", choices=["easy", "normal", "advanced"])
    ap.add_argument("--json", type=Path, help="also write the result here (used by train.py)")
    ap.add_argument("--seed", type=int, default=7, help="which deals to play (same seed, same deals)")
    args = ap.parse_args()

    ck = None
    if args.random:
        rng = np.random.default_rng(0)
        policy = lambda obs, mask: random_legal(mask, rng)
    else:
        ck = torch.load(args.checkpoint, map_location="cpu")
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = PolicyValue(ck["obs"], ck["actions"], ck["priv"]).to(device)
        model.load_state_dict(ck["model"])
        model.eval()
        policy = model_policy(model, device)

    hints = args.random or ck["obs"] != V1_OBS
    r = evaluate(policy, args.deals, args.bots, seed=args.seed, hints=hints)
    print(f"{r['rounds']} rounds vs two {args.bots} bots: {r['rm_per_round']:+.2f} RM/round +/- {r['margin']:.2f}")
    if args.json:
        args.json.write_text(json.dumps(r))


if __name__ == "__main__":
    main()
