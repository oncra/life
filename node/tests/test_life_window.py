"""Tests for node/image/life-window.py: what a boot outside the listening windows is for, and the visit a button
press (or the visit contact's magnet) starts.

    python3 -B -m unittest discover -s node/tests -v

Standard library only. The day's windows are given (life-schedule-wpi needs astral); systemctl, systemd-run,
life-guard and GNU date are fakes on PATH that write down what they were asked.
"""
import importlib.machinery
import importlib.util
import json
import os
import random
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

NODE = Path(__file__).resolve().parents[1]
NEXT = "2026-11-03T06:12:00+00:00"
OUTSIDE = {"date": "2026-11-02", "active": None, "next": NEXT}
INSIDE = {"date": "2026-11-02", "active": {"name": "dawn", "start": "2026-11-02T06:10:00+00:00", "end": "2026-11-02T08:10:00+00:00"}, "next": NEXT}

FAKE = r'''#!{py}
import os, sys
name = os.path.basename(sys.argv[0])
with open(os.path.join(os.environ["FAKE_LOG"], name + ".log"), "a") as f:
    f.write(" ".join(sys.argv[1:]) + "\n")
if name == "life-guard":
    print(open(os.path.join(os.environ["FAKE_LOG"], "guard")).read() if os.path.exists(os.path.join(os.environ["FAKE_LOG"], "guard")) else '{{"enabled": true, "alarm": false}}')
if name == "date":
    print("03 06 12 00")
'''


