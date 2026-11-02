"""Tests for node/life-heartbeat.py: the microphones' check rides along at the end of a window and once a new day has one;
the owner's night window, the settings the node has and how its last night went.

    python3 -B -m unittest discover -s node/tests -v

Standard library only. No modem, Witty Pi or VE.Direct: the heartbeat leaves those out by itself.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HB = Path(__file__).resolve().parents[1] / "life-heartbeat.py"


class Mics(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def beat(self, event):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("LIFE_", "MODEM_", "WITTYPI_", "VEDIRECT_"))}
        env.update({"LIFE_STATE": str(self.state), "MODEM_HOST": "", "WITTYPI_BUS": "", "VEDIRECT_PORT": "none",
                    "LIFE_QUEUE": str(self.state / "queue.jsonl"), "LIFE_CLIPS_DIR": str(self.state / "clips")})
        r = subprocess.run([sys.executable, "-B", str(HB), "--json", "--event", event], env=env, capture_output=True,
                           text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)["metrics"].get("mics")

    def check(self, day, n):
        (self.state / "mics.json").write_text(json.dumps({"day": day, "n": n, "bands": [1000], "diff": [35.2]}))

    def test_no_check_no_field(self):
        self.assertIsNone(self.beat("hourly"))

    def test_sent_once_as_it_stands(self):
        self.check("2026-11-01", 4)
        self.assertEqual(self.beat("hourly")["n"], 4)      # a check the oracle has not had
        self.assertIsNone(self.beat("hourly"))              # not with every post: the SIM pays for each byte
        self.assertIsNone(self.beat("shutdown"))            # nor at every window's end in a week without a check
        self.check("2026-11-01", 40)
        self.assertEqual(self.beat("shutdown")["n"], 40)   # more readings of the same day: sent as it now stands
        self.check("2026-11-08", 38)
        self.assertEqual(self.beat("hourly")["day"], "2026-11-08")


APPLY = "/usr/local/bin/life-guard apply;/usr/local/bin/life-visit apply;/usr/local/bin/life-clips apply;/usr/local/sbin/life-window apply"


class Night(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def metrics(self, **extra):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("LIFE_", "MODEM_", "WITTYPI_", "VEDIRECT_"))}
        env.update({"LIFE_STATE": str(self.state), "MODEM_HOST": "", "WITTYPI_BUS": "", "VEDIRECT_PORT": "none",
                    "LIFE_QUEUE": str(self.state / "queue.jsonl"), "LIFE_CLIPS_DIR": str(self.state / "clips"), **extra})
        r = subprocess.run([sys.executable, "-B", str(HB), "--json", "--event", "hourly"], env=env, capture_output=True,
                           text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)["metrics"]

    def test_no_rev_where_the_answer_does_not_reach_life_window(self):
        self.assertNotIn("nightRev", self.metrics())
        self.assertNotIn("nightRev", self.metrics(LIFE_HEARTBEAT_APPLY_CMD="/usr/local/bin/life-guard apply"))   # an older node
        self.assertEqual(self.metrics(LIFE_HEARTBEAT_APPLY_CMD=APPLY)["nightRev"], -1)   # none yet: the oracle sends them

    def test_the_rev_it_has(self):
        (self.state / "night.json").write_text(json.dumps({"rev": 7, "on": True, "startMin": 60}))
        self.assertEqual(self.metrics(LIFE_HEARTBEAT_APPLY_CMD=APPLY)["nightRev"], 7)
        (self.state / "night.json").write_text("[]")    # damaged: as none, so the oracle sends them again
        self.assertEqual(self.metrics(LIFE_HEARTBEAT_APPLY_CMD=APPLY)["nightRev"], -1)

    def test_how_the_last_night_went(self):
        (self.state / "night-last.json").write_text(json.dumps({
            "date": "2026-05-15", "start": "2026-05-15T20:28:42+00:00", "end": "2026-05-15T21:28:42+00:00", "ran": "battery",
            "v": 12.95, "minV": 13.1, "at": "2026-05-15T20:29:12+00:00", "more": {"nested": True}}))
        last = self.metrics()["nightLast"]
        self.assertEqual((last["ran"], last["v"], last["minV"], last["date"]), ("battery", 12.95, 13.1, "2026-05-15"))
        self.assertNotIn("more", last)
        (self.state / "night-last.json").write_text(json.dumps({"date": "2026-05-16", "ran": "listened", "v": None, "minV": None}))
        self.assertEqual(self.metrics()["nightLast"], {"date": "2026-05-16", "ran": "listened"})   # no reading, no option

    def test_the_window_rides_along_as_before(self):
        self.assertNotIn("window", self.metrics())
        (self.state / "window.json").write_text(json.dumps({"window": None, "offWindow": "stop", "next": "2026-05-16T02:59:42+00:00"}))
        m = self.metrics()
        self.assertEqual((m["window"], m["offWindow"]), (None, "stop"))
        (self.state / "window.json").write_text(json.dumps({"window": "night"}))
        self.assertEqual(self.metrics()["window"], "night")
