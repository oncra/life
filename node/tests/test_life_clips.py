"""Tests for node/life-clips.py: BirdNET-Go's config, the clip sample, and a visit taking it away.

    python3 -B -m unittest discover -s node/tests -v

Standard library only. BirdNET-Go is not needed: its database is built here with the tables life-clips reads, and
its config in the two layouts it comes in (the one BirdNET-Go writes, four spaces and keys in order, and the
annotated example with comments).
"""
import importlib.machinery
import importlib.util
import json
import os
import random
import sqlite3
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

NODE = Path(__file__).resolve().parents[1]
TZ = ZoneInfo("Europe/Amsterdam")

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


def load(env: dict):
    """A fresh life-clips module with its constants read from `env`."""
    for k, v in env.items():
        os.environ[k] = v
    loader = importlib.machinery.SourceFileLoader(f"life_clips_{random.random()}", str(NODE / "life-clips.py"))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


class Node:
    """A node in a temporary directory: BirdNET-Go's database, config and clips, and the sample's home."""

    def __init__(self, tmp: Path, keep="1", anytime="0"):
        self.tmp, self.bng, self.home = tmp, tmp / "birdnet-go", tmp / "life-clips"
        self.export = self.bng / "clips"
        self.export.mkdir(parents=True)
        (self.bng / "config.yaml").write_text(WRITTEN)
        (tmp / "schedule.py").write_text(STUB_SCHEDULE)
        self.db = sqlite3.connect(self.bng / "birdnet.db")
        self.db.executescript("""
            create table label_types (id integer primary key, name text);
            create table labels (id integer primary key, scientific_name text, label_type_id integer);
            create table ai_models (id integer primary key, name text);
            create table detections (id integer primary key, model_id integer, label_id integer, detected_at integer,
                                     confidence real, clip_name text, begin_time integer, end_time integer);
            insert into label_types values (1, 'species'), (2, 'human');
            insert into labels values (1, 'Turdus merula', 1), (2, 'Alauda arvensis', 1), (3, 'Human vocal', 2);
            insert into ai_models values (1, 'BirdNET GLOBAL 6K V2.4');
        """)
        self.n = 0
        self.mod = load({"BIRDNET_DIR": str(self.bng), "BIRDNET_DB": str(self.bng / "birdnet.db"),
                         "BIRDNET_CONFIG": str(self.bng / "config.yaml"), "BIRDNET_CLIPS": str(self.export),
                         "LIFE_CLIPS_DIR": str(self.home), "LIFE_SCHEDULE_WPI": str(tmp / "schedule.py"),
                         "LIFE_KEEP_CLIPS": keep, "LIFE_CLIPS_ANYTIME": anytime, "NODE_HOSTNAME": "node-test",
                         "NODE_TZ": "Europe/Amsterdam"})

    def detect(self, label: int, conf: float, at: datetime, clip=True, spectrogram=False) -> Path | None:
        self.n += 1
        name = None
        if clip:
            sci = {1: "turdus_merula", 2: "alauda_arvensis", 3: "human_vocal"}[label]
            name = f"{at:%Y}/{at:%m}/{sci}_{round(conf * 100)}p_{at:%Y%m%dT%H%M%SZ}_{self.n}.opus"
            p = self.export / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(os.urandom(2000))
            if spectrogram:
                p.with_suffix(".png").write_bytes(b"png")
        self.db.execute("insert into detections values (?, 1, ?, ?, ?, ?, 0, 3000)",
                        (self.n, label, int(at.timestamp()), conf, name))
        self.db.commit()
        return self.export / name if name else None

    def kept(self):
        con = sqlite3.connect(self.home / "state.db")
        return con.execute("select id, cell, slot, file, collected from kept order by id").fetchall()


