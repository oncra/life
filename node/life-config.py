#!/usr/bin/env python3
"""life-config: the settings a Life node takes from the oracle over its SIM, a few hundred bytes when they change.

Every post a node makes is answered, and the answer already carries instructions: the maintenance window
(life-guard), the visit WiFi (life-visit), the laptop batches to delete (life-clips). This program takes the settings.
The node reports the settings it runs as `cfgRev` in its heartbeat; when the oracle has other ones for it, the answer
carries them, and only then: the listening windows as rules (life-schedule-wpi reads them from LIFE_CONFIG) and a short
list of the node's own settings. Nothing extra is sent to ask for them, and they are a few hundred bytes once per
change, against about 10 kB for a post and 137 kB a day over the SIM's ten years.

The rules of a spacecraft, because nobody stands at the node:
- The node decides. Every value is checked here against the node's own list and bounds, whatever the oracle says. A
  setting the node does not know is left out and named back (`cfgIgnored`); a value out of its bounds, or windows that
  leave a month without a wake, and the whole set is refused, with the reason (`cfgRefused`, `cfgWhy`).
- Nothing that keeps the link can be set this way: not the SIM, the network, the tokens or the oracle's address, the
  SSH keys, the software, the clock or the schedule's mode. The battery guard can be moved within its bounds and never
  switched off; on a node whose builder switched it off (a mains adapter) it cannot be switched on from here, and a
  stop level the node's input does not clear right now is refused, since it would switch the node off at once.
- The last good settings are kept. New ones are on trial until the oracle has answered a post made under them. When
  TRIAL_WAKES whole wakes after they came have gone by without an answer from the oracle, the node starts the next one
  on its last good settings, by itself, and refuses the new ones until the oracle sends something else. (At a wake's
  boot the node cannot know yet whether that wake will be answered, so the count is of wakes that are over.)
- The ground knows what the node runs: every heartbeat carries `cfgRev`, and after a change the first one also carries
  the settings the node now runs (`settings`, its own and the oracle's together).

Where they go: the windows into LIFE_CONFIG, the rest into the node's env file, as a block at its end that only this
program writes (the last value of a key counts, for systemd and the shell alike), so every program reads them as it
always did. A value read at each run (life-push, life-clips, a visit) counts from the next run, one read at boot (the
microphones, clip keeping, the grace outside the windows) from the next wake; the battery guard is set at once, and so
are new windows (life-schedule again: the window's end and the next start move, and a node whose window they ended
powers off). A setting the oracle sets wins over the node's own; cleared on the oracle, the node's own counts again.

The windows are the method's: the same at every node, and the readings count exactly them (content/spec.md 2.2). They
ride along so that a new version of the method reaches every node without a visit. A node's own extra listening is the
night window for meadow birds, which has a channel of its own (life-window apply).

    life-config apply < answer     the oracle's answer to a heartbeat, from life-push (LIFE_HEARTBEAT_APPLY_CMD)
    life-config boot               every boot, first thing in life-schedule: the env block in step, a wake on trial
                                   counted, and back to the last good settings once TRIAL_WAKES wakes went unanswered
    life-config report             the heartbeat's part, as JSON (life-heartbeat)
    life-config status [--json]

env: LIFE_STATE (/data/life-node), LIFE_ENV (LIFE_STATE/env), LIFE_CONFIG (LIFE_STATE/config.json),
     LIFE_SCHEDULE_WPI (/usr/local/sbin/life-schedule-wpi), LIFE_SCHEDULE_CMD (/usr/local/sbin/life-schedule),
     WITTYPI_BUS (1), LIFE_WITTYPI_BIN (/usr/local/sbin/life-wittypi); for the tests LIFE_BOOT_ID and LIFE_NOW (epoch s)
"""
import fcntl
import hashlib
import importlib.machinery
import importlib.util
import json
import math
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

