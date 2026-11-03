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

With visits on (LIFE_VISIT=1), the button is a visit: the visit contact's magnet presses it (node/life-visit.py). Such
a boot starts a visit and powers off when the visit is over, at the latest VISIT_MAX_MIN + 10 minutes after this
check, so a node a visitor woke in winter is not left on for hours. With a maintenance window open (the owner set
one on the oracle; life-guard keeps it in maintenance.json) the node stays on after the visit, as before. A node that
was off inside one of its windows ends such a visit with the window; one without a schedule stays on after it. A boot
by the tamper guard presses the same button, so a guard in alarm makes it no visit. The simple alarm (GUARD=simple)
presses it too when it goes off: such a boot is no visit either.
The node reports the alarm (life-guard), keeps reporting its cell for half an hour, and powers off ALARM_S after
this check until its next window, unless a maintenance window is open (the owner, or the person at the box, set one).

Every boot is written to /data/life-node/window.json, and the heartbeat carries the window the node woke for
(`window`, empty outside one) and, outside one, what it did about it (`offWindow`: "stop", "visit", "alarm" or "kept").

The night window for meadow birds (life-schedule-wpi), when the owner turned it on, is decided as it begins: right
after the dusk window, where the two are one ON state, by a timer this check sets; on its own, by this check at the
boot the Witty Pi makes for it. With the battery option on and the Witty Pi reading less than the owner's minimum,
the node powers off with its next start set to the next day's first window; otherwise it listens. A maintenance window
or a visit keeps it on all the same, and a battery that cannot be read lets it listen (the board's own low-voltage stop
still guards the cells), as does a node on a 5 V supply, whose input reads under 6 V and has no battery to spare. Each night's outcome is written to night-last.json and rides on the heartbeat (`nightLast`),
with the rev of the settings the node has (`nightRev`), so the owner's page shows how the night went.

    life-window check [--dry-run] [--now 2026-08-15T13:00] [--wake voltage-restored]
    life-window stop [--unless-maintenance]
                            the timer's job: unless a window has begun (or, with the flag, a maintenance window is
                            open), set the next start, clear the shutdown alarm (a shutdown alarm that comes while the
                            Pi is off wakes it), power off
    life-window night [--dry-run] [--now T]
                            the night timer's job: decide the night window that has just begun
    life-window apply       the oracle's heartbeat answer on stdin (life-push): keep its night settings in night.json
                            and, when they changed, write the day's schedule again (life-schedule again)
    life-window arm [--dry-run] [--now T]
                            after the schedule changed while the node is on: set or clear the night timer, and power
                            off a node that is on for a window which no longer holds the present
    life-window status

env: SCHEDULE (only 'season' acts), OFFWINDOW_GRACE_MIN (default 10), WITTYPI_BUS (default 1),
     LIFE_STATE (default /data/life-node), LIFE_VISIT, VISIT_MAX_MIN (default 30), GUARD,
     LIFE_NIGHT_VIN (tests: pretend the battery reads this), LIFE_SCHEDULE_CMD (default /usr/local/sbin/life-schedule)
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

STATE = Path(os.environ.get("LIFE_STATE", "/data/life-node"))
DECISION = STATE / "window.json"
MAINTENANCE = STATE / "maintenance.json"   # life-guard caches the owner's window here from the oracle's answers
NIGHT_FILE = Path(os.environ.get("LIFE_NIGHT") or STATE / "night.json")   # the owner's night window, from apply
NIGHT_LAST = STATE / "night-last.json"     # how the last night window went, for the heartbeat
MERGE = timedelta(minutes=15)              # as life-schedule-wpi: windows closer than this are one ON state
SCHEDULE = os.environ.get("SCHEDULE", "season").strip() or "season"
GRACE_S = int(float(os.environ.get("OFFWINDOW_GRACE_MIN") or 10) * 60)
VISIT = os.environ.get("LIFE_VISIT", "0").strip() == "1"
_max = float(os.environ.get("VISIT_MAX_MIN") or 30)
VISIT_S = min(_max if _max > 0 else 30, 60) * 60   # as life-visit reads it
ALARM_S = 40 * 60   # an alarm wake: life-guard's half hour of reports, ten minutes to spare, then off
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


def maintenance() -> bool:
    """Whether the owner has a maintenance window open now."""
    try:
        m = json.loads(MAINTENANCE.read_text())
        frm, until = (datetime.fromisoformat(m[k].replace("Z", "+00:00")) if isinstance(m.get(k), str) else None for k in ("from", "until"))
    except (OSError, ValueError, AttributeError):
        return False
    now = datetime.now(timezone.utc)
    return until is not None and until > now and (frm is None or frm <= now)


