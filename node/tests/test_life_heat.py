"""Tests for node/life-heat.py: the processor's heat over a boot, the firmware's flags, and the guard for the bat model.

    python3 -B -m unittest discover -s node/tests -v

Standard library only. The temperature is a file in millidegrees, as the kernel has it; the flags and the clock come
from the environment, as vcgencmd would give them; the call to life-mic is a small shell command writing a line.
"""
import importlib.machinery
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

NODE = Path(__file__).resolve().parents[1]


def load(env: dict):
    old = {k: os.environ.get(k) for k in env}
    os.environ.update(env)
    try:
        loader = importlib.machinery.SourceFileLoader("life_heat", str(NODE / "life-heat.py"))
        spec = importlib.util.spec_from_loader("life_heat", loader)
        mod = importlib.util.module_from_spec(spec)
        loader.exec_module(mod)
        return mod
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class Step(unittest.TestCase):
    """The state as readings come in: highest, minutes hot, the flags, and the guard's trips with its hysteresis."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.h = load({"LIFE_RUN": self.tmp.name, "LIFE_BATS_MAX_C": "78", "LIFE_HEAT_WATCH_S": "15"})
        self.st = self.h.fresh("boot-1", 0)

    def tearDown(self):
        self.tmp.cleanup()

    def feed(self, readings, thr=0x0, mhz=1800, t0=0, every=15):
        flips = []
        for i, c in enumerate(readings):
            if self.h.step(self.st, c, thr, mhz, t0 + i * every, 78.0):
                flips.append((i, self.st["guard"]["on"]))
        return flips

    def test_highest_and_minutes_hot(self):
        self.feed([60, 70, 79.5, 80.2, 81.0, 80.5, 79.9, 75])
        self.assertEqual(self.st["maxC"], 81.0)
        self.assertEqual(self.st["hotS"], 30)        # two intervals with both ends at 80 °C or more
        self.assertEqual(self.st["c"], 75)

    def test_the_guard_trips_and_waits_a_quarter_of_an_hour_before_letting_go(self):
        flips = self.feed([70, 77.9, 78.0, 79, 65, 64, 60])            # cool within a minute
        self.assertEqual(flips, [(2, True)])                           # out at 78, still out though cool
        self.assertTrue(self.st["guard"]["on"])
        # fifteen minutes on, still at 60 °C: it lets go
        self.assertTrue(self.h.step(self.st, 60, 0, 1800, 15 * 2 + 15 * 60 + 1, 78.0))
        self.assertFalse(self.st["guard"]["on"])
        self.assertEqual(self.st["guard"]["trips"], 1)

    def test_not_cool_enough_keeps_it_out(self):
        self.feed([79])
        self.assertTrue(self.st["guard"]["on"])
        self.assertFalse(self.h.step(self.st, 70.5, 0, 1800, 3600, 78.0))    # 70.5 is not 8 under 78
        self.assertTrue(self.st["guard"]["on"])
        self.assertTrue(self.h.step(self.st, 70.0, 0, 1800, 3615, 78.0))
        self.assertFalse(self.st["guard"]["on"])

    def test_the_flags(self):
        self.feed([60], thr=0x0)
        self.assertEqual((self.st["thr"], self.st["thrEver"], self.st["uvEver"]), ("0x0", False, False))
        self.feed([61], thr=0x80000)                                     # the soft limit was reached since boot
        self.assertEqual((self.st["thrEver"], self.st["uvEver"]), (True, False))
        self.feed([62], thr=0x10000)                                     # flags now say only the supply dipped
        self.assertEqual((self.st["thrEver"], self.st["uvEver"]), (True, True))   # what was seen stays seen

    def test_the_lowest_clock(self):
        for c, mhz in ((70, 1800), (81, 1000), (79, 1500)):
            self.h.step(self.st, c, 0, mhz, 0, 78.0)
        self.assertEqual((self.st["mhz"], self.st["minMhz"]), (1500, 1000))

    def test_a_gap_counts_for_little(self):
        self.h.step(self.st, 81, 0, 1800, 0, 90.0)
        self.h.step(self.st, 82, 0, 1800, 3600, 90.0)    # an hour later (a pause, the node asleep): one gap, not an hour
        self.assertEqual(self.st["hotS"], 30)

    def test_the_trip_point_stays_within_bounds(self):
        for v, want in (("60", 70.0), ("95", 84.0), ("80", 80.0), ("x", 78.0)):
            self.assertEqual(load({"LIFE_BATS_MAX_C": v}).max_c(), want)


class Once(unittest.TestCase):
    """One reading end to end: the file on /run, and life-mic asked when the guard flips."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.temp = self.root / "temp"
        self.calls = self.root / "calls"

    def tearDown(self):
        self.tmp.cleanup()

    def run_once(self, milli: int, now: int, thr="0x0"):
        self.temp.write_text(f"{milli}\n")
        h = load({"LIFE_RUN": str(self.root / "run"), "LIFE_HEAT_TEMP": str(self.temp), "LIFE_HEAT_THROTTLED": thr,
                  "LIFE_HEAT_MHZ": "1800", "LIFE_HEAT_NOW": str(now), "LIFE_BATS_MAX_C": "78",
                  "LIFE_HEAT_SYNC_CMD": f"sh -c 'echo sync >> {self.calls}'"})
        h.boot_id = lambda: "boot-1"
        st = h.load("boot-1", now)
        h.once(st)
        return json.loads((self.root / "run" / "heat.json").read_text())

    def test_a_trip_asks_life_mic_once(self):
        st = self.run_once(70000, 1000)
        self.assertEqual((st["c"], st["guard"]["on"]), (70.0, False))
        self.assertFalse(self.calls.exists())
        st = self.run_once(78500, 1015, thr="0x80008")
        self.assertEqual((st["c"], st["guard"]["on"], st["thr"], st["thrEver"]), (78.5, True, "0x80008", True))
        self.assertEqual(self.calls.read_text().split(), ["sync"])
        st = self.run_once(79000, 1030)
        self.assertEqual(self.calls.read_text().split(), ["sync"])   # no second call while it stays out
        self.assertEqual(st["n"], 3)

    def test_a_new_boot_starts_afresh(self):
        self.run_once(81000, 1000)
        run = self.root / "run" / "heat.json"
        st = json.loads(run.read_text())
        st["boot"] = "boot-0"
        run.write_text(json.dumps(st))
        st = self.run_once(50000, 2000)
        self.assertEqual((st["maxC"], st["n"], st["guard"]["trips"]), (50.0, 1, 0))

    def test_status_reads_it(self):
        self.run_once(65000, 1000)
        h = load({"LIFE_RUN": str(self.root / "run")})
        self.assertEqual(h.main(["status", "--json"]), 0)


if __name__ == "__main__":
    unittest.main()