STATE = Path(os.environ.get("LIFE_STATE", "/data/life-node"))
ENV = Path(os.environ.get("LIFE_ENV") or STATE / "env")
CONFIG = Path(os.environ.get("LIFE_CONFIG") or STATE / "config.json")
LOCK = STATE / "config.lock"
SENT, PENDING = STATE / "settings-sent", STATE / "settings-pending"
WPI = os.environ.get("LIFE_SCHEDULE_WPI", "/usr/local/sbin/life-schedule-wpi")
WITTYPI_BIN = os.environ.get("LIFE_WITTYPI_BIN", "/usr/local/sbin/life-wittypi")
SCHEDULE_CMD = os.environ.get("LIFE_SCHEDULE_CMD", "/usr/local/sbin/life-schedule")
TRIAL_WAKES = 3
BEGIN = "# --- set over the air by the oracle (life-config); rewritten with every change, edit on the node's page ---"
END = "# --- end of the oracle's settings ---"
REV = re.compile(r"[0-9a-f]{8,64}")
KEY = re.compile(r"[A-Z][A-Z0-9_]{0,47}")


def num(lo, hi):
    return ("num", lo, hi)


def whole(lo, hi):
    return ("int", lo, hi)


def one_of(*xs):
    return ("enum", xs)


# What the oracle may set, and within what: the same list as NODE_SETTINGS in src/lib/node-config.ts. A key that is not
# here is left out, whatever the oracle sends; adding one is a change to this program, at the node.
SETTINGS = {
    "LIFE_MIN_CONFIDENCE": num(0.5, 0.99),       # detections under it stay on the node (life-push; the floor is 0.7)
    "LIFE_CLIPS_ALL_FROM": num(0.1, 1.01),       # every clip from this score up is kept (above 1: only the sample)
    "LIFE_CLIPS_PER_BAND": whole(0, 50),         # the sample below it, per species, month and band
    "LIFE_CLIPS_SECONDS": whole(3, 15),          # each kept clip cut to this
    "LIFE_CLIPS_MIN_FREE_MB": whole(500, 20000),  # room kept free on /data
    "LIFE_CLIPS_KEEP_DAYS": whole(30, 730),      # a clip that never left is deleted after this
    "LIFE_KEEP_CLIPS": one_of("0", "1"),         # clips at all (next wake)
    "LIFE_BIRD_MIC": one_of("audiomoth", "i2s", "both"),  # which microphone hears the birds (next wake)
    "LIFE_MIC_CHECK": one_of("0", "1"),          # the witness and the weekly level check (next wake)
    "LIFE_MIC_CHECK_DAY": one_of("mon", "tue", "wed", "thu", "fri", "sat", "sun"),
    "LIFE_BATS": one_of("0", "1"),               # the bat model at night (next wake)
    "BAT_LEAD_MIN": whole(0, 120),               # the bat model from this long before sunset
    "LIFE_BATS_BATTERY": one_of("0", "1"),       # the battery decides the evening's bats (next evening)
    "LIFE_BATS_MIN_V": num(12.6, 13.6),          # under this as the bat hours begin, no bats that evening
    "LIFE_BATS_MAX_C": num(70.0, 84.0),          # the heat guard takes the bat model out here (life-heat, next wake)
    "VISIT_MAX_MIN": whole(5, 60),               # how long a visit may last
    "VISIT_HOTSPOT_WAIT_S": whole(30, 600),      # how long a visit looks for the phone's hotspot
    "OFFWINDOW_GRACE_MIN": whole(3, 60),         # a wake outside the windows posts and sleeps after this
    "WITTYPI_LOW_V": num(11.8, 13.0),            # the battery guard's stop, never off from here (at once)
    "WITTYPI_RECOVERY_V": num(12.8, 13.6),       # and where it switches the node on again (at once)
}
GUARD = ("WITTYPI_LOW_V", "WITTYPI_RECOVERY_V")
# set with another, as node/apply-mic.sh sets them: in mode both the AudioMoth's birds go out as test
LINKED = {"LIFE_BIRD_MIC": lambda v: {"LIFE_TEST_SOURCES": "AudioMoth" if v == "both" else ""}}