def guard_alarm() -> bool:
    """The tamper guard, and the simple alarm, wake the Pi through the same button input as the visit contact."""
    if os.environ.get("GUARD", "0").strip() not in ("1", "simple"):
        return False
    try:
        out = subprocess.run(["life-guard", "status"], capture_output=True, text=True, timeout=15)
        return json.loads(out.stdout).get("alarm") is True
    except Exception:  # noqa: BLE001 - no answer from the guard: no reason to think it is an alarm
        return False


def wake_of(args: list[str]) -> str | None:
    return args[args.index("--wake") + 1] if "--wake" in args else wake_reason()


MAINS_V = 6.0   # a Witty Pi input under this is a 5 V supply, not a 12 V battery


def battery_v() -> float | None:
    """The Witty Pi's input, which on a node is the charge controller's load output: the battery less a few tenths."""
    if os.environ.get("LIFE_NIGHT_VIN"):
        return float(os.environ["LIFE_NIGHT_VIN"])
    bus = os.environ.get("WITTYPI_BUS", "1").strip()
    if not bus:
        return None
    try:
        reg = lambda r: int(subprocess.run(["i2cget", "-y", bus, "0x08", str(r)], capture_output=True, text=True,  # noqa: E731
                                           check=True, timeout=5).stdout.strip(), 16)
        return round(reg(1) + reg(2) / 100, 2)
    except Exception as e:  # noqa: BLE001 - no reading: the night runs, the board's own low-voltage stop still guards
        log(f"no battery reading ({e})")
        return None


def visit_running() -> bool:
    out = subprocess.run(["systemctl", "list-units", "life-visit@*", "--state=active", "--no-legend", "--plain"],
                         capture_output=True, text=True)
    return bool(out.stdout.strip())


