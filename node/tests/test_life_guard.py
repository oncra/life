"""Tests for node/life-guard.py and node/firmware/life-guard/flash.sh: the Pi's side of the tamper guard.

    python3 -B -m unittest discover -s node/tests -v

Standard library only. `pinctrl` is a fake on PATH that answers `get` from a file per pin and logs every `set` with a
timestamp; the watcher runs on a fake clock. flash.sh runs against fake dtoverlay, systemctl and avrdude that log what
they were asked, with a plain file standing in for the SPI device.
"""
import importlib.machinery
import importlib.util
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

NODE = Path(__file__).resolve().parents[1]

PINCTRL = """#!/usr/bin/env python3
import os, sys, time
d = os.environ["FAKE_PINS"]
a = sys.argv[1:]
if a[0] == "get":
    v = open(os.path.join(d, "pin" + a[1])).read().strip() if os.path.exists(os.path.join(d, "pin" + a[1])) else "0"
    print(f"{a[1]}: ip pn | {'hi' if v == '1' else 'lo'} // GPIO{a[1]} = input")
else:
    with open(os.path.join(d, "log"), "a") as f:
        f.write(f"{time.time()} {' '.join(a[1:])}\\n")
"""


def load(env):
    os.environ.update(env)
    loader = importlib.machinery.SourceFileLoader("life_guard", str(NODE / "life-guard.py"))
    spec = importlib.util.spec_from_loader("life_guard", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


class FakeTime:
    """time for the watcher: sleep moves the clock, nothing waits."""

    def __init__(self):
        self.t = 1000.0

    def sleep(self, s):
        self.t += s

    def monotonic(self):
        return self.t

    def time(self):
        return self.t


class GuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        bin_ = self.dir / "bin"
        bin_.mkdir()
        (bin_ / "pinctrl").write_text(PINCTRL)
        (bin_ / "pinctrl").chmod(0o755)
        self.old_path = os.environ["PATH"]
        os.environ["PATH"] = f"{bin_}:{self.old_path}"
        self.mod = load({"GUARD": "1", "FAKE_PINS": str(self.dir), "GUARD_LOCK": str(self.dir / "lock"), "LIFE_STATE": str(self.dir / "state")})

    def tearDown(self):
        os.environ["PATH"] = self.old_path
        for k in ("GUARD", "FAKE_PINS", "GUARD_LOCK", "LIFE_STATE"):
            os.environ.pop(k, None)
        self.tmp.cleanup()

    def pulses(self):
        """(start, end) of each DISARM pulse, from the fake pinctrl's log."""
        out, start = [], None
        for line in (self.dir / "log").read_text().splitlines():
            t, rest = line.split(" ", 1)
            if rest.endswith("op dh"):
                start = float(t)
            elif rest.endswith("dl") and start is not None:
                out.append((start, float(t)))
                start = None
        return out

    def test_two_pulses_never_run_together(self):
        # the second caller waits until GAP_S after the first pulse ended, or the guard would read "arm again"
        self.mod.GAP_S = 0.4
        self.mod.pulse(0.05)
        self.mod.pulse(0.05)
        (s1, e1), (s2, e2) = self.pulses()
        self.assertGreaterEqual(s2 - e1, 0.35)

    def test_rearm_is_two_pulses_within_a_second(self):
        self.mod.pulse(0.1, times=2)
        (s1, e1), (s2, e2) = self.pulses()
        self.assertLess(s2 - e1, 0.6)  # the guard waits a second after a pulse for its pair

    def test_watch_checks_when_the_alarm_rises_and_again_while_it_stands(self):
        clock = FakeTime()
        self.mod.time = clock
        line = iter([False, False, True, True, True, True, False, False])  # start, then 7 reads 2 s apart
        self.mod.pin_read = lambda n: next(line)
        checks = []
        self.mod.check = lambda: checks.append(clock.t)
        self.mod.watch(every=2, recheck=4, recheck_for=60, rounds=7)
        # rises at the 2nd read (t=1004), checked; standing at t=1008 is 4 s later, checked again; then it falls
        self.assertEqual(checks, [1004.0, 1008.0])

    def test_watch_stops_asking_after_recheck_for(self):
        clock = FakeTime()
        self.mod.time = clock
        self.mod.pin_read = lambda n: True  # an alarm nobody answers, standing since the boot check
        checks = []
        self.mod.check = lambda: checks.append(clock.t)
        self.mod.watch(every=1, recheck=10, recheck_for=30, rounds=100)
        # standing at start: the boot check had it; rechecks at 10, 20, 30 s, then the push carries it
        self.assertEqual(checks, [1010.0, 1020.0, 1030.0])

    def test_watch_does_nothing_without_the_board(self):
        mod = load({"GUARD": "0"})
        mod.pin_read = lambda n: self.fail("read a pin with GUARD=0")
        mod.watch(rounds=3)

    def test_status_reads_loop_and_alarm(self):
        (self.dir / "pin10").write_text("1")  # ALARM
        (self.dir / "pin11").write_text("1")  # LOOP_A
        (self.dir / "pin9").write_text("0")   # LOOP_B
        self.assertEqual(self.mod.status(), {"enabled": True, "alarm": True, "loop": "lid"})


FAKES = {
    "dtoverlay": 'echo "dtoverlay $*" >> "$FAKE_LOG"',
    "systemctl": 'echo "systemctl $*" >> "$FAKE_LOG"; [ "$1" = is-active ] && echo active; exit 0',
    "avrdude": 'echo "avrdude $*" >> "$FAKE_LOG"',
}


class FlashTest(unittest.TestCase):
    def test_flash_uses_linuxspi_and_puts_everything_back(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            (d / "bin").mkdir()
            for name, body in FAKES.items():
                (d / "bin" / name).write_text(f"#!/usr/bin/env bash\n{body}\n")
                (d / "bin" / name).chmod(0o755)
            (d / "spidev").write_text("")
            (d / "g.hex").write_text(":00000001FF\n")
            env = {**os.environ, "PATH": f"{d / 'bin'}:{os.environ['PATH']}", "FAKE_LOG": str(d / "log"), "GUARD_SPIDEV": str(d / "spidev")}
            r = subprocess.run(["bash", str(NODE / "firmware/life-guard/flash.sh"), str(d / "g.hex")], env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(r.returncode, 0, r.stderr)
            log = (d / "log").read_text().splitlines()
            avr = [l for l in log if l.startswith("avrdude")][0]
            self.assertIn(f"-c linuxspi -P {d / 'spidev'}:/dev/gpiochip0 -B 10 -E noreset -p t84", avr)
            self.assertIn(f"flash:w:{d / 'g.hex'}:i", avr)
            # the watcher is held before SPI comes up, SPI goes off and the watcher comes back after
            self.assertLess(log.index("systemctl stop life-guard-watch"), log.index("dtoverlay spi0-0cs"))
            self.assertLess(log.index(avr), log.index("dtoverlay -r spi0-0cs"))
            self.assertEqual(log[-1], "systemctl start life-guard-watch")

    def test_flash_stops_when_spi_does_not_come_up(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            (d / "bin").mkdir()
            for name, body in FAKES.items():
                (d / "bin" / name).write_text(f"#!/usr/bin/env bash\n{body}\n")
                (d / "bin" / name).chmod(0o755)
            (d / "g.hex").write_text(":00000001FF\n")
            env = {**os.environ, "PATH": f"{d / 'bin'}:{os.environ['PATH']}", "FAKE_LOG": str(d / "log"), "GUARD_SPIDEV": str(d / "nothing")}
            t0 = time.time()
            r = subprocess.run(["bash", str(NODE / "firmware/life-guard/flash.sh"), str(d / "g.hex")], env=env, capture_output=True, text=True, timeout=30)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("SPI0 did not come up", r.stderr)
            log = (d / "log").read_text()
            self.assertNotIn("avrdude", log)
            self.assertIn("dtoverlay -r spi0-0cs", log)
            self.assertLess(time.time() - t0, 15)


if __name__ == "__main__":
    unittest.main()
