"""Tests for clients/birdnet-pi-push.py (life-push on the node): which detections go out as test.

    python3 -B -m unittest discover -s node/tests -v

Standard library only. BirdNET-Go's database is a small SQLite file with the tables of its v2 schema that life-push
reads, and the oracle is a local HTTP server that keeps what it is sent.
"""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PUSH = Path(__file__).resolve().parents[2] / "clients" / "birdnet-pi-push.py"


class Oracle(BaseHTTPRequestHandler):
    posts: list = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        Oracle.posts.append((self.path, body))
        out = json.dumps({"detections": len(body.get("detections", []))}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def do_GET(self):  # BirdNET-Go's own API, asked for common names
        out = json.dumps({"data": [{"scientificName": "Turdus merula", "commonName": "Eurasian Blackbird"}]}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *args):
        pass


def database(path: Path, with_sources: bool = True, i2s_name: str = "Sound Card 1") -> None:
    con = sqlite3.connect(path)
    con.executescript(f"""
        create table label_types (id integer primary key, name text);
        create table labels (id integer primary key, scientific_name text, label_type_id integer);
        create table ai_models (id integer primary key, name text);
        create table detections (id integer primary key, model_id integer, label_id integer, detected_at integer,
                                 begin_time integer, end_time integer, confidence real, unlikely integer
                                 {", source_id integer" if with_sources else ""});
        create table detection_model_contributions (detection_id integer, model_id integer);
        insert into label_types values (1, 'species');
        insert into labels values (1, 'Turdus merula', 1), (2, 'Pipistrellus pipistrellus', 1);
        insert into ai_models values (1, 'BirdNET V2.4'), (2, 'BattyBirdNET EU');
    """)
    if with_sources:
        con.executescript("""
            create table audio_sources (id integer primary key, source_uri text, node_name text, source_type text,
                                        display_name text);
            insert into audio_sources values (1, ':0,0', 'node', 'alsa', '{i2s_name}'),
                                             (2, ':1,0', 'node', 'alsa', 'AudioMoth');
        """.replace("{i2s_name}", i2s_name))
    now = int(time.time()) - 600
    rows = [(1, 1, 1, now, 0, 3000, 0.9, 0, 1),        # a blackbird on the I2S microphone
            (2, 1, 1, now + 1, 0, 3000, 0.8, 0, 2),    # the same blackbird on the AudioMoth
            (3, 2, 2, now + 2, 0, 600, 0.95, 0, 2)]    # a pipistrelle on the AudioMoth
    if with_sources:
        con.executemany("insert into detections values (?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
    else:
        con.executemany("insert into detections values (?, ?, ?, ?, ?, ?, ?, ?)", [r[:8] for r in rows])
    con.executemany("insert into detection_model_contributions values (?, ?)", [(1, 1), (2, 1), (3, 2)])
    con.commit()
    con.close()


class Push(unittest.TestCase):
    def setUp(self):
        Oracle.posts = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Oracle)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def push(self, test_sources: str | None, with_sources: bool = True, i2s_name: str = "Sound Card 1") -> list[dict]:
        db = self.root / "birdnet.db"
        database(db, with_sources, i2s_name)
        url = f"http://127.0.0.1:{self.server.server_address[1]}"
        env = {k: v for k, v in os.environ.items() if not k.startswith(("LIFE_", "BIRDNET_"))}
        env.update({"LIFE_API": url + "/api/v1", "BIRDNET_API": url + "/api/v2", "LIFE_DEVICE_TOKEN": "lo_dev_test",
                    "BIRDNET_DB": str(db), "LIFE_CURSOR": str(self.root / "cursor")})
        if test_sources is not None:
            env["LIFE_TEST_SOURCES"] = test_sources
        r = subprocess.run([sys.executable, "-B", str(PUSH)], env=env, capture_output=True, text=True, timeout=30)
        self.stderr = r.stderr
        self.assertEqual(r.returncode, 0, r.stderr)
        sound = [b for p, b in Oracle.posts if p == "/api/v1/ingest/sound"]
        return [d for b in sound for d in b["detections"]]

    def test_the_trial_microphone_s_birds_go_out_as_test(self):
        dets = self.push("AudioMoth")
        self.assertEqual(len(dets), 3)
        i2s, moth, bat = dets
        self.assertEqual(i2s["detector"], "birdnet-go:birdnet")
        self.assertNotIn("test", i2s)
        self.assertEqual(moth["detector"], "birdnet-go:birdnet@audiomoth")
        self.assertIs(moth["test"], True)
        self.assertEqual(moth["species"], "Eurasian Blackbird")
        self.assertEqual(bat["detector"], "birdnet-go:battybirdnet")  # its bats are the source's own job
        self.assertNotIn("test", bat)

    def test_names_match_whatever_their_case(self):
        dets = self.push("audiomoth")
        self.assertIs(dets[1]["test"], True)

    def test_nothing_is_test_without_the_setting(self):
        dets = self.push(None)
        self.assertEqual([d.get("test") for d in dets], [None, None, None])
        self.assertEqual(dets[1]["detector"], "birdnet-go:birdnet")

    def test_the_i2s_witness_is_always_test(self):
        # mode audiomoth: the AudioMoth's birds count, the I2S microphone beside it is the check and goes out as test
        i2s, moth, bat = self.push(None, i2s_name="I2S witness")
        self.assertIs(i2s["test"], True)
        self.assertEqual(i2s["detector"], "birdnet-go:birdnet@i2s-witness")
        self.assertNotIn("test", moth)
        self.assertNotIn("test", bat)

    def test_without_sources_in_the_database_it_says_so(self):
        dets = self.push("AudioMoth", with_sources=False)
        self.assertEqual([d.get("test") for d in dets], [None, None, None])
        self.assertIn("keeps no source", self.stderr)


if __name__ == "__main__":
    unittest.main()
