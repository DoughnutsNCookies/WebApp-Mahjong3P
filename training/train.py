"""Self-play training with PPO. The AI plays copies of itself and, in some rounds, older versions of itself
(an opponent pool, so it doesn't just get good against its current self). The reward is each player's
money for the round. A coach (value estimate) that also sees hidden information judges decisions during
training; the player part chooses moves from its own view only.

Nothing trains without --start:
    py training/train.py                                   shows the plan and settings
    py training/train.py --dry-run 60                      measures speed for 60 s; learns and saves nothing
    py training/train.py --start --run main                trains, resuming runs/main if it exists
    py training/train.py --start --run main --init-from training/runs/pilot/latest.pt

While it runs: create training/PAUSE to pause (delete it to resume), training/STOP to save and quit.
Benchmarks against the bots run in a separate process, so training doesn't wait for them.
"""

from __future__ import annotations

import argparse
import copy
import csv
import json
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
from torch import nn

from mj_env import GameServer
from model import PolicyValue
from safety import clear_stop, Watchdog, wait_if_paused

HERE = Path(__file__).resolve().parent


def parse(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", action="store_true", help="actually train (otherwise just print the plan)")
    ap.add_argument("--dry-run", type=float, default=0, help="seconds of play with no learning, to measure speed")
    ap.add_argument("--run", default="main")
    ap.add_argument("--init-from", type=Path, help="start from this checkpoint's network (new runs only)")
    ap.add_argument("--servers", type=int, default=16, help="game server processes (CPU cores used for games)")
    ap.add_argument("--envs", type=int, default=192, help="rounds running at once per server")
    ap.add_argument("--steps", type=int, default=65536, help="decisions collected per update")
    ap.add_argument("--minibatch", type=int, default=8192)
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--clip", type=float, default=0.2)
    ap.add_argument("--entropy", type=float, default=0.03, help="exploration bonus (the pilot's 0.01 settled too fast)")
    ap.add_argument("--gae-lambda", type=float, default=0.95)
    ap.add_argument("--league-prob", type=float, default=0.25, help="share of rounds with older versions in 1-2 seats")
    ap.add_argument("--pool-every", type=int, default=50, help="updates between snapshots added to the opponent pool")
    ap.add_argument("--pool-size", type=int, default=8)
    ap.add_argument("--eval-every", type=int, default=100, help="updates between benchmarks (run in parallel)")
    ap.add_argument("--eval-deals", type=int, default=300)
    ap.add_argument("--eval-bots", default="normal", choices=["easy", "normal", "advanced"])
    ap.add_argument("--save-every", type=int, default=25, help="updates between saves of latest.pt")
    ap.add_argument("--keep-every", type=int, default=200, help="updates between kept snapshots")
    ap.add_argument("--torch-threads", type=int, default=4)
    ap.add_argument("--pause-when-hot", action="store_true", help="pause above 82 C (off by default)")
    # Stop rule (agreed with Sean): judged on the average of the last 3 benchmarks.
    ap.add_argument("--max-hours", type=float, default=168, help="stop after this long whatever happens (7 days)")
    ap.add_argument("--patience-hours", type=float, default=12, help="stop if the 3-benchmark average hasn't set a new best for this long")
    ap.add_argument("--target", type=float, default=0.50, help="stop once a confirming benchmark reaches this many RM/round")
    ap.add_argument("--confirm-deals", type=int, default=1000, help="deals in the confirming benchmark (one 300-deal result is +/- 0.35)")
    return ap.parse_args(argv)


class Rollouts:
    """Each player's decisions in each round, kept as row numbers into per-step arrays (no copying), turned
    into training samples when the round ends."""

    def __init__(self, lam: float):
        self.lam = lam
        self.chunks: dict[int, dict[str, np.ndarray]] = {}
        self.next_chunk = 0
        self.open = defaultdict(list)  # (server, env, player) -> [(chunk, row, value)]
        self.ready_rows: list[tuple[int, int]] = []
        self.ready_adv: list[float] = []
        self.ready_ret: list[float] = []

    def add_chunk(self, **arrays) -> int:
        cid = self.next_chunk
        self.chunks[cid] = arrays
        self.next_chunk += 1
        return cid

    def add(self, key, chunk: int, row: int, value: float):
        self.open[key].append((chunk, row, value))

    def finish(self, key, reward: float):
        steps = self.open.pop(key, [])
        if not steps:
            return
        # Reward only at the end of the round (gamma = 1): GAE over the coach's value estimates.
        nxt, gae = reward, 0.0
        adv = [0.0] * len(steps)
        for t in reversed(range(len(steps))):
            v = steps[t][2]
            gae = (nxt - v) + self.lam * gae
            adv[t] = gae
            nxt = v
        for (chunk, row, v), a in zip(steps, adv):
            self.ready_rows.append((chunk, row))
            self.ready_adv.append(a)
            self.ready_ret.append(a + v)

    def ready(self) -> int:
        return len(self.ready_rows)

    def take(self, device):
        rows = np.array(self.ready_rows)
        chunks = np.unique(rows[:, 0])
        # Gather rows chunk by chunk; reorder advantages and returns the same way.
        order = np.concatenate([np.flatnonzero(rows[:, 0] == c) for c in chunks])
        out = {}
        for k in ("obs", "priv", "mask", "action", "logp"):
            out[k] = torch.as_tensor(np.concatenate([self.chunks[c][k][rows[rows[:, 0] == c, 1]] for c in chunks]), device=device)
        out["adv"] = torch.as_tensor(np.array(self.ready_adv, np.float32)[order], device=device)
        out["ret"] = torch.as_tensor(np.array(self.ready_ret, np.float32)[order], device=device)
        self.ready_rows, self.ready_adv, self.ready_ret = [], [], []
        # Drop chunks no unfinished round still points into.
        live = {c for steps in self.open.values() for c, _, _ in steps}
        for c in list(self.chunks):
            if c not in live:
                del self.chunks[c]
        return out


def ppo_update(model, opt, data, args):
    n = len(data["action"])
    adv = (data["adv"] - data["adv"].mean()) / (data["adv"].std() + 1e-8)
    stats = defaultdict(float)
    for _ in range(args.epochs):
        for idx in torch.randperm(n, device=adv.device).split(args.minibatch):
            # The player learns from its own view; the coach (value) also sees the hidden information.
            logits = model.logits(data["obs"][idx], data["mask"][idx])
            value = model.value(data["obs"][idx], data["priv"][idx])
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


class Benchmarks:
    """Runs evaluate.py on a snapshot in its own process, one at a time, and hands back finished results."""

    def __init__(self, run_dir: Path, deals: int, bots: str):
        self.run_dir, self.deals, self.bots = run_dir, deals, bots
        self.proc = None
        self.update = None
        self.kind = "regular"

    def start(self, model, update: int, sizes: dict, deals: int | None = None, kind: str = "regular") -> bool:
        if self.proc and self.proc.poll() is None:
            return False  # the previous benchmark is still running; skip this one
        self.kind = kind
        path = self.run_dir / "bench.pt"
        torch.save({"model": model.state_dict(), **sizes}, path)
        self.update = update
        self.proc = subprocess.Popen(
            [sys.executable, str(HERE / "evaluate.py"), "--checkpoint", str(path), "--deals", str(deals or self.deals),
             "--bots", self.bots, "--json", str(self.run_dir / "bench.json"),
             # Fresh deals for every regular benchmark (the pilot reused one set, which flattered the
             # "best" version); confirming benchmarks use their own fresh sets, never used for picking.
             "--seed", str(500000 + update if kind == "confirm" else 1000 + update)],
            cwd=HERE.parent, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        return True

    def poll(self):
        if not self.proc or self.proc.poll() is None:
            return None
        self.proc = None
        try:
            return self.update, self.kind, json.loads((self.run_dir / "bench.json").read_text())
        except (OSError, ValueError):
            return None

    def close(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()


def main(argv=None):
    args = parse(argv)
    run_dir = HERE / "runs" / args.run
    plan = (f"Self-play PPO, run '{args.run}' in {run_dir}\n"
            f"  {args.servers} game servers x {args.envs} rounds at once, {args.steps} decisions per update\n"
            f"  older versions in 1-2 seats of {args.league_prob:.0%} of rounds (pool of {args.pool_size}, a snapshot every {args.pool_every} updates)\n"
            f"  benchmark vs two {args.eval_bots} bots every {args.eval_every} updates ({args.eval_deals} deals x 3 seats), in parallel\n"
            f"  latest.pt every {args.save_every} updates, kept snapshot every {args.keep_every}; PAUSE / STOP files in {HERE}\n"
            f"  stops at +{args.target:.2f} RM/round (3-benchmark average), after {args.patience_hours:g} h without a new best, or after {args.max_hours:g} h")
    if not args.start and not args.dry_run:
        print(plan + "\n\nNot training: add --start to begin (or --dry-run SECONDS to measure speed).")
        return
    dry = bool(args.dry_run) and not args.start
    print(("DRY RUN: playing only, nothing is learned or saved\n" if dry else "") + plan, flush=True)

    torch.set_num_threads(args.torch_threads)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    rng = np.random.default_rng(int(time.time()))
    servers = [GameServer(args.envs, ["ai", "ai", "ai"], seed=int(rng.integers(1, 2**31))) for _ in range(args.servers)]
    batches = [s.read() for s in servers]
    sizes = {"obs": batches[0].obs.shape[1], "actions": batches[0].mask.shape[1], "priv": batches[0].priv.shape[1]}

    model = PolicyValue(sizes["obs"], sizes["actions"], sizes["priv"]).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    update = 0
    latest = run_dir / "latest.pt"
    if not dry:
        run_dir.mkdir(parents=True, exist_ok=True)
        if latest.exists():
            ck = torch.load(latest, map_location=device)
            model.load_state_dict(ck["model"])
            opt.load_state_dict(ck["opt"])
            update = ck["update"]
            print(f"resumed at update {update}", flush=True)
        elif args.init_from:
            model.load_state_dict(torch.load(args.init_from, map_location=device)["model"])
            print(f"started from {args.init_from}", flush=True)

    def save(path):
        torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "update": update, **sizes}, path)

    log = writer = None
    if not dry:
        log_path = run_dir / "log.csv"
        new_log = not log_path.exists()
        log = open(log_path, "a", newline="")
        writer = csv.writer(log)
        if new_log:
            writer.writerow(["time", "update", "decisions_per_s", "policy_loss", "value_loss", "entropy",
                             "gpu_c", "gpu_w", "benchmark_update", "vs_bots_rm", "margin"])
    bench = Benchmarks(run_dir, args.eval_deals, args.eval_bots)

    pool: list[PolicyValue] = []                          # older versions (only their player part is used)
    frozen: dict[tuple[int, int], tuple[set, int]] = {}   # (server, env) -> (seats played by the pool, pool index)
    rollouts = Rollouts(args.gae_lambda)
    watchdog = Watchdog(pause_when_hot=args.pause_when_hot)
    t0 = t_last = time.time()
    decisions = decisions_total = 0
    recent: list[float] = []
    best_avg, best_at = -1e9, time.time()
    stop_reason = None
    try:
        while True:
            if dry and time.time() - t0 >= args.dry_run:
                break
            if not wait_if_paused(watchdog):
                break

            # Round ends: give each player's decisions their reward, and pick who plays the next round.
            for si, b in enumerate(batches):
                for env, _deal, _seat, r0, r1, r2 in b.done:
                    env = int(env)
                    for p, r in enumerate((r0, r1, r2)):
                        rollouts.finish((si, env, p), float(r))
                    if pool and rng.random() < args.league_prob:
                        seats = set(rng.choice(3, size=int(rng.integers(1, 3)), replace=False).tolist())
                        frozen[(si, env)] = (seats, int(rng.integers(len(pool))))
                    else:
                        frozen.pop((si, env), None)

            # Every server's decisions in one batch through the GPU.
            sid = np.concatenate([np.full(len(b.obs), i) for i, b in enumerate(batches)])
            ep = np.concatenate([b.env_player for b in batches])
            obs = np.concatenate([b.obs for b in batches])
            mask = np.concatenate([b.mask for b in batches])
            priv = np.concatenate([b.priv for b in batches])
            who = np.full(len(obs), -1)  # -1: the learner; otherwise the index of an older version in the pool
            for i, (s, (env, p)) in enumerate(zip(sid, ep)):
                f = frozen.get((int(s), int(env)))
                if f and int(p) in f[0]:
                    who[i] = f[1]
            learner = who == -1
            actions = np.zeros(len(obs), np.int32)
            obs_t, mask_t = torch.from_numpy(obs).to(device), torch.from_numpy(mask).to(device)
            li = torch.from_numpy(np.flatnonzero(learner)).to(device)
            a, logp, value = model.act(obs_t[li], mask_t[li], torch.from_numpy(priv).to(device)[li])
            actions[learner] = a.cpu().numpy()
            for k in np.unique(who[~learner]):
                sel = who == k
                rows = torch.from_numpy(np.flatnonzero(sel)).to(device)
                a_k, _, _ = pool[int(k)].act(obs_t[rows], mask_t[rows])
                actions[sel] = a_k.cpu().numpy()

            # Send each server its moves; they play on while this step is stored.
            start = 0
            for i, srv in enumerate(servers):
                n = len(batches[i].obs)
                srv.send(actions[start:start + n])
                start += n
            decisions += len(obs)

            if not dry:
                logp_all = np.zeros(len(obs), np.float32)
                value_all = np.zeros(len(obs), np.float32)
                logp_all[learner] = logp.cpu().numpy()
                value_all[learner] = value.cpu().numpy()
                cid = rollouts.add_chunk(obs=obs, priv=priv, mask=mask, action=actions.astype(np.int64), logp=logp_all)
                for r in np.flatnonzero(learner & (mask.sum(1) > 1)):  # forced moves teach nothing
                    rollouts.add((int(sid[r]), int(ep[r, 0]), int(ep[r, 1])), cid, int(r), float(value_all[r]))

            batches = [s.read() for s in servers]

            if dry or rollouts.ready() < args.steps:
                continue
            frac = min(1.0, (time.time() - t0) / (args.max_hours * 3600))
            for g in opt.param_groups:
                g["lr"] = args.lr * (1 - 0.8 * frac)
            stats = ppo_update(model, opt, rollouts.take(device), args)
            update += 1
            rate = decisions / (time.time() - t_last)
            decisions_total += decisions
            t_last, decisions = time.time(), 0

            if update % args.pool_every == 0:
                pool = (pool + [copy.deepcopy(model).eval()])[-args.pool_size:]
            if update % args.eval_every == 0:
                bench.start(model, update, sizes)
            bench_cols = ["", "", ""]
            finished = bench.poll()
            if finished:
                bu, kind, r = finished
                bench_cols = [bu, f"{r['rm_per_round']:.3f}", f"{r['margin']:.3f}"]
                label = f"confirming benchmark ({r['rounds']} rounds)" if kind == "confirm" else f"vs {args.eval_bots} bots"
                print(f"update {bu}: {label} {r['rm_per_round']:+.2f} RM/round +/- {r['margin']:.2f}", flush=True)
                if kind == "confirm":
                    if r["rm_per_round"] >= args.target:
                        stop_reason = f"reached the target: confirmed {r['rm_per_round']:+.2f} RM/round over {r['rounds']} rounds"
                    else:
                        print("  not confirmed; carrying on", flush=True)
                else:
                    recent = (recent + [r["rm_per_round"]])[-3:]
                    if len(recent) == 3:
                        avg = sum(recent) / 3
                        if avg > best_avg:
                            best_avg, best_at = avg, time.time()
                            save(run_dir / "best.pt")
                        if avg >= args.target and bench.start(model, update, sizes, deals=args.confirm_deals, kind="confirm"):
                            print(f"  3-benchmark average {avg:+.2f}: confirming with {args.confirm_deals} deals", flush=True)
            if not stop_reason and best_avg > -1e9 and time.time() - best_at > args.patience_hours * 3600:
                stop_reason = f"no new best for {args.patience_hours:g} h (best 3-benchmark average {best_avg:+.2f} RM/round)"
            if not stop_reason and time.time() - t0 > args.max_hours * 3600:
                stop_reason = f"time limit of {args.max_hours:g} h"
            writer.writerow([time.strftime("%Y-%m-%d %H:%M:%S"), update, f"{rate:.0f}", f"{stats['policy']:.4f}",
                             f"{stats['value']:.4f}", f"{stats['entropy']:.3f}", watchdog.last.get("temp", ""),
                             watchdog.last.get("power", ""), *bench_cols])
            log.flush()
            if update % args.save_every == 0:
                save(latest)
            if update % args.keep_every == 0:
                save(run_dir / f"update-{update:05d}.pt")
            if stop_reason:
                print(f"stopping: {stop_reason}", flush=True)
                break
    finally:
        elapsed = time.time() - t0
        if dry:
            print(f"dry run: {(decisions_total + decisions) / elapsed:,.0f} decisions/s over {elapsed:.0f} s "
                  f"({args.servers} servers x {args.envs} rounds); GPU {watchdog.last}", flush=True)
        else:
            save(latest)
            print(f"saved {latest} at update {update}", flush=True)
            log.close()
        bench.close()
        watchdog.close()
        for s in servers:
            s.close()
        clear_stop()


if __name__ == "__main__":
    main()
