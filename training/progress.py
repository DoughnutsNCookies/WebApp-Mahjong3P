"""Writes a plain-English progress page for a training run: training/runs/<run>/progress.html.
Only reads the run's log files, so it never disturbs a run in progress.

    py training/progress.py            (run "main")
    py training/progress.py pilot2
Or double-click training/Update progress.bat.
"""

from __future__ import annotations

import csv
import html
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
PATIENCE_H = 12
MAX_H = 168
TARGET = 0.50
# What each known starting point measured, for the 'Running for' note.
ORIGINS = {"pilot2": "the one-hour trial's best version (it measured +RM0.29)", "pilot": "the first pilot's model (about normal-bot level)"}


def read_run(run: str):
    d = HERE / "runs" / run
    rows = list(csv.DictReader(open(d / "log.csv", newline=""))) if (d / "log.csv").exists() else []
    console = (d / "console.log").read_text(errors="replace") if (d / "console.log").exists() else ""
    when = {int(r["update"]): datetime.strptime(r["time"], "%Y-%m-%d %H:%M:%S") for r in rows}
    checks, confirms = [], []
    for m in re.finditer(r"update (\d+): vs (\w+) bots ([+-][\d.]+) RM/round \+/- ([\d.]+)", console):
        u = int(m[1])
        checks.append({"update": u, "time": when.get(u), "rm": float(m[3]), "margin": float(m[4]), "bots": m[2]})
    for m in re.finditer(r"update (\d+): confirming benchmark \((\d+) rounds\) ([+-][\d.]+) RM/round \+/- ([\d.]+)", console):
        confirms.append({"update": int(m[1]), "rounds": int(m[2]), "rm": float(m[3]), "margin": float(m[4])})
    stop = re.search(r"stopping: (.*)", console)
    start_from = re.search(r"started from (.*)", console)
    return d, rows, checks, confirms, (stop[1].strip() if stop else None), (start_from[1].strip() if start_from else None)


def running(d: Path) -> bool:
    pid = (d / "pid.txt").read_text().strip() if (d / "pid.txt").exists() else ""
    if not pid:
        return False
    out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
    return pid in out


def hours(td: timedelta) -> str:
    h = td.total_seconds() / 3600
    return f"{int(h * 60)} min" if h < 1 else f"{h:.1f} h" if h < 48 else f"{h / 24:.1f} days"


def money(x: float) -> str:
    return f"{'+' if x >= 0 else '-'}RM{abs(x):.2f}"


