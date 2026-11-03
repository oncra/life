"""Tests for node/life-clips.py: BirdNET-Go's config, which clips are kept and how they are cut, sending them to the
oracle, a laptop taking them at a visit, a stick, and the bookkeeping surviving a power cut at each step.

    python3 -B -m unittest discover -s node/tests -v
    LIFE_STRESS=1 python3 -B -m unittest node/tests/test_life_clips.py -v      (the stress tests at full size)

Standard library only, and ffmpeg for the tests that cut real sound (skipped without it). BirdNET-Go is not needed:
its database is built here with the tables life-clips reads, and its config in the two layouts it comes in (the one
BirdNET-Go writes, four spaces and keys in order, and the annotated example with comments). The oracle is a small HTTP
server in the test that answers the two routes the node posts to, and can be told to fail in each way the real one can.
A power cut is a second process that stops dead (os._exit) at the step under test.
"""
import base64
import io
from contextlib import redirect_stdout
import fcntl
import hashlib
import hmac
import importlib.machinery
import importlib.util
import json
import os
import random
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from collections import Counter
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

NODE = Path(__file__).resolve().parents[1]
TZ = ZoneInfo("Europe/Amsterdam")
TOKEN = "lo_dev_" + "t" * 32
FFMPEG = shutil.which("ffmpeg")
STRESS = os.environ.get("LIFE_STRESS") == "1"

WRITTEN = """birdnet:
    locale: en
    threshold: 0.7
realtime:
    audio:
        export:
            bitrate: 96k
            debug: false
            enabled: false
            length: 15
            path: clips/
            precapture: 3
            retention:
                keepspectrograms: true
                policy: usage
            type: wav
        sources:
            - device: ":0,0"
              name: mic
    privacyfilter:
        confidence: 0.05
        enabled: true
        vad:
            enabled: false
            threshold: 0.35
"""

ANNOTATED = """birdnet:
  sensitivity: 1.0        # sigmoid sensitivity, 0.1 to 1.5
  threshold: 0.7          # threshold for prediction confidence to report, 0.0 to 1.0
realtime:
  audio:
    export:
      enabled: true       # true to export audio clips containing indentified bird calls
      path: clips/        # path to audio clip export directory
      type: wav           # wav, flac, aac, opus, mp3
      bitrate: 96k        # bitrate for aac, mp3 and opus exports
      retention:
        policy: usage     # retention policy: none, age or usage
        keepspectrograms: true # true to keep spectrograms even when clips are deleted
  privacyfilter:          # Privacy filter prevents audio clip saving if human voice
    enabled: true         # is detected durin audio capture
    confidence: 0.05      # threshold for human voice detection
"""

STUB_SCHEDULE = '''from datetime import datetime, timezone
def windows(d):
    """Test windows: 04:00 to 08:00 UTC on every day."""
    return [{"name": "dawn", "start": datetime(d.year, d.month, d.day, 4, tzinfo=timezone.utc),
             "end": datetime(d.year, d.month, d.day, 8, tzinfo=timezone.utc)}]
'''

V1 = """
    create table meta (key text primary key, value text);
    create table seen (cell text primary key, n integer not null);
    create table kept (
        id integer primary key, cell text not null, slot integer not null, file text not null,
        ts integer not null, scientific text not null, confidence real not null, band text not null,
        month text not null, detector text, collected integer not null default 0,
        unique (cell, slot));
"""

MAY = datetime(2026, 5, 4, 5, 0, tzinfo=timezone.utc)   # inside the stub's window
NOW = (MAY + timedelta(days=2)).timestamp()             # long after every detection: all settled
NOW_DT = datetime.fromtimestamp(NOW, timezone.utc)
LATER = (MAY + timedelta(days=40)).timestamp()          # after detections spread over May


def load(env: dict):
    """A fresh life-clips module with its constants read from `env`."""
    for k, v in env.items():
        os.environ[k] = v
    loader = importlib.machinery.SourceFileLoader(f"life_clips_{random.random()}", str(NODE / "life-clips.py"))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


OPEN: list[sqlite3.Connection] = []   # each test node's BirdNET-Go database, closed when the tests are done


def tearDownModule():
    for con in OPEN:
        con.close()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


class Node:
    """A node in a temporary directory: BirdNET-Go's database, config and clips, the clips' home, the node's state."""

    def __init__(self, tmp: Path, keep="1", anytime="0", all_from="1.01", ffmpeg="", api="http://127.0.0.1:9/api/v1", **env):
        self.tmp, self.bng, self.home, self.state = tmp, tmp / "birdnet-go", tmp / "life-clips", tmp / "life-node"
        self.export = self.bng / "clips"
        self.export.mkdir(parents=True)
        self.state.mkdir()
        (self.bng / "config.yaml").write_text(WRITTEN)
        (tmp / "schedule.py").write_text(STUB_SCHEDULE)
        self.db = sqlite3.connect(self.bng / "birdnet.db", check_same_thread=False)
        OPEN.append(self.db)
        self.db.execute("pragma journal_mode = wal")   # as BirdNET-Go keeps it
        self.db.executescript("""
            create table label_types (id integer primary key, name text);
            create table labels (id integer primary key, scientific_name text, label_type_id integer);
            create table ai_models (id integer primary key, name text);
            create table detections (id integer primary key, model_id integer, label_id integer, detected_at integer,
                                     confidence real, clip_name text, begin_time integer, end_time integer);
            insert into label_types values (1, 'species'), (2, 'human');
            insert into labels values (1, 'Turdus merula', 1), (2, 'Alauda arvensis', 1), (3, 'Human vocal', 2),
                                      (4, 'Pipistrellus pipistrellus', 1);
            insert into ai_models values (1, 'BirdNET GLOBAL 6K V2.4');
        """)
        self.n = 0
        self.env = {"BIRDNET_DIR": str(self.bng), "BIRDNET_DB": str(self.bng / "birdnet.db"),
                    "BIRDNET_CONFIG": str(self.bng / "config.yaml"), "BIRDNET_CLIPS": str(self.export),
                    "LIFE_CLIPS_DIR": str(self.home), "LIFE_SCHEDULE_WPI": str(tmp / "schedule.py"),
                    "LIFE_KEEP_CLIPS": keep, "LIFE_CLIPS_ANYTIME": anytime, "NODE_HOSTNAME": "node-test",
                    "NODE_TZ": "Europe/Amsterdam", "LIFE_CLIPS_ALL_FROM": all_from, "FFMPEG": ffmpeg, "LIFE_API": api,
                    "LIFE_DEVICE_TOKEN": TOKEN, "LIFE_STATE": str(self.state), "LIFE_CLIPS_UPLOAD": "1",
                    "LIFE_CLIPS_PER_BAND": "5", "LIFE_CLIPS_SECONDS": "7", "LIFE_CLIPS_KEEP_DAYS": "365",
                    "LIFE_CLIPS_MIN_FREE_MB": "0", "LIFE_CLIPS_TEMP": str(tmp / "temp"), "LIFE_CLIPS_HOT_C": "70", **env}
        self.way = ["wlan0"]   # the interface the node's traffic leaves by, as `ip route get` would say
        self.mod = self.module()

    def module(self):
        """A fresh copy of life-clips for this node, as another program on it would have it."""
        mod = load(self.env)
        mod.BIND = False
        mod.way_out = lambda: self.way[0] if self.way[0] in mod.WAYS else None   # as way_out decides (WayOut tests it)
        return mod

    def detect(self, label: int, conf: float, at: datetime, clip=True, spectrogram=False, audio: Path | None = None) -> Path | None:
        self.n += 1
        name = None
        if clip:
            sci = {1: "turdus_merula", 2: "alauda_arvensis", 3: "human_vocal", 4: "pipistrellus_pipistrellus"}[label]
            name = f"{at:%Y}/{at:%m}/{sci}_{round(conf * 100)}p_{at:%Y%m%dT%H%M%SZ}_{self.n}{audio.suffix if audio else '.opus'}"
            p = self.export / name
            p.parent.mkdir(parents=True, exist_ok=True)
            if audio:
                shutil.copyfile(audio, p)
            else:
                p.write_bytes(os.urandom(2000))
            if spectrogram:
                p.with_suffix(".png").write_bytes(b"png")
        self.db.execute("insert into detections values (?, 1, ?, ?, ?, ?, 0, 3000)", (self.n, label, int(at.timestamp()), conf, name))
        self.db.commit()
        return self.export / name if name else None

    def restart(self):
        """BirdNET-Go starts a new database: its detection ids start at 1 again."""
        self.db.execute("delete from detections")
        self.db.commit()
        self.n = 0

    def query(self, q: str, *args):
        con = sqlite3.connect(self.home / "state.db")
        try:
            con.row_factory = sqlite3.Row
            return [dict(r) for r in con.execute(q, args)]
        finally:
            con.close()

    def execute(self, q: str, *args):
        con = sqlite3.connect(self.home / "state.db")
        try:
            con.execute(q, args)
            con.commit()
        finally:
            con.close()

    def kept(self):
        return [tuple(r.values()) for r in self.query("select det, cell, slot, file, collected from kept order by seq")]

    def rows(self):
        return self.query("select * from kept order by seq")

    def waiting(self):
        return self.query("select * from kept where collected = 0 order by seq")

    def files(self):
        """Every clip file on the node outside BirdNET-Go's export directory."""
        return sorted(p.relative_to(self.home).as_posix() for d in ("incoming", "clips", "sample") if (self.home / d).exists()
                      for p in (self.home / d).rglob("*") if p.is_file())

    def status(self):
        return json.loads((self.home / "status.json").read_text())

    def agrees(self, test: unittest.TestCase):
        """The bookkeeping and the card agree: every waiting clip has its file, and every file is a waiting clip."""
        test.assertEqual(sorted(r["file"] for r in self.waiting()), self.files())
        for r in self.waiting():
            if r["sha256"]:
                test.assertEqual(sha((self.home / r["file"]).read_bytes()), r["sha256"])


