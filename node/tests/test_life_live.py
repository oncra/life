"""Tests for node/life-live.py: it posts only over the WiFi or the cable, never over the 4G stick; what a post carries
(the heartbeat's metrics, the cell without its id, area or PCI, the way out); the oracle's `every`; the push of the
detections without a heartbeat; and life-push's lock, so two runs never send the same detections twice.

    python3 -B -m unittest discover -s node/tests -v

Standard library only. No modem, Witty Pi or VE.Direct: the readers leave those out by themselves.
"""
import fcntl
import importlib.machinery
import importlib.util
import json
import os
import random
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

NODE = Path(__file__).resolve().parents[1]
PUSH = NODE.parent / "clients" / "birdnet-pi-push.py"
CELL = {"plmn": "20416", "operator": "Odido", "cellId": "123456", "tac": "77", "pci": 101, "band": "20", "rsrp": -96.0, "rssi": -71.0, "sinr": 8.0, "mode": "LTE"}


class Oracle(BaseHTTPRequestHandler):
    posts: list = []
    status = 201

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
        Oracle.posts.append((self.path, self.headers.get("authorization"), body))
        out = json.dumps({"ok": True, "every": 30} if Oracle.status == 201 else {"error": "no such route"}).encode()
        self.send_response(Oracle.status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *args):
        pass


def load(env: dict):
    """A fresh life-live with life-heartbeat and life-clips from this checkout, its constants read from `env`; the
    process environment is put back afterwards."""
    saved = dict(os.environ)
    try:
        os.environ.update(env)
        loader = importlib.machinery.SourceFileLoader(f"life_live_{random.random()}", str(NODE / "life-live.py"))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        mod = importlib.util.module_from_spec(spec)
        loader.exec_module(mod)
        return mod
    finally:
        os.environ.clear()
        os.environ.update(saved)


