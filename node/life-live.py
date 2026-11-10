#!/usr/bin/env python3
"""Life node, live: while the node reaches the internet over WiFi or a cable, how it is doing every 20 seconds, for the
status panel on its dashboard (POST /api/v1/ingest/live). Never over the 4G stick: there the heartbeat every three
hours is all the SIM pays for.

The way out is life-clips' own (`way_out`): the kernel's route to the internet, IPv4 and IPv6, has to leave by the Pi's
cable port (eth0) or its WiFi (wlan0), and every post goes on a connection bound to that interface (SO_BINDTODEVICE),
so when the WiFi drops a post fails instead of falling back to the stick. A phone's hotspot at a visit is a way out;
the node's own WiFi for a laptop is not (it has no gateway), so it posts nothing then.

What it sends is the heartbeat's own reading: life-heartbeat's `metrics()`, and `cell()` from the stick's local web
API, which costs the SIM nothing, without the cell id, the tracking area and the PCI (how well it hears the network,
not where it is); and the way out (`net`: wifi or lan, and the WiFi's signal in dBm). Never `mics()`, which marks the
microphones' check as sent, and nothing that answers back: settings and visits still come with the heartbeat.

While it is live it also runs life-push every LIFE_LIVE_PUSH_S seconds without a heartbeat, so the birds and the soil
reach the dashboard within minutes; the heartbeats keep their own rhythm (life-sound.timer). life-push takes a lock
next to its cursor, so the timer's run and this one never send the same detections twice.

    life-live            run (life-live.service)
    life-live --once     one post now if there is a way out, and say what was sent (no push)

Environment (the units' own, from /etc/life-node.env and /data/life-node/env):
    LIFE_DEVICE_TOKEN, LIFE_API   as for life-heartbeat
    LIFE_LIVE                     0 to never post live (default 1)
    LIFE_LIVE_EVERY_S             seconds between posts (default 20; the oracle's answer `every` wins, 10 at least)
    LIFE_LIVE_PUSH_S              seconds between pushes of the detections while live (default 120; 0 for none)
    LIFE_HEARTBEAT_BIN, LIFE_CLIPS_BIN, LIFE_PUSH_BIN
                                  default /usr/local/bin/life-heartbeat, life-clips and life-push
"""
import contextlib, importlib.machinery, importlib.util, io, json, os, subprocess, sys, time
from pathlib import Path