MAY = datetime(2026, 5, 4, 5, 0, tzinfo=timezone.utc)   # inside the stub's window
NOW = (MAY + timedelta(days=2)).timestamp()             # long after every detection: all settled


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
        cells = {}
        for _, cell, *_ in rows:
            cells[cell] = cells.get(cell, 0) + 1
        self.assertEqual(cells, {"2026-05|Turdus merula|0.8": 5, "2026-05|Turdus merula|0.3": 3})
        for _, _, _, rel, _ in rows:
            self.assertTrue((nd.home / rel).is_file())
        for p in clips + low + [voice, outside]:
            self.assertFalse(p.exists(), p)                           # kept ones moved, the rest deleted
            self.assertFalse(p.with_suffix(".png").exists())          # and no spectrogram left beside them
        self.assertEqual(list(nd.export.rglob("*.opus")), [])

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

    def test_nothing_is_kept_for_ever(self):
        nd = self.node
        nd.detect(1, 0.85, MAY)
        nd.mod.sample(random.Random(1), now=NOW)
        self.assertEqual(len(nd.kept()), 1)
        nd.mod.sample(random.Random(1), now=NOW + 400 * 86400)
        self.assertEqual(nd.kept(), [])
        self.assertEqual(list((nd.home / "sample").rglob("*.opus")), [])

    def test_switched_off_deletes_everything(self):
        nd = self.node
        nd.detect(1, 0.85, MAY)
        nd.mod.sample(random.Random(1), now=NOW)
        stray = nd.detect(1, 0.85, MAY + timedelta(minutes=1))
        off = Node(Path(self._tmp.name) / "off")
        off.home = nd.home
        off.mod = load({"BIRDNET_CLIPS": str(nd.export), "LIFE_CLIPS_DIR": str(nd.home), "LIFE_KEEP_CLIPS": "0"})
        off.mod.sample(random.Random(1), now=NOW)
        self.assertFalse(stray.exists())
        self.assertEqual(list((nd.home / "sample").rglob("*.opus")), [])
        self.assertEqual(json.loads((nd.home / "status.json").read_text())["waiting"], 0)


class Visit(unittest.TestCase):
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
        self.assertEqual(nd.mod.collect(self.stick), 0)
        runs = list((self.stick / "life-clips" / "node-test").iterdir())
        self.assertEqual(len(runs), 1)
        run = runs[0]
        lines = (run / "clips.csv").read_text().strip().splitlines()
        self.assertEqual(len(lines), 6)                               # header and five clips
        self.assertTrue(lines[0].startswith("file,detection,time_local,time_utc,scientific,score,band"))
        self.assertIn(",Turdus merula,0.850,0.8,birdnet-go:birdnet,15,3,6,", lines[1])
        sums = (run / "SHA256SUMS").read_text().splitlines()
        self.assertEqual(len(sums), 5)
        for line in sums:
            h, name = line.split("  ")
            self.assertEqual(nd.mod.sha256(run / name), h)
        self.assertTrue((run / "RECEIPT.txt").exists())
        self.assertEqual(list((nd.home / "sample").rglob("*.opus")), [])  # gone from the node
        st = json.loads((nd.home / "status.json").read_text())
        self.assertEqual((st["waiting"], bool(st["collectedAt"])), (0, True))

    def test_a_collected_place_stays_taken_that_month(self):
        nd = self.node
        for i in range(5):
            nd.detect(1, 0.85, MAY + timedelta(minutes=i))
        nd.mod.sample(random.Random(3), now=NOW)
        nd.mod.collect(self.stick)
        later = [nd.detect(1, 0.85, MAY + timedelta(days=1, minutes=i)) for i in range(20)]
        nd.mod.sample(random.Random(3), now=NOW + 86400)
        self.assertEqual(sum(1 for r in nd.kept() if not r[4]), 0)   # five already went this month: no sixth
        for p in later:
            self.assertFalse(p.exists())

    def test_a_bad_copy_deletes_nothing(self):
        nd = self.node
        nd.detect(1, 0.85, MAY)
        nd.mod.sample(random.Random(3), now=NOW)
        real = nd.mod.sha256
        nd.mod.sha256 = lambda p: "0" * 64 if str(self.stick) in str(p) else real(p)
        self.assertEqual(nd.mod.collect(self.stick), 1)
        self.assertEqual(len(list((nd.home / "sample").rglob("*.opus"))), 1)
        self.assertTrue(next((self.stick / "life-clips" / "node-test").iterdir()).joinpath("FAILED.txt").exists())


class Heartbeat(unittest.TestCase):
    def test_clips_ride_on_the_heartbeat(self):
        with tempfile.TemporaryDirectory() as t:
            Path(t, "status.json").write_text(json.dumps({"keep": True, "waiting": 12, "mb": 0.7, "collectedAt": None}))
            os.environ["LIFE_CLIPS_DIR"] = t
            loader = importlib.machinery.SourceFileLoader("life_heartbeat", str(NODE / "life-heartbeat.py"))
            spec = importlib.util.spec_from_loader(loader.name, loader)
            hb = importlib.util.module_from_spec(spec)
            loader.exec_module(hb)
            self.assertEqual(hb.clips(), {"clipsKeep": True, "clipsWaiting": 12, "clipsMb": 0.7})


if __name__ == "__main__":
    unittest.main()
