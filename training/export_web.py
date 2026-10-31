"""Saves the playing half of a trained network for the web game, and test positions to check it with.

    py training/export_web.py --checkpoint training/runs/v2n/latest.pt --name v2

Writes:
  public/ai/<name>-<hash>.bin   the player's weights as float16, layer by layer (weights row by row, then
                                biases); the hash in the name makes browsers fetch a new file when it changes
  src/ai/web-model.json         which file, its layer sizes and which inputs it expects
  training/runs/webcheck.bin    real positions with PyTorch's move for each, so `npx tsx scripts/ai-check.ts`
                                can confirm the browser picks the same moves

Only the player (actor) is exported: the coach is for training only and never chooses a move."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch

from evaluate import V1_OBS, V2_OBS
from mj_env import GameServer
from model import PolicyValue

HERE = Path(__file__).resolve().parent
REPO = HERE.parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", type=Path, required=True)
    ap.add_argument("--name", required=True, help="short name shown in the game, e.g. v2")
    ap.add_argument("--positions", type=int, default=5000, help="test positions to save")
    args = ap.parse_args()

    ck = torch.load(args.checkpoint, map_location="cpu")
    model = PolicyValue(ck["obs"], ck["actions"], ck["priv"])
    model.load_state_dict(ck["model"])
    model.eval()
    linears = [m for m in model.actor.modules() if isinstance(m, torch.nn.Linear)]

    parts, layers = [], []
    for lin in linears:
        parts += [lin.weight.detach().numpy().astype("<f2").tobytes(), lin.bias.detach().numpy().astype("<f2").tobytes()]
        layers.append([lin.in_features, lin.out_features])
    blob = b"".join(parts)
    digest = hashlib.sha256(blob).hexdigest()[:10]
    out_dir = REPO / "public" / "ai"
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob(f"{args.name}-*.bin"):
        old.unlink()
    file = f"{args.name}-{digest}.bin"
    (out_dir / file).write_bytes(blob)
    hints, opp = ck["obs"] != V1_OBS, ck["obs"] > V2_OBS
    info = {"name": args.name, "file": file, "obs": ck["obs"], "actions": ck["actions"], "hints": hints, "opp": opp,
            "layers": layers, "source": f"{args.checkpoint.parent.name}/{args.checkpoint.name} update {ck.get('update')}"}
    (REPO / "src" / "ai" / "web-model.json").write_text(json.dumps(info, indent=2) + "\n")
    print(f"wrote public/ai/{file} ({len(blob) / 1e6:.2f} MB, {sum(i * o + o for i, o in layers):,} numbers)")

    # Test positions from real games (the AI playing itself), with PyTorch's full-precision move for each.
    obs_rows, mask_rows, moves = [], [], []
    with GameServer(64, ["ai", "ai", "ai"], seed=4242, hints=hints, opp=opp) as srv:
        while True:
            b = srv.read()
            with torch.no_grad():
                a, _, _ = model.act(torch.from_numpy(b.obs), torch.from_numpy(b.mask), greedy=True)
            a = a.numpy().astype(np.int32)
            obs_rows.append(b.obs)
            mask_rows.append(b.mask.astype(np.uint8))
            moves.append(a)
            if sum(len(o) for o in obs_rows) >= args.positions:
                break  # stop while the server waits for moves, so it closes cleanly
            srv.send(a)
    obs, mask, move = np.concatenate(obs_rows), np.concatenate(mask_rows), np.concatenate(moves)
    header = np.array([len(obs), obs.shape[1], mask.shape[1]], "<i4")
    check = HERE / "runs" / "webcheck.bin"
    check.parent.mkdir(exist_ok=True)
    check.write_bytes(header.tobytes() + obs.astype("<f4").tobytes() + mask.tobytes() + move.astype("<i4").tobytes())
    print(f"wrote {check.relative_to(REPO)} ({len(obs):,} positions)")


if __name__ == "__main__":
    main()