def load(name: str, path: str):
    loader = importlib.machinery.SourceFileLoader(name, path)
    spec = importlib.util.spec_from_loader(name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


HB = load("life_heartbeat", os.environ.get("LIFE_HEARTBEAT_BIN", "/usr/local/bin/life-heartbeat"))
CLIPS = load("life_clips", os.environ.get("LIFE_CLIPS_BIN", "/usr/local/bin/life-clips"))
PUSH = os.environ.get("LIFE_PUSH_BIN", "/usr/local/bin/life-push")
TOKEN = os.environ.get("LIFE_DEVICE_TOKEN", "").strip()
VIA = {"wlan0": "wifi", "eth0": "lan"}            # life-clips' WAYS: the Pi's own WiFi and cable port
KEEP = ("plmn", "rsrp", "rssi", "sinr", "band", "mode")
WIRELESS = Path("/proc/net/wireless")


def wifi_dbm(dev: str, text: str | None = None) -> float | None:
    """The WiFi's signal level in dBm, from /proc/net/wireless ('wlan0: 0000   54.  -56.  -256 ...'); None without."""
    if text is None:
        try:
            text = WIRELESS.read_text()
        except OSError:
            return None
    for line in text.splitlines():
        parts = line.split()
        if parts and parts[0] == dev + ":":
            try:
                v = float(parts[3].rstrip("."))
            except (IndexError, ValueError):
                return None
            return v if -120 <= v < 0 else None
    return None


def reading(dev: str) -> tuple[dict, str]:
    """What one live post carries, and what the readers said on stderr (no modem, no VE.Direct block, ...)."""
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        body: dict = {"net": {"via": VIA[dev]}, "metrics": HB.metrics()}
        c = HB.cell()
    if dev == "wlan0":
        d = wifi_dbm(dev)
        if d is not None:
            body["net"]["dBm"] = d
    if c:
        body["cell"] = {k: v for k, v in c.items() if k in KEEP}
    return body, err.getvalue().strip()


def push() -> str:
    """The detections and the soil queue now, without a heartbeat: the heartbeats keep their own rhythm. What it said."""
    env = {k: v for k, v in os.environ.items() if k not in ("LIFE_HEARTBEAT_CMD", "LIFE_HEARTBEAT_APPLY_CMD", "LIFE_HEARTBEAT_EVENT")}
    try:
        r = subprocess.run([PUSH], env=env, capture_output=True, text=True, timeout=180)
    except (OSError, subprocess.TimeoutExpired) as e:
        return f"push: {e}"
    out = " ".join(l for l in r.stdout.splitlines() if l.strip() and l.strip() != "nothing new")
    return out if r.returncode == 0 else f"push failed ({r.returncode}): {(r.stderr or r.stdout).strip()[-300:]}"


class Live:
    """One loop of posts; `tick` does one round and says how long to wait for the next."""

    def __init__(self, every: int, push_every: int):
        self.every, self.push_every = every, push_every
        self.oracle, self.said, self.noise, self.last_push = None, None, None, 0.0

    def say(self, what: str, err: bool = False):
        if what and what != self.said:
            print(what, file=sys.stderr if err else sys.stdout, flush=True)
            self.said = what

    def close(self):
        if self.oracle is not None:
            self.oracle.close()
            self.oracle = None

    def tick(self) -> float:
        dev = CLIPS.way_out()
        if dev not in VIA:   # the 4G stick, or no way out at all: nothing goes out from here
            self.close()
            self.say("no WiFi or cable to the internet: not posting live")
            return self.every
        if self.oracle is None or self.oracle.dev != dev:
            self.close()
            self.oracle = CLIPS.Oracle(dev)
        body, noise = reading(dev)
        if noise and noise != self.noise:   # once per change, not every twenty seconds
            print(noise, file=sys.stderr, flush=True)
        self.noise = noise
        status, answer = self.oracle.post("/ingest/live", json.dumps({"live": body}).encode(), "application/json", f"Bearer {TOKEN}")
        if status != 201:
            self.close()
            self.say(f"live post over {dev}: {status} {str(answer)[:200]}", err=True)
            return 60   # an oracle without /ingest/live, or none at all: try again in a minute
        try:
            self.every = max(10, int(answer.get("every") or self.every))
        except (TypeError, ValueError):
            pass
        self.say(f"posting live over {dev} every {self.every} s")
        if self.push_every and time.monotonic() - self.last_push >= self.push_every and CLIPS.way_out() == dev:
            self.last_push = time.monotonic()
            said = push()
            if said:
                print(said, flush=True)
        return self.every


def main():
    args = sys.argv[1:]
    if os.environ.get("LIFE_LIVE", "1").strip() == "0":
        print("LIFE_LIVE=0: not posting live")
        return
    if not TOKEN:
        sys.exit("LIFE_DEVICE_TOKEN not set")
    try:
        every = max(10, int(os.environ.get("LIFE_LIVE_EVERY_S") or 20))
        push_every = max(0, int(os.environ.get("LIFE_LIVE_PUSH_S") or 120))
    except ValueError:
        sys.exit("LIFE_LIVE_EVERY_S and LIFE_LIVE_PUSH_S are whole seconds")
    if "--once" in args:
        dev = CLIPS.way_out()
        if dev not in VIA:
            print("no WiFi or cable to the internet: nothing sent")
            return
        body, noise = reading(dev)
        status, answer = CLIPS.Oracle(dev).post("/ingest/live", json.dumps({"live": body}).encode(), "application/json", f"Bearer {TOKEN}")
        print(json.dumps({"sent": body, "status": status, "answer": answer}, indent=1))
        if noise:
            print(noise, file=sys.stderr)
        sys.exit(0 if status == 201 else 1)
    live = Live(every, push_every)
    while True:
        t0 = time.monotonic()
        try:
            wait = live.tick()
        except Exception as e:  # noqa: BLE001 - a reader that throws must not end the loop
            live.close()
            live.say(f"live: {e}", err=True)
            wait = 60
        time.sleep(max(1.0, wait - (time.monotonic() - t0)))


if __name__ == "__main__":
    main()