def say(msg: str) -> None:
    print(f"life-config: {msg}", flush=True)


def now() -> float:
    return float(os.environ.get("LIFE_NOW") or time.time())


def iso(t: float | None = None) -> str:
    return datetime.fromtimestamp(now() if t is None else t, timezone.utc).isoformat(timespec="seconds")


def boot_id() -> str:
    if os.environ.get("LIFE_BOOT_ID"):
        return os.environ["LIFE_BOOT_ID"]
    try:
        return Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    except OSError:
        return "unknown"


def sh(cmd: list[str], timeout: float = 120) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return subprocess.CompletedProcess(cmd, 127, "", str(e))


def write(p: Path, text: str, mode: int = 0o644) -> None:
    """Atomically, so a power cut leaves the old file or the new one."""
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(fd, "w") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.chmod(tmp, mode)
    os.replace(tmp, p)


# --- the state: what the node runs, what it had, what is on trial, what it refused ---

def load() -> dict:
    try:
        st = json.loads(CONFIG.read_text())
        return st if isinstance(st, dict) else {}
    except (OSError, ValueError):
        return {}


def save(st: dict) -> None:
    write(CONFIG, json.dumps(st, indent=1) + "\n")


class locked:
    """life-push (apply) and life-schedule (boot) can run at once just after a boot."""
    def __enter__(self):
        STATE.mkdir(parents=True, exist_ok=True)
        self.f = open(LOCK, "w")
        fcntl.flock(self.f, fcntl.LOCK_EX)
        return self

    def __exit__(self, *a):
        self.f.close()


# --- the env file: the builder's part, and the block at its end ---

def parse_env(text: str) -> dict:
    out = {}
    for line in text.splitlines():
        m = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", line.strip())
        if m:
            out[m.group(1)] = m.group(2).split(" #")[0].strip().strip("'\"")
    return out


def env_text() -> str:
    try:
        return ENV.read_text()
    except OSError:
        return ""


def without_block(text: str) -> str:
    lines = text.splitlines(keepends=True)
    if BEGIN not in [ln.rstrip("\n") for ln in lines]:
        return text
    i = [ln.rstrip("\n") for ln in lines].index(BEGIN)
    rest = [ln.rstrip("\n") for ln in lines[i:]]
    j = i + rest.index(END) + 1 if END in rest else len(lines)
    return "".join(lines[:i] + lines[j:])


def base_env() -> dict:
    """The node's own settings, as its builder wrote them: the env file without the oracle's block."""
    return parse_env(without_block(env_text()))


def block_env(env: dict) -> dict:
    out = dict(env)
    for k, link in LINKED.items():
        if k in env:
            out.update(link(env[k]))
    return out


def sync_block(env: dict) -> bool:
    """Put the oracle's settings at the end of the env file, or take them out; True when the file changed."""
    text = env_text()
    base = without_block(text)
    full = block_env(env)
    new = base
    if full:
        new = (base if base.endswith("\n") or not base else base + "\n") + BEGIN + "\n" + "".join(f"{k}={full[k]}\n" for k in sorted(full)) + END + "\n"
    if new == text:
        return False
    write(ENV, new, 0o600)
    return True


# --- checking what the oracle sends ---

_wpi = None


def wpi(fresh: bool = False):
    """life-schedule-wpi as a module: its reading of the windows is the only one. Fresh after new windows, since the
    module keeps the rules it read."""
    global _wpi
    if _wpi is None or fresh:
        here = Path(__file__).with_name("image") / "life-schedule-wpi.py"
        path = str(here) if here.exists() and not Path(WPI).exists() else WPI
        loader = importlib.machinery.SourceFileLoader(f"life_schedule_wpi_{time.monotonic_ns()}", path)
        spec = importlib.util.spec_from_loader(loader.name, loader)
        mod = importlib.util.module_from_spec(spec)
        loader.exec_module(mod)
        _wpi = mod
    return _wpi