def parse_multipart(ctype: str, body: bytes) -> tuple[dict, bytes | None, str | None]:
    boundary = ctype.split("boundary=", 1)[1].strip().strip('"').encode()
    fields, sound, filename = {}, None, None
    for chunk in body.split(b"--" + boundary)[1:]:
        if chunk.startswith(b"--"):
            break
        head, _, value = chunk[2:].partition(b"\r\n\r\n")
        value = value[:-2]
        disp = head.decode()
        name = re.search(r'name="([^"]*)"', disp).group(1)
        if name == "file":
            sound, filename = value, re.search(r'filename="([^"]*)"', disp).group(1)
        else:
            fields[name] = value.decode()
    return fields, sound, filename


class Oracle:
    """The oracle's clip routes, as far as the node uses them: POST /clips (multipart, kept once per clip name, its
    SHA-256 echoed) and POST /clips/bands. `mode` makes it fail: down (503), token (401), legacy (no SHA-256 in the
    answer), wrongsha (a wrong one), drop-once (the first connection closed without an answer)."""

    def __init__(self):
        self.clips, self.bands, self.posts, self.by_ref = {}, [], 0, Counter()
        self.mode, self.reject, self.before = "ok", set(), None
        oracle = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):
                pass

            def answer(self, code, obj):
                body = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                data = self.rfile.read(int(self.headers.get("content-length") or 0))
                oracle.posts += 1
                if oracle.mode == "drop-once":
                    oracle.mode = "ok"
                    self.close_connection = True
                    return
                if self.headers.get("authorization") != f"Bearer {TOKEN}" or oracle.mode == "token":
                    return self.answer(401, {"error": "unauthorized"})
                if oracle.mode == "down":
                    return self.answer(503, {"error": "down for maintenance"})
                if self.path == "/api/v1/clips/bands":
                    oracle.bands.append(json.loads(data)["rows"])
                    return self.answer(200, {"ok": True})
                fields, sound, filename = parse_multipart(self.headers["content-type"], data)
                ref = fields.get("detection")
                oracle.by_ref[ref] += 1
                if oracle.before:
                    oracle.before(ref)
                if ref in oracle.reject:
                    return self.answer(422, {"error": "not this one"})
                h = sha(sound)
                if fields.get("sha256") and fields["sha256"] != h:
                    return self.answer(422, {"error": "the file does not match its sha256"})

                def echo(s):
                    return {} if oracle.mode == "legacy" else {"sha256": "0" * 64 if oracle.mode == "wrongsha" else s}
                have = oracle.clips.get(ref)
                if have and fields.get("replace") != "1":
                    return self.answer(200, {"ok": True, "id": ref, "created": False, **echo(have["sha256"])})
                oracle.clips[ref] = {"sha256": h, "fields": fields, "file": filename, "bytes": len(sound)}
                return self.answer(200 if have else 201, {"ok": True, "id": ref, "created": not have, **echo(h)})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.api = f"http://127.0.0.1:{self.server.server_address[1]}/api/v1"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def make_song(path: Path):
    """A clip as BirdNET-Go writes it: 15 s of Opus at 48 kHz, a faint 3 kHz tone, 20 dB louder from 3 to 6 s."""
    subprocess.run([FFMPEG, "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=3000:sample_rate=48000:duration=15",
                    "-af", "volume=-30dB,volume=enable='between(t,3,6)':volume=20dB", "-c:a", "libopus", "-b:a", "32k", str(path)], check=True)


def make_bat(path: Path):
    """A bat clip from the AudioMoth: 15 s of WAV at 192 kHz, a 40 kHz tone, 20 dB louder from 3 to 6 s."""
    subprocess.run([FFMPEG, "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=40000:sample_rate=192000:duration=15",
                    "-af", "volume=-30dB,volume=enable='between(t,3,6)':volume=20dB", "-c:a", "pcm_s16le", str(path)], check=True)


