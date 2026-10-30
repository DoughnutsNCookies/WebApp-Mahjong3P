"""Self-play training with PPO. Three copies of the same AI play each other; the reward is each player's
money for the round. Every few updates it is benchmarked against the normal bot (evaluate.py).

Nothing runs without --start:
    py training/train.py                      shows the plan and settings
    py training/train.py --start --run main   trains, resuming training/runs/main if it exists

While it runs: create training/PAUSE to pause (delete it to resume), training/STOP to save and quit.
It also pauses by itself if the GPU passes 82 C, and resumes below 70 C.
"""

from __future__ import annotations

import argparse
import csv
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
from torch import nn

from evaluate import evaluate, model_policy
from mj_env import GameServer
from model import PolicyValue
from safety import STOP_FILE, Watchdog, wait_if_paused

HERE = Path(__file__).resolve().parent


def parse():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", action="store_true", help="actually train (otherwise just print the plan)")
    ap.add_argument("--run", default="main")
    ap.add_argument("--servers", type=int, default=8, help="game server processes (CPU cores used for games)")
    ap.add_argument("--envs", type=int, default=128, help="rounds running at once per server")
    ap.add_argument("--steps", type=int, default=65536, help="decisions collected per update")
    ap.add_argument("--minibatch", type=int, default=8192)
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--clip", type=float, default=0.2)
    ap.add_argument("--entropy", type=float, default=0.01)
    ap.add_argument("--gae-lambda", type=float, default=0.95)
    ap.add_argument("--eval-every", type=int, default=25, help="updates between benchmarks")
    ap.add_argument("--eval-deals", type=int, default=300)
    ap.add_argument("--save-every", type=int, default=10, help="updates between checkpoints")
    ap.add_argument("--torch-threads", type=int, default=4)
    return ap.parse_args()


class Rollouts:
    """Collects each player's decisions in each round and turns finished rounds into training samples."""

    def __init__(self, lam: float):
        self.lam = lam
        self.open = defaultdict(list)  # (server, env, player) -> [(obs, mask, action, logp, value)]
        self.samples = defaultdict(list)

    def add(self, key, obs, mask, action, logp, value):
        self.open[key].append((obs, mask, action, logp, value))

    def finish(self, key, reward: float):
        steps = self.open.pop(key, [])
        if not steps:
            return
        values = [s[4] for s in steps]
        # Reward only at the end of the round (gamma = 1): GAE over the value estimates.
        adv = np.zeros(len(steps), np.float32)
        nxt, gae = reward, 0.0
        for t in reversed(range(len(steps))):
            delta = nxt - values[t]
            gae = delta + self.lam * gae
            adv[t] = gae
            nxt = values[t]
        for (obs, mask, action, logp, value), a in zip(steps, adv):
            for k, v in zip(("obs", "mask", "action", "logp", "adv", "ret"), (obs, mask, action, logp, a, a + value)):
                self.samples[k].append(v)

    def ready(self) -> int:
        return len(self.samples["action"])

    def take(self, device):
        s = {k: torch.as_tensor(np.array(v), device=device) for k, v in self.samples.items()}
        self.samples = defaultdict(list)
        return s


