"""Tests for node/image/life-window.py: what a boot outside the listening windows is for, the visit a button press
(or the visit contact's magnet) starts, the owner's night window, and the hold after a guard stop.

    python3 -B -m unittest discover -s node/tests -v

Standard library only. The day's windows are given (life-schedule-wpi needs astral); systemctl, systemd-run,
life-guard, journalctl and GNU date are fakes on PATH that write down what they were asked.
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


# 17 November at Amsterdam: sunrise 07:58 and sunset 16:42 local (06:58 and 15:42 UTC); the next start is the winter
# window's, from civil dawn the next morning
SUN = {"rise": "2026-11-17T06:58:00+00:00", "set": "2026-11-17T15:42:00+00:00"}
NOV_NEXT = "2026-11-18T06:20:00+00:00"
WINTER = {"name": "winter", "start": "2026-11-17T06:19:00+00:00", "end": "2026-11-17T08:19:00+00:00"}


def nov(now, active=None, nxt=NOV_NEXT, sun=SUN):
    return {"date": "2026-11-17", "now": now, "windows": [WINTER], "active": active, "next": nxt, "sun": sun}


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
if name == "journalctl" and os.path.exists(os.path.join(os.environ["FAKE_LOG"], "journal")):
    print(open(os.path.join(os.environ["FAKE_LOG"], "journal")).read())
'''


class Window(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.state = self.dir / "state"
        self.state.mkdir()
        bin_ = self.dir / "bin"
        bin_.mkdir()
        for name in ("systemctl", "systemd-run", "life-guard", "date", "journalctl"):
            (bin_ / name).write_text(FAKE.format(py=sys.executable))
            (bin_ / name).chmod(0o755)
        self.old = dict(os.environ)
        os.environ.update({"PATH": f"{bin_}:{os.environ['PATH']}", "FAKE_LOG": str(self.dir), "LIFE_STATE": str(self.state),
                           "SCHEDULE": "season", "WITTYPI_BUS": "", "LIFE_VISIT": "1", "GUARD": "0"})
        for k in ("VISIT_MAX_MIN", "LIFE_BOARD_C", "LIFE_OFF_S", "HOLD_MIN_C", "HOLD_RETRY_MIN"):
            os.environ.pop(k, None)

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

    def test_a_battery_back_wake_in_a_warm_box_still_goes_back_to_sleep(self):
        self.window(LIFE_OFF_S="36000", LIFE_BOARD_C="14").check(["--wake", "voltage-restored"])   # off all night, warm
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


    # the hold after a guard stop

    def held(self) -> dict | None:
        p = self.state / "hold.json"
        return json.loads(p.read_text()) if p.exists() else None

    def hold_file(self, posted="2026-11-17T10:00:00+00:00", checks=1):
        (self.state / "hold.json").write_text(json.dumps({"since": "2026-11-17T10:00:00+00:00", "checks": checks, "boardC": 30.0,
                                                          "why": "stopped", "retryAt": "2026-11-17T10:30:00+00:00", "postedAt": posted}))

    def test_back_after_a_guard_stop_the_node_goes_off_for_a_first_look(self):
        # the board is warm from the Pi that ran until the guard stopped it two minutes ago: it says nothing yet
        self.window(nov("2026-11-17T10:00:00+00:00"), LIFE_OFF_S="120", LIFE_BOARD_C="31.5").check(["--wake", "voltage-restored"])
        d, h = self.decision(), self.held()
        self.assertEqual((d["offWindow"], d["window"], d["hold"]["why"], d["hold"]["retryAt"]), ("hold", None, "stopped", "2026-11-17T10:30:00+00:00"))
        self.assertEqual((h["checks"], h["since"], h["postedAt"]), (1, "2026-11-17T10:00:00+00:00", "2026-11-17T10:00:00+00:00"))
        self.assertIn("poweroff", self.log("systemctl"))
        self.assertNotIn("mask --runtime life-flush.service", self.log("systemctl"))   # the page hears of it
        self.assertEqual(self.log("systemd-run"), [])
        self.assertFalse(self.visit_started())

    def test_a_cold_look_holds_on_without_a_post(self):
        self.hold_file()
        self.window(nov("2026-11-17T10:30:00+00:00"), LIFE_OFF_S="1790", LIFE_BOARD_C="2.5").check(["--wake", "alarm"])
        h = self.held()
        self.assertEqual((h["checks"], h["why"], h["boardC"], h["since"], h["retryAt"]), (2, "cold", 2.5, "2026-11-17T10:00:00+00:00", "2026-11-17T11:00:00+00:00"))
        self.assertEqual(h["postedAt"], "2026-11-17T10:00:00+00:00")
        self.assertEqual(self.log("systemctl"), ["mask --runtime life-flush.service", "poweroff"])

    def test_a_held_node_posts_at_a_look_every_three_hours(self):
        self.hold_file(posted="2026-11-17T07:20:00+00:00", checks=6)
        self.window(nov("2026-11-17T10:30:00+00:00"), LIFE_OFF_S="1790", LIFE_BOARD_C="1.0").check(["--wake", "alarm"])
        self.assertEqual(self.held()["postedAt"], "2026-11-17T10:30:00+00:00")
        self.assertEqual(self.log("systemctl"), ["poweroff"])

    def test_a_cold_box_after_a_long_stop_holds_at_once(self):
        self.window(nov("2026-11-17T09:10:00+00:00"), LIFE_OFF_S="50000", LIFE_BOARD_C="0.5").check(["--wake", "voltage-restored"])
        self.assertEqual((self.held()["why"], self.decision()["offWindow"]), ("cold", "hold"))
        self.assertIn("poweroff", self.log("systemctl"))

    def test_a_warm_look_ends_the_hold_and_the_node_carries_on(self):
        self.hold_file(checks=4)
        self.window(nov("2026-11-17T12:00:00+00:00"), LIFE_OFF_S="1800", LIFE_BOARD_C="7.5").check(["--wake", "alarm"])
        self.assertIsNone(self.held())
        self.assertEqual(self.decision()["offWindow"], "stop")      # outside its window: posts, then off until the next
        self.assertTrue(self.log("systemd-run")[0].endswith("/usr/local/sbin/life-window stop"))
        self.assertNotIn("poweroff", self.log("systemctl"))

    def test_a_warm_look_in_a_window_listens(self):
        self.hold_file()
        self.window(nov("2026-11-17T07:00:00+00:00", active=WINTER), LIFE_OFF_S="1800", LIFE_BOARD_C="6").check(["--wake", "alarm"])
        self.assertIsNone(self.held())
        self.assertEqual(self.decision()["window"], "winter")
        self.assertEqual(self.log("systemctl"), [])

    def test_a_cold_look_in_a_window_does_not_listen(self):
        self.hold_file()
        self.window(nov("2026-11-17T07:00:00+00:00", active=WINTER), LIFE_OFF_S="1800", LIFE_BOARD_C="-1.5").check(["--wake", "alarm"])
        self.assertEqual((self.decision()["offWindow"], self.decision()["window"]), ("hold", None))
        self.assertIn("poweroff", self.log("systemctl"))

    def test_the_looks_are_by_day(self):
        self.hold_file()
        self.window(nov("2026-11-17T15:30:00+00:00"), LIFE_OFF_S="1800", LIFE_BOARD_C="3").check(["--wake", "alarm"])
        self.assertEqual(self.held()["retryAt"], NOV_NEXT)           # 16:00 would be after sunset: the next window
        self.hold_file()
        self.window(nov("2026-11-17T05:00:00+00:00", nxt="2026-11-17T07:30:00+00:00"), LIFE_OFF_S="1800", LIFE_BOARD_C="3").check(["--wake", "alarm"])
        self.assertEqual(self.held()["retryAt"], "2026-11-17T06:58:00+00:00")   # before sunrise: at sunrise
        self.hold_file()
        self.window(nov("2026-11-17T10:30:00+00:00", nxt="2026-11-17T10:45:00+00:00"), LIFE_OFF_S="1800", LIFE_BOARD_C="3").check(["--wake", "alarm"])
        self.assertEqual(self.held()["retryAt"], "2026-11-17T10:45:00+00:00")   # never after the next window's start
        self.hold_file()
        self.window(nov("2026-11-17T10:30:00+00:00", sun=None), LIFE_OFF_S="1800", LIFE_BOARD_C="3").check(["--wake", "alarm"])
        self.assertEqual(self.held()["retryAt"], "2026-11-17T11:00:00+00:00")   # no sun times: every half hour

    def test_the_look_follows_the_setting(self):
        self.hold_file()
        self.window(nov("2026-11-17T10:30:00+00:00"), LIFE_OFF_S="3600", LIFE_BOARD_C="3", HOLD_RETRY_MIN="60").check(["--wake", "alarm"])
        self.assertEqual(self.held()["retryAt"], "2026-11-17T11:30:00+00:00")
        for v, want in (("2", 600), ("999", 10800), ("ten", 1800)):
            mod = self.window(HOLD_RETRY_MIN=v)
            self.assertEqual(mod.HOLD_RETRY_S, want, v)
            self.assertLessEqual(mod.COOL_S, mod.HOLD_RETRY_S * 0.8)
        self.assertEqual(self.window(HOLD_MIN_C="8").HOLD_C, 8.0)

    def test_the_owners_minimum_ends_the_hold(self):
        self.hold_file()
        self.window(nov("2026-11-17T12:00:00+00:00"), LIFE_OFF_S="1800", LIFE_BOARD_C="6", HOLD_MIN_C="8").check(["--wake", "alarm"])
        self.assertEqual(self.held()["why"], "cold")

    def test_without_a_board_reading_a_hold_ends(self):
        self.hold_file()
        self.window(nov("2026-11-17T12:00:00+00:00"), LIFE_OFF_S="1800").check(["--wake", "alarm"])   # no Witty Pi to read
        self.assertIsNone(self.held())

    def test_the_first_look_reads_the_board_when_the_journal_says_nothing(self):
        self.hold_file()
        self.window(nov("2026-11-17T10:30:00+00:00"), LIFE_BOARD_C="2").check(["--wake", "alarm"])
        self.assertEqual(self.held()["why"], "cold")
        self.window(nov("2026-11-17T12:30:00+00:00"), LIFE_BOARD_C="9").check(["--wake", "alarm"])
        self.assertIsNone(self.held())

    def test_without_the_journal_a_guard_stop_waits_one_look(self):
        self.window(nov("2026-11-17T10:00:00+00:00"), LIFE_BOARD_C="12").check(["--wake", "voltage-restored"])
        self.assertEqual(self.held()["why"], "stopped")

    def test_the_time_off_comes_from_the_journal(self):
        import time
        mod = self.window()
        last = time.time() - mod.uptime_s() - 1800
        (self.dir / "journal").write_text(json.dumps({"__REALTIME_TIMESTAMP": str(int(last * 1e6)), "MESSAGE": "Power down"}))
        self.assertAlmostEqual(mod.off_s(), 1800, delta=5)
        self.assertEqual(self.log("journalctl"), ["-b -1 -n 1 -o json --no-pager -q"])

    def test_a_button_press_in_a_hold_is_a_visit_and_the_backstop_keeps_the_hold(self):
        self.hold_file()
        self.window(nov("2026-11-17T10:40:00+00:00"), LIFE_OFF_S="600", LIFE_BOARD_C="2").check(["--wake", "button"])
        self.assertEqual(self.decision()["offWindow"], "visit")
        self.assertTrue(self.visit_started())
        out = io.StringIO()
        sys.stdout, old = out, sys.stdout
        try:
            self.window(nov("2026-11-17T07:30:00+00:00", active=WINTER)).stop(["--unless-maintenance", "--dry-run"])
        finally:
            sys.stdout = old
        said = out.getvalue()
        self.assertIn("i2cset -y 1 0x08 19 255 && i2cset -y 1 0x08 22 255", said)   # held: off inside a window too, guard off
        self.assertIn("systemctl poweroff", said)

    def test_a_maintenance_window_lets_a_node_back_from_a_guard_stop_stay_on(self):
        self.maintenance(timedelta(hours=-1), timedelta(hours=3))
        self.window(nov("2026-11-17T10:00:00+00:00"), LIFE_OFF_S="120", LIFE_BOARD_C="1").check(["--wake", "voltage-restored"])
        self.assertIsNone(self.held())
        self.assertNotEqual(self.decision()["offWindow"], "hold")

    def test_power_back_by_hand_is_no_hold(self):
        for wake in ("button", "reboot", "usb-5v"):
            self.window(nov("2026-11-17T10:00:00+00:00"), LIFE_OFF_S="120", LIFE_BOARD_C="1").check(["--wake", wake])
            self.assertIsNone(self.held(), wake)
        self.window(nov("2026-11-17T10:00:00+00:00"), LIFE_OFF_S="120", LIFE_BOARD_C="1").check(["--wake", "power-connected"])
        self.assertIsNone(self.held())      # a battery connected by hand, or the controller's load back: as before

    def test_off_outside_a_hold_keeps_the_guard(self):
        out = io.StringIO()
        sys.stdout, old = out, sys.stdout
        try:
            self.window(nov("2026-11-17T10:00:00+00:00")).stop(["--dry-run"])
        finally:
            sys.stdout = old
        self.assertNotIn("i2cset", out.getvalue())
        self.assertIn(f"set_startup_time 03 06 12 00", out.getvalue())

    def test_a_dry_hold_only_says(self):
        self.window(nov("2026-11-17T10:00:00+00:00"), LIFE_OFF_S="120", LIFE_BOARD_C="20").check(["--wake", "voltage-restored", "--dry-run"])
        self.assertIsNone(self.held())
        self.assertFalse((self.state / "window.json").exists())
        self.assertEqual(self.log("systemctl"), [])


if __name__ == "__main__":
    unittest.main()
