#!/usr/bin/env python3
"""The Pi's side of the tamper guard (node/firmware/life-guard). Reads the guard's lines, sends the disarm pulse,
and decides, from the oracle's answer or a cached maintenance window, whether it may.

    life-guard status [--json]     what the guard reports: alarm, which loop, Pi power line
    life-guard check               alarm boot: if the guard is in alarm, heartbeat now (event "alarm", the loop, the
                                   cell) and disarm if the answer or the cache holds an active window. Runs early at
                                   every boot (life-guard.service); nothing to do when the guard is quiet.
    life-guard apply < response    fed by life-push with the oracle's heartbeat answer: caches the window, disarms
                                   when it is active now
    life-guard disarm [--hours 4|24]   the pulse itself; for the bench

The disarm pulse is the only thing that silences the guard, and this program only sends it with a window in hand.
A window is the steward's, set on the oracle (PUT /places/{id}/devices/{deviceId}/maintenance); it is never made
here. GPIO through `pinctrl` (raspi-utils) so no library is needed on the read-only root.

Environment: GUARD=1 enables it (the guard board is optional). GUARD_PIN_ALARM/LOOP_A/LOOP_B/DISARM override the
BCM numbers 10, 11, 9, 26. LIFE_STATE (default /var/lib/life-node) holds maintenance.json.
"""
import json, os, subprocess, sys, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ENABLED = os.environ.get("GUARD", "0") == "1"
PIN = {k: int(os.environ.get(f"GUARD_PIN_{k}", d)) for k, d in (("ALARM", 10), ("LOOP_A", 11), ("LOOP_B", 9), ("DISARM", 26))}
STATE = Path(os.environ.get("LIFE_STATE", "/var/lib/life-node"))
CACHE = STATE / "maintenance.json"
API = os.environ.get("LIFE_API", "https://life.oncra.org/api/v1").rstrip("/")
TOKEN = os.environ.get("LIFE_DEVICE_TOKEN")
LOOPS = {0: "none", 1: "lid", 2: "panel", 3: "tilt"}


def pin_read(n):
    subprocess.run(["pinctrl", "set", str(n), "ip", "pn"], check=False, capture_output=True)
    out = subprocess.run(["pinctrl", "get", str(n)], capture_output=True, text=True, check=True).stdout
    return "| hi" in out


def pulse(seconds):
    subprocess.run(["pinctrl", "set", str(PIN["DISARM"]), "op", "dh"], check=True)
    time.sleep(seconds)
    subprocess.run(["pinctrl", "set", str(PIN["DISARM"]), "dl"], check=True)


def status():
    if not ENABLED:
        return {"enabled": False}
    a, la, lb = pin_read(PIN["ALARM"]), pin_read(PIN["LOOP_A"]), pin_read(PIN["LOOP_B"])
    return {"enabled": True, "alarm": a, "loop": LOOPS[(1 if la else 0) | (2 if lb else 0)]}


def now():
    return datetime.now(timezone.utc)


def parse(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00")) if ts else None


def cache_window(m):
    """m is the oracle's maintenance object or None."""
    if m and parse(m["until"]) > now():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(m))
    elif CACHE.exists():
        CACHE.unlink()


def active_window():
    if not CACHE.exists():
        return None
    try:
        m = json.loads(CACHE.read_text())
    except ValueError:
        return None
    frm, until = parse(m.get("from")), parse(m.get("until"))
    if until is None or until <= now() or (frm and frm > now()):
        return None
    return m


def disarm_for(m):
    """Short pulse = 4 h bypass, long = 24 h. Pick by how much window is left."""
    left_h = (parse(m["until"]) - now()).total_seconds() / 3600
    pulse(2.5 if left_h > 4 else 0.3)
    print(f"disarmed for {'24' if left_h > 4 else '4'} h (window until {m['until']})")


def apply(resp):
    """The oracle's answer to a heartbeat: {..., maintenance: {from, until, active} | null}."""
    m = resp.get("maintenance") if isinstance(resp, dict) else None
    cache_window(m)
    if not ENABLED:
        return
    w = active_window()
    if w:
        disarm_for(w)


def check():
    if not ENABLED:
        return
    s = status()
    if not s["alarm"]:
        w = active_window()
        if w:
            disarm_for(w)  # arrived inside a window set earlier: green before the lid opens
        return
    hb = {"ts": now().isoformat(), "event": "alarm", "tamper": {"loop": s["loop"]}, "metrics": {"uptimeS": int(float(Path("/proc/uptime").read_text().split()[0]))}}
    try:
        cell = json.loads(subprocess.run(["life-heartbeat", "--json", "--cell-only"], capture_output=True, text=True, timeout=20, check=True).stdout)
        if cell:
            hb["cell"] = cell
    except Exception as e:  # noqa: BLE001 - the report goes out with or without the cell
        print(f"cell: {e}", file=sys.stderr)
    resp = None
    if TOKEN:
        try:
            req = urllib.request.Request(f"{API}/ingest/heartbeat", data=json.dumps({"heartbeat": hb}).encode(), headers={"content-type": "application/json", "authorization": f"Bearer {TOKEN}"}, method="POST")
            with urllib.request.urlopen(req, timeout=40) as r:
                resp = json.load(r)
            print(f"alarm reported: loop {s['loop']}, oracle {resp}")
        except Exception as e:  # noqa: BLE001 - offline: the cached window decides
            print(f"alarm report failed: {e}", file=sys.stderr)
    if resp is not None:
        apply(resp)
    else:
        w = active_window()
        if w:
            disarm_for(w)
        else:
            print("no window: the guard stays in alarm")


def main():
    a = sys.argv[1:]
    cmd = a[0] if a else "status"
    if cmd == "status":
        print(json.dumps(status()))
    elif cmd == "check":
        check()
    elif cmd == "apply":
        apply(json.load(sys.stdin))
    elif cmd == "disarm":
        hours = int(a[a.index("--hours") + 1]) if "--hours" in a else 4
        pulse(2.5 if hours >= 24 else 0.3)
        print(f"pulse sent, {24 if hours >= 24 else 4} h")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