def duration(path: Path) -> float:
    r = subprocess.run([shutil.which("ffprobe") or "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def peak(path: Path) -> float:
    r = subprocess.run([FFMPEG, "-nostdin", "-hide_banner", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True)
    return float(re.search(r"max_volume:\s*(-?[\d.]+) dB", r.stderr).group(1))


# a power cut: a second process runs the step and stops dead where the patch says
DRIVER = r'''
import importlib.machinery, importlib.util, os, random, sys
loader = importlib.machinery.SourceFileLoader("life_clips", sys.argv[1])
spec = importlib.util.spec_from_loader(loader.name, loader)
mod = importlib.util.module_from_spec(spec)
loader.exec_module(mod)
mod.BIND = False
mod.way_out = lambda: "wlan0"
exec(sys.argv[3])
if sys.argv[2] == "sample":
    mod.sample(random.Random(1), now=float(sys.argv[4]))
else:
    mod.upload()
'''

AFTER_MOVE = """
import shutil as _s
_move = _s.move
def _cut(a, b):
    _move(a, b)
    os._exit(9)
_s.move = _cut
"""

AFTER_CUT = """
_convert = mod.convert
def _cut(*a):
    _convert(*a)
    os._exit(9)
mod.convert = _cut
"""

AFTER_DROP = """
_drop = mod._drop_row
def _cut(*a):
    _drop(*a)
    os._exit(9)
mod._drop_row = _cut
"""

AFTER_POST = """
_post = mod.Oracle.post
def _cut(self, path, *a):
    out = _post(self, path, *a)
    if path == "/clips":
        os._exit(9)
    return out
mod.Oracle.post = _cut
"""


def power_cut(nd: Node, cmd: str, patch: str, now: float = NOW) -> int:
    r = subprocess.run([sys.executable, "-I", "-c", DRIVER, str(NODE / "life-clips.py"), cmd, patch, str(now)],
                       env={**os.environ, **nd.env}, capture_output=True, text=True, timeout=180)
    return r.returncode


class Config(unittest.TestCase):
    def setUp(self):
        self.mod = load({"LIFE_KEEP_CLIPS": "1"})

    def test_written_layout_on_then_off(self):
        text = WRITTEN
        for path, value in self.mod.ON:
            text, what = self.mod.yaml_set(text, path, value)
            self.assertIn(what, ("set", "same"), path)
        for path, value in self.mod.ON:
            self.assertEqual(self.mod.yaml_get(text, path), value, path)
        self.assertIn('            - device: ":0,0"', text)            # the list under sources is untouched
        self.assertEqual(self.mod.yaml_get(text, ("realtime", "privacyfilter", "vad", "threshold")), "0.35")
        for path, value in self.mod.OFF:
            text, _ = self.mod.yaml_set(text, path, value)
        self.assertEqual(self.mod.yaml_get(text, ("realtime", "audio", "export", "enabled")), "false")
        self.assertEqual(self.mod.yaml_get(text, ("birdnet", "threshold")), "0.7")
        self.assertEqual(self.mod.yaml_get(text, ("realtime", "audio", "export", "type")), "opus")  # off leaves the rest

    def test_annotated_layout_keeps_comments_and_adds_missing_keys(self):
        text = ANNOTATED
        for path, value in self.mod.ON:
            text, what = self.mod.yaml_set(text, path, value)
            if path[-2:] == ("vad", "enabled"):
                self.assertEqual(what, "added")                # the speech detector's block was not written out
        self.assertIn("  privacyfilter:          # Privacy filter prevents audio clip saving if human voice\n    vad:\n      enabled: true\n", text)
        self.assertEqual(self.mod.yaml_get(text, ("realtime", "privacyfilter", "confidence")), "0.05")  # siblings still in place
        self.assertEqual(self.mod.yaml_get(text, ("realtime", "privacyfilter", "vad", "enabled")), "true")
        self.assertIn("  threshold: 0.1          # threshold for prediction confidence to report", text)
        self.assertIn("      type: opus           # wav, flac, aac, opus, mp3", text)
        self.assertIn("        policy: none     # retention policy", text)
        self.assertEqual(self.mod.yaml_get(text, ("realtime", "audio", "export", "bitrate")), "32k")

    def test_added_key_takes_the_blocks_indent(self):
        text, what = self.mod.yaml_set("a:\n  b:\n    c: 1\n", ("a", "b", "d"), "2")
        self.assertEqual(what, "added")
        self.assertIn("\n    d: 2\n", text)
        self.assertEqual(self.mod.yaml_set("a:\n  b: 1\n", ("x", "y", "z"), "2")[1], "missing")  # no top-level block invented

    def test_setup_writes_only_what_changed(self):
        with tempfile.TemporaryDirectory() as t:
            cfg = Path(t) / "config.yaml"
            cfg.write_text(WRITTEN)
            mod = load({"BIRDNET_CONFIG": str(cfg), "LIFE_KEEP_CLIPS": "1"})
            mod.setup()
            first = cfg.read_text()
            self.assertEqual(mod.yaml_get(first, ("birdnet", "threshold")), "0.1")
            mtime = cfg.stat().st_mtime_ns
            time.sleep(0.01)
            mod.setup()
            self.assertEqual(cfg.stat().st_mtime_ns, mtime)      # nothing to change, nothing written


class Sample(unittest.TestCase):
    """The band sample on its own (LIFE_CLIPS_ALL_FROM above 1), without ffmpeg."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.node = Node(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def test_sample_keeps_five_per_band_and_deletes_the_rest(self):
        nd = self.node
        clips = [nd.detect(1, 0.85, MAY + timedelta(minutes=i), spectrogram=True) for i in range(12)]
        low = [nd.detect(1, 0.32, MAY + timedelta(minutes=20 + i)) for i in range(3)]
        voice = nd.detect(3, 0.9, MAY + timedelta(minutes=30))
        outside = nd.detect(2, 0.9, MAY.replace(hour=12))
        nd.detect(2, 0.9, MAY + timedelta(minutes=31), clip=False)    # the privacy filter wrote no clip
        nd.mod.sample(random.Random(1), now=NOW)
        rows = nd.kept()
        self.assertEqual(Counter(r[1] for r in rows), {"2026-05|Turdus merula|0.8": 5, "2026-05|Turdus merula|0.3": 3})
        for _, _, _, rel, _ in rows:
            self.assertTrue((nd.home / rel).is_file())
        for p in clips + low + [voice, outside]:
            self.assertFalse(p.exists(), p)                           # kept ones moved, the rest deleted
            self.assertFalse(p.with_suffix(".png").exists())          # and no spectrogram left beside them
        self.assertEqual(list(nd.export.rglob("*.opus")), [])
        nd.agrees(self)

    def test_unsettled_clips_wait_for_the_next_run(self):
        nd = self.node
        nd.detect(1, 0.85, MAY)
        young = nd.detect(1, 0.85, MAY + timedelta(minutes=50))
        nd.mod.sample(random.Random(1), now=(MAY + timedelta(minutes=55)).timestamp())
        self.assertTrue(young.exists())                               # BirdNET-Go may still be writing it
        self.assertEqual(len(nd.kept()), 1)
        nd.mod.sample(random.Random(1), now=NOW)
        self.assertFalse(young.exists())
        self.assertEqual(len(nd.kept()), 2)

    def test_reservoir_reaches_past_the_first_five(self):
        nd = self.node
        for i in range(200):
            nd.detect(2, 0.55, MAY + timedelta(minutes=i % 200, seconds=i))
        nd.mod.sample(random.Random(7), now=NOW)
        ids = [r[0] for r in nd.kept()]
        self.assertEqual(len(ids), 5)
        self.assertTrue(any(i > 5 for i in ids), ids)
        nd.agrees(self)

    def test_orphans_go_after_half_an_hour(self):
        nd = self.node
        old = nd.export / "2026/05/stray.opus"
        old.parent.mkdir(parents=True, exist_ok=True)
        old.write_bytes(b"x")
        os.utime(old, (NOW - 3600, NOW - 3600))
        fresh = nd.export / "2026/05/fresh.opus"
        fresh.write_bytes(b"x")
        os.utime(fresh, (NOW - 60, NOW - 60))
        nd.mod.sample(random.Random(1), now=NOW)
        self.assertFalse(old.exists())
        self.assertTrue(fresh.exists())

    def test_leftovers_of_a_power_cut_are_swept(self):
        nd = self.node
        part = nd.home / "clips/2026-05/20260504-070000_turdus_merula_0.8_1.m4a.part"   # a cut the power stopped
        stray = nd.home / "incoming/9_1777870800.opus"                                  # moved, never written down
        fresh = nd.home / "incoming/10_1777870800.opus"                                 # somebody's work in progress
        for p, age in ((part, 3600), (stray, 3600), (fresh, 60)):
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b"x")
            os.utime(p, (NOW - age, NOW - age))
        nd.mod.sample(random.Random(1), now=NOW)
        self.assertEqual((part.exists(), stray.exists(), fresh.exists()), (False, False, True))

    def test_a_waiting_clip_whose_file_is_gone_is_marked_lost(self):
        nd = self.node
        nd.detect(1, 0.85, MAY)
        nd.detect(1, 0.85, MAY + timedelta(minutes=1))
        nd.mod.sample(random.Random(1), now=NOW)
        first = nd.rows()[0]
        (nd.home / first["file"]).unlink()                             # deleted just before a commit a power cut undid
        nd.mod.sample(random.Random(1), now=NOW)
        self.assertEqual([(r["collected"], r["via"]) for r in nd.rows()], [(1, "lost"), (0, None)])
        self.assertEqual(nd.status()["waiting"], 1)
        nd.agrees(self)

    def test_nothing_is_kept_for_ever(self):
        nd = self.node
        nd.detect(1, 0.85, MAY)
        nd.mod.sample(random.Random(1), now=NOW)
        self.assertEqual(len(nd.kept()), 1)
        nd.mod.sample(random.Random(1), now=NOW + 400 * 86400)
        self.assertEqual(nd.kept(), [])
        self.assertEqual(nd.files(), [])

    def test_switched_off_deletes_everything(self):
        nd = self.node
        nd.detect(1, 0.85, MAY)
        nd.mod.sample(random.Random(1), now=NOW)
        stray = nd.detect(1, 0.85, MAY + timedelta(minutes=1))
        load({**nd.env, "LIFE_KEEP_CLIPS": "0"}).sample(random.Random(1), now=NOW)
        self.assertFalse(stray.exists())
        self.assertEqual(nd.files(), [])
        self.assertEqual(nd.status()["waiting"], 0)


class KeepAll(unittest.TestCase):
    """Every clip from LIFE_CLIPS_ALL_FROM up, the band sample below it."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.node = Node(self.tmp / "n", all_from="0.5")

    def tearDown(self):
        self._tmp.cleanup()

    def test_every_clip_from_half_up_is_kept_and_below_it_sampled(self):
        nd = self.node
        for i in range(12):
            nd.detect(1, 0.85, MAY + timedelta(minutes=i))
        for i in range(3):
            nd.detect(2, 0.55, MAY + timedelta(minutes=12 + i))
        for i in range(20):
            nd.detect(1, 0.32, MAY + timedelta(minutes=15 + i))
        nd.mod.sample(random.Random(1), now=NOW)
        self.assertEqual(Counter((r["band"], r["slot"] is None) for r in nd.rows()),
                         {("0.8", True): 12, ("0.5", True): 3, ("0.3", False): 5})
        con = nd.mod.connect()
        weights = {(b["scientific"], b["band"]): (b["detections"], b["kept"]) for b in nd.mod.band_rows(con)}
        con.close()
        self.assertEqual(weights, {("Turdus merula", "0.8"): (12, 12), ("Alauda arvensis", "0.5"): (3, 3), ("Turdus merula", "0.3"): (20, 5)})
        nd.agrees(self)

    def test_short_of_space_only_the_band_sample_grows(self):
        nd = Node(self.tmp / "full", all_from="0.5", LIFE_CLIPS_MIN_FREE_MB=str(10 ** 12))
        for i in range(12):
            nd.detect(1, 0.85, MAY + timedelta(minutes=i))
        nd.mod.sample(random.Random(1), now=NOW)
        self.assertEqual(len(nd.kept()), 5)
        self.assertTrue(nd.status()["full"])
        con = self.node.mod.connect()
        self.assertFalse(self.node.mod.status(con)["full"])
        con.close()

    def test_names_stay_unique_when_birdnet_starts_a_new_database(self):
        nd = self.node
        for i in range(3):
            nd.detect(1, 0.85, MAY + timedelta(minutes=i))
        nd.mod.sample(random.Random(1), now=NOW)
        nd.restart()
        for i in range(2):   # fewer than before: the new ids stay below where the last run stopped
            nd.detect(1, 0.85, MAY + timedelta(minutes=10 + i))
        nd.mod.sample(random.Random(1), now=NOW)
        nd.restart()
        for i in range(5):   # more than before: the new ids pass it again, and the same id is another detection
            nd.detect(2, 0.85, MAY + timedelta(minutes=20 + i))
        nd.mod.sample(random.Random(1), now=NOW)
        rows = nd.rows()
        self.assertEqual(len({r["ref"] for r in rows}), 10)
        self.assertEqual(sorted(r["det"] for r in rows), [1, 1, 1, 2, 2, 2, 3, 3, 4, 5])
        self.assertEqual(len(nd.files()), 10)                         # no clip written over another
        nd.agrees(self)

    def test_a_clip_moved_just_before_a_power_cut_is_found_again(self):
        nd = self.node
        p = nd.detect(1, 0.85, MAY)
        ts = int(MAY.timestamp())
        data = p.read_bytes()
        moved = nd.home / "incoming" / f"1_{ts}.opus"
        moved.parent.mkdir(parents=True)
        shutil.move(p, moved)                                          # what the run did just before the power went
        nd.mod.sample(random.Random(1), now=NOW)
        rows = nd.rows()
        self.assertEqual([(r["ref"], r["file"]) for r in rows], [(f"1@{ts}", f"incoming/1_{ts}.opus")])
        self.assertEqual((nd.home / rows[0]["file"]).read_bytes(), data)
        nd.execute("delete from meta where key in ('cursor', 'cursor_ts')")   # read again from the start: still kept once
        nd.mod.sample(random.Random(1), now=NOW)
        self.assertEqual(len(nd.rows()), 1)
        nd.agrees(self)


@unittest.skipUnless(FFMPEG, "ffmpeg is not installed")
class Cut(unittest.TestCase):
    """The node cuts each kept clip to its final form: seven seconds from the detection, levelled, AAC."""

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.song, cls.bat = Path(cls._tmp.name) / "song.opus", Path(cls._tmp.name) / "bat.wav"
        make_song(cls.song)
        make_bat(cls.bat)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.node = Node(Path(self._dir.name), all_from="0.5", ffmpeg=FFMPEG)

    def tearDown(self):
        self._dir.cleanup()

    def test_a_clip_is_cut_to_seven_seconds_from_the_detection_and_levelled(self):
        nd = self.node
        nd.detect(1, 0.85, MAY, audio=self.song)
        nd.mod.sample(random.Random(1), now=NOW)
        r = nd.rows()[0]
        self.assertEqual(r["file"], "clips/2026-05/20260504-070000_turdus_merula_0.8_1.m4a")   # local time first
        self.assertEqual((r["clip_s"], r["from_s"], r["to_s"], r["expansion"], r["error"]), (7.0, 0.0, 3.0, None, None))
        self.assertAlmostEqual(r["gain_db"], 26, delta=2)              # the tone peaks near -28 dBFS in its loud part
        out = nd.home / r["file"]
        self.assertEqual((r["sha256"], r["bytes"]), (sha(out.read_bytes()), out.stat().st_size))
        self.assertLess(r["bytes"], 100_000)
        self.assertAlmostEqual(duration(out), 7.0, delta=0.15)
        self.assertAlmostEqual(peak(out), -2.0, delta=1.5)
        self.assertEqual(nd.files(), [r["file"]])                      # BirdNET-Go's 15 seconds are gone

    def test_a_bat_is_cut_to_its_three_seconds_and_slowed_ten_times(self):
        nd = self.node
        nd.detect(4, 0.7, MAY, audio=self.bat)
        nd.mod.sample(random.Random(1), now=NOW)
        r = nd.rows()[0]
        self.assertEqual(r["file"], "clips/2026-05/20260504-070000_pipistrellus_pipistrellus_0.7_1.x10.m4a")
        self.assertEqual((r["clip_s"], r["from_s"], r["to_s"], r["expansion"]), (3.2, 0.1, 3.1, 10))   # in recording seconds
        self.assertAlmostEqual(duration(nd.home / r["file"]), 32.0, delta=0.3)

    def test_a_clip_ffmpeg_cannot_read_stays_as_birdnet_wrote_it(self):
        nd = self.node
        data = nd.detect(1, 0.85, MAY).read_bytes()                    # not sound at all
        nd.mod.sample(random.Random(1), now=NOW)
        r = nd.rows()[0]
        ts = int(MAY.timestamp())
        self.assertEqual(r["file"], f"incoming/1_{ts}.opus")
        self.assertTrue(r["error"].startswith("not cut:"), r["error"])
        self.assertEqual((r["clip_s"], r["from_s"], r["to_s"], r["sha256"]), (15.0, 3.0, 6.0, sha(data)))
        self.assertEqual((nd.home / r["file"]).read_bytes(), data)

    def test_a_power_cut_after_cutting_a_clip(self):
        nd = self.node
        nd.detect(1, 0.85, MAY, audio=self.song)
        self.assertEqual(power_cut(nd, "sample", AFTER_CUT), 9)
        self.assertEqual(len(nd.files()), 2)                           # the cut clip and BirdNET-Go's, its row unchanged
        nd.mod.sample(random.Random(1), now=NOW)
        r = nd.rows()[0]
        self.assertEqual(nd.files(), [r["file"]])
        self.assertTrue(r["file"].endswith(".m4a"))
        nd.agrees(self)


class Busy(unittest.TestCase):
    """Cutting and sending wait while the bat model runs or the processor is hot, and a visit takes everything."""

    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.node = Node(Path(self._dir.name), all_from="0.5")    # no ffmpeg: a clip is "left as BirdNET-Go wrote it"

    def tearDown(self):
        self._dir.cleanup()

    def bats(self, state: str, at: datetime = NOW_DT):
        (self.node.state / "bats.json").write_text(json.dumps({"last": {"at": at.isoformat(), "state": state, "boot": "b"}}))

    def test_cutting_waits_while_the_bat_model_runs(self):
        nd = self.node
        nd.detect(4, 0.8, MAY)
        self.bats("on")
        nd.mod.sample(random.Random(1), now=NOW)
        r = nd.rows()[0]
        self.assertIsNone(r["sha256"])                                 # kept, not cut: it waits on the card
        self.assertTrue(r["file"].startswith("incoming/"))
        self.bats("day")
        nd.mod.sample(random.Random(1), now=NOW + 600)
        self.assertIsNotNone(nd.rows()[0]["sha256"])                   # the next free run takes it
        nd.agrees(self)

    def test_an_old_bat_decision_does_not_hold_it(self):
        nd = self.node
        nd.detect(4, 0.8, MAY)
        self.bats("on", at=NOW_DT - timedelta(hours=2))               # the node stopped mid-evening and came back
        nd.mod.sample(random.Random(1), now=NOW)
        self.assertIsNotNone(nd.rows()[0]["sha256"])

    def test_cutting_waits_while_the_processor_is_hot(self):
        nd = self.node
        nd.detect(1, 0.8, MAY)
        (nd.tmp / "temp").write_text("74000\n")
        nd.mod.sample(random.Random(1), now=NOW)
        self.assertIsNone(nd.rows()[0]["sha256"])
        (nd.tmp / "temp").write_text("61000\n")
        nd.mod.sample(random.Random(1), now=NOW + 600)
        self.assertIsNotNone(nd.rows()[0]["sha256"])

    def test_a_visit_cuts_what_waits(self):
        nd = self.node
        nd.detect(1, 0.8, MAY)
        nd.detect(4, 0.9, MAY)
        self.bats("on")
        nd.mod.sample(random.Random(1), now=NOW)
        self.assertEqual([r["sha256"] for r in nd.rows()], [None, None])
        nd.mod.cut_all()
        self.assertTrue(all(r["sha256"] for r in nd.rows()))
        nd.agrees(self)

    def test_sending_waits_while_busy(self):
        nd = self.node
        (nd.tmp / "temp").write_text("79000\n")
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(nd.mod.upload(5), 0)
        self.assertIn("sending waits: the processor is at 79 °C", out.getvalue())


class Upload(unittest.TestCase):
    """The node sends its clips itself, over the cable or the WiFi, and deletes each once the oracle has it."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.oracle = Oracle()
        self.node = Node(Path(self._tmp.name), all_from="0.5", api=self.oracle.api)
        for i in range(6):
            self.node.detect(1 + i % 2, 0.85, MAY + timedelta(minutes=i))
        self.node.mod.sample(random.Random(1), now=NOW)

    def tearDown(self):
        self.oracle.close()
        self._tmp.cleanup()

    def test_sends_what_waits_and_deletes_it_once_the_oracle_has_it(self):
        nd, o = self.node, self.oracle
        rows = nd.rows()
        self.assertEqual(nd.mod.upload(), 0)
        self.assertEqual(sorted(o.clips), sorted(r["ref"] for r in rows))
        for r in rows:
            c = o.clips[r["ref"]]
            self.assertEqual(c["sha256"], r["sha256"])
            self.assertEqual((c["fields"]["scientific"], c["fields"]["score"], c["fields"]["band"]), (r["scientific"], "0.850", "0.8"))
            self.assertEqual(c["fields"]["time_utc"], datetime.fromtimestamp(r["ts"], timezone.utc).isoformat(timespec="seconds"))
            self.assertEqual((c["fields"]["clip_s"], c["fields"]["detection_from_s"], c["fields"]["detection_to_s"]), ("15.0", "3.0", "6.0"))
        self.assertEqual(nd.files(), [])
        self.assertEqual({(r["collected"], r["via"]) for r in nd.rows()}, {(1, "upload")})
        self.assertEqual(nd.status()["waiting"], 0)
        self.assertTrue(nd.status()["sentAt"])
        self.assertEqual(len(o.bands), 1)                              # the band counts, once, after a run that sent clips
        self.assertEqual({(b["scientific"], b["band"], b["detections"], b["kept"]) for b in o.bands[0]},
                         {("Turdus merula", "0.8", 3, 3), ("Alauda arvensis", "0.8", 3, 3)})
        nd.mod.upload()
        self.assertEqual(o.posts, 7)                                   # nothing left, nothing posted
        self.assertEqual(max(o.by_ref.values()), 1)

    def test_never_over_the_sim(self):
        nd, o = self.node, self.oracle
        for way in (None, "usb0"):
            nd.way[0] = way
            nd.mod.upload()
        self.assertEqual(o.posts, 0)
        self.assertEqual(len(nd.files()), 6)

    def test_an_oracle_that_is_down_stops_the_run_and_deletes_nothing(self):
        nd, o = self.node, self.oracle
        o.mode = "down"
        nd.mod.upload()
        self.assertEqual(o.posts, 1)
        self.assertEqual(len(nd.files()), 6)
        self.assertEqual({r["tries"] for r in nd.rows()}, {0})         # the link failed, not the clip
        self.assertIn("503", nd.status()["upload"])
        o.mode = "ok"
        nd.mod.upload()
        self.assertEqual(nd.files(), [])

    def test_a_refused_clip_waits_and_the_rest_go(self):
        nd, o = self.node, self.oracle
        first = nd.rows()[0]["ref"]
        o.reject = {first}
        nd.mod.upload()
        self.assertEqual(len(o.clips), 5)
        r = nd.waiting()[0]
        self.assertEqual((r["ref"], r["tries"]), (first, 1))
        self.assertGreater(r["next_try"], time.time() + 500)
        self.assertTrue(r["error"].startswith("422"))
        before = o.by_ref[first]
        nd.mod.upload()
        self.assertEqual(o.by_ref[first], before)                      # not before its time
        o.reject = set()
        nd.execute("update kept set next_try = 0")
        nd.mod.upload()
        self.assertEqual(len(o.clips), 6)
        self.assertEqual(nd.files(), [])

    def test_a_clip_refused_ten_times_is_left_for_a_stick(self):
        nd, o = self.node, self.oracle
        first = nd.rows()[0]["ref"]
        o.reject = {first}
        for _ in range(14):
            nd.execute("update kept set next_try = 0")
            nd.mod.upload()
        self.assertEqual(o.by_ref[first], 10)
        self.assertEqual([r["ref"] for r in nd.waiting()], [first])

    def test_a_wrong_checksum_from_the_oracle_deletes_nothing(self):
        nd, o = self.node, self.oracle
        o.mode = "wrongsha"
        nd.mod.upload()
        self.assertEqual(len(nd.files()), 6)
        self.assertEqual({(r["collected"], r["tries"]) for r in nd.rows()}, {(0, 1)})

    def test_an_oracle_without_checksums_deletes_nothing(self):
        nd, o = self.node, self.oracle
        o.mode = "legacy"
        nd.mod.upload()
        self.assertEqual(len(nd.files()), 6)
        self.assertEqual(o.posts, 6)

    def test_an_earlier_send_with_other_sound_is_replaced(self):
        nd, o = self.node, self.oracle
        r = nd.rows()[0]
        o.clips[r["ref"]] = {"sha256": "f" * 64, "fields": {}, "file": "old.m4a", "bytes": 1}
        nd.mod.upload()
        self.assertEqual(o.clips[r["ref"]]["sha256"], r["sha256"])
        self.assertEqual(o.by_ref[r["ref"]], 2)
        self.assertEqual(nd.files(), [])

    def test_a_way_out_that_changes_mid_run_stops_it(self):
        nd, o = self.node, self.oracle
        o.before = lambda ref: nd.way.__setitem__(0, "usb0")           # the phone walks away, the 4G takes over
        nd.mod.upload()
        self.assertEqual(len(o.clips), 1)
        self.assertEqual(len(nd.files()), 5)
        self.assertEqual(o.bands, [])                                  # nothing more after the change, not even counts
        self.assertEqual(nd.status()["upload"], "the way out changed")

    def test_a_dropped_connection_is_tried_again(self):
        nd, o = self.node, self.oracle
        o.mode = "drop-once"
        nd.mod.upload()
        self.assertEqual(len(o.clips), 6)
        self.assertEqual(nd.files(), [])

    def test_a_refused_token_stops_the_run(self):
        nd, o = self.node, self.oracle
        o.mode = "token"
        nd.mod.upload()
        self.assertEqual(o.posts, 1)
        self.assertEqual(len(nd.files()), 6)
        self.assertIn("401", nd.status()["upload"])

    def test_one_upload_at_a_time(self):
        nd, o = self.node, self.oracle
        with open(nd.home / ".upload-lock", "w") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            nd.mod.upload()
        self.assertEqual(o.posts, 0)

    def test_without_a_token_or_switched_off_nothing_is_sent(self):
        nd, o = self.node, self.oracle
        nd.mod.TOKEN = ""
        nd.mod.upload()
        nd.mod.TOKEN, nd.mod.UPLOAD = TOKEN, False
        nd.mod.upload()
        self.assertEqual(o.posts, 0)

    def test_the_time_given_ends_a_run(self):
        nd, o = self.node, self.oracle
        nd.mod.upload(seconds=0)
        self.assertEqual(o.posts, 0)

    def test_a_power_cut_after_the_oracle_has_a_clip(self):
        nd, o = self.node, self.oracle
        self.assertEqual(power_cut(nd, "upload", AFTER_POST), 9)
        self.assertEqual(len(o.clips), 1)
        self.assertEqual(len(nd.files()), 6)                           # the node had not yet marked it sent
        nd.mod.upload()
        self.assertEqual(len(o.clips), 6)                              # and the oracle keeps no clip twice
        self.assertEqual(nd.files(), [])
        self.assertEqual({r["via"] for r in nd.rows()}, {"upload"})


FAKE_IP = """#!/bin/sh
case "$*" in
  "-4 route get"*) dev=$(cat "$WAY4") ;;
  "-6 route get"*) dev=$(cat "$WAY6" 2>/dev/null) ;;
  *) exit 1 ;;