def build(run: str) -> Path:
    d, rows, checks, confirms, stop, start_from = read_run(run)
    now = datetime.now()
    start = datetime.strptime(rows[0]["time"], "%Y-%m-%d %H:%M:%S") if rows else now
    last = rows[-1] if rows else {}
    alive = running(d)

    # Rolling average of the last 3 checks: what the stop rule watches.
    for i, c in enumerate(checks):
        c["avg"] = sum(x["rm"] for x in checks[i - 2:i + 1]) / 3 if i >= 2 else None
    avgs = [c for c in checks if c["avg"] is not None]
    best = max(avgs, key=lambda c: c["avg"]) if avgs else None
    current = avgs[-1]["avg"] if avgs else (checks[-1]["rm"] if checks else None)

    # Status, in words, with an icon so it isn't colour alone.
    if stop:
        status, icon, cls = f"Finished: {stop}.", "â– ", "done"
    elif not alive:
        saved = re.findall(r"saved .* at update (\d+)", (d / "console.log").read_text(errors="replace") if (d / "console.log").exists() else "")
        status, icon, cls = ((f"Stopped and saved at update {saved[-1]} (by a STOP file or by hand).", "â– ", "done") if saved else
                             ("Not running (stopped by a restart, or not started). Its last save is kept.", "!", "warn"))
    else:
        # Judge the trend, not the best point: a single high average can just be a lucky streak (this label
        # once said "still improving" on a run that a paired benchmark showed was flat).
        until = (f" It stops by itself if there's no new best by {(best['time'] + timedelta(hours=PATIENCE_H)):%a %H:%M}."
                 if best and best["time"] else "")
        if len(checks) < 12:
            status, icon, cls = f"Warming up: the trend needs 12 checks ({len(checks)} so far).{until}", "â—", "flat"
        else:
            recent = sum(c["rm"] for c in checks[-6:]) / 6
            before = sum(c["rm"] for c in checks[-12:-6]) / 6
            diff = recent - before
            words = f"the last 6 checks average {money(recent)}, against {money(before)} for the 6 before"
            if diff > 0.15:
                status, icon, cls = f"Improving: {words}.{until}", "â–²", "good"
            elif diff < -0.15:
                status, icon, cls = f"Slipping: {words}.{until}", "â–¼", "warn"
            else:
                status, icon, cls = f"Flat: {words} (within the noise).{until}", "â—", "flat"
    def explain(x):
        if x is None:
            return "No checks yet."
        per100 = abs(x) * 100
        if abs(x) < 0.05:
            return "About as good as a normal bot."
        if x > 0:
            return f"Ahead of the normal bots: about RM{per100:.0f} won per 100 rounds at RM0.20/fan."
        return f"Behind the normal bots: about RM{per100:.0f} lost per 100 rounds."

    # ---- Chart (inline SVG) ------------------------------------------------------------------
    W, H, L, R, T, B = 760, 320, 56, 150, 20, 40
    pts = [c for c in checks if c["time"]]
    xmax = max([(c["time"] - start).total_seconds() / 3600 for c in pts] + [1.0])
    vals = [c["rm"] for c in pts] + [0, TARGET]
    ymin, ymax = min(-0.25, min(vals) - 0.05), max(0.75, max(vals) + 0.05)
    X = lambda h: L + (W - L - R) * h / xmax
    Y = lambda v: T + (H - T - B) * (ymax - v) / (ymax - ymin)
    svg = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-labelledby="chart-title" class="chart">']
    step = 0.25
    v = (int(ymin / step) - 1) * step
    while v <= ymax:
        if v >= ymin:
            svg.append(f'<line x1="{L}" x2="{W - R}" y1="{Y(v):.1f}" y2="{Y(v):.1f}" class="grid"/>'
                       f'<text x="{L - 8}" y="{Y(v) + 4:.1f}" class="tick" text-anchor="end">{v:+.2f}</text>')
        v += step
    hstep = max(1, round(xmax / 6)) if xmax > 3 else 0.5
    h = 0.0
    while h <= xmax + 1e-9:
        svg.append(f'<text x="{X(h):.1f}" y="{H - B + 18}" class="tick" text-anchor="middle">{h:g} h</text>')
        h += hstep
    svg.append(f'<text x="{(L + W - R) / 2}" y="{H - 4}" class="tick" text-anchor="middle">hours since the start</text>')
    # Reference lines, labelled directly.
    svg.append(f'<line x1="{L}" x2="{W - R}" y1="{Y(0):.1f}" y2="{Y(0):.1f}" class="ref"/>'
               f'<text x="{W - R + 6}" y="{Y(0) + 4:.1f}" class="lab">normal bot level</text>')
    svg.append(f'<line x1="{L}" x2="{W - R}" y1="{Y(TARGET):.1f}" y2="{Y(TARGET):.1f}" class="ref dash"/>'
               f'<text x="{W - R + 6}" y="{Y(TARGET) + 4:.1f}" class="lab">target {TARGET:+.2f}</text>')
    # Each check: small muted dots. Average of 3: the main line.
    for c in pts:
        svg.append(f'<circle cx="{X((c["time"] - start).total_seconds() / 3600):.1f}" cy="{Y(c["rm"]):.1f}" r="4" class="dot"/>')
    line = [c for c in pts if c["avg"] is not None]
    if len(line) >= 2:
        path = " ".join(f'{"M" if i == 0 else "L"}{X((c["time"] - start).total_seconds() / 3600):.1f},{Y(c["avg"]):.1f}' for i, c in enumerate(line))
        svg.append(f'<path d="{path}" class="avg"/>')
    if line:
        e = line[-1]
        ex, ey = X((e["time"] - start).total_seconds() / 3600), Y(e["avg"])
        svg.append(f'<circle cx="{ex:.1f}" cy="{ey:.1f}" r="5" class="avg-end"/>'
                   f'<text x="{ex + 8:.1f}" y="{ey - 8:.1f}" class="val">{e["avg"]:+.2f}</text>')
    svg.append('<line id="cross" class="cross" y1="%d" y2="%d" x1="-10" x2="-10"/>' % (T, H - B))
    svg.append(f'<rect x="{L}" y="{T}" width="{W - L - R}" height="{H - T - B}" fill="transparent" id="hit"/>')
    svg.append("</svg>")
    data = [{"x": X((c["time"] - start).total_seconds() / 3600), "u": c["update"], "t": c["time"].strftime("%a %H:%M"),
             "rm": c["rm"], "m": c["margin"], "avg": c["avg"]} for c in pts]

    # ---- Page -----------------------------------------------------------------------------
    def tile(label, value, note):
        return f'<div class="tile"><div class="tl">{label}</div><div class="tv">{value}</div><div class="tn">{note}</div></div>'

    src = Path(start_from).parent.name if start_from else None
    origin = ORIGINS.get(src, f"run {src}'s saved model" if src else "scratch (a brand-new network)")
    rate = float(last.get("decisions_per_s") or 0)
    disk = sum(f.stat().st_size for f in d.rglob("*") if f.is_file()) / 1e9
    tiles = "".join([
        tile("Score now", money(current) if current is not None else "â€“",
             "Average of the last 3 checks. " + explain(current)),
        tile("Best so far", money(best["avg"]) if best else "â€“",
             (f"At update {best['update']}, {best['time']:%a %H:%M}. Saved as best.pt." if best else "Needs 3 checks.")),
        tile("Running for", hours((now if alive and not stop else datetime.strptime(last['time'], '%Y-%m-%d %H:%M:%S') if last else now) - start),
             f"Started {start:%a %d %b %H:%M}, from {origin}."),
        tile("Version", f"update {last.get('update', 'â€“')}", "Each update is the AI learning from about 65,000 of its own decisions."),
    ])
    rows_html = "".join(
        f"<tr><td>{c['update']}</td><td>{c['time']:%a %H:%M}</td><td>{money(c['rm'])} Â± {c['margin']:.2f}</td>"
        f"<td>{money(c['avg']) if c['avg'] is not None else 'â€“'}</td></tr>" for c in reversed(checks))
    conf_html = "".join(
        f"<li>Update {c['update']}: {money(c['rm'])} Â± {c['margin']:.2f} over {c['rounds']} rounds "
        f"({'passed: it stopped' if c['rm'] >= TARGET else 'not enough: it carried on'})</li>" for c in confirms) or "<li>None yet. One runs when the average reaches the target.</li>"

    if stop:
        stop_section = f"<p>It has stopped: {html.escape(stop)}. Its final version is latest.pt and its best is best.pt.</p><ul><li>Confirmations:<ul>{conf_html}</ul></li></ul>"
    else:
        patience = (f"if there's no new best by {(best['time'] + timedelta(hours=PATIENCE_H)):%a %d %b %H:%M} ({PATIENCE_H} h after the current best)"
                    if best else f"{PATIENCE_H} h without a new best (starts counting after 3 checks)")
        stop_section = (f"<ul><li><b>Target:</b> when the average reaches {money(TARGET)}, a bigger 1,000-deal check confirms it first. "
                        f"Confirmations so far:<ul>{conf_html}</ul></li>"
                        f"<li><b>Stopped improving:</b> {patience}.</li>"
                        f"<li><b>Time limit:</b> {(start + timedelta(hours=MAX_H)):%a %d %b %H:%M} (7 days after the start), whatever happens.</li>"
                        f"<li>Pause or stop it yourself: create a file named <b>PAUSE</b> or <b>STOP</b> in the training folder (delete PAUSE to carry on).</li></ul>")

    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Mahjong AI training: {html.escape(run)}</title>
