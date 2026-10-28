#!/usr/bin/env python3
"""What a boot is for: a listening window, or a wake the Witty Pi made by itself outside them (content/spec.md 2.2).

The Witty Pi switches the node on for its windows; life-schedule writes them at every boot. The board can also switch
it on by itself: when the battery has recovered after the board stopped the node for low voltage (life-wittypi sets
both thresholds), or when its input comes back after the charge controller cut the load (it is set to switch the Pi
on as soon as it has power). Outside a window the board's schedule logic would then keep the node on until the end
of the next window, hours from a battery that has just been empty. `life-window check`, run at the end of
life-schedule, ends such a boot: the node posts what it has and powers off GRACE minutes after it booted, with its
next start set to the start of the next window. A boot by hand outside the windows (the button, a reboot, a USB supply) stays on,
as before: somebody is at the node.

Every boot is written to /data/life-node/window.json, and the heartbeat carries the window the node woke for
(`window`, empty outside one) and, outside one, what it did about it (`offWindow`: "stop" or "kept").

    life-window check [--dry-run] [--now 2026-08-15T13:00] [--wake voltage-restored]
    life-window stop        the timer's job: unless a window has begun, set the next start, clear the shutdown alarm
                            (a shutdown alarm that comes while the Pi is off wakes it), power off
    life-window status

env: SCHEDULE (only 'season' acts), OFFWINDOW_GRACE_MIN (default 10), WITTYPI_BUS (default 1),
     LIFE_STATE (default /data/life-node)
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

STATE = Path(os.environ.get("LIFE_STATE", "/data/life-node"))
DECISION = STATE / "window.json"
SCHEDULE = os.environ.get("SCHEDULE", "season").strip() or "season"
GRACE_S = int(float(os.environ.get("OFFWINDOW_GRACE_MIN") or 10) * 60)
# the Witty Pi's reason for its latest action (register 11), as life-heartbeat names them
WAKE = {1: "alarm", 2: "alarm", 3: "button", 4: "low-voltage", 5: "voltage-restored", 6: "over-temp", 7: "under-temp",
        8: "alarm", 9: "usb-5v", 10: "power-connected", 11: "reboot", 12: "guaranteed-wake"}
BY_HAND = {"button", "reboot", "usb-5v"}   # someone pressed, rebooted or plugged in a USB supply


def log(msg: str) -> None:
    print(f"life-window: {msg}", flush=True)


def windows(now_arg: str | None) -> dict:
    cmd = ["life-schedule-wpi", "--windows"] + (["--now", now_arg] if now_arg else [])
    here = Path(__file__).with_name("life-schedule-wpi.py")
    if here.exists():  # run from the repository: use the script beside this one
        cmd = [sys.executable, str(here)] + cmd[1:]
    return json.loads(subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=60).stdout)


def wake_reason() -> str | None:
    bus = os.environ.get("WITTYPI_BUS", "1").strip()
    if not bus:
        return None
    try:
        out = subprocess.run(["i2cget", "-y", bus, "0x08", "11"], capture_output=True, text=True, check=True, timeout=5)
        return WAKE.get(int(out.stdout.strip(), 16), "unknown")
    except Exception as e:  # noqa: BLE001 - no Witty Pi: nobody but a person can have switched it on
        log(f"no wake reason ({e})")
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


def uptime_s() -> float:
    try:
        return float(Path("/proc/uptime").read_text().split()[0])
    except Exception:  # noqa: BLE001
        return 0.0


def check(args: list[str]) -> None:
    dry = "--dry-run" in args
    now_arg = args[args.index("--now") + 1] if "--now" in args else None
    if SCHEDULE != "season":
        log(f"SCHEDULE={SCHEDULE}: no listening windows, nothing to decide")
        write({"schedule": SCHEDULE, "window": None}, dry)
        return
    info = windows(now_arg)
    w = info["active"]
    if w is not None:
        log(f"{w['name']} window, {w['start']} to {w['end']}")
        write({"date": info["date"], "window": w["name"], "start": w["start"], "end": w["end"]}, dry)
        return
    wake = args[args.index("--wake") + 1] if "--wake" in args else wake_reason()
    rec = {"date": info["date"], "window": None, "wake": wake, "next": info["next"]}
    if wake is None or wake in BY_HAND:
        log(f"woke outside the windows ({wake or 'no Witty Pi'}): started by hand, staying on")
        write({**rec, "offWindow": "kept"}, dry)
        return
    wait = max(int(GRACE_S - uptime_s()), 120)
    log(f"woke outside the windows ({wake}): posting, then off in {wait} s until the next window at {info['next']}")
    write({**rec, "offWindow": "stop", "stopInS": wait}, dry)
    if dry:
        print(f"would run: systemd-run --unit=life-window-stop --on-active={wait}s /usr/local/sbin/life-window stop")
        return
    subprocess.run(["systemctl", "stop", "life-window-stop.timer"], capture_output=True)
    subprocess.run(["systemd-run", "--unit=life-window-stop", f"--on-active={wait}s", "/usr/local/sbin/life-window", "stop"], check=True)


def stop(args: list[str]) -> None:
    dry = "--dry-run" in args
    info = windows(args[args.index("--now") + 1] if "--now" in args else None)
    if info["active"] is not None:
        log(f"the {info['active']['name']} window has begun; staying on, the schedule ends it")
        return
    start = datetime.fromisoformat(info["next"])
    # the board reads its alarm as clock fields against its RTC, which keeps UTC (wittypi.service, life-schedule)
    fields = subprocess.run(["date", "-u", "-d", f"@{int(start.timestamp())}", "+%d %H %M %S"], capture_output=True, text=True,
                            check=True).stdout.split()
    cmd = f"cd /data/wittypi && . ./utilities.sh >/dev/null 2>&1 && set_startup_time {' '.join(fields)} && clear_shutdown_time"
    log(f"outside the windows: next start {info['next']} (Witty Pi clock, UTC: {' '.join(fields)}), powering off")
    if dry:
        print(f"would run: bash -c '{cmd}' && systemctl poweroff")
        return
    if (Path("/data/wittypi") / "utilities.sh").exists():
        if subprocess.run(["bash", "-c", cmd]).returncode != 0:
            log("could not set the next start; staying on until the schedule ends the next window")
            return
    subprocess.run(["systemctl", "poweroff"], check=False)


def status() -> None:
    print(DECISION.read_text().strip() if DECISION.exists() else "{}")


def main() -> None:
    args = sys.argv[1:]
    cmd = args[0] if args else "status"
    if cmd == "check":
        check(args[1:])
    elif cmd == "stop":
        stop(args[1:])
    elif cmd == "status":
        status()
    else:
        sys.exit("usage: life-window check [--dry-run] [--now T] [--wake REASON] | stop [--dry-run] [--now T] | status")


if __name__ == "__main__":
    main()