def ppo_update(model, opt, data, args):
    n = len(data["action"])
    adv = (data["adv"] - data["adv"].mean()) / (data["adv"].std() + 1e-8)
    stats = defaultdict(float)
    for _ in range(args.epochs):
        for idx in torch.randperm(n, device=adv.device).split(args.minibatch):
            logits, value = model(data["obs"][idx], data["mask"][idx])
            dist = torch.distributions.Categorical(logits=logits)
            logp = dist.log_prob(data["action"][idx])
            ratio = (logp - data["logp"][idx]).exp()
            a = adv[idx]
            policy_loss = -torch.min(ratio * a, ratio.clamp(1 - args.clip, 1 + args.clip) * a).mean()
            value_loss = (value - data["ret"][idx]).pow(2).mean()
            entropy = dist.entropy().mean()
            loss = policy_loss + 0.5 * value_loss - args.entropy * entropy
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            stats["policy"] += policy_loss.item()
            stats["value"] += value_loss.item()
            stats["entropy"] += entropy.item()
    return {k: v / max(1, args.epochs * ((n + args.minibatch - 1) // args.minibatch)) for k, v in stats.items()}


def main():
    args = parse()
    run_dir = HERE / "runs" / args.run
    plan = (f"Self-play PPO, run '{args.run}' in {run_dir}\n"
            f"  {args.servers} game servers x {args.envs} rounds at once, {args.steps} decisions per update\n"
            f"  benchmark vs two normal bots every {args.eval_every} updates ({args.eval_deals} deals x 3 seats)\n"
            f"  checkpoint every {args.save_every} updates; PAUSE / STOP files in {HERE}")
    if not args.start:
        print(plan + "\n\nNot training: add --start to begin.")
        return
    print(plan)

    torch.set_num_threads(args.torch_threads)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    run_dir.mkdir(parents=True, exist_ok=True)
    servers = [GameServer(args.envs, ["ai", "ai", "ai"], seed=1000 + i * 7919 + int(time.time()) % 1000) for i in range(args.servers)]
    batches = [s.read() for s in servers]
    obs_size, actions = batches[0].obs.shape[1], batches[0].mask.shape[1]

    model = PolicyValue(obs_size, actions).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    update = 0
    latest = run_dir / "latest.pt"
    if latest.exists():
        ck = torch.load(latest, map_location=device)
        model.load_state_dict(ck["model"])
        opt.load_state_dict(ck["opt"])
        update = ck["update"]
        print(f"resumed at update {update}")

    def save(path):
        torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "update": update,
                    "obs": obs_size, "actions": actions}, path)

    log_path = run_dir / "log.csv"
    new_log = not log_path.exists()
    log = open(log_path, "a", newline="")
    writer = csv.writer(log)
    if new_log:
        writer.writerow(["time", "update", "decisions_per_s", "policy_loss", "value_loss", "entropy", "gpu_c", "vs_normal_rm", "margin"])

    rollouts = Rollouts(args.gae_lambda)
    watchdog = Watchdog()
    t_last, decisions = time.time(), 0
    try:
        while True:
            if not wait_if_paused(watchdog):
                break
            # Choose moves for every server's pending decisions, send them all, then read the next batches
            # (the servers play their bot-free moves in parallel while we wait).
            for si, (srv, b) in enumerate(zip(servers, batches)):
                for env, _deal, _seat, r0, r1, r2 in b.done:
                    for p, r in enumerate((r0, r1, r2)):
                        rollouts.finish((si, int(env), p), float(r))
                obs = torch.from_numpy(b.obs).to(device)
                mask = torch.from_numpy(b.mask).to(device)
                action, logp, value = model.act(obs, mask)
                action_np = action.cpu().numpy()
                logp_np, value_np = logp.cpu().numpy(), value.cpu().numpy()
                forced = b.mask.sum(1) == 1  # nothing to learn from a forced move
                for i, (env, p) in enumerate(b.env_player):
                    if not forced[i]:
                        rollouts.add((si, int(env), int(p)), b.obs[i], b.mask[i], action_np[i], logp_np[i], value_np[i])
                srv.send(action_np)
                decisions += len(action_np)
            batches = [s.read() for s in servers]

            if rollouts.ready() >= args.steps:
                stats = ppo_update(model, opt, rollouts.take(device), args)
                update += 1
                rate = decisions / (time.time() - t_last)
                t_last, decisions = time.time(), 0
                bench = ["", ""]
                if update % args.eval_every == 0:
                    model.eval()
                    r = evaluate(model_policy(model, device), args.eval_deals, "normal")
                    model.train()
                    bench = [f"{r['rm_per_round']:.3f}", f"{r['margin']:.3f}"]
                    print(f"update {update}: vs normal bots {r['rm_per_round']:+.2f} RM/round +/- {r['margin']:.2f}")
                writer.writerow([time.strftime("%Y-%m-%d %H:%M:%S"), update, f"{rate:.0f}", f"{stats['policy']:.4f}",
                                 f"{stats['value']:.4f}", f"{stats['entropy']:.3f}", watchdog.last.get("temp", ""), *bench])
                log.flush()
                if update % args.save_every == 0:
                    save(run_dir / f"update-{update:05d}.pt")
                    save(latest)
    finally:
        save(latest)
        print(f"saved {latest} at update {update}")
        watchdog.close()
        log.close()
        for s in servers:
            s.close()
        if STOP_FILE.exists():
            STOP_FILE.unlink()


if __name__ == "__main__":
    main()
