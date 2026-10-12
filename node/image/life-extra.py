#!/usr/bin/env python3
"""Extra listening hours only when the battery can carry them (content/spec.md, section 2.2).

Every window the Witty Pi opens has a core and, from March to October, extra time after it: from the end of the dawn
core to 6 h after civil dawn (the dawn core is 4 h, 6 h in May, June and July), and the second hour after sunset.
The core always runs. At every boot, once life-schedule has set the clock and the schedule, `life-extra decide`
reads the battery through the Witty Pi, before the sun is on the panel at dawn or after it has gone at dusk. At
EXTRA_MIN_V or more the window runs to its end. Below it, the node shuts down at the end of the core: `life-extra stop`
clears the Witty Pi's shutdown alarm, so the board does not switch the Pi on again for it, and powers off; the next
start stays as scheduled and life-flush still sends the shutdown heartbeat on the way down.

The threshold is a resting voltage on LiFePO4, which is flat in the middle: 13.0 to 13.2 V spans roughly 30 to 70%
charge. That is good enough because it does not need to be exact. In a simulation of 2005 to 2023 any threshold
between half and 70% kept the core whole with the panel at half output all year and with it at 30% from June to
September. Calibrate it against a node's own heartbeats once a season is in.

Every decision is written to /data/life-node/extra.json and rides on the heartbeat (`window`, `extra`, `extraV`),
so the oracle knows how long a node listened. The readings never count the extra hours.

    life-extra decide [--dry-run] [--now 2026-08-15T06:00]
    life-extra stop
    life-extra status

env: SCHEDULE (only 'season' decides), EXTRA_MIN_V (default 13.1), WITTYPI_BUS (default 1),
     LIFE_EXTRA_VIN (tests: pretend the battery reads this), LIFE_STATE (default /data/life-node)
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

STATE = Path(os.environ.get("LIFE_STATE", "/data/life-node"))
DECISION = STATE / "extra.json"
WITTY = Path("/data/wittypi")
MIN_V = float(os.environ.get("EXTRA_MIN_V") or 13.1)
SCHEDULE = os.environ.get("SCHEDULE", "season").strip() or "season"


def log(msg: str) -> None:
    print(f"life-extra: {msg}", flush=True)


def windows(now_arg: str | None) -> dict:
    cmd = ["life-schedule-wpi", "--windows"] + (["--now", now_arg] if now_arg else [])
    here = Path(__file__).with_name("life-schedule-wpi.py")
    if here.exists():  # run from the repository: use the script beside this one
        cmd = [sys.executable, str(here)] + cmd[1:]
    return json.loads(subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=60).stdout)


def battery_v() -> float | None:
    if os.environ.get("LIFE_EXTRA_VIN"):
        return float(os.environ["LIFE_EXTRA_VIN"])
    bus = os.environ.get("WITTYPI_BUS", "1").strip()
    if not bus:
        return None
    try:
        reg = lambda r: int(subprocess.run(["i2cget", "-y", bus, "0x08", str(r)], capture_output=True, text=True,  # noqa: E731
                                           check=True, timeout=5).stdout.strip(), 16)
        return round(reg(1) + reg(2) / 100, 2)
    except Exception as e:  # noqa: BLE001 - no Witty Pi: no decision, the window runs as scheduled
        log(f"no battery reading ({e})")
        return None


def write(rec: dict, dry: bool) -> None:
    rec["decidedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if dry:
        print(json.dumps(rec))
        return
    STATE.mkdir(parents=True, exist_ok=True)
    tmp = DECISION.with_suffix(".tmp")
    tmp.write_text(json.dumps(rec) + "\n")
    tmp.replace(DECISION)


def decide(args: list[str]) -> None:
    dry = "--dry-run" in args
    now_arg = args[args.index("--now") + 1] if "--now" in args else None
    if SCHEDULE != "season":
        log(f"SCHEDULE={SCHEDULE}: no listening schedule, nothing to decide")
        write({"schedule": SCHEDULE, "window": None, "extra": None}, dry)
        return
    info = windows(now_arg)
    w = info["active"]
    if w is None:
        log(f"woke outside the listening windows of {info['date']}; nothing to decide")
        write({"date": info["date"], "window": None, "extra": None}, dry)
        return
    rec = {"date": info["date"], "window": w["name"], "start": w["start"], "coreEnd": w["coreEnd"], "end": w["end"], "minV": MIN_V}
    if datetime.fromisoformat(w["coreEnd"]) >= datetime.fromisoformat(w["end"]):
        log(f"{w['name']} window is all core; it runs to {w['end']}")
        write({**rec, "extra": None}, dry)
        return
    v = battery_v()
    rec["v"] = v
    if v is None:
        log(f"no battery reading: the {w['name']} window runs to its end")
        write({**rec, "extra": None}, dry)
        return
    if v >= MIN_V:
        log(f"battery {v:.2f} V >= {MIN_V:.2f} V: extra hours on, the {w['name']} window runs to {w['end']}")
        write({**rec, "extra": True}, dry)
        return
    now = datetime.fromisoformat(info["now"])
    left = (datetime.fromisoformat(w["coreEnd"]) - now).total_seconds()
    wait = int(left) if left > 300 else 300  # past the core already: stop after the boot post has gone out
    log(f"battery {v:.2f} V < {MIN_V:.2f} V: extra hours off, shutting down at the end of the core in {wait} s")
    write({**rec, "extra": False}, dry)
    if dry:
        print(f"would run: systemd-run --unit=life-extra-stop --on-active={wait}s /usr/local/sbin/life-extra stop")
        return
    subprocess.run(["systemctl", "stop", "life-extra-stop.timer"], capture_output=True)
    subprocess.run(["systemd-run", "--unit=life-extra-stop", f"--on-active={wait}s", "/usr/local/sbin/life-extra", "stop"], check=True)


def stop() -> None:
    # the scheduled shutdown would otherwise wake the Pi again when its time comes; the next startup is kept
    if (WITTY / "utilities.sh").exists():
        subprocess.run(["bash", "-c", "cd /data/wittypi && . ./utilities.sh >/dev/null 2>&1 && clear_shutdown_time"], check=False)
    log("end of the core with the extra hours off: powering off; the next start stays as scheduled")
    subprocess.run(["systemctl", "poweroff"], check=False)


def status() -> None:
    print(DECISION.read_text().strip() if DECISION.exists() else "{}")


def main() -> None:
    args = sys.argv[1:]
    cmd = args[0] if args else "status"
    if cmd == "decide":
        decide(args[1:])
    elif cmd == "stop":
        stop()
    elif cmd == "status":
        status()
    else:
        sys.exit("usage: life-extra decide [--dry-run] [--now T] | stop | status")


if __name__ == "__main__":
    main()
