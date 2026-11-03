"""Tests for node/image/life-window.py: what a boot outside the listening windows is for, the visit a button press
(or the visit contact's magnet) starts, and the owner's night window.

    python3 -B -m unittest discover -s node/tests -v

Standard library only. The day's windows are given (life-schedule-wpi needs astral); systemctl, systemd-run,
life-guard and GNU date are fakes on PATH that write down what they were asked.
"""
import importlib.machinery
import importlib.util
import io
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

# 15 May at Amsterdam with the night window on at its defaults: right after the dusk window, so one ON state with it
DAWN = {"name": "dawn", "start": "2026-05-15T03:01:30+00:00", "end": "2026-05-15T07:01:30+00:00"}
DUSK = {"name": "dusk", "start": "2026-05-15T19:28:42+00:00", "end": "2026-05-15T20:28:42+00:00"}
NIGHT_W = {"name": "night", "start": "2026-05-15T20:28:42+00:00", "end": "2026-05-15T21:28:42+00:00"}
LATE = {"name": "night", "start": "2026-05-15T21:28:42+00:00", "end": "2026-05-15T22:28:42+00:00"}   # startMin 120: apart
NIGHT_ON = {"rev": 3, "on": True, "startMin": 60, "lenMin": 60, "from": "03-25", "to": "06-30", "battery": True, "minV": 13.1}
MAY_NEXT = "2026-05-16T02:59:42+00:00"


def may(active, now, windows=(DAWN, DUSK, NIGHT_W), **night):
    return {"date": "2026-05-15", "now": now, "windows": list(windows), "active": active, "next": MAY_NEXT,
            "night": {**NIGHT_ON, **night}}


