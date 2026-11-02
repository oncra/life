"""Tests for node/image/life-schedule-wpi.py: the owner's night window on top of the listening windows.

    python3 -B -m unittest discover -s node/tests -v

Needs astral, as the node has it (pip install astral); without it these tests are skipped. The night window's settings
are a file in a temporary directory, as life-window apply keeps them.
"""
import importlib.machinery
import importlib.util
import json
import os
import random
import re
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

NODE = Path(__file__).resolve().parents[1]
try:
    import astral  # noqa: F401
    HAVE_ASTRAL = True
except ImportError:
    HAVE_ASTRAL = False

ON = {"rev": 1, "on": True, "startMin": 60, "lenMin": 60, "from": "03-25", "to": "06-30", "battery": True, "minV": 13.1}
MIN = timedelta(minutes=1)


@unittest.skipUnless(HAVE_ASTRAL, "life-schedule-wpi needs astral")
class Night(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.night_file = Path(self._tmp.name) / "night.json"
        self.old = dict(os.environ)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.old)
        self._tmp.cleanup()

    def sched(self, night=None, lat=52.37, lon=5.0, tz="Europe/Amsterdam"):
        os.environ.update({"NODE_LAT": str(lat), "NODE_LON": str(lon), "NODE_TZ": tz, "LIFE_NIGHT": str(self.night_file)})
        self.set(night)
        loader = importlib.machinery.SourceFileLoader(f"life_schedule_wpi_{random.random()}", str(NODE / "image" / "life-schedule-wpi.py"))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        mod = importlib.util.module_from_spec(spec)
        loader.exec_module(mod)
        return mod

    def set(self, night):
        if night is None:
            self.night_file.unlink(missing_ok=True)
        else:
            self.night_file.write_text(night if isinstance(night, str) else json.dumps(night))

    @staticmethod
    def local(mod, s: str) -> datetime:
        """A local time, as --now reads it."""
        return datetime.fromisoformat(s).replace(tzinfo=mod.TZ).astimezone(timezone.utc)

    @staticmethod
    def states(text: str) -> list[tuple[str, int]]:
        out = []
        for line in text.splitlines():
            m = re.fullmatch(r"(ON|OFF)\tH(\d+) M(\d+) S(\d+)", line)
            if m:
                out.append((m[1], int(m[2]) * 3600 + int(m[3]) * 60 + int(m[4])))
        return out

    @staticmethod
    def names(mod, d: date) -> list[str]:
        return [w["name"] for w in mod.windows(d)]

    def test_off_until_the_owner_turns_it_on(self):
        for night in (None, {**ON, "on": False}, {**ON, "on": "yes"}, "not json", "[]", {**ON, "from": "02-30"},
                      {**ON, "to": "6-30"}, {**ON, "startMin": "late"}):
            mod = self.sched(night)
            self.assertEqual(self.names(mod, date(2026, 5, 15)), ["dawn", "dusk"], night)
            self.assertFalse(mod.night_config()["on"], night)

    def test_at_its_defaults_it_runs_on_from_the_dusk_window(self):
        mod = self.sched(ON)
        dawn, dusk, night = mod.windows(date(2026, 5, 15))
        self.assertEqual((night["name"], night["start"], night["end"]), ("night", dusk["end"], dusk["end"] + 60 * MIN))
        st = self.states(mod.script(self.local(mod, "2026-05-15T22:00")))
        self.assertEqual([k for k, _ in st], ["ON", "OFF", "ON", "OFF"])   # dusk and night: one ON state, no boot between
        self.assertEqual(st[2][1], 2 * 3600)

    def test_only_in_its_season(self):
        mod = self.sched(ON)
        for d in (date(2026, 3, 24), date(2026, 7, 1), date(2026, 12, 1)):
            self.assertNotIn("night", self.names(mod, d), d)
        for d in (date(2026, 3, 25), date(2026, 6, 30)):
            self.assertIn("night", self.names(mod, d), d)

    def test_a_season_over_the_new_year(self):
        mod = self.sched({**ON, "from": "11-15", "to": "02-15"})
        for d, want in ((date(2026, 11, 14), False), (date(2026, 11, 15), True), (date(2027, 1, 10), True),
                        (date(2027, 2, 15), True), (date(2027, 2, 16), False)):
            self.assertEqual("night" in self.names(mod, d), want, d)
        self.assertEqual(self.names(mod, date(2027, 1, 10)), ["winter", "night"])   # an hour after sunset, as in summer

    def test_each_value_is_held_to_the_oracles_range(self):
        c = self.sched({**ON, "startMin": -30, "lenMin": 500, "minV": 20, "battery": "no"}).night_config()
        self.assertEqual((c["startMin"], c["lenMin"], c["minV"], c["battery"]), (0, 180, 14.0, True))   # only false is false
        c = self.sched({**ON, "startMin": 999, "lenMin": 1, "minV": 3, "battery": False}).night_config()
        self.assertEqual((c["startMin"], c["lenMin"], c["minV"], c["battery"]), (360, 15, 12.0, False))
        c = self.sched({"rev": 4, "on": True}).night_config()   # what the owner left out is the default
        self.assertEqual({k: c[k] for k in ("startMin", "lenMin", "from", "to", "battery", "minV")},
                         {k: ON[k] for k in ("startMin", "lenMin", "from", "to", "battery", "minV")})

    def test_inside_the_dusk_window_it_adds_nothing(self):
        mod = self.sched({**ON, "startMin": 0, "lenMin": 45})      # the dusk window's own hour already
        self.assertEqual(self.names(mod, date(2026, 5, 15)), ["dawn", "dusk"])
        mod = self.sched({**ON, "startMin": 30, "lenMin": 60})     # the half hour past the dusk window
        dawn, dusk, night = mod.windows(date(2026, 5, 15))
        self.assertEqual((night["start"], night["end"] - night["start"]), (dusk["end"], 30 * MIN))

    def test_a_night_window_apart_from_dusk_is_an_on_state_of_its_own(self):
        mod = self.sched({**ON, "startMin": 120})
        st = self.states(mod.script(self.local(mod, "2026-05-15T12:00")))
        self.assertEqual([k for k, _ in st], ["ON", "OFF", "ON", "OFF", "ON", "OFF"])
        self.assertEqual([s for _, s in st[2:5]], [3600, 3600, 3600])   # dusk, an hour off, the night window

    def test_it_ends_before_the_next_dawn(self):
        d = date(2026, 6, 21)
        mod = self.sched({**ON, "startMin": 300, "lenMin": 180})   # as late and long as it goes, on the shortest night
        night = mod.windows(d)[-1]
        nxt = mod.core_windows(d + timedelta(days=1))[0]["start"]
        self.assertEqual((night["name"], night["end"]), ("night", nxt - mod.MERGE))
        self.assertEqual(self.states(mod.script(night["start"]))[-1][1], 15 * 60)   # off for the 15 minutes to dawn
        mod = self.sched({**ON, "startMin": 360, "lenMin": 180})   # what is left is under 15 minutes: no window
        self.assertEqual(self.names(mod, d), ["dawn", "dusk"])

    def test_after_midnight_it_belongs_to_the_evening_before(self):
        mod = self.sched({**ON, "startMin": 180})
        info = mod.window_info(self.local(mod, "2026-06-22T01:30"))
        self.assertEqual((info["date"], info["active"]["name"]), ("2026-06-21", "night"))
        self.assertEqual(info["next"], mod.core_windows(date(2026, 6, 22))[0]["start"].isoformat(timespec="seconds"))
        self.assertTrue(info["night"]["on"])
        self.assertIn("BEGIN\t2026-06-21", mod.script(self.local(mod, "2026-06-22T01:30")))

    def test_the_states_run_exactly_to_the_next_first_window_when_the_clocks_change(self):
        mod = self.sched({**ON, "from": "03-01", "to": "10-31", "startMin": 150, "lenMin": 120})
        for d in (date(2026, 3, 28), date(2026, 3, 29), date(2026, 10, 24), date(2026, 10, 25)):
            ws = mod.windows(d)
            self.assertEqual(ws[-1]["name"], "night", d)
            nxt = mod.core_windows(d + timedelta(days=1))[0]["start"]
            total = sum(s for _, s in self.states(mod.script(ws[0]["start"] + MIN)))
            self.assertAlmostEqual(total, (nxt - ws[0]["start"]).total_seconds(), delta=3, msg=d)

    def test_the_south_keeps_its_own_calendar(self):
        mod = self.sched({**ON, "from": "09-25", "to": "12-31"}, lat=-33.9, lon=18.4, tz="Africa/Johannesburg")
        self.assertEqual(self.names(mod, date(2026, 11, 15)), ["dawn", "dusk", "night"])   # spring there
        self.assertEqual(self.names(mod, date(2026, 6, 15)), ["winter"])

    def test_the_rules_hold_all_year_at_every_setting(self):
        settings = [(0, 15), (0, 180), (30, 15), (60, 60), (75, 60), (150, 90), (240, 180), (330, 45), (360, 15), (360, 180)]
        places = [(52.37, 5.0, "Europe/Amsterdam"), (60.4, 5.3, "Europe/Oslo"), (69.65, 18.96, "Europe/Oslo"),
                  (-33.9, 18.4, "Africa/Johannesburg")]
        for lat, lon, tz in places:
            mod = self.sched({**ON, "from": "01-01", "to": "12-31"}, lat=lat, lon=lon, tz=tz)
            for start, length in settings:
                self.set({**ON, "from": "01-01", "to": "12-31", "startMin": start, "lenMin": length})
                for k in range(0, 366, 9):
                    d = date(2026, 1, 1) + timedelta(days=k)
                    where = f"{lat} {d} {start}+{length}"
                    ws, core = mod.windows(d), mod.core_windows(d)
                    nxt = mod.core_windows(d + timedelta(days=1))[0]["start"]
                    for a, b in zip(ws, ws[1:]):
                        self.assertLessEqual(a["end"], b["start"], where)        # never overlapping, in order
                    if ws[-1]["name"] == "night":
                        n = ws[-1]
                        self.assertGreaterEqual(n["start"], core[-1]["end"], where)
                        self.assertLessEqual(n["end"], nxt - mod.MERGE, where)
                        self.assertGreaterEqual(n["end"] - n["start"], 15 * MIN, where)
                        self.assertLessEqual(n["end"] - n["start"], length * MIN, where)
                    else:
                        self.assertEqual(ws, core, where)
                    st = self.states(mod.script(ws[0]["start"] + MIN))
                    self.assertTrue(all(s > 0 for _, s in st), where)
                    self.assertEqual([k for k, _ in st], ["ON", "OFF"] * (len(st) // 2), where)
                    self.assertAlmostEqual(sum(s for _, s in st), (nxt - ws[0]["start"]).total_seconds(), delta=4, msg=where)
                    for w in ws:   # a minute into each window, the node is in that window
                        info = mod.window_info(w["start"] + MIN)
                        self.assertEqual((info["date"], info["active"]["name"]), (d.isoformat(), w["name"]), where)


if __name__ == "__main__":
    unittest.main()