def normal(key: str, v) -> str:
    """The value as the node writes it, or ValueError: a number within the bounds, or one of the words."""
    kind = SETTINGS[key]
    if isinstance(v, bool) or v is None or isinstance(v, (list, dict)):
        raise ValueError(f"{key}: {v!r} is not a value")
    if kind[0] == "enum":
        s = str(v).strip().lower()
        if s not in kind[1]:
            raise ValueError(f"{key}: {v!r} is none of {', '.join(kind[1])}")
        return s
    try:
        x = float(v)
    except ValueError:
        raise ValueError(f"{key}: {v!r} is not a number") from None
    if not math.isfinite(x) or not kind[1] <= x <= kind[2]:
        raise ValueError(f"{key}: {v!r} is outside {kind[1]:g} to {kind[2]:g}")
    if kind[0] == "int":
        if x != int(x):
            raise ValueError(f"{key}: {v!r} is not a whole number")
        return str(int(x))
    return f"{x:.3f}".rstrip("0").rstrip(".")


def fnum(s, default: float) -> float:
    try:
        return float(s)
    except (TypeError, ValueError):
        return default


def input_volts() -> float | None:
    """The Witty Pi's input now (registers 1 and 2), or None without one."""
    bus = os.environ.get("WITTYPI_BUS", "1").strip()
    if not bus:
        return None
    try:
        v = [int(sh(["i2cget", "-y", bus, "0x08", str(r)], 5).stdout.strip(), 16) for r in (1, 2)]
        return v[0] + v[1] / 100
    except ValueError:
        return None


def check_guard(env: dict) -> None:
    if not any(k in env for k in GUARD):
        return
    base = base_env()
    if fnum(base.get("WITTYPI_LOW_V", "12.6"), 12.6) == 0:
        raise ValueError("the battery guard is off at this node (WITTYPI_LOW_V=0, a mains adapter); only at the node can it go on again")
    low = fnum(env.get("WITTYPI_LOW_V", base.get("WITTYPI_LOW_V")), 12.6)
    rec = fnum(env.get("WITTYPI_RECOVERY_V", base.get("WITTYPI_RECOVERY_V")), 13.2)
    if rec < low + 0.3 - 1e-9:
        raise ValueError(f"the recovery level {rec:g} V must be at least 0.3 V above the stop at {low:g} V")
    vin = input_volts()
    if vin is not None and vin < low + 0.1:
        raise ValueError(f"the node's input reads {vin:.2f} V now: a stop at {low:g} V would switch it off at once")


def take(cfg: dict) -> tuple[dict, list[str]]:
    """The settings a node takes from the oracle's `config`, and the keys it leaves out; ValueError if it takes none."""
    rev = cfg.get("rev")
    if not isinstance(rev, str) or not REV.fullmatch(rev):
        raise ValueError("the settings carry no rev")
    out = {"rev": rev, "windows": None, "env": {}}
    if cfg.get("windows") is not None:
        wpi().parse_rules(cfg["windows"])
        out["windows"] = cfg["windows"]
    env = cfg.get("env") or {}
    if not isinstance(env, dict):
        raise ValueError("env is not a list of settings")
    ignored = []
    for k, v in env.items():
        if k in SETTINGS:
            out["env"][k] = normal(k, v)
        else:
            ignored.append(k if isinstance(k, str) and KEY.fullmatch(k) else "?")
    check_guard(out["env"])
    return out, sorted(set(ignored))


# --- putting them in place ---

def stopping() -> bool:
    return sh(["systemctl", "is-system-running"], 10).stdout.strip() == "stopping"