class Window(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.state = self.dir / "state"
        self.state.mkdir()
        bin_ = self.dir / "bin"
        bin_.mkdir()
        for name in ("systemctl", "systemd-run", "life-guard", "date"):
            (bin_ / name).write_text(FAKE.format(py=sys.executable))
            (bin_ / name).chmod(0o755)
        self.old = dict(os.environ)
        os.environ.update({"PATH": f"{bin_}:{os.environ['PATH']}", "FAKE_LOG": str(self.dir), "LIFE_STATE": str(self.state),
                           "SCHEDULE": "season", "WITTYPI_BUS": "", "LIFE_VISIT": "1", "GUARD": "0"})
        os.environ.pop("VISIT_MAX_MIN", None)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.old)
        self._tmp.cleanup()

    def window(self, info=OUTSIDE, **env):
        os.environ.update(env)
        loader = importlib.machinery.SourceFileLoader(f"life_window_{random.random()}", str(NODE / "image" / "life-window.py"))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        mod = importlib.util.module_from_spec(spec)
        loader.exec_module(mod)
        mod.windows = lambda now_arg: info
        return mod

    def log(self, name: str) -> list[str]:
        p = self.dir / f"{name}.log"
        return p.read_text().splitlines() if p.exists() else []

    def decision(self) -> dict:
        return json.loads((self.state / "window.json").read_text())

    def maintenance(self, start: timedelta, end: timedelta):
        now = datetime.now(timezone.utc)
        (self.state / "maintenance.json").write_text(json.dumps({"from": (now + start).isoformat().replace("+00:00", "Z"),
                                                                 "until": (now + end).isoformat().replace("+00:00", "Z"), "active": True}))

    def visit_started(self) -> bool:
        return "start --no-block life-visit@boot.service" in self.log("systemctl")

    def test_a_button_press_is_a_visit_and_then_sleep(self):
        self.window().check(["--wake", "button"])
        d = self.decision()
        self.assertEqual((d["offWindow"], d["stopInS"], d["next"]), ("visit", 2400, NEXT))
        self.assertEqual(self.log("systemd-run"), ["--unit=life-window-stop --on-active=2400s /usr/local/sbin/life-window stop --unless-maintenance"])
        self.assertIn("stop life-window-stop.timer", self.log("systemctl"))
        self.assertTrue(self.visit_started())

    def test_the_backstop_follows_the_visit_length(self):
        self.window(VISIT_MAX_MIN="10").check(["--wake", "button"])
        self.assertEqual(self.decision()["stopInS"], 1200)

    def test_a_maintenance_window_keeps_the_node_on_after_the_visit(self):
        self.maintenance(timedelta(hours=-1), timedelta(hours=3))
        self.window().check(["--wake", "button"])
        self.assertEqual(self.decision()["offWindow"], "kept")
        self.assertEqual(self.log("systemd-run"), [])
        self.assertTrue(self.visit_started())

    def test_a_maintenance_window_over_or_to_come_does_not(self):
        for start, end in ((timedelta(hours=-5), timedelta(hours=-1)), (timedelta(hours=2), timedelta(hours=6))):
            self.maintenance(start, end)
            self.window().check(["--wake", "button"])
            self.assertEqual(self.decision()["offWindow"], "visit")

    def test_a_guard_in_alarm_is_no_visit(self):
        (self.dir / "guard").write_text('{"enabled": true, "alarm": true, "loop": "lid"}')
        self.window(GUARD="1").check(["--wake", "button"])
        self.assertEqual(self.decision()["offWindow"], "kept")      # as before visits: somebody, or something, is at the node
        self.assertFalse(self.visit_started())

    def test_a_quiet_guard_is_a_visit(self):
        self.window(GUARD="1").check(["--wake", "button"])
        self.assertEqual(self.decision()["offWindow"], "visit")
        self.assertEqual(self.log("life-guard"), ["status"])

    def test_visits_off_keeps_the_old_way(self):
        self.window(LIFE_VISIT="0").check(["--wake", "button"])
        self.assertEqual(self.decision()["offWindow"], "kept")
        self.assertFalse(self.visit_started())
        self.assertEqual(self.log("systemd-run"), [])

    def test_a_reboot_is_no_visit(self):
        self.window().check(["--wake", "reboot"])
        self.assertEqual(self.decision()["offWindow"], "kept")
        self.assertFalse(self.visit_started())

    def test_a_battery_back_wake_still_goes_back_to_sleep(self):
        self.window().check(["--wake", "voltage-restored"])
        self.assertEqual(self.decision()["offWindow"], "stop")
        self.assertEqual(len(self.log("systemd-run")), 1)
        self.assertTrue(self.log("systemd-run")[0].endswith("/usr/local/sbin/life-window stop"))   # no maintenance exception
        self.assertFalse(self.visit_started())

    def test_inside_a_window_nothing_to_decide(self):
        self.window(INSIDE).check(["--wake", "alarm"])
        self.assertEqual(self.decision()["window"], "dawn")
        self.assertNotIn("visit", self.decision())
        self.assertFalse(self.visit_started())

    def test_a_magnet_inside_a_window_is_a_visit_the_window_ends(self):
        self.window(INSIDE).check(["--wake", "button"])
        d = self.decision()
        self.assertEqual((d["window"], d["visit"]), ("dawn", True))
        self.assertTrue(self.visit_started())
        self.assertEqual(self.log("systemd-run"), [])      # the window's end, not a backstop, switches it off

    def test_inside_a_window_without_visits_the_button_is_only_the_button(self):
        self.window(INSIDE, LIFE_VISIT="0").check(["--wake", "button"])
        self.assertNotIn("visit", self.decision())
        self.assertFalse(self.visit_started())

    def test_without_a_schedule_a_magnet_is_a_visit_that_leaves_the_node_on(self):
        self.window(SCHEDULE="bench").check(["--wake", "button"])
        self.assertEqual(self.decision(), {"schedule": "bench", "window": None, "decidedAt": self.decision()["decidedAt"]})
        self.assertIn("start --no-block life-visit@magnet.service", self.log("systemctl"))   # no power-off after it
        self.assertFalse(self.visit_started())
        self.window(SCHEDULE="none", LIFE_VISIT="0").check(["--wake", "button"])
        self.assertEqual(self.log("systemctl").count("start --no-block life-visit@magnet.service"), 1)

    def test_no_witty_pi_no_visit(self):
        self.window().check([])                             # WITTYPI_BUS empty: no wake reason to read
        self.assertEqual(self.decision()["offWindow"], "kept")
        self.assertFalse(self.visit_started())

    def test_a_dry_run_only_says(self):
        self.window().check(["--wake", "button", "--dry-run"])
        self.assertFalse((self.state / "window.json").exists())
        self.assertEqual(self.log("systemctl"), [])

    def test_stop_keeps_a_node_on_in_a_maintenance_window_only_when_asked(self):
        self.maintenance(timedelta(hours=-1), timedelta(hours=3))
        self.window().stop(["--unless-maintenance"])
        self.assertNotIn("poweroff", self.log("systemctl"))
        self.window().stop([])
        self.assertIn("poweroff", self.log("systemctl"))

    def test_stop_without_a_maintenance_window_powers_off(self):
        self.window().stop(["--unless-maintenance"])
        self.assertIn("poweroff", self.log("systemctl"))

    def test_stop_in_a_window_stays_on(self):
        self.window(INSIDE).stop(["--unless-maintenance"])
        self.assertNotIn("poweroff", self.log("systemctl"))

    def test_a_maintenance_file_that_makes_no_sense_is_no_window(self):
        for text in ("", "[]", "{}", '{"until": "tomorrow"}', '{"until": 5}'):
            (self.state / "maintenance.json").write_text(text)
            self.assertFalse(self.window().maintenance(), text)


if __name__ == "__main__":
    unittest.main()