esac
[ -n "$dev" ] || { echo "RTNETLINK answers: Network is unreachable" >&2; exit 2; }
echo "$4 via 10.0.0.1 dev $dev src 10.0.0.2 uid 0"
echo "    cache"
"""


class WayOut(unittest.TestCase):
    """way_out itself, with `ip` a fake on PATH that answers `route get` from two files the test rewrites."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        t = Path(self._tmp.name)
        (t / "ip").write_text(FAKE_IP)
        (t / "ip").chmod(0o755)
        self.way4, self.way6 = t / "way4", t / "way6"
        self.path = os.environ["PATH"]
        os.environ.update({"PATH": f"{t}:{self.path}", "WAY4": str(self.way4), "WAY6": str(self.way6)})
        self.mod = load({"LIFE_KEEP_CLIPS": "1"})

    def tearDown(self):
        os.environ["PATH"] = self.path
        self._tmp.cleanup()

    def way(self, v4: str, v6: str | None = None):
        self.way4.write_text(v4)
        if v6 is None:
            self.way6.unlink(missing_ok=True)
        else:
            self.way6.write_text(v6)
        return self.mod.way_out()

    def test_only_the_cable_or_the_wifi(self):
        self.assertEqual(self.way("wlan0"), "wlan0")                   # a phone's hotspot, IPv4 only
        self.assertEqual(self.way("eth0", "eth0"), "eth0")
        self.assertEqual(self.way("wlan0", "wlan0"), "wlan0")
        for v4, v6 in (("usb0", None), ("eth1", None), ("wwan0", None), ("", None), ("wlan0", "usb0"), ("eth0", "wwan0")):
            self.assertIsNone(self.way(v4, v6), (v4, v6))              # the stick, no way out, or IPv6 over the SIM

    def test_reads_the_interface(self):
        self.assertEqual(self.mod.device("1.1.1.1 via 192.168.2.254 dev wlan0 src 192.168.2.114 uid 0\n    cache\n"), "wlan0")
        self.assertIsNone(self.mod.device("unreachable 2606:4700:4700::1111 from :: dev lo proto kernel src ::1 metric 4294967295"))
        self.assertIsNone(self.mod.device(""))