<style>
.viz-root {{ color-scheme: light; --surface-1:#fcfcfb; --surface-2:#f3f2ee; --line:#d9d7cf; --text-primary:#0b0b0b;
  --text-secondary:#52514e; --muted:#8a8880; --series-1:#2a78d6; --good:#1a7f37; --warn:#b35c00; }}
@media (prefers-color-scheme: dark) {{ :root:where(:not([data-theme="light"])) .viz-root {{ color-scheme: dark;
  --surface-1:#1a1a19; --surface-2:#232321; --line:#3a3936; --text-primary:#f0efec; --text-secondary:#c3c2b7; --muted:#8f8d85;
  --series-1:#3987e5; --good:#4cb86a; --warn:#e29a4a; }} }}
body {{ margin:0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }}
.viz-root {{ background:var(--surface-1); color:var(--text-primary); min-height:100vh; padding:20px; box-sizing:border-box; }}
main {{ max-width:900px; margin:0 auto; }}
h1 {{ font-family: Georgia, serif; font-size:1.5rem; margin:0 0 4px; }} h2 {{ font-family: Georgia, serif; font-size:1.1rem; margin:24px 0 8px; }}
.sub {{ color:var(--text-secondary); margin:0 0 16px; font-size:.9rem; }}
.status {{ border:1px solid var(--line); border-left:4px solid var(--muted); padding:10px 12px; border-radius:6px; margin-bottom:16px; }}
.status.good {{ border-left-color:var(--good); }} .status.warn {{ border-left-color:var(--warn); }}
.status b {{ margin-right:6px; }}
.tiles {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:10px; }}
.tile {{ border:1px solid var(--line); border-radius:8px; padding:10px 12px; background:var(--surface-2); }}
.tl {{ color:var(--text-secondary); font-size:.8rem; }} .tv {{ font-size:1.5rem; font-weight:650; margin:2px 0; font-variant-numeric:tabular-nums; }}
.tn {{ color:var(--text-secondary); font-size:.82rem; }}
.chart-wrap {{ position:relative; }} .chart {{ width:100%; height:auto; display:block; }}
.grid {{ stroke:var(--line); stroke-width:1; }} .tick {{ fill:var(--text-secondary); font-size:11px; }}
.ref {{ stroke:var(--muted); stroke-width:1.5; }} .dash {{ stroke-dasharray:5 4; }}
.lab {{ fill:var(--text-secondary); font-size:12px; }} .val {{ fill:var(--text-primary); font-size:12px; font-weight:600; }}
.dot {{ fill:var(--muted); opacity:.55; }} .avg {{ fill:none; stroke:var(--series-1); stroke-width:2; stroke-linejoin:round; }}
.avg-end {{ fill:var(--series-1); stroke:var(--surface-1); stroke-width:2; }} .cross {{ stroke:var(--text-secondary); stroke-width:1; }}
.legend {{ display:flex; gap:16px; font-size:.85rem; color:var(--text-secondary); margin:4px 0 6px; flex-wrap:wrap; }}
.sw {{ display:inline-block; width:18px; height:2px; vertical-align:middle; margin-right:6px; }} .sw.dotsw {{ width:8px; height:8px; border-radius:50%; }}
#tip {{ position:absolute; pointer-events:none; background:var(--surface-1); border:1px solid var(--line); border-radius:6px; padding:6px 8px;
  font-size:.8rem; display:none; white-space:nowrap; font-variant-numeric:tabular-nums; }}
table {{ border-collapse:collapse; width:100%; font-size:.85rem; font-variant-numeric:tabular-nums; }} td,th {{ border-bottom:1px solid var(--line); padding:4px 6px; text-align:left; }}
dl {{ font-size:.9rem; }} dt {{ font-weight:600; margin-top:8px; }} dd {{ margin:2px 0 0 0; color:var(--text-secondary); }}
ul {{ font-size:.9rem; }} .foot {{ color:var(--muted); font-size:.8rem; margin-top:24px; }}
</style></head><body><div class="viz-root"><main>
<h1>Mahjong AI training</h1>
<p class="sub">Run â€œ{html.escape(run)}â€. Refreshed {now:%a %d %b, %H:%M}. Double-click <b>Update progress.bat</b> in the training folder to refresh.</p>
<div class="status {cls}"><b aria-hidden="true">{icon}</b>{html.escape(status)}</div>
<div class="tiles">{tiles}</div>

<h2 id="chart-title">Score against two normal bots, over time</h2>
<div class="legend"><span><span class="sw" style="background:var(--series-1)"></span>Average of the last 3 checks (what the stop rule watches)</span>
<span><span class="sw dotsw" style="background:var(--muted)"></span>Each check (300 deals; about Â±0.35 each, so they jump around)</span></div>
<div class="chart-wrap">{''.join(svg)}<div id="tip" role="status"></div></div>
<details><summary>Every check as a table</summary><table><thead><tr><th>Update</th><th>When</th><th>Check</th><th>Average of last 3</th></tr></thead><tbody>{rows_html}</tbody></table></details>

<h2>When does it stop?</h2>
{stop_section}

<h2>How BEAST is doing</h2>
<ul>
<li>Speed: {rate:,.0f} decisions a second (roughly {rate / 45:,.0f} rounds a second).</li>
<li>GPU: {last.get('gpu_c', 'â€“')} Â°C, {float(last.get('gpu_w') or 0):.0f} W.</li>
<li>Disk used by this run: {disk:.2f} GB.</li>
<li>Exploring: {last.get('entropy', 'â€“')} (how much it still tries different moves; around 0.6 is healthy, near 0 means it has stopped trying new things).</li>
</ul>

<h2>What the numbers mean</h2>
<dl>
<dt>Score (RM per round)</dt><dd>Money the AI wins per round, on average, at a table with two normal bots, at RM0.20 per fan. +0.30 means about RM30 ahead per 100 rounds. 0 means exactly as good as a normal bot. For scale: the normal bot beats the easy bot by about +0.32.</dd>
<dt>Fair checks</dt><dd>Every deal is played 3 times, with the AI in each seat, so lucky tiles and the dealer's advantage cancel out. Each check uses fresh deals.</dd>
<dt>Why the dots jump around</dt><dd>A 300-deal check is only accurate to about Â±0.35, so single checks are noisy. The blue line (average of 3) is the one to watch.</dd>
<dt>Update</dt><dd>One round of learning. Each update, the AI looks back at about 65,000 of its own recent decisions and adjusts.</dd>
</dl>
<p class="foot">Reads only training/runs/{html.escape(run)}/log.csv and console.log; it doesn't touch the running training.</p>
</main></div>
<script>
const pts = {json.dumps(data)};
const hit = document.getElementById('hit'), tip = document.getElementById('tip'), cross = document.getElementById('cross');
const svg = hit.ownerSVGElement;
function fmt(v) {{ return (v >= 0 ? '+RM' : '-RM') + Math.abs(v).toFixed(2); }}
hit.addEventListener('mousemove', (e) => {{
  if (!pts.length) return;
  const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
  const x = p.matrixTransform(svg.getScreenCTM().inverse()).x;
  let best = pts[0]; for (const q of pts) if (Math.abs(q.x - x) < Math.abs(best.x - x)) best = q;
  cross.setAttribute('x1', best.x); cross.setAttribute('x2', best.x);
  tip.style.display = 'block';
  tip.innerHTML = `Update ${{best.u}} Â· ${{best.t}}<br>Check: ${{fmt(best.rm)}} Â± ${{best.m.toFixed(2)}}` +
    (best.avg === null ? '' : `<br><b>Average of 3: ${{fmt(best.avg)}}</b>`);
  const r = svg.getBoundingClientRect(), w = svg.parentElement.getBoundingClientRect();
  const px = r.left - w.left + best.x / {W} * r.width;
  tip.style.left = Math.min(px + 12, w.width - 190) + 'px'; tip.style.top = '30px';
}});
hit.addEventListener('mouseleave', () => {{ tip.style.display = 'none'; cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); }});
</script></body></html>"""
    out = d / "progress.html"
    out.write_text(page, encoding="utf-8")
    return out


# ---------------------------------------------------------------------------------------------------
# Comparison page: v1 and v2 on one chart, against total training time.

# v1 is a chain: each run started from the one before, so their times add up. (The long run actually
# started from the trial's best point, about 0.4 h in, so v1's later times are slightly generous.)
LINES = [
    {"name": "v3", "runs": ["v3"], "cls": "s3",
     "about": "v3: also reads the opponents (danger per tile, early and recent discards, tiles they let go); started from v2n's final version"},
    {"name": "v2", "runs": ["v2trial", "v2", "v2k", "v2n", "v2w"], "cls": "s1",
     "about": "v2: also sees the analyzer's hand-reading (hints); started from zero; v2k = from 02:47 with kong money; v2n = overnight from 03:45; v2w = coach sees the whole wall"},
    {"name": "v1", "runs": ["pilot", "pilot2", "main"], "cls": "s2",
     "about": "v1: raw tiles only; pilot, then the 1-hour trial, then the long run"},
]


def run_points(run: str):
    """(hours since the run's start, check, average of last 3, update) for each regular check."""
    d = HERE / "runs" / run
    if not (d / "log.csv").exists():
        return None
    _, rows, checks, _, stop, _ = read_run(run)
    if not rows:
        return None
    start = datetime.strptime(rows[0]["time"], "%Y-%m-%d %H:%M:%S")
    end = datetime.strptime(rows[-1]["time"], "%Y-%m-%d %H:%M:%S")
    for i, c in enumerate(checks):
        c["avg"] = sum(x["rm"] for x in checks[i - 2:i + 1]) / 3 if i >= 2 else None
    pts = [{"h": (c["time"] - start).total_seconds() / 3600, "rm": c["rm"], "avg": c["avg"], "u": c["update"]}
           for c in checks if c["time"]]
    return {"run": run, "pts": pts, "hours": (end - start).total_seconds() / 3600, "alive": running(d), "stop": stop,
            "start": start, "updates": int(rows[-1]["update"])}


def build_compare() -> Path:
    now = datetime.now()
    series = []
    for line in LINES:
        pts, segs, offset = [], [], 0.0
        for run in line["runs"]:
            r = run_points(run)
            if not r:
                continue
            for p in r["pts"]:
                pts.append({**p, "h": p["h"] + offset, "run": run})
            segs.append({**r, "offset": offset})
            offset += r["hours"]
        # Each run continues from the one before, so the average of the last 3 checks carries straight
        # across hand-overs (it used to restart, leaving a gap after every hand-over).
        for i, p in enumerate(pts):
            p["avg"] = sum(q["rm"] for q in pts[i - 2:i + 1]) / 3 if i >= 2 else None
        series.append({**line, "pts": pts, "segs": segs, "total": offset})
    paired_path = HERE / "runs" / "paired.json"
    paired = json.loads(paired_path.read_text(encoding="utf-8-sig")) if paired_path.exists() else []

    W, H, L, R, T, B = 760, 340, 56, 110, 20, 44
    allp = [p for s in series for p in s["pts"]]
    xmax = max([s["total"] for s in series] + [1.0])
    vals = [p["rm"] for p in allp] + [0, TARGET]
    ymin, ymax = min(-0.5, min(vals) - 0.05), max(0.75, max(vals) + 0.05)
    X = lambda h: L + (W - L - R) * h / xmax
    Y = lambda v: T + (H - T - B) * (ymax - v) / (ymax - ymin)
    svg = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-labelledby="cmp-title" class="chart">']
    v = -2.0
    while v <= ymax:
        if v >= ymin:
            svg.append(f'<line x1="{L}" x2="{W - R}" y1="{Y(v):.1f}" y2="{Y(v):.1f}" class="grid"/>'
                       f'<text x="{L - 8}" y="{Y(v) + 4:.1f}" class="tick" text-anchor="end">{v:+.2f}</text>')
        v += 0.25
    hstep = 0.5 if xmax <= 4 else 1 if xmax <= 8 else 2
    h = 0.0
    while h <= xmax + 1e-9:
        svg.append(f'<text x="{X(h):.1f}" y="{H - B + 18}" class="tick" text-anchor="middle">{h:g} h</text>')
        h += hstep
    svg.append(f'<text x="{(L + W - R) / 2}" y="{H - 6}" class="tick" text-anchor="middle">total hours of training</text>')
    svg.append(f'<line x1="{L}" x2="{W - R}" y1="{Y(0):.1f}" y2="{Y(0):.1f}" class="ref"/>'
               f'<text x="{W - R + 6}" y="{Y(0) + 4:.1f}" class="lab">normal bot level</text>')
    svg.append(f'<line x1="{L}" x2="{W - R}" y1="{Y(TARGET):.1f}" y2="{Y(TARGET):.1f}" class="ref dash"/>'
               f'<text x="{W - R + 6}" y="{Y(TARGET) + 4:.1f}" class="lab">target {TARGET:+.2f}</text>')
    for s in series:
        for seg in s["segs"][1:]:  # where one run hands over to the next
            x = X(seg["offset"])
            svg.append(f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{T}" y2="{H - B}" class="handover {s["cls"]}"/>')
        for p in s["pts"]:
            svg.append(f'<circle cx="{X(p["h"]):.1f}" cy="{Y(p["rm"]):.1f}" r="3" class="dot {s["cls"]}"/>')
        line = [p for p in s["pts"] if p["avg"] is not None]
        # One continuous line per version; the dotted upright lines mark the hand-overs.
        path, prev = [], None
        for p in line:
            path.append(f'{"M" if prev is None else "L"}{X(p["h"]):.1f},{Y(p["avg"]):.1f}')
            prev = p["run"]
        if path:
            svg.append(f'<path d="{" ".join(path)}" class="line {s["cls"]}"/>')
            e = line[-1]
            ly = Y(e["avg"]) - 8
            # Keep the end label clear of the reference-line labels on the right.
            for ref in (Y(0), Y(TARGET)):
                if abs(ly - ref) < 14:
                    ly = ref + 18 if ly >= ref else ref - 14
            svg.append(f'<circle cx="{X(e["h"]):.1f}" cy="{Y(e["avg"]):.1f}" r="5" class="end {s["cls"]}"/>'
                       f'<text x="{X(e["h"]) - 8:.1f}" y="{ly:.1f}" class="val" text-anchor="end">{s["name"]} {e["avg"]:+.2f}</text>')
    svg.append(f'<line id="cross" class="cross" y1="{T}" y2="{H - B}" x1="-10" x2="-10"/>')
    svg.append(f'<rect x="{L}" y="{T}" width="{W - L - R}" height="{H - T - B}" fill="transparent" id="hit"/></svg>')
    data = [{"x": X(p["h"]), "s": s["name"], "run": p["run"], "h": round(p["h"], 2), "rm": p["rm"], "avg": p["avg"], "u": p["u"]}
            for s in series for p in s["pts"]]

    # The same moment for both: the score each had reached at v2's current training time.
    def at(s, hrs):
        line = [p for p in s["pts"] if p["avg"] is not None and p["h"] <= hrs]
        return line[-1]["avg"] if line else None
    v2 = next(s for s in series if s["name"] == "v2")
    v1 = next(s for s in series if s["name"] == "v1")
    same = ""
    if v2["pts"]:
        hrs = v2["total"]
        a, b = at(v2, hrs), at(v1, hrs)
        if a is not None and b is not None:
            lead = a - b
            same = (f"After {hours(timedelta(hours=hrs))} of training: v2 {money(a)}, v1 {money(b)} at the same point. "
                    + ("v2 is ahead" if lead > 0.15 else "v1 is ahead" if lead < -0.15 else "about level") + " (averages of 3 checks, each Â±0.2).")
    runs_rows = "".join(
        f"<tr><td><span class='key {s['cls']}'></span>{s['name']}</td><td>{seg['run']}</td>"
        f"<td>{seg['start']:%a %H:%M}</td><td>{hours(timedelta(hours=seg['hours']))}</td><td>{seg['updates']:,}</td>"
        f"<td>{'running' if seg['alive'] else html.escape(seg['stop'] or 'stopped')}</td>"
        f"<td>{money(sum(p['rm'] for p in seg['pts'][-6:]) / len(seg['pts'][-6:])) if seg['pts'] else 'â€“'}</td></tr>"
        for s in series for seg in s["segs"])
    paired_rows = "".join(
        f"<tr><td>{html.escape(p['version'])}</td><td>{html.escape(p['label'])}</td><td><b>{money(p['rm'])}</b> Â± {p['margin']:.2f}</td>"
        f"<td>{p['deals']:,} deals (seed {p['seed']})</td><td>{html.escape(p['date'])}</td></tr>" for p in paired)

    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Mahjong AI: v1 vs v2</title>
<style>
.viz-root {{ color-scheme: light; --surface-1:#fcfcfb; --surface-2:#f3f2ee; --line:#d9d7cf; --text-primary:#0b0b0b;
  --text-secondary:#52514e; --muted:#8a8880; --series-1:#2a78d6; --series-2:#eb6834; --series-3:#1baf7a; }}
@media (prefers-color-scheme: dark) {{ :root:where(:not([data-theme="light"])) .viz-root {{ color-scheme: dark;
  --surface-1:#1a1a19; --surface-2:#232321; --line:#3a3936; --text-primary:#f0efec; --text-secondary:#c3c2b7; --muted:#8f8d85;
  --series-1:#3987e5; --series-2:#d95926; --series-3:#199e70; }} }}
body {{ margin:0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }}
.viz-root {{ background:var(--surface-1); color:var(--text-primary); min-height:100vh; padding:20px; box-sizing:border-box; }}
main {{ max-width:900px; margin:0 auto; }} h1 {{ font-family: Georgia, serif; font-size:1.5rem; margin:0 0 4px; }}
h2 {{ font-family: Georgia, serif; font-size:1.1rem; margin:24px 0 8px; }} .sub {{ color:var(--text-secondary); font-size:.9rem; margin:0 0 14px; }}
.lead {{ border:1px solid var(--line); border-radius:6px; padding:10px 12px; }}
.chart-wrap {{ position:relative; }} .chart {{ width:100%; height:auto; display:block; }}
.grid {{ stroke:var(--line); }} .tick {{ fill:var(--text-secondary); font-size:11px; }} .ref {{ stroke:var(--muted); stroke-width:1.5; }}
.dash {{ stroke-dasharray:5 4; }} .lab {{ fill:var(--text-secondary); font-size:12px; }} .val {{ fill:var(--text-primary); font-size:12px; font-weight:600; }}
.line {{ fill:none; stroke-width:2; stroke-linejoin:round; }} .line.s1 {{ stroke:var(--series-1); }} .line.s2 {{ stroke:var(--series-2); }} .line.s3 {{ stroke:var(--series-3); }}
.dot {{ opacity:.35; }} .dot.s1, .end.s1 {{ fill:var(--series-1); }} .dot.s2, .end.s2 {{ fill:var(--series-2); }} .dot.s3, .end.s3 {{ fill:var(--series-3); }} .end {{ stroke:var(--surface-1); stroke-width:2; }}
.handover {{ stroke-dasharray:2 4; stroke-width:1; opacity:.6; }} .handover.s1 {{ stroke:var(--series-1); }} .handover.s2 {{ stroke:var(--series-2); }} .handover.s3 {{ stroke:var(--series-3); }}
.cross {{ stroke:var(--text-secondary); }}
.legend {{ display:flex; gap:18px; font-size:.85rem; color:var(--text-secondary); flex-wrap:wrap; margin:4px 0 6px; }}
.key {{ display:inline-block; width:18px; height:3px; vertical-align:middle; margin-right:6px; }} .key.s1 {{ background:var(--series-1); }} .key.s2 {{ background:var(--series-2); }} .key.s3 {{ background:var(--series-3); }}
#tip {{ position:absolute; pointer-events:none; background:var(--surface-1); border:1px solid var(--line); border-radius:6px; padding:6px 8px; font-size:.8rem; display:none; white-space:nowrap; }}
table {{ border-collapse:collapse; width:100%; font-size:.85rem; font-variant-numeric:tabular-nums; }} td,th {{ border-bottom:1px solid var(--line); padding:5px 6px; text-align:left; vertical-align:top; }}
ul, dl {{ font-size:.9rem; }} .foot {{ color:var(--muted); font-size:.8rem; margin-top:24px; }}
</style></head><body><div class="viz-root"><main>
<h1>Mahjong AI: v1 vs v2</h1>
<p class="sub">Refreshed {now:%a %d %b, %H:%M}. Double-click <b>Update progress.bat</b> to refresh. Each run's own page: {" Â· ".join(f'<a href="{seg["run"]}/progress.html">{seg["run"]}</a>' for s in series for seg in s["segs"])}</p>
<p class="lead">{html.escape(same) or "v2 needs a few checks before it can be compared."}</p>

<h2 id="cmp-title">Score against two normal bots, by total training time</h2>
<div class="legend">{"".join(f'<span><span class="key {s["cls"]}"></span>{html.escape(s["about"])}</span>' for s in series)}</div>
<div class="chart-wrap">{''.join(svg)}<div id="tip" role="status"></div></div>
<p class="sub">Lines: average of the last 3 checks. Faint dots: single checks (Â±0.35 each). Dotted upright lines: one run handing over to the next.
v1's early checks are less precise (the pilot used 150 deals, and the 1-hour trial reused the same deals each time, which flattered it a little).</p>

<h2>The fair verdict: paired benchmarks</h2>
<p class="sub">The chart's checks are quick and noisy. These use the same 1,000 deals (3,000 rounds) for every version, so luck cancels out.
They're the numbers to decide on. New rows are added every 6 hours or so while a run trains.</p>
<table><thead><tr><th>Version</th><th>What was measured</th><th>Score vs normal bots</th><th>Deals</th><th>When</th></tr></thead><tbody>{paired_rows}</tbody></table>

<h2>The runs</h2>
<table><thead><tr><th></th><th>Run</th><th>Started</th><th>Trained for</th><th>Updates</th><th>Status</th><th>Last 6 checks</th></tr></thead><tbody>{runs_rows}</tbody></table>

<h2>What's different in v2</h2>
<ul>
<li><b>Hints:</b> for each possible discard it is told how close to ready that leaves it and how many live tiles would help; for each claim, how close to ready it would be. v1 had to work this out from raw tiles.</li>
<li><b>Steadier learning:</b> it learns from 262,000 decisions per update instead of 65,000, in smaller steps, so luck in single rounds misleads it less.</li>
<li><b>Different opponents:</b> about 6% of its games are against easy bots, as well as itself and its older versions.</li>
<li><b>Faster setup:</b> the game processes no longer wait for each other.</li>
</ul>
<p class="foot">Built from training/runs/*/log.csv, console.log and runs/paired.json. Reading these never disturbs a running training.</p>
</main></div>
<script>
const pts = {json.dumps(data)};
const hit = document.getElementById('hit'), tip = document.getElementById('tip'), cross = document.getElementById('cross');
const svg = hit.ownerSVGElement;
const fmt = (v) => (v >= 0 ? '+RM' : '-RM') + Math.abs(v).toFixed(2);
hit.addEventListener('mousemove', (e) => {{
  if (!pts.length) return;
  const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
  const x = p.matrixTransform(svg.getScreenCTM().inverse()).x;
  let best = pts[0]; for (const q of pts) if (Math.abs(q.x - x) < Math.abs(best.x - x)) best = q;
  const near = pts.filter((q) => Math.abs(q.x - best.x) < 6);
  cross.setAttribute('x1', best.x); cross.setAttribute('x2', best.x);
  tip.style.display = 'block';
  tip.innerHTML = `${{best.h}} h of training<br>` + near.map((q) => `<b>${{q.s}}</b> (${{q.run}}, update ${{q.u}}): check ${{fmt(q.rm)}}` +
    (q.avg === null ? '' : `, average ${{fmt(q.avg)}}`)).join('<br>');
  const r = svg.getBoundingClientRect(), w = svg.parentElement.getBoundingClientRect();
  tip.style.left = Math.min(r.left - w.left + best.x / {W} * r.width + 12, w.width - 330) + 'px'; tip.style.top = '30px';
}});
hit.addEventListener('mouseleave', () => {{ tip.style.display = 'none'; cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); }});
</script></body></html>"""
    out = HERE / "runs" / "compare.html"
    out.write_text(page, encoding="utf-8")
    return out


def latest_run() -> str:
    """The run whose log changed most recently (the one running now, or the last one)."""
    logs = sorted((HERE / "runs").glob("*/log.csv"), key=lambda p: p.stat().st_mtime)
    return logs[-1].parent.name if logs else "main"


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "all":
        for d in sorted((HERE / "runs").glob("*/log.csv")):
            build(d.parent.name)
        print(build_compare())
    else:
        print(build(sys.argv[1] if len(sys.argv) > 1 else latest_run()))