class LiveTest(unittest.TestCase):
    def setUp(self):
        Oracle.posts, Oracle.status = [], 201
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Oracle)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.live = load({
            "LIFE_API": f"http://127.0.0.1:{self.server.server_address[1]}/api/v1", "LIFE_DEVICE_TOKEN": "lo_dev_test",
            "LIFE_HEARTBEAT_BIN": str(NODE / "life-heartbeat.py"), "LIFE_CLIPS_BIN": str(NODE / "life-clips.py"),
            "LIFE_PUSH_BIN": "/bin/true", "LIFE_CLIPS_BIND": "0", "MODEM_HOST": "", "WITTYPI_BUS": "", "VEDIRECT_PORT": "none",
            "LIFE_STATE": str(self.root), "LIFE_QUEUE": str(self.root / "queue.jsonl"), "LIFE_CLIPS_DIR": str(self.root / "clips"),
            "LIFE_RUN": str(self.root / "run"),
        })
        self.way = "wlan0"
        self.live.CLIPS.way_out = lambda: self.way
        self.live.HB.cell = lambda: dict(CELL)
        self.live.WIRELESS = self.root / "wireless"
        self.live.WIRELESS.write_text("Inter-| sta-|   Quality        |   Discarded packets               | Missed | WE\n"
                                      " face | tus | link level noise |  nwid  crypt   frag  retry   misc | beacon | 22\n"
                                      " wlan0: 0000   54.  -61.  -256        0      0      0      0     19        0\n")
        self.pushes = 0

        def push():
            self.pushes += 1
            return ""
        self.live.push = push

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def live_posts(self):
        return [b["live"] for p, _, b in Oracle.posts if p == "/api/v1/ingest/live"]

    def test_wifi_posts_the_reading_without_where_it_is(self):
        loop = self.live.Live(20, 120)
        self.assertEqual(loop.tick(), 30, "the oracle's every wins")
        [post] = self.live_posts()
        self.assertEqual(post["net"], {"via": "wifi", "dBm": -61.0})
        self.assertEqual(post["cell"], {"plmn": "20416", "band": "20", "rsrp": -96.0, "rssi": -71.0, "sinr": 8.0, "mode": "LTE"})
        self.assertIn("unsent", post["metrics"], "the heartbeat's own metrics")
        self.assertNotIn("mics", post["metrics"], "the microphones' check stays with the heartbeat")
        self.assertEqual(Oracle.posts[0][1], "Bearer lo_dev_test")
        self.assertEqual(self.pushes, 1, "the detections go out with the first post")
        loop.tick()
        self.assertEqual(self.pushes, 1, "and again only after LIFE_LIVE_PUSH_S")

    def test_a_cable_says_lan_and_no_wifi_signal(self):
        self.way = "eth0"
        self.live.Live(20, 0).tick()
        [post] = self.live_posts()
        self.assertEqual(post["net"], {"via": "lan"})
        self.assertEqual(self.pushes, 0, "LIFE_LIVE_PUSH_S=0 pushes nothing")

    def test_never_over_the_4g_stick(self):
        for way in ("usb0", "eth1", "wwan0", None):
            self.way = way
            self.assertEqual(self.live.Live(20, 120).tick(), 20)
        self.assertEqual(Oracle.posts, [])
        self.assertEqual(self.pushes, 0)

    def test_an_oracle_without_the_route_is_asked_again_in_a_minute(self):
        Oracle.status = 404
        self.assertEqual(self.live.Live(20, 120).tick(), 60)
        self.assertEqual(self.pushes, 0, "no push when the oracle did not take the post")

    def test_the_heartbeat_says_its_way_out(self):
        way = self.live.HB.way
        self.assertEqual(way("1.1.1.1 via 192.168.2.254 dev wlan0 src 192.168.2.113 uid 0"), {"via": "wifi"})
        self.assertEqual(way("1.1.1.1 via 10.0.0.1 dev eth0 src 10.0.0.7 uid 0"), {"via": "lan"})
        self.assertEqual(way("1.1.1.1 via 192.168.8.1 dev eth1 src 192.168.8.100 uid 0"), {"via": "4g"})
        self.assertEqual(way("1.1.1.1 dev usb0 src 192.168.8.100 uid 0"), {"via": "4g"})
        self.assertIsNone(way("1.1.1.1 dev tailscale0 table 52 src 100.64.0.3 uid 0"), "a tunnel does not say what it rides on")
        self.assertIsNone(way("unreachable 1.1.1.1"))

    def test_wifi_signal(self):
        line = " wlan0: 0000   54.  -56.  -256        0      0      0      0     19        0\n"
        self.assertEqual(self.live.wifi_dbm("wlan0", line), -56.0)
        self.assertIsNone(self.live.wifi_dbm("wlan1", line))
        self.assertIsNone(self.live.wifi_dbm("wlan0", " wlan0: 0000   0.  0.  -256\n"), "zero is no reading")


class PushLock(unittest.TestCase):
    """Two life-push runs at once (the timer's and life-live's) would read the same cursor: the second waits."""

    def test_a_second_run_waits_for_the_first(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            import sqlite3
            con = sqlite3.connect(root / "birds.db")
            con.executescript("create table notes (date text, time text, scientific_name text, common_name text, confidence real);")
            con.close()
            env = {k: v for k, v in os.environ.items() if not k.startswith(("LIFE_", "BIRDNET_"))}
            env.update({"LIFE_DEVICE_TOKEN": "lo_dev_test", "LIFE_API": "http://127.0.0.1:9/api/v1", "BIRDNET_DB": str(root / "birds.db"),
                        "LIFE_CURSOR": str(root / "cursor")})
            with open(str(root / "cursor") + ".lock", "a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                p = subprocess.Popen([sys.executable, "-B", str(PUSH)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                time.sleep(1.5)
                self.assertIsNone(p.poll(), "it waits while another run holds the lock")
            out, err = p.communicate(timeout=30)
            self.assertEqual(p.returncode, 0, err)
            self.assertIn("nothing new", out)


if __name__ == "__main__":
    unittest.main()