class Laptop(unittest.TestCase):
    """A laptop on the node's own WiFi downloads the clips; the node deletes them once the oracle has the batch."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.node = Node(self.tmp / "n", all_from="0.5")
        for i in range(6):
            self.node.detect(1, 0.85, MAY + timedelta(minutes=i))
        self.node.mod.sample(random.Random(1), now=NOW)
        (self.node.state / "visit.json").write_text(json.dumps({"device": "dev_1", "rev": 3}))

    def tearDown(self):
        self._tmp.cleanup()

    def test_the_manifest_lists_the_waiting_clips_in_order(self):
        nd = self.node
        m = nd.mod.manifest()
        self.assertEqual([c["detection"] for c in m], [r["ref"] for r in nd.rows()])
        self.assertLessEqual({"seq", "file", "bytes", "sha256", "detection", "time_utc", "scientific", "score", "band", "clip_s"}, set(m[0]))
        page = nd.mod.manifest(after=m[1]["seq"], limit=2)
        self.assertEqual([c["seq"] for c in page], [m[2]["seq"], m[3]["seq"]])

    def test_only_waiting_clips_are_served(self):
        nd = self.node
        f = nd.rows()[0]["file"]
        self.assertEqual(nd.mod.clip_file(f), (nd.home / f).resolve())
        for bad in ("state.db", "../life-node/visit.json", "incoming/../state.db", "/etc/passwd", ""):
            self.assertIsNone(nd.mod.clip_file(bad), bad)
        nd.execute("update kept set collected = 1 where file = ?", f)
        self.assertIsNone(nd.mod.clip_file(f))

    def test_a_handover_grants_exactly_those_clips(self):
        nd = self.node
        rows = nd.rows()[:3]
        out = nd.mod.handover([r["ref"] for r in rows] + ["999@1"], "a laptop")
        self.assertEqual(out["n"], 3)
        tag, p, s = out["grant"].split(".")
        self.assertEqual(tag, "lg1")
        key = sha(TOKEN.encode()).encode()                             # what the oracle keeps of the node's token
        self.assertTrue(hmac.compare_digest(s, b64url(hmac.new(key, p.encode(), hashlib.sha256).digest())))
        payload = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))
        self.assertEqual((payload["v"], payload["d"], payload["b"], payload["n"]), (1, "dev_1", out["batch"], 3))
        self.assertEqual(payload["h"], sha("".join(f"{r['ref']} {r['sha256']}\n" for r in sorted(rows, key=lambda r: r["ref"])).encode()))
        self.assertAlmostEqual(payload["e"], time.time() + 90 * 86400, delta=60)
        self.assertEqual(len(nd.files()), 6)                           # still on the node until the oracle has them
        self.assertEqual(nd.status()["handed"], f"{out['batch']}:3")

    def test_the_handover_lists_what_it_signed(self):
        nd = self.node
        rows = nd.rows()[:3]
        out = nd.mod.handover([r["ref"] for r in rows] + ["999@1"], "a laptop")
        want = sorted(({"ref": r["ref"], "sha256": r["sha256"]} for r in rows), key=lambda i: i["ref"])
        self.assertEqual(out["items"], want)                           # the ref the node does not have is left out
        self.assertEqual(out["hash"], sha("".join(f"{i['ref']} {i['sha256']}\n" for i in want).encode()))

    def test_counts_say_what_a_visit_finds(self):
        nd = self.node
        self.assertEqual(nd.mod.counts(now=NOW), {"waiting": 6, "mb": round(sum(r["bytes"] for r in nd.rows()) / 1e6, 1), "ready": 6})
        nd.execute("update kept set tries = 10 where seq = (select min(seq) from kept)")   # refused too often
        nd.execute("update kept set next_try = ? where seq = (select max(seq) from kept)", int(NOW) + 600)
        self.assertEqual(nd.mod.counts(now=NOW)["ready"], 4)
        self.assertEqual(nd.mod.counts(now=NOW)["waiting"], 6)          # a laptop can still take those two

    def test_the_heartbeat_answer_deletes_a_received_batch(self):
        nd = self.node
        out = nd.mod.handover([r["ref"] for r in nd.rows()[:3]])

        def apply(answer: str):
            r = subprocess.run([sys.executable, "-I", str(NODE / "life-clips.py"), "apply"], input=answer,
                               env={**os.environ, **nd.env}, capture_output=True, text=True, timeout=60)
            self.assertEqual(r.returncode, 0, r.stderr)

        for answer in ("", "not json", "[]", "{}", json.dumps({"clipsReceived": "x"}),
                       json.dumps({"clipsReceived": ["../x", 5, out["batch"].upper()]})):
            apply(answer)                                              # nothing it can use: nothing happens
        self.assertEqual(len(nd.files()), 6)
        apply(json.dumps({"ok": True, "maintenance": None, "clipsReceived": [out["batch"]]}))
        self.assertEqual(len(nd.files()), 3)
        self.assertIsNone(nd.status()["handed"])
        nd.agrees(self)

    def test_the_oracles_receipt_deletes_the_batch(self):
        nd = self.node
        out = nd.mod.handover([r["ref"] for r in nd.rows()[:3]])
        self.assertEqual(nd.mod.receipt([out["batch"], "abcdef123456"]), 3)
        self.assertEqual(len(nd.files()), 3)
        self.assertEqual([r["via"] for r in nd.rows()], ["laptop"] * 3 + [None] * 3)
        self.assertIsNone(nd.status()["handed"])
        self.assertEqual(nd.mod.receipt([out["batch"]]), 0)            # said twice: nothing more happens
        nd.agrees(self)

    def test_handed_again_in_a_new_batch(self):
        nd = self.node
        refs = [r["ref"] for r in nd.rows()]
        a, b = nd.mod.handover(refs[:3]), nd.mod.handover(refs[:4])    # the laptop lost the first copy and came back
        self.assertEqual(nd.mod.receipt([b["batch"]]), 4)
        self.assertEqual(nd.mod.receipt([a["batch"]]), 0)
        self.assertEqual(len(nd.files()), 2)
        self.assertIsNone(nd.status()["handed"])

    def test_without_its_id_the_node_hands_nothing_over(self):
        nd = self.node
        (nd.state / "visit.json").unlink()
        out = nd.mod.handover([r["ref"] for r in nd.rows()])
        self.assertEqual((out["batch"], out["grant"]), (None, None))
        self.assertIn("error", out)
        self.assertIsNone(nd.status()["handed"])

    def test_a_handed_clip_keeps_its_place_in_the_band_sample(self):
        nd = Node(self.tmp / "r")
        for i in range(5):
            nd.detect(1, 0.85, MAY + timedelta(minutes=i))
        nd.mod.sample(random.Random(1), now=NOW)
        (nd.state / "visit.json").write_text(json.dumps({"device": "dev_1", "rev": 3}))
        handed = {r["ref"] for r in nd.rows()}
        nd.mod.handover(sorted(handed))
        for i in range(30):
            nd.detect(1, 0.85, MAY + timedelta(days=1, minutes=i))
        nd.mod.sample(random.Random(1), now=NOW + 86400)
        self.assertEqual({r["ref"] for r in nd.waiting()}, handed)
        nd.agrees(self)


class Stick(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.node = Node(Path(self._tmp.name))
        self.stick = Path(self._tmp.name) / "stick"
        self.stick.mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def test_collect_copies_checks_and_clears(self):
        nd = self.node
        for i in range(7):
            nd.detect(1, 0.85, MAY + timedelta(minutes=i))
        nd.mod.sample(random.Random(3), now=NOW)
        refs = {r["ref"]: r["sha256"] for r in nd.rows()}
        self.assertEqual(nd.mod.collect(self.stick), 0)
        runs = list((self.stick / "life-clips" / "node-test").iterdir())
        self.assertEqual(len(runs), 1)
        run = runs[0]
        lines = (run / "clips.csv").read_text().strip().splitlines()
        self.assertEqual(len(lines), 6)                               # header and five clips
        self.assertEqual(lines[0], "file,detection,time_local,time_utc,scientific,score,band,detector,clip_s,detection_from_s,"
                                   "detection_to_s,label,true_species,checked_by,note,ref,sha256,source,gain_db,expansion,ready")
        self.assertIn(",Turdus merula,0.850,0.8,birdnet-go:birdnet,15,3,6,", lines[1])
        cols = lines[1].split(",")
        self.assertEqual((refs.get(cols[15]), cols[-1]), (cols[16], "0"))   # BirdNET-Go's clip as it was: not ready to send as is
        sums = (run / "SHA256SUMS").read_text().splitlines()
        self.assertEqual(len(sums), 6)                                # five clips and the band list
        for line in sums:
            h, name = line.split("  ")
            self.assertEqual(nd.mod.sha256(run / name), h)
        bands = (run / "bands.csv").read_text().strip().splitlines()
        self.assertEqual(bands[0], "month,scientific,band,detections,kept,as_of_utc")
        self.assertTrue(bands[1].startswith("2026-05,Turdus merula,0.8,7,5,"))  # seven heard, five kept: weight 7/5
        self.assertTrue((run / "RECEIPT.txt").read_text().startswith("5 clips"))
        self.assertEqual(nd.files(), [])                              # gone from the node
        self.assertEqual({r["via"] for r in nd.rows()}, {"stick"})
        st = nd.status()
        self.assertEqual((st["waiting"], bool(st["collectedAt"])), (0, True))

    def test_a_collected_place_stays_taken_that_month(self):
        nd = self.node
        for i in range(5):
            nd.detect(1, 0.85, MAY + timedelta(minutes=i))
        nd.mod.sample(random.Random(3), now=NOW)
        nd.mod.collect(self.stick)
        later = [nd.detect(1, 0.85, MAY + timedelta(days=1, minutes=i)) for i in range(20)]
        nd.mod.sample(random.Random(3), now=NOW + 86400)
        self.assertEqual(nd.waiting(), [])                            # five already went this month: no sixth
        for p in later:
            self.assertFalse(p.exists())

    def test_a_bad_copy_deletes_nothing(self):
        nd = self.node
        nd.detect(1, 0.85, MAY)
        nd.mod.sample(random.Random(3), now=NOW)
        real = nd.mod.sha256
        nd.mod.sha256 = lambda p: "0" * 64 if str(self.stick) in str(p) else real(p)
        self.assertEqual(nd.mod.collect(self.stick), 1)
        self.assertEqual(len(nd.files()), 1)
        self.assertTrue(next((self.stick / "life-clips" / "node-test").iterdir()).joinpath("FAILED.txt").exists())


class Migration(unittest.TestCase):
    def test_version_one_bookkeeping_moves_over(self):
        with tempfile.TemporaryDirectory() as t:
            nd = Node(Path(t), all_from="0.5")
            for i in range(8):
                nd.detect(1, 0.85, MAY + timedelta(minutes=i), clip=False)   # ids 1 to 8, from before
            ts7, ts8 = int((MAY + timedelta(minutes=6)).timestamp()), int((MAY + timedelta(minutes=7)).timestamp())
            nd.home.mkdir()
            con = sqlite3.connect(nd.home / "state.db")
            con.executescript(V1)
            old = nd.home / "sample/2026-05/7_turdus_merula_0.8.opus"
            old.parent.mkdir(parents=True)
            old.write_bytes(b"a clip from the old sample")
            cell = "2026-05|Turdus merula|0.8"
            con.execute("insert into kept values (7, ?, 0, 'sample/2026-05/7_turdus_merula_0.8.opus', ?, 'Turdus merula', 0.85, '0.8', '2026-05', 'birdnet-go:birdnet', 0)", (cell, ts7))
            con.execute("insert into kept values (8, ?, 1, 'sample/2026-05/8_turdus_merula_0.8.opus', ?, 'Turdus merula', 0.85, '0.8', '2026-05', 'birdnet-go:birdnet', 1)", (cell, ts8))
            con.execute("insert into seen values (?, 8)", (cell,))
            con.execute("insert into meta values ('cursor', '8')")
            con.commit()
            con.close()
            nd.detect(2, 0.9, MAY + timedelta(minutes=9))
            ts9 = int((MAY + timedelta(minutes=9)).timestamp())
            for _ in range(2):                                          # and a second run changes nothing more
                nd.mod.sample(random.Random(1), now=NOW)
            rows = nd.rows()
            self.assertEqual([(r["det"], r["ref"], r["slot"], r["collected"], r["via"]) for r in rows],
                             [(7, f"7@{ts7}", 0, 0, None), (8, f"8@{ts8}", 1, 1, "stick"), (9, f"9@{ts9}", None, 0, None)])
            self.assertEqual(rows[0]["sha256"], sha(b"a clip from the old sample"))   # where it was, ready to go
            self.assertEqual(nd.files(), [f"incoming/9_{ts9}.opus", "sample/2026-05/7_turdus_merula_0.8.opus"])
            self.assertEqual(nd.query("select value from meta where key = 'schema'"), [{"value": "2"}])
            nd.agrees(self)


class PowerCut(unittest.TestCase):
    """A power cut at each step that writes: the next run finds every clip once, and the card and the books agree."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_after_moving_a_clip(self):
        nd = Node(self.tmp, all_from="0.5")
        for i in range(3):
            nd.detect(1, 0.85, MAY + timedelta(minutes=i))
        self.assertEqual(power_cut(nd, "sample", AFTER_MOVE), 9)
        self.assertEqual(len(nd.files()), 1)                           # one clip moved, nothing written down
        nd.mod.sample(random.Random(1), now=NOW)
        self.assertEqual(len({r["ref"] for r in nd.rows()}), 3)
        nd.agrees(self)

    def test_after_dropping_a_clip_the_sample_replaced(self):
        nd = Node(self.tmp)
        for i in range(5):
            nd.detect(1, 0.85, MAY + timedelta(minutes=i))
        nd.mod.sample(random.Random(1), now=NOW)
        for i in range(40):
            nd.detect(1, 0.85, MAY + timedelta(days=1, minutes=i))
        self.assertEqual(power_cut(nd, "sample", AFTER_DROP, now=NOW + 86400), 9)
        nd.mod.sample(random.Random(1), now=NOW + 86400)
        self.assertEqual(len(nd.waiting()), 5)
        nd.agrees(self)


