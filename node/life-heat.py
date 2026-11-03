#!/usr/bin/env python3
"""Life node heat: how hot the processor runs while the node is awake, whether the Pi slowed itself down, and the
heat guard that takes the bat model out before that happens.

    life-heat watch            every WATCH_S seconds while the node is awake (life-heat.service): the processor's
                               temperature, the firmware's throttle flags and the processor's clock, kept for this
                               boot in RUN/heat.json; the guard trips at LIFE_BATS_MAX_C, lets go at RESUME_K degrees
                               under it after at least GUARD_MIN_OFF_MIN minutes, and asks life-mic to take the bat
                               model out or to put it back (life-mic-sync.service)
    life-heat status [--json]  what it has seen this boot

Why. With the bat model running, node 1's processor sat 46 to 70 degrees above the outside air at the end of its
evening window in late October 2026, in its closed box (kit/bench-log.csv). A summer evening at the end of that hour is
15 to 20 °C outside, so the processor reaches the 80 °C from which the firmware slows the cores step by step, and at 85
the GPU too. A slowed processor cannot keep up with the bat model, whose pace BirdNET-Go keeps fixed: it lowers the
bird model's overlap and then drops sound, birds and bats both, and nothing said so. The guard drops the bat model
first and the heartbeat says for how long, so the listening effort of a hot evening is known rather than guessed.

What it keeps (one file per boot, on /run, which a node's power cut clears with it):
- `c`, `maxC`, `maxAt`: the processor's temperature now and its highest this boot;
- `hotS`: seconds at or above HOT_C (80 °C), where the firmware starts slowing the cores;
- `thr`: the firmware's throttle flags now (hex), `thrEver` whether the cores were capped, throttled or held at the
  soft limit since boot, `uvEver` whether the supply sagged under the Pi's limit since boot (bits 17 to 19 and 16 of
  `vcgencmd get_throttled`);
- `mhz`, `minMhz`: the processor's clock now and its lowest this boot, as the firmware measures it;
- `guard`: `on`, `since`, `trips` this boot.

The guard acts only on the bat model, and only through life-mic, which decides the bat model and keeps the evening's
minutes (life-mic's bats.json). The birds keep the processor.

env: LIFE_BATS_MAX_C (78; 70 to 84), LIFE_RUN (/run/life-node), LIFE_HEAT_WATCH_S (15),
     LIFE_HEAT_SYNC_CMD (systemctl start --no-block life-mic-sync.service), LIFE_HEAT_TEMP (a file with the
     temperature in millidegrees, for tests), LIFE_HEAT_THROTTLED (a hex value, for tests), LIFE_HEAT_MHZ (for tests),
     LIFE_HEAT_NOW (epoch seconds, for tests)
"""
import json
import os
import shlex
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HOT_C = 80.0          # the firmware starts slowing the cores here (Raspberry Pi documentation, 4-series)
RESUME_K = 8.0        # the guard lets go this far under its trip point
MIN_OFF_S = 15 * 60   # and not before the bat model has been out this long: fewer restarts of BirdNET-Go
WATCH_S = float(os.environ.get("LIFE_HEAT_WATCH_S") or 15)
RUN = Path(os.environ.get("LIFE_RUN") or "/run/life-node")
HEAT = RUN / "heat.json"
SYNC = os.environ.get("LIFE_HEAT_SYNC_CMD", "systemctl start --no-block life-mic-sync.service")
TEMP = Path(os.environ.get("LIFE_HEAT_TEMP") or "/sys/class/thermal/thermal_zone0/temp")
# where the firmware's flags live depends on the kernel; node 1 (Raspberry Pi OS, kernel 6.18) has none of these, and
# then vcgencmd asks the firmware itself
THROTTLED_FILES = ("/sys/devices/platform/soc/soc:firmware/get_throttled",
                   "/sys/devices/platform/soc/soc:firmware/raspberrypi-hwmon/get_throttled")
UV_EVER, THR_EVER = 1 << 16, (1 << 17) | (1 << 18) | (1 << 19)
# for tests: the flags, the clock and the time as given, instead of the firmware's and the clock's
_THROTTLED, _MHZ, _NOW = (os.environ.get(k) for k in ("LIFE_HEAT_THROTTLED", "LIFE_HEAT_MHZ", "LIFE_HEAT_NOW"))
try:
    _MAX_C = float(os.environ.get("LIFE_BATS_MAX_C") or 78)
except ValueError:
    _MAX_C = 78.0


def say(msg: str) -> None:
    print(f"life-heat: {msg}", flush=True)


def max_c() -> float:
    return min(max(_MAX_C, 70.0), 84.0)


def now() -> float:
    return float(_NOW) if _NOW else time.time()


def iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="seconds")


def boot_id() -> str:
    try:
        return Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    except OSError:
        return "unknown"


