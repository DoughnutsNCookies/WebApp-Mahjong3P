"""Lets Sean pause or stop a run by creating a file (training/PAUSE or training/STOP), no terminal needed,
and reads the GPU temperature for the log. Pausing when the GPU is hot is optional (--pause-when-hot);
Sean chose to leave it off on 2026-10-30 (the card throttles itself)."""

from __future__ import annotations

import subprocess
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PAUSE_FILE = HERE / "PAUSE"
STOP_FILE = HERE / "STOP"


def _exists(f: Path) -> bool:
    """True for PAUSE or PAUSE.txt: Windows hides extensions, so a "new text document" gets .txt."""
    return f.exists() or f.with_name(f.name + ".txt").exists()


def stop_requested() -> bool:
    return _exists(STOP_FILE)


def clear_stop():
    for f in (STOP_FILE, STOP_FILE.with_name("STOP.txt")):
        if f.exists():
            f.unlink()

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

    def __init__(self, every: float = 15.0, pause_when_hot: bool = False):
        self.pause_when_hot = pause_when_hot
        self.hot = threading.Event()
        self.last: dict = {}
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, args=(every,), daemon=True)
        self._thread.start()

    def _run(self, every: float):
        while not self._stop.is_set():
            self.last = gpu_status()
            t = self.last.get("temp")
            if t is not None and self.pause_when_hot:
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
        if stop_requested():
            return False
        reason = "PAUSE file" if _exists(PAUSE_FILE) else ("GPU at %.0f C" % watchdog.last.get("temp", 0) if watchdog.hot.is_set() else None)
        if not reason:
            if announced:
                log("resuming")
            return True
        if not announced:
            log(f"paused ({reason})")
            announced = True
        time.sleep(5)