def reschedule() -> str:
    """New windows move this window's end and the next start now: life-schedule again writes the day's schedule and
    hands it to the Witty Pi, and life-window arm powers off a node whose window the change ended. In a unit of its own,
    as life-window apply does it for the night window: life-push gives each apply a minute, and the Witty Pi's script
    must not be cut off half way."""
    mode = parse_env(env_text()).get("SCHEDULE", "season") or "season"
    if mode != "season":
        return f"SCHEDULE={mode}: no windows to follow"
    r = sh(["systemd-run", "--unit=life-schedule-again", "--collect", SCHEDULE_CMD, "again"], 30)
    if r.returncode != 0:
        return "could not write the schedule again now; the next boot follows the new windows"
    return "writing the schedule again with the new windows"


def guard_now() -> str:
    if not Path(WITTYPI_BIN).exists():
        return "no life-wittypi here: the battery guard follows at the next boot"
    r = sh([WITTYPI_BIN])
    lines = [ln for ln in (r.stdout + r.stderr).splitlines() if ln.strip()]
    return lines[-1] if lines else "life-wittypi ran"


def effects(old: dict | None, new: dict | None) -> None:
    old, new = old or {}, new or {}
    if stopping():
        say("the node is shutting down: the new settings count from its next wake")
        return
    try:
        built_in = wpi().METHOD
    except Exception:  # noqa: BLE001 - no schedule program to compare with: any windows count as a change
        built_in = None
    if (old.get("windows") or built_in) != (new.get("windows") or built_in):   # none sent is the built-in ones
        say(reschedule())
    oe, ne = old.get("env") or {}, new.get("env") or {}
    if any(oe.get(k) != ne.get(k) for k in GUARD):
        say(guard_now())


def apply(answer) -> int:
    if not isinstance(answer, dict):
        return 0
    with locked():
        st = load()
        dirty = False
        t = st.get("trial")
        # a post made under settings on trial has been answered: they are good
        if t and (t.get("bootId") != boot_id() or now() - float(t.get("epoch") or 0) > 60):
            st["trial"] = None
            dirty = True
            say(f"settings {(st.get('current') or {}).get('rev')} confirmed: the oracle answered a post made under them")
        # the settings the heartbeat carried have arrived
        try:
            write(SENT, PENDING.read_text())
            PENDING.unlink()
        except OSError:
            pass
        cfg = answer.get("config")
        cur = st.get("current") or {}
        if isinstance(cfg, dict) and cfg.get("rev") != cur.get("rev"):
            rev = cfg.get("rev")
            if (st.get("refused") or {}).get("rev") == rev:
                say(f"settings {rev} were refused before ({st['refused'].get('why')}); waiting for others")
            else:
                try:
                    new, ignored = take(cfg)
                except Exception as e:  # noqa: BLE001 - whatever stops the check, the settings are not taken
                    st["refused"] = {"rev": str(rev)[:64], "why": str(e)[:200], "at": iso()}
                    save(st)
                    say(f"settings {rev} refused: {e}")
                    return 0
                if cur and not st.get("trial"):
                    st["previous"] = cur              # the last good ones; settings still on trial never become that
                st["current"] = {**new, "at": iso()}
                st["trial"] = {"since": iso(), "epoch": now(), "bootId": boot_id(), "counted": boot_id(), "boots": 0}
                st["refused"] = None
                st["ignored"] = ignored
                save(st)
                sync_block(new["env"])
                say(f"settings {rev} from the oracle: windows {'from the oracle' if new['windows'] is not None else 'built in'}, "
                    + (", ".join(f"{k}={v}" for k, v in sorted(new["env"].items())) or "no settings of its own")
                    + (f"; left out: {', '.join(ignored)}" if ignored else "")
                    + f"; on trial for {TRIAL_WAKES} wakes")
                effects(cur, new)
                return 0
        if dirty:
            save(st)
    return 0


