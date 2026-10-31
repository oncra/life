#!/usr/bin/env python3
"""The Pi's side of the tamper guard (node/firmware/life-guard). Reads the guard's lines, sends the disarm pulse,
and decides, from the oracle's answer or a cached maintenance window, whether it may.

    life-guard status [--json]     what the guard reports: alarm, which loop, Pi power line
    life-guard check               alarm boot: if the guard is in alarm, heartbeat now (event "alarm", the loop, the
                                   cell) and disarm if the answer or the cache holds an active window. Runs early at
                                   every boot (life-guard.service); nothing to do when the guard is quiet.
    life-guard apply < response    fed by life-push with the oracle's heartbeat answer: caches the window, disarms
                                   when it is active now
    life-guard watch               while the Pi is up (life-guard-watch.service): a contact opened now gets the same
                                   check as at an alarm boot, at once, not at the next push hours later
    life-guard disarm [--hours 4|24]   the pulse itself; for the bench
    life-guard rearm               two pulses within a second: armed again at once, or as soon as every contact is
                                   closed; for the bench, between tests (a field node re-arms when its bypass ends)

The disarm pulse is the only thing that silences the guard, and this program only sends it with a window in hand.
A window is the steward's, set on the oracle (PUT /places/{id}/devices/{deviceId}/maintenance); it is never made
here. GPIO through `pinctrl` (raspi-utils) so no library is needed on the read-only root.

Environment: GUARD=1 enables it (the guard board is optional). GUARD_PIN_ALARM/LOOP_A/LOOP_B/DISARM override the
BCM numbers 10, 11, 9, 26. LIFE_STATE (default /var/lib/life-node) holds maintenance.json. GUARD_LOCK (default
/run/life-guard.lock) keeps the pulses of the boot check, the push and the watcher apart.
"""
import fcntl, json, os, subprocess, sys, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ENABLED = os.environ.get("GUARD", "0") == "1"
PIN = {k: int(os.environ.get(f"GUARD_PIN_{k}", d)) for k, d in (("ALARM", 10), ("LOOP_A", 11), ("LOOP_B", 9), ("DISARM", 26))}
STATE = Path(os.environ.get("LIFE_STATE", "/var/lib/life-node"))
CACHE = STATE / "maintenance.json"
API = os.environ.get("LIFE_API", "https://life.oncra.org/api/v1").rstrip("/")
TOKEN = os.environ.get("LIFE_DEVICE_TOKEN")
LOOPS = {0: "none", 1: "lid", 2: "panel", 3: "tilt"}
LOCK = Path(os.environ.get("GUARD_LOCK", "/run/life-guard.lock"))
GAP_S = 1.5          # the guard reads two pulses less than a second apart as "arm again"
WATCH_EVERY_S = 2.0  # how often the watcher reads the ALARM line
RECHECK_S = 300      # while an alarm stands with the Pi up, ask the oracle again this often...
RECHECK_FOR_S = 1800  # ...for this long; after that the push carries it (each check is a post over 4G)


def pin_read(n):
    subprocess.run(["pinctrl", "set", str(n), "ip", "pn"], check=False, capture_output=True)
    out = subprocess.run(["pinctrl", "get", str(n)], capture_output=True, text=True, check=True).stdout
    return "| hi" in out


def pulse(seconds, times=1):
    """One pulse at a time, and never two within GAP_S of each other: the boot check, the push and the watcher can
    each want to send one, and two in quick succession would re-arm the guard instead of silencing it. times=2 is
    that double on purpose (rearm)."""
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    with open(LOCK, "a+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.seek(0)
        try:
            last = float(f.read().strip() or 0)
        except ValueError:
            last = 0.0
        wait = min(GAP_S, last + GAP_S - time.monotonic())  # monotonic: an NTP step must not hold a disarm back
        if wait > 0:
            time.sleep(wait)
        for i in range(times):
            if i:
                time.sleep(0.3)
            subprocess.run(["pinctrl", "set", str(PIN["DISARM"]), "op", "dh"], check=True)
            time.sleep(seconds)
            subprocess.run(["pinctrl", "set", str(PIN["DISARM"]), "dl"], check=True)
        f.seek(0)
        f.truncate()
        f.write(str(time.monotonic()))  # /run is cleared at boot, and monotonic time is one clock for every process


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


def watch(every=None, recheck=None, recheck_for=None, rounds=None):
    """The alarm boot (check) only happens when the guard woke the Pi. With the Pi already up, in a listening window,
    the guard cannot boot it, and the alarm would wait for the next push, hours away, while the siren sounds at
    a steward who did set a window. So read the ALARM line while the Pi is up and run the same check the moment it
    rises; while it stands, again every RECHECK_S for RECHECK_FOR_S, so a window set after the siren started still
    silences it. rounds is for the tests."""
    if not ENABLED:
        return
    every = WATCH_EVERY_S if every is None else every
    recheck = RECHECK_S if recheck is None else recheck
    recheck_for = RECHECK_FOR_S if recheck_for is None else recheck_for
    was = pin_read(PIN["ALARM"])  # an alarm standing at start is the boot check's, already handled
    rose = last = time.monotonic()
    n = 0
    while rounds is None or n < rounds:
        n += 1
        time.sleep(every)
        alarm = pin_read(PIN["ALARM"])
        t = time.monotonic()
        if alarm and not was:
            rose = last = t
            check()
        elif alarm and t - last >= recheck and t - rose <= recheck_for:
            last = t
            check()
        was = alarm


def main():
    a = sys.argv[1:]
    cmd = a[0] if a else "status"
    if cmd == "status":
        print(json.dumps(status()))
    elif cmd == "check":
        check()
    elif cmd == "apply":
        apply(json.load(sys.stdin))
    elif cmd == "watch":
        watch()
    elif cmd == "disarm":
        hours = int(a[a.index("--hours") + 1]) if "--hours" in a else 4
        pulse(2.5 if hours >= 24 else 0.3)
        print(f"pulse sent, {24 if hours >= 24 else 4} h")
    elif cmd == "rearm":
        pulse(0.3, times=2)
        print("double pulse sent: armed, or waiting for every contact to close")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