FAKE = r'''#!{py}
import os, sys
name = os.path.basename(sys.argv[0])
with open(os.path.join(os.environ["FAKE_LOG"], name + ".log"), "a") as f:
    f.write(" ".join(sys.argv[1:]) + "\n")
if name == "life-guard":
    print(open(os.path.join(os.environ["FAKE_LOG"], "guard")).read() if os.path.exists(os.path.join(os.environ["FAKE_LOG"], "guard")) else '{{"enabled": true, "alarm": false}}')
if name == "date":
    print("03 06 12 00")
if name == "systemctl" and "list-units" in sys.argv and os.path.exists(os.path.join(os.environ["FAKE_LOG"], "visits")):
    print(open(os.path.join(os.environ["FAKE_LOG"], "visits")).read())
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

    def test_the_simple_alarm_is_no_visit_and_sleeps_after_its_reports(self):
        (self.dir / "guard").write_text('{"enabled": true, "kind": "simple", "alarm": true, "loop": "unknown"}')
        self.window(GUARD="simple").check(["--wake", "button"])
        d = self.decision()
        self.assertEqual((d["offWindow"], d["stopInS"]), ("alarm", 2400))
        self.assertFalse(self.visit_started())
        self.assertTrue(self.log("systemd-run")[0].endswith("/usr/local/sbin/life-window stop --unless-maintenance"))

    def test_the_simple_alarm_in_a_maintenance_window_keeps_the_node_on(self):
        self.maintenance(timedelta(hours=-1), timedelta(hours=3))
        (self.dir / "guard").write_text('{"enabled": true, "kind": "simple", "alarm": true, "loop": "unknown"}')
        self.window(GUARD="simple").check(["--wake", "button"])
        self.assertEqual(self.decision()["offWindow"], "kept")
        self.assertEqual(self.log("systemd-run"), [])
        self.assertFalse(self.visit_started())

    def test_a_quiet_simple_alarm_leaves_the_button_a_visit(self):
        self.window(GUARD="simple").check(["--wake", "button"])
        self.assertEqual(self.decision()["offWindow"], "visit")
        self.assertTrue(self.visit_started())

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

    # the night window

    def night_last(self) -> dict:
        return json.loads((self.state / "night-last.json").read_text())

    def test_dusk_running_on_into_the_night_window_sets_the_night_timer(self):
        self.window(may(DUSK, "2026-05-15T19:30:00+00:00")).check(["--wake", "alarm"])
        self.assertEqual(self.decision()["window"], "dusk")
        # 58 min 42 s to the night window, and 30 s into it
        self.assertEqual(self.log("systemd-run"), ["--unit=life-window-night --collect --on-active=3552s /usr/local/sbin/life-window night"])
        self.assertFalse((self.state / "night-last.json").exists())   # decided when it begins, not now

    def test_a_night_window_apart_from_dusk_gets_no_timer(self):
        self.window(may(DUSK, "2026-05-15T19:30:00+00:00", windows=(DAWN, DUSK, LATE))).check(["--wake", "alarm"])
        self.assertEqual(self.log("systemd-run"), [])   # the Witty Pi wakes the node for it; the check at that boot decides

    def test_no_night_window_no_timer(self):
        self.window(may(DUSK, "2026-05-15T19:30:00+00:00", windows=(DAWN, DUSK))).check(["--wake", "alarm"])
        self.window(may(DAWN, "2026-05-15T03:05:00+00:00")).check(["--wake", "alarm"])   # dawn: the night is far off
        self.assertEqual(self.log("systemd-run"), [])

    def test_a_visit_in_the_dusk_window_still_sets_the_night_timer(self):
        self.window(may(DUSK, "2026-05-15T20:00:00+00:00")).check(["--wake", "button"])
        self.assertTrue(self.visit_started())
        self.assertEqual(self.log("systemd-run"), ["--unit=life-window-night --collect --on-active=1752s /usr/local/sbin/life-window night"])

    def test_the_night_timer_listens_on_a_battery_that_holds(self):
        self.window(may(NIGHT_W, "2026-05-15T20:29:12+00:00"), LIFE_NIGHT_VIN="13.4").night_cmd([])
        n = self.night_last()
        self.assertEqual((n["ran"], n["v"], n["minV"], n["date"], n["start"]), ("listened", 13.4, 13.1, "2026-05-15", NIGHT_W["start"]))
        self.assertNotIn("poweroff", self.log("systemctl"))

    def test_the_night_timer_powers_off_under_the_minimum(self):
        self.window(may(NIGHT_W, "2026-05-15T20:29:12+00:00"), LIFE_NIGHT_VIN="12.95").night_cmd([])
        self.assertEqual(self.night_last()["ran"], "battery")
        self.assertIn("poweroff", self.log("systemctl"))
        self.assertIn("life-visit@*", self.log("systemctl")[0])   # it looked for a visit first

    def test_a_node_on_a_5_v_supply_listens(self):
        # on the bench the Witty Pi reads its 5 V input: no battery to spare, so the night listens
        self.window(may(NIGHT_W, "2026-05-15T20:29:12+00:00"), LIFE_NIGHT_VIN="4.61").night_cmd([])
        n = self.night_last()
        self.assertEqual((n["ran"], n["v"]), ("mains", 4.61))
        self.assertNotIn("poweroff", self.log("systemctl"))

    def test_the_minimum_is_the_owners(self):
        self.window(may(NIGHT_W, "2026-05-15T20:29:12+00:00", minV=12.8), LIFE_NIGHT_VIN="12.95").night_cmd([])
        self.assertEqual((self.night_last()["ran"], self.night_last()["minV"]), ("listened", 12.8))
        self.assertNotIn("poweroff", self.log("systemctl"))

    def test_without_the_battery_option_it_listens_on_any_battery(self):
        self.window(may(NIGHT_W, "2026-05-15T20:29:12+00:00", battery=False), LIFE_NIGHT_VIN="12.3").night_cmd([])
        n = self.night_last()
        self.assertEqual((n["ran"], n["minV"]), ("listened", None))
        self.assertNotIn("poweroff", self.log("systemctl"))

    def test_a_battery_it_cannot_read_lets_it_listen(self):
        self.window(may(NIGHT_W, "2026-05-15T20:29:12+00:00")).night_cmd([])   # WITTYPI_BUS empty, no LIFE_NIGHT_VIN
        n = self.night_last()
        self.assertEqual((n["ran"], n["v"]), ("unknown", None))
        self.assertNotIn("poweroff", self.log("systemctl"))

    def test_a_maintenance_window_or_a_visit_keeps_it_on_under_the_minimum(self):
        self.maintenance(timedelta(hours=-1), timedelta(hours=3))
        self.window(may(NIGHT_W, "2026-05-15T20:29:12+00:00"), LIFE_NIGHT_VIN="12.7").night_cmd([])
        self.assertEqual(self.night_last()["ran"], "kept")
        (self.state / "maintenance.json").unlink()
        (self.dir / "visits").write_text("life-visit@boot.service loaded active running Life node visit\n")
        self.window(may(NIGHT_W, "2026-05-15T20:29:12+00:00"), LIFE_NIGHT_VIN="12.7").night_cmd([])
        self.assertEqual(self.night_last()["ran"], "kept")
        self.assertNotIn("poweroff", self.log("systemctl"))

    def test_the_night_timer_does_nothing_outside_the_night_window(self):
        for info in (may(None, "2026-05-15T21:40:00+00:00"), may(DUSK, "2026-05-15T20:00:00+00:00")):
            self.window(info, LIFE_NIGHT_VIN="12.0").night_cmd([])
        self.window(may(NIGHT_W, "2026-05-15T20:29:12+00:00"), SCHEDULE="bench", LIFE_NIGHT_VIN="12.0").night_cmd([])
        self.assertFalse((self.state / "night-last.json").exists())
        self.assertEqual(self.log("systemctl"), [])

    def test_a_dry_night_only_says(self):
        self.window(may(NIGHT_W, "2026-05-15T20:29:12+00:00"), LIFE_NIGHT_VIN="12.0").night_cmd(["--dry-run"])
        self.assertFalse((self.state / "night-last.json").exists())
        self.assertNotIn("poweroff", self.log("systemctl"))

    def test_a_boot_for_a_night_window_of_its_own_is_decided_at_the_check(self):
        self.window(may(LATE, "2026-05-15T21:29:00+00:00", windows=(DAWN, DUSK, LATE)), LIFE_NIGHT_VIN="12.6").check(["--wake", "alarm"])
        self.assertEqual(self.decision()["window"], "night")
        self.assertEqual(self.night_last()["ran"], "battery")
        self.assertIn("poweroff", self.log("systemctl"))

    def test_a_node_switched_on_by_hand_in_the_night_window_listens(self):
        for wake in (["--wake", "reboot"], []):   # a reboot; no Witty Pi to ask
            self.window(may(LATE, "2026-05-15T21:40:00+00:00", windows=(DAWN, DUSK, LATE)), LIFE_NIGHT_VIN="12.2").check(wake)
            self.assertEqual((self.night_last()["ran"], self.night_last()["minV"]), ("listened", None))
        self.assertNotIn("poweroff", self.log("systemctl"))

    def apply_answer(self, answer, **env) -> None:
        old = sys.stdin
        sys.stdin = io.StringIO(answer if isinstance(answer, str) else json.dumps(answer))
        try:
            self.window(**env).apply()
        finally:
            sys.stdin = old

    def test_apply_keeps_the_settings_and_writes_the_schedule_again(self):
        self.apply_answer({"ok": True, "night": NIGHT_ON}, LIFE_SCHEDULE_CMD="/opt/life-schedule")
        self.assertEqual(json.loads((self.state / "night.json").read_text()), NIGHT_ON)
        self.assertEqual(self.log("systemd-run"), ["--unit=life-schedule-again --collect /opt/life-schedule again"])
        self.apply_answer({"night": NIGHT_ON})   # the same answer: nothing to do
        self.assertEqual(len(self.log("systemd-run")), 1)

    def test_apply_writes_the_schedule_again_only_for_a_change_that_moves_an_hour(self):
        self.apply_answer({"night": {**NIGHT_ON, "on": False}})          # off, never on before: no hour changes
        self.apply_answer({"night": {**NIGHT_ON, "on": False, "startMin": 90}})
        self.assertEqual(self.log("systemd-run"), [])
        self.apply_answer({"night": {**NIGHT_ON, "startMin": 90}})       # on
        self.apply_answer({"night": {**NIGHT_ON, "startMin": 90, "rev": 4}})   # a new rev, the same settings
        self.assertEqual(json.loads((self.state / "night.json").read_text())["rev"], 4)
        self.apply_answer({"night": {**NIGHT_ON, "startMin": 90, "rev": 5, "minV": 12.9, "battery": False}})   # read at night
        self.assertEqual(json.loads((self.state / "night.json").read_text())["minV"], 12.9)
        self.assertEqual(len(self.log("systemd-run")), 1)
        self.apply_answer({"night": {**NIGHT_ON, "rev": 6, "on": False}})      # off again
        self.assertEqual(len(self.log("systemd-run")), 2)

    def test_apply_on_a_node_without_the_season_schedule_only_keeps_the_settings(self):
        self.apply_answer({"night": NIGHT_ON}, SCHEDULE="bench")
        self.assertTrue((self.state / "night.json").exists())
        self.assertEqual(self.log("systemd-run"), [])

    def test_apply_leaves_anything_but_a_night_answer_alone(self):
        for answer in ("", "not json", "[1]", {"ok": True}, {"night": None}, {"night": {"on": True}}, {"night": {"rev": "3", "on": True}}):
            self.apply_answer(answer)
        self.assertFalse((self.state / "night.json").exists())
        self.assertEqual(self.log("systemd-run"), [])

    def test_arm_resets_the_night_timer(self):
        self.window(may(DUSK, "2026-05-15T20:00:00+00:00")).arm([])
        self.assertIn("stop life-window-night.timer", self.log("systemctl"))
        self.assertEqual(self.log("systemd-run"), ["--unit=life-window-night --collect --on-active=1752s /usr/local/sbin/life-window night"])
        self.assertNotIn("poweroff", self.log("systemctl"))

    def test_arm_powers_off_a_node_on_for_a_night_window_that_is_gone(self):
        (self.state / "window.json").write_text(json.dumps({"date": "2026-05-15", "window": "night"}))
        self.window(may(None, "2026-05-15T20:40:00+00:00", windows=(DAWN, DUSK))).arm([])
        self.assertIn("poweroff", self.log("systemctl"))

    def test_arm_leaves_a_node_somebody_is_at(self):
        boots = ({"window": None, "offWindow": "kept"}, {"window": "dusk", "visit": True}, {"window": "night"})
        for i, boot in enumerate(boots):
            (self.state / "window.json").write_text(json.dumps(boot))
            if i == 2:
                self.maintenance(timedelta(hours=-1), timedelta(hours=3))
            self.window(may(None, "2026-05-15T20:40:00+00:00", windows=(DAWN, DUSK))).arm([])
        self.assertNotIn("poweroff", self.log("systemctl"))
        self.window(may(None, "2026-05-15T20:40:00+00:00"), SCHEDULE="bench").arm([])
        self.assertEqual(self.log("systemctl").count("stop life-window-night.timer"), 3)   # bench: arm does nothing at all


if __name__ == "__main__":
    unittest.main()