def write_night(rec: dict, dry: bool) -> None:
    rec["at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if dry:
        print(json.dumps(rec))
        return
    STATE.mkdir(parents=True, exist_ok=True)
    tmp = NIGHT_LAST.with_suffix(".tmp")
    tmp.write_text(json.dumps(rec) + "\n")
    tmp.replace(NIGHT_LAST)


def night_after(info: dict, w: dict) -> dict | None:
    """Today's night window when it follows window w in the same ON state (less than MERGE after it)."""
    end = datetime.fromisoformat(w["end"])
    for n in info.get("windows", []):
        if n["name"] == "night" and n is not w and timedelta(0) <= datetime.fromisoformat(n["start"]) - end < MERGE:
            return n
    return None


def arm_night(info: dict, dry: bool) -> None:
    """Inside a core window that runs on into the night window: a timer to decide the night when it begins."""
    w = info.get("active")
    n = night_after(info, w) if w is not None and w["name"] != "night" else None
    if n is None:
        return
    now = datetime.fromisoformat(info["now"])
    wait = max(int((datetime.fromisoformat(n["start"]) - now).total_seconds()) + 30, 30)   # well inside the night window
    cmd = ["systemd-run", "--unit=life-window-night", "--collect", f"--on-active={wait}s", "/usr/local/sbin/life-window", "night"]
    log(f"the night window follows, {n['start']} to {n['end']}: deciding it in {wait} s")
    if dry:
        print(f"would run: {' '.join(cmd)}")
    elif subprocess.run(cmd).returncode != 0:
        log("could not set the night timer; the night window runs as scheduled")


def gate(info: dict, dry: bool) -> None:
    """Decide the night window that is on now: with the battery option, below the owner's minimum, power off."""
    w, c = info["active"], info.get("night") or {}
    v = battery_v()
    rec = {"date": info["date"], "start": w["start"], "end": w["end"], "v": v, "minV": c.get("minV") if c.get("battery") else None}
    if not c.get("battery"):
        ran = "listened"
    elif v is None:
        ran = "unknown"
    elif v < MAINS_V:   # a 5 V supply on the bench: there is no battery to spare, so the night listens
        ran = "mains"
    elif v >= float(c.get("minV", 13.1)):
        ran = "listened"
    elif maintenance() or visit_running():
        ran = "kept"
    else:
        ran = "battery"
    write_night({**rec, "ran": ran}, dry)
    if ran != "battery":
        log(f"night window {w['start']} to {w['end']}: {ran}" + (f" (battery {v:.2f} V)" if v is not None else ""))
        return
    log(f"night window: battery {v:.2f} V under {float(c['minV']):.2f} V, skipping it")
    power_off(info, dry)


def by_magnet(wake: str | None) -> bool:
    """Whether this boot is a visit: the button (the magnet presses it), with visits on and the guard quiet."""
    return VISIT and wake == "button" and not guard_alarm()


def start_visit(unit: str, dry: bool) -> None:
    cmd = ["systemctl", "start", "--no-block", unit]
    if dry:
        print(f"would run: {' '.join(cmd)}")
    else:
        subprocess.run(cmd)


def visit(rec: dict, dry: bool) -> None:
    kept = maintenance()
    wait = int(VISIT_S + 600)
    if kept:
        log("woke by the button or the visit contact, with a maintenance window open: a visit, and the node stays on")
        write({**rec, "offWindow": "kept"}, dry)
    else:
        log(f"woke by the button or the visit contact: a visit, then off until the next window at {rec['next']} (in {wait} s at the latest)")
        write({**rec, "offWindow": "visit", "stopInS": wait}, dry)
    stop_cmd = ["systemd-run", "--unit=life-window-stop", f"--on-active={wait}s", "/usr/local/sbin/life-window", "stop", "--unless-maintenance"]
    if dry:
        if not kept:
            print(f"would run: {' '.join(stop_cmd)}")
    elif not kept:
        subprocess.run(["systemctl", "stop", "life-window-stop.timer"], capture_output=True)
        if subprocess.run(stop_cmd).returncode != 0:
            log("could not set the backstop; the visit powers the node off itself when it is over")
    start_visit("life-visit@boot.service", dry)


def alarm(rec: dict, dry: bool) -> None:
    """A boot the simple alarm made: no visit and nobody at the node. Report, then sleep until the next window."""
    if maintenance():
        log("woke by the alarm, with a maintenance window open: the node stays on")
        write({**rec, "offWindow": "kept", "alarm": True}, dry)
        return
    log(f"woke by the alarm: reporting for half an hour, then off until the next window at {rec['next']} (in {ALARM_S} s)")
    write({**rec, "offWindow": "alarm", "stopInS": ALARM_S}, dry)
    stop_cmd = ["systemd-run", "--unit=life-window-stop", f"--on-active={ALARM_S}s", "/usr/local/sbin/life-window", "stop", "--unless-maintenance"]
    if dry:
        print(f"would run: {' '.join(stop_cmd)}")
        return
    subprocess.run(["systemctl", "stop", "life-window-stop.timer"], capture_output=True)
    if subprocess.run(stop_cmd).returncode != 0:
        log("could not set the stop; the node stays on until the end of its next window")


def check(args: list[str]) -> None:
    dry = "--dry-run" in args
    now_arg = args[args.index("--now") + 1] if "--now" in args else None
    if SCHEDULE != "season":
        log(f"SCHEDULE={SCHEDULE}: no listening windows, nothing to decide")
        write({"schedule": SCHEDULE, "window": None}, dry)
        if VISIT and by_magnet(wake_of(args)):   # no window to end it: the visit leaves the node on, as a boot by hand did
            start_visit("life-visit@magnet.service", dry)
        return
    info = windows(now_arg)
    w = info["active"]
    if w is not None:
        log(f"{w['name']} window, {w['start']} to {w['end']}")
        rec = {"date": info["date"], "window": w["name"], "start": w["start"], "end": w["end"]}
        wake = wake_of(args)
        if VISIT and by_magnet(wake):   # a node that was off inside its window: the visit ends with it at the latest
            log("woke by the button or the visit contact: a visit")
            write({**rec, "visit": True}, dry)
            start_visit("life-visit@boot.service", dry)
            arm_night(info, dry)
            return
        write(rec, dry)
        if w["name"] != "night":
            arm_night(info, dry)
        elif wake is None or wake in BY_HAND:   # somebody is at the node: it listens, as in any window
            write_night({"date": info["date"], "start": w["start"], "end": w["end"], "v": battery_v(), "minV": None, "ran": "listened"}, dry)
        else:
            gate(info, dry)
        return
    wake = wake_of(args)
    rec = {"date": info["date"], "window": None, "wake": wake, "next": info["next"]}
    if wake == "button" and os.environ.get("GUARD", "0").strip() == "simple" and guard_alarm():
        alarm(rec, dry)
        return
    if by_magnet(wake):
        visit(rec, dry)
        return
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
    if "--unless-maintenance" in args and maintenance():
        log("a maintenance window is open; staying on")
        return
    power_off(info, dry)


def night_cmd(args: list[str]) -> None:
    dry = "--dry-run" in args
    if SCHEDULE != "season":
        log(f"SCHEDULE={SCHEDULE}: no night window")
        return
    info = windows(args[args.index("--now") + 1] if "--now" in args else None)
    w = info["active"]
    if w is None or w["name"] != "night":
        log("no night window now; nothing to decide")
        return
    gate(info, dry)


def apply() -> None:
    """The oracle's heartbeat answer on stdin: its `night` settings into night.json, and the schedule written again
    when they changed. Anything that is not a well-formed answer is left alone."""
    try:
        n = json.loads(sys.stdin.read() or "{}").get("night")
    except (ValueError, AttributeError):
        return
    if not isinstance(n, dict) or not isinstance(n.get("rev"), int):
        return
    keys = ("on", "startMin", "lenMin", "from", "to", "battery", "minV")
    new = {"rev": n["rev"], **{k: n[k] for k in keys if k in n}}
    try:
        old = json.loads(NIGHT_FILE.read_text())
    except (OSError, ValueError):
        old = {}
    if old == new:
        return
    STATE.mkdir(parents=True, exist_ok=True)
    tmp = NIGHT_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(new) + "\n")
    tmp.replace(NIGHT_FILE)
    old = old if isinstance(old, dict) else {}
    # a schedule to write again only when an hour moves: a night window was or is now on and its hours changed. Off and
    # off again moves none, and the battery option and its minimum are read when the night begins
    hours = ("on", "startMin", "lenMin", "from", "to")
    changed = (old.get("on") is True or new.get("on") is True) and any(old.get(k) != new.get(k) for k in hours)
    log(f"night settings {new['rev']} from the oracle: " + ("on" if new.get("on") else "off")
        + ("; writing the schedule again" if changed and SCHEDULE == "season" else ""))
    if changed and SCHEDULE == "season":
        # in a unit of its own: life-push gives each apply a minute, and runScript must not be cut off half way
        cmd = ["systemd-run", "--unit=life-schedule-again", "--collect", os.environ.get("LIFE_SCHEDULE_CMD", "/usr/local/sbin/life-schedule"), "again"]
        if subprocess.run(cmd, capture_output=True, text=True).returncode != 0:
            log("could not write the schedule again now; the next boot writes it with these settings")


