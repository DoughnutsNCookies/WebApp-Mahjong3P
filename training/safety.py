"""Keeps a training run gentle on BEAST: watches the GPU temperature, and lets Sean pause or stop a run
by creating a file (training/PAUSE or training/STOP), no terminal needed."""

from __future__ import annotations

import subprocess
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PAUSE_FILE = HERE / "PAUSE"
STOP_FILE = HERE / "STOP"

HOT_C = 82    # pause above this
COOL_C = 70   # resume below this


def gpu_status() -> dict:
    """Temperature, power and use of GPU 0 from nvidia-smi (empty if unavailable)."""
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=temperature.gpu,power.draw,power.limit,utilization.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10,
        ).stdout.strip().splitlines()[0]
        temp, draw, limit, util = (float(x) for x in out.split(","))
        return {"temp": temp, "power": draw, "limit": limit, "util": util}
    except Exception:
        return {}


class Watchdog:
    """Polls the GPU every `every` seconds. `hot` is set while the GPU is too warm."""

    def __init__(self, every: float = 15.0):
        self.hot = threading.Event()
        self.last: dict = {}
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, args=(every,), daemon=True)
        self._thread.start()

    def _run(self, every: float):
        while not self._stop.is_set():
            self.last = gpu_status()
            t = self.last.get("temp")
            if t is not None:
                if t >= HOT_C:
                    self.hot.set()
                elif t <= COOL_C:
                    self.hot.clear()
            self._stop.wait(every)

    def close(self):
        self._stop.set()


def wait_if_paused(watchdog: Watchdog, log=print) -> bool:
    """Blocks while PAUSE exists or the GPU is hot. Returns False if STOP exists (save and exit)."""
    announced = False
    while True:
        if STOP_FILE.exists():
            return False
        reason = "PAUSE file" if PAUSE_FILE.exists() else ("GPU at %.0f C" % watchdog.last.get("temp", 0) if watchdog.hot.is_set() else None)
        if not reason:
            if announced:
                log("resuming")
            return True
        if not announced:
            log(f"paused ({reason})")
            announced = True
        time.sleep(5)
