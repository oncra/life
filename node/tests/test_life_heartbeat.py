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


class Heat(unittest.TestCase):
    """The processor's heat and the evening's bat minutes ride on the post at the end of a window, and whenever something
    is wrong; the throttle flags on every post."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name)
        self.run_dir = self.state / "run"
        self.run_dir.mkdir()
        self.boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        self.metrics = self.state / "metrics.txt"
        self.metrics.write_text('# HELP x\nmyaudio_birdnet_processing_overruns_total{source="audio_card_1"} 3\n'
                                'myaudio_buffer_overruns_total{source="audio_card_1"} 2\nother_total 7\n')

    def tearDown(self):
        self.tmp.cleanup()

    def beat(self, event):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("LIFE_", "MODEM_", "WITTYPI_", "VEDIRECT_"))}
        env.update({"LIFE_STATE": str(self.state), "MODEM_HOST": "", "WITTYPI_BUS": "", "VEDIRECT_PORT": "none",
                    "LIFE_QUEUE": str(self.state / "queue.jsonl"), "LIFE_CLIPS_DIR": str(self.state / "clips"),
                    "LIFE_RUN": str(self.run_dir), "LIFE_MIC_METRICS": self.metrics.as_uri(),
                    "LIFE_BNG_URL": "http://127.0.0.1:9"})
        r = subprocess.run([sys.executable, "-B", str(HB), "--json", "--event", event], env=env, capture_output=True,
                           text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)["metrics"]

    def heat(self, guard=False, thr="0x80000", boot=None):
        (self.run_dir / "heat.json").write_text(json.dumps({
            "boot": boot or self.boot, "c": 79.1, "maxC": 82.4, "hotS": 750, "thr": thr, "thrEver": True, "uvEver": False,
            "mhz": 1500, "minMhz": 1000, "guard": {"on": guard, "trips": 2}}))

    def test_the_end_of_a_window_carries_the_heat_and_the_bats(self):
        self.heat()
        from datetime import datetime, timedelta, timezone
        at = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat(timespec="seconds")
        (self.state / "bats.json").write_text(json.dumps({"evening": "2026-07-01", "battery": "ok", "v": 13.28, "minV": 13.1,
                                                          "onS": 2400, "heatS": 900, "batteryS": 0, "trips": 1,
                                                          "last": {"at": at, "state": "on", "boot": self.boot}}))
        m = self.beat("shutdown")
        self.assertEqual(m["throttled"], "0x80000")
        self.assertEqual(m["heat"], {"maxC": 82.4, "hotMin": 12, "slowed": True, "sagged": False, "minMhz": 1000, "trips": 2})
        self.assertEqual(m["bats"], {"ev": "2026-07-01", "battery": "ok", "v": 13.28, "minV": 13.1, "onMin": 42,
                                     "heatMin": 15, "batteryMin": 0, "trips": 1})   # the open stretch since life-mic counted in
        self.assertEqual(m["overruns"], 5)

    def test_an_ordinary_post_carries_only_the_flags(self):
        self.heat(thr="0x0")
        m = self.beat("hourly")
        self.assertEqual(m["throttled"], "0x0")
        self.assertNotIn("heat", m)
        self.assertNotIn("overruns", m)

    def test_a_slowed_processor_is_reported_at_once(self):
        self.heat(thr="0x80008")      # the soft limit active now
        self.assertIn("heat", self.beat("hourly"))

    def test_the_guard_holding_the_bats_out_is_reported_at_once(self):
        self.heat(guard=True, thr="0x0")
        self.assertEqual(self.beat("hourly")["heat"]["trips"], 2)

    def test_readings_of_an_earlier_boot_are_not_this_ones(self):
        self.heat(boot="another-boot")
        m = self.beat("shutdown")
        self.assertNotIn("heat", m)


class Version(unittest.TestCase):
    """BirdNET-Go's version rides on the posts at a window's start and end, every time, so a lost post loses nothing."""

    def setUp(self):
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

        class H(BaseHTTPRequestHandler):
            def do_GET(self):
                body = json.dumps({"status": "healthy", "version": "20261031"}).encode()
                self.send_response(200 if self.path == "/api/v2/health" else 404)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name)

    def tearDown(self):
        self.srv.shutdown()
        self.tmp.cleanup()

    def beat(self, event):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("LIFE_", "MODEM_", "WITTYPI_", "VEDIRECT_"))}
        env.update({"LIFE_STATE": str(self.state), "MODEM_HOST": "", "WITTYPI_BUS": "", "VEDIRECT_PORT": "none",
                    "LIFE_QUEUE": str(self.state / "queue.jsonl"), "LIFE_CLIPS_DIR": str(self.state / "clips"),
                    "LIFE_RUN": str(self.state / "run"), "LIFE_MIC_METRICS": "http://127.0.0.1:9/metrics",
                    "LIFE_BNG_URL": f"http://127.0.0.1:{self.srv.server_address[1]}"})
        r = subprocess.run([sys.executable, "-B", str(HB), "--json", "--event", event], env=env, capture_output=True,
                           text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)["metrics"]

    def test_at_the_start_and_end_of_a_window_every_time(self):
        self.assertEqual(self.beat("boot").get("bng"), "20261031")
        self.assertEqual(self.beat("boot").get("bng"), "20261031")      # again: the first may never have arrived
        self.assertEqual(self.beat("shutdown").get("bng"), "20261031")
        self.assertNotIn("bng", self.beat("hourly"))
