"""Tests for node/life-tailscale.py: tailscaled runs while the way out is the cable or the WiFi, and never over the SIM.

    python3 -B -m unittest discover -s node/tests -v

Standard library only. `ip` is a fake on PATH that answers `route get` from a file the test rewrites (the way out) and
whose `monitor` only waits, so the service sees a change at its recheck; tailscaled is a fake that keeps a pid file while
it runs and removes it when it is stopped.
"""
import importlib.machinery
import importlib.util
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

NODE = Path(__file__).resolve().parents[1]


def load():
    loader = importlib.machinery.SourceFileLoader("life_tailscale", str(NODE / "life-tailscale.py"))
    spec = importlib.util.spec_from_loader("life_tailscale", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


lt = load()

FAKE_IP = """#!/bin/sh
case "$*" in
  monitor*) exec sleep 600 ;;
  "-4 route get"*) dev=$(cat "$WAY4") ;;
  "-6 route get"*) dev=$(cat "$WAY6" 2>/dev/null) ;;
  *) exit 1 ;;
esac
[ -n "$dev" ] || { echo "RTNETLINK answers: Network is unreachable" >&2; exit 2; }
echo "$4 via 10.0.0.1 dev $dev src 10.0.0.2 uid 0"
echo "    cache"
"""

FAKE_TAILSCALED = """#!/bin/sh
echo "$@" > "$PIDFILE.args"
echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE"; exit 0' TERM
while :; do sleep 0.05; done
"""


def wait_for(cond, seconds=5.0) -> bool:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.05)
    return cond()


class Device(unittest.TestCase):
    def test_reads_the_interface(self):
        self.assertEqual(lt.device("1.1.1.1 via 192.168.2.254 dev wlan0 src 192.168.2.114 uid 0\n    cache\n"), "wlan0")
        self.assertEqual(lt.device("1.1.1.1 via 192.168.8.1 dev usb0 src 192.168.8.100 uid 0\n    cache\n"), "usb0")

    def test_no_route(self):
        self.assertIsNone(lt.device(""))
        self.assertIsNone(lt.device("unreachable 2606:4700:4700::1111 from :: dev lo proto kernel src ::1 metric 4294967295"))


class MayRun(unittest.TestCase):
    def test_cable_and_wifi(self):
        self.assertTrue(lt.may_run({"-4": "wlan0", "-6": None}))
        self.assertTrue(lt.may_run({"-4": "eth0", "-6": "eth0"}))

    def test_never_the_stick_or_nothing(self):
        for dev in ("usb0", "eth1", "wwan0", "ppp0", None):
            self.assertFalse(lt.may_run({"-4": dev, "-6": None}), dev)

    def test_not_when_ipv6_leaves_by_the_stick(self):
        self.assertFalse(lt.may_run({"-4": "wlan0", "-6": "usb0"}))


class Run(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        (d / "bin").mkdir()
        (d / "ts").mkdir()
        for path, text in ((d / "bin" / "ip", FAKE_IP), (d / "ts" / "tailscaled", FAKE_TAILSCALED)):
            path.write_text(text)
            path.chmod(0o755)
        self.way4, self.pid = d / "way4", d / "tailscaled.pid"
        self.env = {**os.environ, "PATH": f"{d / 'bin'}:{os.environ['PATH']}", "LIFE_TAILSCALE": "1",
                    "LIFE_TAILSCALE_DIR": str(d / "ts"), "LIFE_TAILSCALE_RECHECK_S": "0.2",
                    "WAY4": str(self.way4), "WAY6": str(d / "way6"), "PIDFILE": str(self.pid)}
        self.proc = None

    def tearDown(self):
        if self.proc and self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait()
        if self.proc:
            self.proc.stdout.close()
        if self.pid.exists():
            os.kill(int(self.pid.read_text()), signal.SIGKILL)
        self.tmp.cleanup()

    def start(self, **env):
        self.proc = subprocess.Popen([sys.executable, "-B", str(NODE / "life-tailscale.py"), "run"],
                                     env={**self.env, **env}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    def test_stops_the_moment_the_way_out_is_the_stick(self):
        self.way4.write_text("wlan0")
        self.start()
        self.assertTrue(wait_for(self.pid.exists), "tailscaled did not start on the WiFi")
        args = Path(f"{self.pid}.args").read_text()
        self.assertIn("--tun=userspace-networking", args)
        self.assertIn("--no-logs-no-support", args)
        self.way4.write_text("usb0")
        self.assertTrue(wait_for(lambda: not self.pid.exists()), "tailscaled kept running over the stick")
        time.sleep(1)
        self.assertFalse(self.pid.exists(), "tailscaled came back over the stick")
        self.way4.write_text("eth0")
        self.assertTrue(wait_for(self.pid.exists), "tailscaled did not come back on the cable")
        self.proc.send_signal(signal.SIGTERM)
        self.assertEqual(self.proc.wait(10), 0)
        self.assertFalse(self.pid.exists(), "tailscaled outlived the service")
        log = self.proc.stdout.read()
        self.assertIn("tailscaled stopped, the SIM does not carry it", log)

    def test_never_starts_on_the_stick_alone(self):
        self.way4.write_text("usb0")
        self.start()
        time.sleep(1.5)
        self.assertFalse(self.pid.exists())
        self.proc.send_signal(signal.SIGTERM)
        self.assertEqual(self.proc.wait(10), 0)
        self.assertIn("Tailscale waits for the cable or the WiFi", self.proc.stdout.read())

    def test_off_unless_asked(self):
        self.way4.write_text("wlan0")
        self.start(LIFE_TAILSCALE="0")
        self.assertEqual(self.proc.wait(10), 0)
        self.assertFalse(self.pid.exists())
        self.assertIn("Tailscale stays off", self.proc.stdout.read())


if __name__ == "__main__":
    unittest.main()