def arm(args: list[str]) -> None:
    """After the schedule was written again with the node on: the night timer as it now should be, and off for a node
    that is on for a window the new schedule no longer has at this hour (nobody at it: no visit, no maintenance)."""
    dry = "--dry-run" in args
    if SCHEDULE != "season":
        return
    info = windows(args[args.index("--now") + 1] if "--now" in args else None)
    if not dry:
        subprocess.run(["systemctl", "stop", "life-window-night.timer"], capture_output=True)
    arm_night(info, dry)
    if info["active"] is not None:
        return
    try:
        boot = json.loads(DECISION.read_text())
    except (OSError, ValueError):
        return
    if not boot.get("window") or boot.get("visit") or maintenance() or visit_running():
        return
    log(f"on for the {boot['window']} window, which the new schedule ends before now: off until {info['next']}")
    power_off(info, dry)


def power_off(info: dict, dry: bool) -> None:
    start = datetime.fromisoformat(info["next"])
    # the board reads its alarm as clock fields against its RTC, which keeps UTC (wittypi.service, life-schedule)
    fields = subprocess.run(["date", "-u", "-d", f"@{int(start.timestamp())}", "+%d %H %M %S"], capture_output=True, text=True,
                            check=True).stdout.split()
    cmd = f"cd /data/wittypi && . ./utilities.sh >/dev/null 2>&1 && set_startup_time {' '.join(fields)} && clear_shutdown_time"
    log(f"next start {info['next']} (Witty Pi clock, UTC: {' '.join(fields)}), powering off")
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
    elif cmd == "night":
        night_cmd(args[1:])
    elif cmd == "apply":
        apply()
    elif cmd == "arm":
        arm(args[1:])
    elif cmd == "status":
        status()
    else:
        sys.exit("usage: life-window check [--dry-run] [--now T] [--wake REASON] | stop [--dry-run] [--now T] [--unless-maintenance]"
                 " | night [--dry-run] [--now T] | apply | arm [--dry-run] [--now T] | status")


if __name__ == "__main__":
    main()
