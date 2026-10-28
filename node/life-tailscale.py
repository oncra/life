#!/usr/bin/env python3
"""life-tailscale: reach a node on the bench from anywhere, over Tailscale, and never over the SIM.

On its own network a node answers SSH; from anywhere else nobody can reach it. With LIFE_TAILSCALE=1 it also joins its
steward's tailnet, so a laptop or a server elsewhere reaches it while it is on. Tailscale runs in userspace networking:
no routes, no firewall rules and no DNS change on the node, and an SSH connection that comes in over the tailnet goes to
the node's own sshd on localhost. The SIM never carries it. tailscaled runs only while the node's way out to the
internet is the cable or the WiFi, and stops the moment that way out is anything else, the 4G stick above all: an idle
Tailscale keeps a connection to its coordination server and to a relay open all day, traffic a 500 MB ten-year SIM has
no room for. Its log upload to Tailscale is off. The binaries and the node's identity live in /data/tailscale and
survive the read-only root and a new image. node/apply-tailscale.sh puts it on a node; LIFE_TAILSCALE=0 (apply-tailscale.sh
off) before the node goes to a field.

    life-tailscale run       the service's job: tailscaled while the way out is cable or WiFi, nothing otherwise
    life-tailscale status    the way out, whether Tailscale may use it, and Tailscale's own status

env: LIFE_TAILSCALE (1 = on), LIFE_TAILSCALE_DIR (default /data/tailscale), LIFE_TAILSCALE_RECHECK_S (default 30)
"""
from __future__ import annotations

import os
import select
import signal
import subprocess
import sys
import time

DIR = os.environ.get("LIFE_TAILSCALE_DIR") or "/data/tailscale"
ENV_FILE = "/data/life-node/env"
SOCKET = "/run/tailscale/tailscaled.sock"
WAYS = {"eth0", "wlan0"}   # the Pi's own cable port and its WiFi; the 4G stick (usb0, eth1, wwan0, ...) is never one
PROBES = (("-4", "1.1.1.1"), ("-6", "2606:4700:4700::1111"))   # any public address: the route traffic out would take
RECHECK_S = float(os.environ.get("LIFE_TAILSCALE_RECHECK_S") or 30)   # a route change wakes it at once; this is the net
RETRY_S = 10   # after tailscaled exits by itself, so a failing one does not spin


def log(msg: str) -> None:
    print(msg, flush=True)


def enabled() -> bool:
    """LIFE_TAILSCALE from the environment (the service), else from the node's env file (a person running status)."""
    v = os.environ.get("LIFE_TAILSCALE")
    if v is None:
        try:
            with open(ENV_FILE) as f:
                v = next((ln.split("=", 1)[1].split("#")[0].strip() for ln in f if ln.startswith("LIFE_TAILSCALE=")), None)
        except OSError:
            v = None
    return v == "1"


def device(route: str) -> str | None:
    """The interface in `ip route get`: '1.1.1.1 via 192.168.2.254 dev wlan0 src ...' -> 'wlan0'; None without a route."""
    words = route.split()
    if not words or words[0] in ("unreachable", "prohibit", "blackhole", "throw"):
        return None
    return words[words.index("dev") + 1] if "dev" in words[:-1] else None


def ways_out() -> dict[str, str | None]:
    """Per address family, the interface the node's internet traffic leaves by now."""
    out = {}
    for fam, addr in PROBES:
        r = subprocess.run(["ip", fam, "route", "get", addr], capture_output=True, text=True)
        out[fam] = device(r.stdout) if r.returncode == 0 else None
    return out


def may_run(ways: dict[str, str | None]) -> bool:
    """Cable or WiFi for IPv4, and for IPv6 the same or none: any other way out may be the SIM."""
    v4, v6 = ways.get("-4"), ways.get("-6")
    return v4 in WAYS and (v6 is None or v6 in WAYS)


def describe(ways: dict[str, str | None]) -> str:
    return (ways.get("-4") or "none") + (f", IPv6 {ways['-6']}" if ways.get("-6") else "")


def run() -> int:
    if not enabled():
        log("LIFE_TAILSCALE is not 1: Tailscale stays off")
        return 0
    os.makedirs(os.path.join(DIR, "state"), mode=0o700, exist_ok=True)
    cmd = [os.path.join(DIR, "tailscaled"), "--tun=userspace-networking", f"--statedir={DIR}/state",
           f"--socket={SOCKET}", "--port=41641", "--no-logs-no-support"]
    procs: dict[str, subprocess.Popen | None] = {"daemon": None, "monitor": None}
    retry_at = 0.0
    said = None

    def stop(name: str) -> None:
        p = procs[name]
        if p is not None and p.poll() is None:
            p.terminate()
            try:
                p.wait(15)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()
        procs[name] = None

    def quit_(*_) -> None:
        stop("daemon")
        stop("monitor")
        sys.exit(0)

    signal.signal(signal.SIGTERM, quit_)
    signal.signal(signal.SIGINT, quit_)
    while True:
        mon = procs["monitor"]
        if mon is None or mon.poll() is not None:
            mon = procs["monitor"] = subprocess.Popen(["ip", "monitor", "route"], stdout=subprocess.PIPE,
                                                      stderr=subprocess.DEVNULL)
        ways = ways_out()
        daemon = procs["daemon"]
        if daemon is not None and daemon.poll() is not None:
            log(f"tailscaled exited ({daemon.returncode})")
            procs["daemon"] = daemon = None
            retry_at = time.monotonic() + RETRY_S
        if may_run(ways):
            if daemon is None and time.monotonic() >= retry_at:
                procs["daemon"] = subprocess.Popen(cmd)
                log(f"way out {describe(ways)}: tailscaled started")
                said = None
        elif daemon is not None:
            stop("daemon")
            log(f"way out {describe(ways)}: tailscaled stopped, the SIM does not carry it")
            said = describe(ways)
        elif said != describe(ways):
            said = describe(ways)
            log(f"way out {said}: Tailscale waits for the cable or the WiFi")
        ready, _, _ = select.select([mon.stdout], [], [], RECHECK_S)
        if ready and not os.read(mon.stdout.fileno(), 65536):
            mon.wait()   # the monitor ended; the next round starts a new one


def status() -> int:
    ways = ways_out()
    print(f"LIFE_TAILSCALE: {'on' if enabled() else 'off'}")
    print(f"way out: IPv4 {ways['-4'] or 'none'}, IPv6 {ways['-6'] or 'none'}")
    print("Tailscale may use it: " + ("yes" if may_run(ways) else "no"))
    ts = os.path.join(DIR, "tailscale")
    if os.path.exists(ts):
        r = subprocess.run([ts, f"--socket={SOCKET}", "status"], capture_output=True, text=True)
        print((r.stdout or r.stderr).strip())
    else:
        print(f"no Tailscale in {DIR}: node/apply-tailscale.sh puts it there")
    return 0


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "run":
        sys.exit(run())
    if cmd == "status":
        sys.exit(status())
    sys.exit("usage: life-tailscale run | status")


if __name__ == "__main__":
    main()
