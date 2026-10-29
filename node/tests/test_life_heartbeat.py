"""Tests for node/life-heartbeat.py: the microphones' check rides along at the end of a window and once a new day has one.

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