class Stress(unittest.TestCase):
    """Many clips, and the sample and an upload running at the same time, as the timer and a visit can."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.oracle = Oracle()
        self.node = Node(Path(self._tmp.name), all_from="0.5", api=self.oracle.api)

    def tearDown(self):
        self.oracle.close()
        self._tmp.cleanup()

    def bulk(self, n: int, low_every: int = 0) -> int:
        """n detections spread over the dawn windows of May; every low_every-th one under 0.5. Returns how many are 0.5 up."""
        nd = self.node
        rows, high = [], 0
        for i in range(n):
            nd.n += 1
            at = MAY + timedelta(days=i % 25, seconds=(i // 25) * 7 % 14000)
            conf = 0.32 if low_every and i % low_every == 0 else 0.85
            high += conf >= 0.5
            label = 1 + i % 2
            name = f"{at:%Y}/{at:%m}/s{label}_{at:%Y%m%dT%H%M%SZ}_{nd.n}.opus"
            p = nd.export / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(os.urandom(600))
            rows.append((nd.n, label, int(at.timestamp()), conf, name))
        nd.db.executemany("insert into detections values (?, 1, ?, ?, ?, ?, 0, 3000)", rows)
        nd.db.commit()
        return high

    def test_many_clips(self):
        nd, o = self.node, self.oracle
        n = 10000 if STRESS else 1500
        high = self.bulk(n, low_every=10)
        t0 = time.monotonic()
        nd.mod.sample(random.Random(1), now=LATER)
        t_sample = time.monotonic() - t0
        rows = nd.rows()
        self.assertEqual(sum(1 for r in rows if r["slot"] is None), high)
        self.assertLessEqual(Counter(r["cell"] for r in rows if r["slot"] is not None).most_common(1)[0][1], 5)
        nd.agrees(self)
        (nd.state / "visit.json").write_text(json.dumps({"device": "dev_1", "rev": 1}))
        m = nd.mod.manifest(limit=5000)
        while len(m) % 5000 == 0 and m:
            more = nd.mod.manifest(after=m[-1]["seq"], limit=5000)
            if not more:
                break
            m += more
        self.assertEqual(len(m), len(rows))
        t0 = time.monotonic()
        out = nd.mod.handover([c["detection"] for c in m], "stress")
        self.assertEqual(out["n"], len(rows))
        t_hand = time.monotonic() - t0
        half = len(rows) // 2
        nd.execute("delete from handed where seq in (select seq from kept order by seq limit ?)", half)   # half of them came back
        t0 = time.monotonic()
        nd.mod.upload(seconds=600)
        t_upload = time.monotonic() - t0
        self.assertEqual(len(o.clips), len(rows))
        self.assertEqual(max(o.by_ref.values()), 1)
        self.assertEqual(nd.files(), [])
        self.assertEqual(nd.mod.receipt([out["batch"]]), 0)            # all sent already, by the node itself
        print(f"\n  {n} detections: sample {t_sample:.1f} s, handover {t_hand:.2f} s, upload of {len(rows)} {t_upload:.1f} s",
              file=sys.stderr)

    def test_sample_and_upload_at_the_same_time(self):
        nd, o = self.node, self.oracle
        sampler, sender = nd.module(), nd.module()      # two programs on one node: the timer's sample and a visit's upload
        errors, done = [], threading.Event()

        def send():
            try:
                while not done.is_set():
                    sender.upload(seconds=5)
                    time.sleep(0.005)
            except BaseException as e:  # noqa: BLE001
                errors.append(e)

        t = threading.Thread(target=send)
        t.start()
        high = 0
        rounds = 30 if STRESS else 12
        try:
            for k in range(rounds):
                for i in range(60):
                    conf = 0.32 if i % 6 == 0 else 0.85
                    high += conf >= 0.5
                    nd.detect(1 + i % 2, conf, MAY + timedelta(days=k % 25, seconds=i * 13))
                sampler.sample(random.Random(k), now=LATER)
        except BaseException as e:  # noqa: BLE001
            errors.append(e)
        finally:
            done.set()
            t.join(120)
        sampler.sample(random.Random(99), now=LATER)
        sender.upload(seconds=120)
        self.assertEqual(errors, [])
        self.assertEqual(nd.waiting(), [])
        self.assertEqual(nd.files(), [])
        bands = Counter(c["fields"]["band"] for c in o.clips.values())
        self.assertEqual(bands["0.8"], high)                           # every clip from 0.5 up reached the oracle
        self.assertLessEqual(bands["0.3"], 10)                         # and no more than five per band and species
        self.assertEqual(max(o.by_ref.values()), 1)                    # each of them once
        self.assertEqual({r["ref"] for r in nd.rows() if r["via"] == "upload"}, set(o.clips))


class Heartbeat(unittest.TestCase):
    def test_clips_ride_on_the_heartbeat(self):
        with tempfile.TemporaryDirectory() as t:
            Path(t, "status.json").write_text(json.dumps({"keep": True, "waiting": 12, "mb": 0.7, "collectedAt": None}))
            os.environ["LIFE_CLIPS_DIR"] = t
            os.environ["LIFE_STATE"] = t
            os.environ["LIFE_VISIT_BIN"] = str(Path(t, "life-visit"))
            loader = importlib.machinery.SourceFileLoader("life_heartbeat", str(NODE / "life-heartbeat.py"))
            spec = importlib.util.spec_from_loader(loader.name, loader)
            hb = importlib.util.module_from_spec(spec)
            loader.exec_module(hb)
            # a node without life-visit asks for no visit settings: they carry passwords it would not use
            self.assertEqual(hb.clips(), {"clipsKeep": True, "clipsWaiting": 12, "clipsMb": 0.7})
            Path(t, "life-visit").write_text("")
            self.assertEqual(hb.clips(), {"visitRev": -1, "clipsKeep": True, "clipsWaiting": 12, "clipsMb": 0.7})
            Path(t, "status.json").write_text(json.dumps({"keep": True, "waiting": 3, "mb": 0.2, "sentAt": "2026-11-02T10:00:00+00:00",
                                                          "handed": "a1b2c3d4e5f6:40", "full": True}))
            Path(t, "visit.json").write_text(json.dumps({"rev": 4, "device": "dev_1"}))
            Path(t, "visit-last.json").write_text(json.dumps({"at": "2026-11-02T10:00:00+00:00", "reason": "magnet", "how": "hotspot",
                                                              "sent": 31, "handed": 0, "minutes": 4.2, "extra": {"x": 1}}))
            self.assertEqual(hb.clips(), {"visitRev": 4, "clipsKeep": True, "clipsWaiting": 3, "clipsMb": 0.2,
                                          "clipsSentAt": "2026-11-02T10:00:00+00:00", "clipsHanded": "a1b2c3d4e5f6:40", "clipsFull": True,
                                          "visitLast": {"at": "2026-11-02T10:00:00+00:00", "reason": "magnet", "how": "hotspot",
                                                        "sent": 31, "handed": 0, "minutes": 4.2}})
            os.environ.pop("LIFE_VISIT_BIN")


if __name__ == "__main__":
    unittest.main()