def boot() -> int:
    with locked():
        st = load()
        cur = st.get("current") or {}
        if sync_block(cur.get("env") or {}):   # a power cut between the two writes: the state decides
            say("the env file's block brought in step with the settings")
        t = st.get("trial")
        # life-schedule retries every five minutes, so one boot counts once; the boot they came in never does
        if not t or t.get("counted", t.get("bootId")) == boot_id():
            return 0
        t["boots"] = int(t.get("boots") or 0) + 1
        t["counted"] = boot_id()
        if t["boots"] <= TRIAL_WAKES:
            save(st)
            say(f"settings {cur.get('rev')} on trial: wake {t['boots']} since they came; back to the last good ones if "
                f"{TRIAL_WAKES} wakes go by without an answer from the oracle")
            return 0
        prev = st.get("previous")
        st["refused"] = {"rev": cur.get("rev"), "why": f"no answer from the oracle in {TRIAL_WAKES} wakes after they came; back to the last good settings", "at": iso()}
        st["current"], st["previous"], st["trial"], st["ignored"] = prev, None, None, []
        save(st)
        sync_block((prev or {}).get("env") or {})
        say(f"settings {cur.get('rev')}: {TRIAL_WAKES} wakes without an answer from the oracle; back to "
            + (f"settings {prev.get('rev')}" if prev else "the node's own settings and the built-in windows"))
        if any(((cur.get("env") or {}).get(k)) != (((prev or {}).get("env") or {}).get(k)) for k in GUARD):
            say(guard_now())
    return 0


def running() -> dict:
    """The settings the node runs now, its own and the oracle's together, for the keys the oracle may set."""
    env = parse_env(env_text())
    return {k: env[k] for k in SETTINGS if k in env}


def report() -> dict:
    st = load()
    cur = st.get("current") or {}
    out = {"cfgRev": cur.get("rev") or ""}
    if st.get("trial"):
        out["cfgTrial"] = True
    if st.get("refused"):
        out["cfgRefused"] = str(st["refused"].get("rev") or "")
        out["cfgWhy"] = str(st["refused"].get("why") or "")[:200]
    if st.get("ignored"):
        out["cfgIgnored"] = ",".join(st["ignored"])[:200]
    now_set = running()
    h = hashlib.sha256(json.dumps(now_set, sort_keys=True).encode()).hexdigest()[:12]
    try:
        sent = SENT.read_text().strip()
    except OSError:
        sent = ""
    if h != sent:
        out["settings"] = now_set
        try:
            write(PENDING, h)
        except OSError:
            pass
    return out


def status(as_json: bool) -> int:
    st = load()
    cur, prev = st.get("current") or {}, st.get("previous") or {}
    s = {"rev": cur.get("rev"), "since": cur.get("at"), "windows": "from the oracle" if cur.get("windows") is not None else "built in",
         "env": cur.get("env") or {}, "trial": st.get("trial"), "previous": prev.get("rev"), "refused": st.get("refused"),
         "ignored": st.get("ignored") or [], "running": running()}
    if as_json:
        print(json.dumps(s))
        return 0
    print(f"settings: {s['rev'] or 'none from the oracle yet'}" + (f", since {s['since']}" if s["since"] else ""))
    print(f"windows: {s['windows']}")
    for k, v in sorted(s["env"].items()):
        print(f"  {k}={v}")
    if s["trial"]:
        print(f"on trial: wake {s['trial'].get('boots', 0)} of {TRIAL_WAKES} since they came")
    if s["previous"]:
        print(f"last good before them: {s['previous']}")
    if s["refused"]:
        print(f"refused {s['refused'].get('rev')}: {s['refused'].get('why')}")
    if s["ignored"]:
        print(f"left out (unknown here): {', '.join(s['ignored'])}")
    return 0


def main() -> int:
    args = sys.argv[1:]
    cmd = args[0] if args else "status"
    if cmd == "apply":
        try:
            answer = json.load(sys.stdin)
        except ValueError:
            return 0
        return apply(answer)
    if cmd == "boot":
        return boot()
    if cmd == "report":
        print(json.dumps(report()))
        return 0
    if cmd == "status":
        return status("--json" in args)
    print("usage: life-config apply < answer | boot | report | status [--json]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