def vcgencmd(*args: str) -> str | None:
    try:
        r = subprocess.run(["vcgencmd", *args], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def read_c() -> float | None:
    try:
        return round(int(TEMP.read_text().strip()) / 1000, 1)
    except (OSError, ValueError):
        return None


def read_throttled() -> int | None:
    """The firmware's throttle flags: a sysfs file where the kernel has one, else `vcgencmd get_throttled`."""
    if _THROTTLED:
        return int(_THROTTLED, 16)
    for f in THROTTLED_FILES:
        try:
            return int(Path(f).read_text().strip(), 16)
        except (OSError, ValueError):
            continue
    out = vcgencmd("get_throttled")  # "throttled=0x50005"
    if out and "=" in out:
        try:
            return int(out.split("=", 1)[1], 16)
        except ValueError:
            return None
    return None


def read_mhz() -> int | None:
    """The clock the firmware measures (the kernel's own figure is only what it asked for)."""
    if _MHZ:
        return int(_MHZ)
    out = vcgencmd("measure_clock", "arm")  # "frequency(0)=1800404352"
    if out and "=" in out:
        try:
            return round(int(out.split("=", 1)[1]) / 1e6)
        except ValueError:
            pass
    try:
        return round(int(Path("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq").read_text()) / 1000)
    except (OSError, ValueError):
        return None


def fresh(boot: str, t: float) -> dict:
    return {"boot": boot, "since": iso(t), "t": t, "n": 0, "c": None, "maxC": None, "maxAt": None, "hotS": 0,
            "thr": None, "thrEver": False, "uvEver": False, "mhz": None, "minMhz": None,
            "guard": {"on": False, "since": None, "sinceT": None, "trips": 0}}


def load(boot: str, t: float) -> dict:
    try:
        st = json.loads(HEAT.read_text())
        if st.get("boot") == boot:
            return st
    except (OSError, ValueError):
        pass
    return fresh(boot, t)


def step(st: dict, c: float | None, thr: int | None, mhz: int | None, t: float, trip: float) -> bool:
    """One reading into the state. True when the guard tripped or let go."""
    prev_t = st.get("t")
    dt = min(max(t - float(t if prev_t is None else prev_t), 0), 2 * WATCH_S)   # a gap (a pause) counts for little
    st["t"], st["n"] = t, int(st.get("n") or 0) + 1
    if c is not None:
        if st.get("c") is not None and st["c"] >= HOT_C and c >= HOT_C:
            st["hotS"] = int(st.get("hotS") or 0) + int(round(dt))
        st["c"] = c
        if st.get("maxC") is None or c > st["maxC"]:
            st["maxC"], st["maxAt"] = c, iso(t)
    if thr is not None:
        st["thr"] = hex(thr)
        st["thrEver"] = bool(st.get("thrEver")) or bool(thr & THR_EVER) or bool(thr & 0b1110)
        st["uvEver"] = bool(st.get("uvEver")) or bool(thr & UV_EVER) or bool(thr & 0b1)
    if mhz is not None:
        st["mhz"] = mhz
        st["minMhz"] = mhz if st.get("minMhz") is None else min(st["minMhz"], mhz)
    g = st.setdefault("guard", {"on": False, "since": None, "sinceT": None, "trips": 0})
    if c is None:
        return False
    if not g.get("on") and c >= trip:
        g.update(on=True, since=iso(t), sinceT=t, trips=int(g.get("trips") or 0) + 1)
        return True
    since = g.get("sinceT")
    if g.get("on") and c <= trip - RESUME_K and t - float(t if since is None else since) >= MIN_OFF_S:
        g.update(on=False, since=iso(t), sinceT=t)
        return True
    return False


def write(st: dict) -> None:
    RUN.mkdir(parents=True, exist_ok=True)
    tmp = HEAT.with_suffix(".tmp")
    tmp.write_text(json.dumps(st) + "\n")
    os.replace(tmp, HEAT)


def once(st: dict) -> bool:
    flipped = step(st, read_c(), read_throttled(), read_mhz(), now(), max_c())
    write(st)
    if flipped:
        g = st["guard"]
        say(f"processor at {st['c']} °C: the guard {'takes the bat model out' if g['on'] else 'lets it back in'} "
            f"(trips at {max_c():.0f} °C, lets go at {max_c() - RESUME_K:.0f} °C)")
        r = subprocess.run(shlex.split(SYNC), capture_output=True, text=True)
        if r.returncode != 0:
            say(f"could not ask life-mic ({SYNC}: {r.returncode}); its own five-minute timer will")
    return flipped


def watch() -> int:
    st = load(boot_id(), now())
    while True:
        try:
            once(st)
        except Exception as e:  # noqa: BLE001 - a bad reading never stops the watch
            say(f"reading failed: {e}")
        time.sleep(WATCH_S)


def status(as_json: bool) -> int:
    try:
        st = json.loads(HEAT.read_text())
    except (OSError, ValueError):
        st = None
    if as_json:
        print(json.dumps(st))
    elif st is None:
        print("no readings this boot (is life-heat.service running?)")
    else:
        g = st.get("guard") or {}
        print(f"processor {st.get('c')} °C, highest {st.get('maxC')} °C at {st.get('maxAt')}, "
              f"{round((st.get('hotS') or 0) / 60)} min at {HOT_C:.0f} °C or more")
        print(f"throttle flags {st.get('thr')}, slowed since boot: {'yes' if st.get('thrEver') else 'no'}, "
              f"supply sagged: {'yes' if st.get('uvEver') else 'no'}; clock {st.get('mhz')} MHz, lowest {st.get('minMhz')}")
        print(f"guard {'on' if g.get('on') else 'off'} since {g.get('since')}, {g.get('trips', 0)} trips "
              f"(at {max_c():.0f} °C)")
    return 0


def main(argv: list[str]) -> int:
    if argv[:1] == ["watch"]:
        return watch()
    if argv[:1] == ["status"]:
        return status("--json" in argv)
    if argv[:1] == ["once"]:   # one reading, for tests and by hand
        once(load(boot_id(), now()))
        return 0
    print(__doc__.strip().split("\n\n")[0])
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
