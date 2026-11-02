#!/usr/bin/env python3
"""Life node clips: the sound an expert checks, kept on the node's own card (content/spec.md, section 2.2).

To give every species its own threshold, and to let whoever studies a place hear what the node heard, someone has to
listen to what the detector heard. So the node keeps BirdNET-Go's clips on /data: every clip from a score of 0.5 up,
and below that a sample per score band for the thresholds. Sound never goes over the node's SIM. It leaves the node
when somebody is at the box, or when the node itself is on a cable or a WiFi:

    life-clips setup                     before BirdNET-Go starts: clip export on or off in its config
    life-clips sample                    every 15 minutes: keep what qualifies, cut it to its clip, delete the rest
    life-clips upload [--for SECONDS]    send the waiting clips to the oracle, only while the node's way out to the
                                         internet is the cable or the WiFi (a visitor's phone hotspot is WiFi), never
                                         the SIM; each clip is deleted once the oracle has it, checked by its SHA-256.
                                         The timer runs it after every sample; life-visit runs it on a hotspot
    life-clips collect --to DIR          copy the waiting clips, their list and the band counts into DIR, check the
                                         copy, delete them from the node
    life-clips collect-device /dev/sdX1  the same onto a stick named LIFECLIPS (udev starts this when one is plugged in)
    life-clips receipt BATCH...          the oracle has every clip of these laptop batches: delete them from the node
    life-clips apply < answer            the same, from the oracle's answer to a heartbeat (`clipsReceived`), which
                                         life-push hands over
    life-clips status [--json]           what is waiting

What is kept:
- only detections of bird and bat species (BirdNET-Go label type `species`), only inside the listening windows of
  their own day (life-schedule-wpi; the owner's night window for meadow birds counts here, and one that runs past
  midnight belongs to the evening before), and only clips BirdNET-Go actually wrote: its privacy filter writes no clip in
  which it hears a human voice, and its speech detector (Privacy Guard, `realtime.privacyfilter.vad`) drops such a
  detection outright;
- every clip with a score of LIFE_CLIPS_ALL_FROM (0.5) or more, while /data has more than LIFE_CLIPS_MIN_FREE_MB
  (2000) free: BirdNET-Go's database and the readings not yet sent come before the clips, and a node nobody visits must
  not fill its card. Short of space, these clips go into the band sample like the rest (`full` in the status, and
  `clipsFull` on the heartbeat, so the owner sees that a visit is due);
- below that, per species, per month and per score band of 0.1, at most LIFE_CLIPS_PER_BAND (5) clips: a uniform
  random sample of that month's detections in that band (reservoir sampling), so the checking covers the whole score
  range. A clip that left the node, or that a laptop has in hand, keeps its place in the month's sample, so no more
  than five per band ever leave;
- every other clip is deleted at the first run after BirdNET-Go has finished writing it (SETTLE_S), anything still in
  BirdNET-Go's export directory after ORPHAN_S is deleted too, and a kept clip goes after LIFE_CLIPS_KEEP_DAYS (365)
  if it never left the node.

The clip. BirdNET-Go writes 15 seconds with the detected three seconds starting 3 seconds in (its defaults, kept on
purpose: the same two numbers set the window in which it confirms a bird, and changing them would change what the node
reports). The node cuts each kept clip to LIFE_CLIPS_SECONDS (7) from the start of the detection, turns it up or down
until its loudest moment is at -2 dBFS (at most 60 dB up, so the quiet I2S microphone is heard as well as the
AudioMoth; the gain is written beside the clip, so the original level can be had back) and stores it as AAC (.m4a),
which every browser plays. A clip recorded faster than 48 kHz (a bat, on the AudioMoth at 192 kHz) is cut to its
detected three seconds with a tenth of a second either side and slowed down ten times (.x10.m4a): AAC keeps nothing
above about 18 kHz, and slowed down a call at 40 kHz is heard at 4 kHz. Without ffmpeg, or when it fails, the clip
stays as BirdNET-Go wrote it, with its timing; nothing is lost for want of a cut.

How a clip leaves the node, each way deleting it only once its copy is known to be good:
- `upload`: the node posts it to the oracle (POST /clips, with its own token), bound to the interface it checked, so
  a route that changes mid-run cannot send a byte over the stick. The oracle answers with the clip's SHA-256.
- a laptop on the node's own WiFi at a visit (life-visit): it downloads the clips and gets a grant, signed with the
  node's token, for exactly those clips; it sends them to the oracle once it is back online, and the node deletes
  them when the oracle names the batch in its answer to a heartbeat (`receipt`), which comes over the SIM as a few
  bytes. Until then they stay on the node and go out by any other way too.
- a stick named LIFECLIPS (`collect-device`).

To have detections in the low score bands at all, `setup` puts BirdNET-Go's own threshold at 0.1 while clips are kept.
What the node sends to the oracle as detections does not follow: life-push keeps its floor of 0.7
(LIFE_MIN_CONFIDENCE_FLOOR, set in the units), the score the Diversity reading counts from.

LIFE_KEEP_CLIPS=0 turns all of it off: export goes off in BirdNET-Go's config at the next boot, its threshold returns
to 0.7, and the next run deletes every clip on the node.

env: LIFE_KEEP_CLIPS (1), LIFE_CLIPS_ALL_FROM (0.5; above 1 keeps only the band sample), LIFE_CLIPS_PER_BAND (5),
     LIFE_CLIPS_SECONDS (7), LIFE_CLIPS_KEEP_DAYS (365), LIFE_CLIPS_MIN_FREE_MB (2000),
     LIFE_CLIPS_UPLOAD (1; 0 = only a visit takes clips away),
     LIFE_CLIPS_ANYTIME (0; 1 keeps clips outside the windows too, for a bench), LIFE_API, LIFE_DEVICE_TOKEN,
     BIRDNET_DIR (/data/birdnet-go), BIRDNET_DB, BIRDNET_CONFIG, BIRDNET_CLIPS, LIFE_CLIPS_DIR (/data/life-clips),
     LIFE_STATE (/data/life-node), LIFE_SCHEDULE_WPI (/usr/local/sbin/life-schedule-wpi), FFMPEG, NODE_TZ,
     NODE_HOSTNAME
"""
import base64
import csv
import fcntl
import hashlib
import hmac
import http.client
import importlib.machinery
import importlib.util
import io
import json
import os
import random
import re
import secrets
import shutil
import socket
import sqlite3
import ssl
import subprocess
import sys
import time
import urllib.parse
import uuid
import wave
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

BNG = Path(os.environ.get("BIRDNET_DIR", "/data/birdnet-go"))
DB = Path(os.environ.get("BIRDNET_DB") or BNG / "birdnet.db")
CONFIG = Path(os.environ.get("BIRDNET_CONFIG") or BNG / "config.yaml")
EXPORT = Path(os.environ["BIRDNET_CLIPS"]) if os.environ.get("BIRDNET_CLIPS") else None  # else from the config
HOME = Path(os.environ.get("LIFE_CLIPS_DIR", "/data/life-clips"))
STATE_DIR = Path(os.environ.get("LIFE_STATE", "/data/life-node"))   # visit.json: the node's id on the oracle
SCHEDULE = os.environ.get("LIFE_SCHEDULE_WPI", "/usr/local/sbin/life-schedule-wpi")
TZ = ZoneInfo(os.environ.get("NODE_TZ") or "Europe/Amsterdam")
KEEP = os.environ.get("LIFE_KEEP_CLIPS", "1").strip() != "0"
ANYTIME = os.environ.get("LIFE_CLIPS_ANYTIME", "0").strip() == "1"
ALL_FROM = float(os.environ.get("LIFE_CLIPS_ALL_FROM") or 0.5)
PER_BAND = int(os.environ.get("LIFE_CLIPS_PER_BAND") or 5)
SECONDS = float(os.environ.get("LIFE_CLIPS_SECONDS") or 7)
KEEP_DAYS = int(os.environ.get("LIFE_CLIPS_KEEP_DAYS") or 365)
MIN_FREE_MB = int(os.environ.get("LIFE_CLIPS_MIN_FREE_MB") or 2000)   # BirdNET-Go and the readings' queue come first
UPLOAD = os.environ.get("LIFE_CLIPS_UPLOAD", "1").strip() != "0"
API = os.environ.get("LIFE_API", "https://life.oncra.org/api/v1").rstrip("/")
TOKEN = os.environ.get("LIFE_DEVICE_TOKEN", "").strip()
_ff = os.environ.get("FFMPEG")
FFMPEG = (shutil.which("ffmpeg") if _ff is None else _ff) or None   # FFMPEG= (empty) means none
SETTLE_S = 15 * 60   # BirdNET-Go may still be encoding a clip ten minutes after the detection (its ClipRecencyWindow)
ORPHAN_S = 30 * 60   # anything in its export directory longer than this was never going to be kept
STICK = "LIFECLIPS"
MOUNT = Path("/run/life-clips-usb")
SLOW = 10            # time expansion for a clip recorded faster than 48 kHz
BAT_LEAD_S = 0.1     # recording seconds kept either side of a bat's detected three seconds
PEAK_DB = -2.0       # every clip's loudest moment ends up here, with room for the AAC encoder to overshoot
MAX_GAIN_DB = 60.0   # enough for the I2S microphone (peaks near -49 dBFS); digital silence stays silent
BITRATE = "64k"      # AAC, mono: 7 s is about 56 kB, as much as BirdNET-Go's 15 s of Opus at 32k
WAYS = {"eth0", "wlan0"}   # the Pi's own cable port and its WiFi; the 4G stick (usb0, eth1, wwan0, ...) is never one
PROBES = (("-4", "1.1.1.1"), ("-6", "2606:4700:4700::1111"))
TRIES = 10           # a clip the oracle refuses this often stays for a visit with a stick, or until it expires
GRANT_DAYS = 90      # how long a laptop may take to bring its batch to the oracle
# SO_BINDTODEVICE exists on Linux only; LIFE_CLIPS_BIND=0 is for tests that run the upload against a local oracle
BIND = sys.platform.startswith("linux") and os.environ.get("LIFE_CLIPS_BIND", "1").strip() != "0"

# BirdNET-Go's config while clips are kept, and while they are not. Its threshold goes down so that every score band
# has detections in it; export goes to small Opus files that only this program deletes.
ON = [(("realtime", "audio", "export", "enabled"), "true"),
      (("realtime", "audio", "export", "type"), "opus"),
      (("realtime", "audio", "export", "bitrate"), "32k"),
      (("realtime", "audio", "export", "retention", "policy"), "none"),
      (("realtime", "audio", "export", "retention", "keepspectrograms"), "false"),
      (("realtime", "privacyfilter", "enabled"), "true"),
      (("realtime", "privacyfilter", "vad", "enabled"), "true"),
      (("birdnet", "threshold"), "0.1")]
OFF = [(("realtime", "audio", "export", "enabled"), "false"),
       (("birdnet", "threshold"), "0.7")]


def say(msg: str) -> None:
    print(f"life-clips: {msg}", flush=True)


# --- BirdNET-Go's config.yaml: block-style YAML, edited line by line so its comments and layout survive ---

KEY = re.compile(r"^(\s*)([A-Za-z0-9_]+):(?:[ \t]|$)")
VALUE = re.compile(r"^(\s*[A-Za-z0-9_]+:[ \t]*)([^#\n]*?)([ \t]*(?:#.*)?)$")


def yaml_find(lines: list[str], path: tuple[str, ...]) -> int | None:
    """Index of the line holding the key at `path`, keys compared in lower case (viper writes them so)."""
    want = [k.lower() for k in path]
    stack: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        body = line.lstrip()
        if not body or body.startswith("#"):
            continue
        ind = len(line) - len(body)
        if body.startswith("- "):  # a list item opens a level of its own; nothing we set lives inside one
            while stack and stack[-1][0] >= ind:
                stack.pop()
            stack.append((ind, "-"))
            continue
        m = KEY.match(line)
        if not m:
            continue
        while stack and stack[-1][0] >= ind:
            stack.pop()
        stack.append((ind, m.group(2).lower()))
        if [k for _, k in stack] == want:
            return i
    return None


def yaml_get(text: str, path: tuple[str, ...]) -> str | None:
    lines = text.split("\n")
    i = yaml_find(lines, path)
    if i is None:
        return None
    m = VALUE.match(lines[i])
    return m.group(2).strip().strip("'\"") if m else None


def _child_indent(lines: list[str], p: int) -> int:
    """The indent of the block at line p's children: its own, else the file's step."""
    def ind(line):
        return len(line) - len(line.lstrip())
    pind = ind(lines[p])
    step = min((ind(l) for l in lines if l.strip() and not l.lstrip().startswith("#") and ind(l) > 0), default=2)
    for line in lines[p + 1:]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        return ind(line) if ind(line) > pind else pind + step
    return pind + step


def yaml_set(text: str, path: tuple[str, ...], value: str, _block: bool = False) -> tuple[str, str]:
    """Set a scalar. Returns (text, what happened): 'same', 'set', 'added' or 'missing'. A missing key is added when
    its block exists, and a missing block too when the block above it exists; a top-level block is never invented."""
    lines = text.split("\n")
    i = yaml_find(lines, path)
    if i is not None:
        if _block:
            return text, "same"
        m = VALUE.match(lines[i])
        if not m:
            return text, "missing"
        if m.group(2).strip().strip("'\"") == value:
            return text, "same"
        lines[i] = m.group(1) + value + m.group(3)
        return "\n".join(lines), "set"
    if len(path) < 2:
        return text, "missing"
    p = yaml_find(lines, path[:-1])
    if p is None:
        if len(path) < 3:
            return text, "missing"
        text, what = yaml_set(text, path[:-1], "", _block=True)
        if what == "missing":
            return text, "missing"
        lines = text.split("\n")
        p = yaml_find(lines, path[:-1])
    lines.insert(p + 1, " " * _child_indent(lines, p) + (f"{path[-1]}:" if _block else f"{path[-1]}: {value}"))
    return "\n".join(lines), "added"


def setup() -> int:
    """Put clip export on or off in BirdNET-Go's config, before it starts. Writes only what changed."""
    if not CONFIG.exists():
        say(f"no BirdNET-Go config at {CONFIG}; nothing to set")
        return 0
    text = orig = CONFIG.read_text()
    for path, value in (ON if KEEP else OFF):
        text, what = yaml_set(text, path, value)
        if what == "missing":
            # the privacy guard needs BirdNET-Go 20261014 or later; without it the human-voice filter still stands
            say(f"{'.'.join(path)} not in this BirdNET-Go's config, left alone")
        elif what != "same":
            say(f"{'.'.join(path)} = {value} ({what})")
    if text != orig:
        tmp = CONFIG.with_suffix(".yaml.life-clips")
        tmp.write_text(text)
        os.replace(tmp, CONFIG)
    say(f"clip keeping {'on' if KEEP else 'off'}")
    return 0


# --- the node's bookkeeping: one SQLite file on /data ---

SCHEMA = """
    create table if not exists meta (key text primary key, value text);
    create table if not exists seen (cell text primary key, n integer not null);
    create table if not exists kept (
        seq integer primary key autoincrement,
        det integer not null,              -- BirdNET-Go's detection id
        ts integer not null,
        ref text not null unique,          -- det@ts: the clip's name on the oracle, unique across database resets
        cell text not null,
        slot integer,                      -- its place in the band sample; null for a clip kept for its score
        file text not null,
        scientific text not null, confidence real not null, band text not null, month text not null,
        detector text, source text,
        clip_s real, from_s real, to_s real, expansion integer, gain_db real,
        bytes integer, sha256 text,        -- set once the clip is cut; until then it waits in incoming/
        collected integer not null default 0,   -- 1: gone from the node
        via text,                          -- how it left: stick, upload, laptop, expired, lost
        gone_at integer,
        sending integer not null default 0,     -- an upload has it in hand since then; the sample leaves it alone
        tries integer not null default 0, next_try integer not null default 0, error text);
    create unique index if not exists kept_slot on kept (cell, slot) where slot is not null;
    create index if not exists kept_waiting on kept (collected, ts);
    create table if not exists batches (batch text primary key, n integer not null, at integer not null, laptop text);
    create table if not exists handed (batch text not null, seq integer not null, primary key (batch, seq));
"""

_lock = None


def _lockfile():
    HOME.mkdir(parents=True, exist_ok=True)
    return open(HOME / ".lock", "w")


def connect() -> sqlite3.Connection:
    """The bookkeeping, without the sample's lock: for the upload, a visit and the status. Writes are short
    transactions, so the sample and an upload can run at the same time."""
    HOME.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(HOME / "state.db", timeout=60)
    con.execute("pragma busy_timeout = 60000")
    con.execute("pragma journal_mode = wal")
    # normal: a power cut can undo the last few commits, never corrupt the file, and an SD card is spared an fsync per
    # clip. Every step here survives an undone commit: a clip moved but not written down is found again, and one sent
    # or collected but not marked gone is found missing and marked so
    con.execute("pragma synchronous = normal")
    if (con.execute("select count(*) from sqlite_master where name = 'meta'").fetchone()[0] == 0
            or (con.execute("select value from meta where key = 'schema'").fetchone() or ("0",))[0] != "2"):
        if _lock is None:   # a migration is a sample's job; anyone else waits for it under the lock
            with _lockfile() as f:
                fcntl.flock(f, fcntl.LOCK_EX)
                migrate(con)
        else:
            migrate(con)
    return con


def migrate(con: sqlite3.Connection) -> None:
    """Version 1 kept one row per clip under BirdNET-Go's detection id, which a new BirdNET-Go database hands out
    again; version 2 numbers its own rows and names each clip det@ts."""
    cols = [r[1] for r in con.execute("pragma table_info(kept)")]
    if cols and "seq" not in cols:
        con.execute("alter table kept rename to kept_v1")
        con.executescript(SCHEMA)
        con.execute("""insert into kept (det, ts, ref, cell, slot, file, scientific, confidence, band, month, detector,
                                         collected, via)
                       select id, ts, id || '@' || ts, cell, slot, file, scientific, confidence, band, month, detector,
                              collected, case when collected = 1 then 'stick' end
                       from kept_v1 order by id""")
        con.execute("drop table kept_v1")
    else:
        con.executescript(SCHEMA)
    con.execute("insert into meta (key, value) values ('schema', '2') on conflict (key) do update set value = '2'")
    con.commit()


def state() -> sqlite3.Connection:
    """The bookkeeping, taken by one sample or collect at a time (the timer and a stick can meet)."""
    global _lock
    if _lock is None:
        _lock = _lockfile()
        fcntl.flock(_lock, fcntl.LOCK_EX)
    return connect()


def release() -> None:
    """Let the next run in: each command holds the lock only while it works."""
    global _lock
    if _lock is not None:
        _lock.close()
        _lock = None


def meta(con, key, value=None):
    if value is None:
        r = con.execute("select value from meta where key = ?", (key,)).fetchone()
        return r[0] if r else None
    con.execute("insert into meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value", (key, str(value)))
    return value


# --- BirdNET-Go's detections ---

def detections(after: int):
    """BirdNET-Go's detections after id `after`, oldest first:
    (id, epoch, confidence, clip, scientific, kind, model, source)."""
    if not DB.exists():
        return
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=30)
    try:
        tables = {r[0] for r in con.execute("select name from sqlite_master where type = 'table'")}
        if {"detections", "labels", "label_types"} <= tables:
            cols = [c[1] for c in con.execute("pragma table_info(detections)")]
            models = "m.name" if "ai_models" in tables else "null"
            join = "left join ai_models m on m.id = d.model_id" if "ai_models" in tables else ""
            # which microphone heard it: BirdNET-Go keeps one row per audio source and its id on each detection
            src = next((t for t in ("audio_sources", "v2_audio_sources") if t in tables), None) if "source_id" in cols else None
            source = "coalesce(s.display_name, s.source_uri)" if src else "null"
            join += f" left join {src} s on s.id = d.source_id" if src else ""
            q = f"""select d.id, d.detected_at, d.confidence, d.clip_name, l.scientific_name, t.name, {models}, {source}
                    from detections d join labels l on l.id = d.label_id join label_types t on t.id = l.label_type_id
                    {join} where d.id > ? order by d.id"""
            yield from con.execute(q, (after,))
        elif "notes" in tables:  # the older schema: no label types, so a label without a genus and species is no bird
            for r in con.execute("select id, date, time, confidence, clip_name, scientific_name from notes where id > ? order by id", (after,)):
                ts = int(datetime.fromisoformat(f"{r[1]}T{r[2]}").replace(tzinfo=TZ).timestamp())
                kind = "species" if re.fullmatch(r"[A-Z][a-z]+ [a-z-]+", r[5] or "") else "other"
                yield (r[0], ts, r[3], r[4], r[5], kind, None, None)
    finally:
        con.close()


def last_id() -> int:
    if not DB.exists():
        return 0
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=30)
    try:
        tables = {r[0] for r in con.execute("select name from sqlite_master where type = 'table'")}
        t = "detections" if "detections" in tables else "notes" if "notes" in tables else None
        return con.execute(f"select coalesce(max(id), 0) from {t}").fetchone()[0] if t else 0
    finally:
        con.close()


_windows = None
_days: dict = {}


def in_window(ts: int) -> bool:
    """Whether a detection falls inside the listening windows of its own day (content/spec.md, section 2.2), the owner's
    night window included."""
    global _windows
    if ANYTIME:
        return True
    if _windows is None:
        try:
            loader = importlib.machinery.SourceFileLoader("life_schedule_wpi", SCHEDULE)
            spec = importlib.util.spec_from_loader("life_schedule_wpi", loader)
            mod = importlib.util.module_from_spec(spec)
            loader.exec_module(mod)
            _windows = mod.windows
        except Exception as e:  # noqa: BLE001 - no schedule, no window: keep nothing rather than too much
            print(f"life-clips: listening windows unknown ({e}); no clip is kept", file=sys.stderr)
            _windows = lambda d: []  # noqa: E731
    t = datetime.fromtimestamp(ts, timezone.utc)
    day = t.astimezone(TZ).date()
    days = (day, day - timedelta(days=1))   # a night window past midnight is the evening before's
    for d in days:
        if d not in _days:   # the sun's times, worked out once per day and run
            _days[d] = _windows(d)
    return any(w["start"] <= t < w["end"] for d in days for w in _days[d])


def band(confidence: float) -> str:
    return f"{min(int(round(confidence * 1000)) // 100, 9) / 10:.1f}"


def remove(p: Path) -> None:
    """Delete a clip in BirdNET-Go's export directory and the spectrogram it may have drawn beside it. Named, not
    searched for: a search per clip reads the whole month's directory each time, which a backlog of thousands turns
    into minutes. Anything else beside it goes with the orphans, half an hour on."""
    for q in (p, p.with_suffix(".png")):
        try:
            q.unlink()
        except FileNotFoundError:
            pass


def safe(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_") or "unknown"


def preset() -> tuple[float, float]:
    """Where the detected three seconds start in BirdNET-Go's clip, and how long its clips are."""
    text = CONFIG.read_text() if CONFIG.exists() else ""
    pre = float(yaml_get(text, ("realtime", "audio", "export", "precapture")) or 3)
    length = float(yaml_get(text, ("realtime", "audio", "export", "length")) or 15)
    return pre, length


# --- the sample ---

def sample(rng: random.Random | None = None, now: float | None = None) -> int:
    con = state()
    try:
        return _sample(con, rng, now)
    finally:
        con.close()
        release()


def _taken(collected: int, sending: int, handed: int, now: float) -> bool:
    """A place in the band sample that a checker has had, or that an upload or a laptop has in hand, is not given away."""
    return bool(collected) or bool(handed) or sending > now - 600


def _drop_row(con, seq: int, rel: str) -> None:
    (HOME / rel).unlink(missing_ok=True)
    con.execute("delete from kept where seq = ?", (seq,))
    con.execute("delete from handed where seq = ?", (seq,))


def _discard(clip: Path, moved: Path | None) -> None:
    remove(clip)
    if moved is not None:
        moved.unlink(missing_ok=True)


def _cursor(con) -> int:
    """Where the last run stopped in BirdNET-Go's detections, or 0 when its database started again since: its ids then
    start again too (det@ts keeps the clips' names apart), and the id the last run stopped at is another detection."""
    cursor = int(meta(con, "cursor") or 0)
    if not cursor:
        return 0
    if cursor > last_id():
        return 0
    at = next(detections(cursor - 1), None)
    if at and at[0] == cursor and meta(con, "cursor_ts") not in (None, str(at[1])):
        return 0
    return cursor


def _sample(con, rng: random.Random | None = None, now: float | None = None) -> int:
    rng = rng or random.Random()
    now = time.time() if now is None else now
    if not KEEP:
        purge(con)
        return 0
    kept = dropped = 0
    for det_id, ts, conf, clip_name, scientific, kind, model, source in detections(_cursor(con)):
        if ts > now - SETTLE_S:
            break  # BirdNET-Go may still be writing this clip; the next run takes it
        meta(con, "cursor", det_id)
        meta(con, "cursor_ts", ts)
        clip = EXPORT / clip_name if clip_name else None
        rel = Path("incoming") / f"{det_id}_{ts}{clip.suffix}" if clip else None
        # a run that a power cut stopped between moving a clip and writing it down left it here
        moved = HOME / rel if rel is not None and (HOME / rel).is_file() else None
        if clip is None or not (moved or clip.is_file()):
            con.commit()
            continue  # no clip written: the privacy filter heard a voice, or export was off at the time
        ref = f"{det_id}@{ts}"
        if con.execute("select 1 from kept where ref = ?", (ref,)).fetchone():
            remove(clip)  # kept already (its file is the kept one)
            con.commit()
            continue
        if kind != "species" or not in_window(ts):
            _discard(clip, moved)
            dropped += 1
            con.commit()
            continue
        b, month = band(conf), datetime.fromtimestamp(ts, TZ).strftime("%Y-%m")
        cell = f"{month}|{scientific}|{b}"
        n = (con.execute("select n from seen where cell = ?", (cell,)).fetchone() or (0,))[0] + 1
        con.execute("insert into seen (cell, n) values (?, ?) on conflict (cell) do update set n = excluded.n", (cell, n))
        slot = None
        if conf < ALL_FROM or free_mb(HOME) < MIN_FREE_MB:   # short of space, only the band sample still grows
            slots = {r[0]: r[1:] for r in con.execute(
                """select slot, seq, file, collected, sending, exists (select 1 from handed h where h.seq = kept.seq)
                   from kept where cell = ? and slot is not null""", (cell,))}
            if len(slots) < PER_BAND:
                slot = next(s for s in range(PER_BAND) if s not in slots)
            else:
                j = rng.randrange(n)  # reservoir sampling: the n-th detection replaces a kept one with chance PER_BAND/n
                if j >= PER_BAND or (j in slots and _taken(*slots[j][2:], now)):
                    _discard(clip, moved)
                    dropped += 1
                    con.commit()
                    continue
                slot = j
                if j in slots:
                    _drop_row(con, slots[j][0], slots[j][1])
        if moved is None:
            (HOME / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(clip), HOME / rel)
        remove(clip)  # a spectrogram BirdNET-Go may have drawn beside it
        detector = f"birdnet-go:{model.lower().split()[0]}" if model else "birdnet-go"
        con.execute("""insert into kept (det, ts, ref, cell, slot, file, scientific, confidence, band, month, detector, source)
                       values (?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (det_id, ts, ref, cell, slot, str(rel), scientific, conf, b, month, detector, source))
        con.commit()  # one detection at a time: an upload running beside this never waits long for the database
        kept += 1
    cut, failed = finish_all(con)
    # nothing else stays: whatever is left in BirdNET-Go's export directory once it is old enough to be finished
    orphans = 0
    if EXPORT.exists():
        for p in EXPORT.rglob("*"):
            if p.is_file() and now - p.stat().st_mtime > ORPHAN_S:
                p.unlink(missing_ok=True)
                orphans += 1
    orphans += sweep(con, now)
    # and nothing stays for ever
    expired = 0
    for seq, rel in con.execute("select seq, file from kept where ts < ? and collected = 0", (int(now - KEEP_DAYS * 86400),)).fetchall():
        _drop_row(con, seq, rel)
        expired += 1
    con.execute("delete from kept where collected = 1 and ts < ?", (int(now - (KEEP_DAYS + 35) * 86400),))
    con.execute("delete from seen where cell < ?", (datetime.fromtimestamp(now - KEEP_DAYS * 86400, TZ).strftime("%Y-%m"),))
    old = [r[0] for r in con.execute("select batch from batches where at < ?", (int(now - (GRANT_DAYS + 30) * 86400),))]
    for b in old:
        con.execute("delete from handed where batch = ?", (b,))
        con.execute("delete from batches where batch = ?", (b,))
    con.commit()
    write_status(con)
    say(f"{kept} kept, {cut} cut" + (f" ({failed} left as BirdNET-Go wrote them)" if failed else "")
        + f", {dropped} deleted, {orphans} left over deleted, {expired} past {KEEP_DAYS} days deleted")
    return 0


def sweep(con, now: float) -> int:
    """The bookkeeping and the card agree again after a power cut: a file no waiting clip refers to (a cut that was
    interrupted, a clip whose row a cut undid) goes once it is old enough to be nobody's work in progress, and a waiting
    clip whose file is gone (deleted just before an undone commit) is marked lost."""
    wanted = {r[0] for r in con.execute("select file from kept where collected = 0")}
    present, n = set(), 0
    for d in ("incoming", "clips", "sample"):
        root = HOME / d
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if not p.is_file():
                continue
            rel = p.relative_to(HOME).as_posix()
            present.add(rel)
            if rel not in wanted and now - p.stat().st_mtime > ORPHAN_S:
                p.unlink(missing_ok=True)
                n += 1
    gone = wanted - present
    if gone:
        con.executemany("update kept set collected = 1, via = 'lost', gone_at = ? where file = ? and collected = 0 and sha256 is not null",
                        [(int(time.time()), f) for f in gone])
        con.commit()
    return n


def rate(clip: Path) -> int:
    """The sample rate of a WAV clip; BirdNET-Go's Opus clips are 48 kHz."""
    if clip.suffix.lower() != ".wav":
        return 48000
    try:
        with wave.open(str(clip)) as w:
            return w.getframerate()
    except (wave.Error, EOFError, OSError):
        return 48000


def cut_window(pre: float, length: float, slow: int) -> tuple[float, float]:
    """Where to cut, in seconds of the recording: from the start of the detection, LIFE_CLIPS_SECONDS long; for a
    slowed-down bat, its three seconds with BAT_LEAD_S either side."""
    if slow > 1:
        return max(0.0, pre - BAT_LEAD_S), min(length, pre + 3 + BAT_LEAD_S)
    return pre, min(length, pre + SECONDS)


def convert(src: Path, dst: Path, sr: int, slow: int, a: float, b: float) -> float:
    """Cut, slow down, level and encode one clip with ffmpeg; returns the gain in dB. Written beside its place and
    renamed, so a power cut never leaves half a clip under its name."""
    chain = [f"atrim=start={a:.3f}:end={b:.3f}", "asetpts=PTS-STARTPTS"]
    if slow > 1:
        chain.append(f"asetrate={sr // slow},aresample=48000")
    probe = subprocess.run([FFMPEG, "-nostdin", "-hide_banner", "-i", str(src), "-af", ",".join(chain + ["volumedetect"]),
                            "-f", "null", "-"], capture_output=True, text=True, timeout=120)
    m = re.search(r"max_volume:\s*(-inf|-?[\d.]+) dB", probe.stderr)
    if probe.returncode != 0 or not m:
        raise RuntimeError((probe.stderr.strip() or "no level measured")[-160:])
    peak = -91.0 if m.group(1) == "-inf" else float(m.group(1))
    gain = round(min(PEAK_DB - peak, MAX_GAIN_DB), 1)
    tmp = dst.with_name(dst.name + ".part")
    r = subprocess.run([FFMPEG, "-nostdin", "-loglevel", "error", "-y", "-i", str(src), "-af", ",".join(chain + [f"volume={gain}dB"]),
                        "-ac", "1", "-c:a", "aac", "-b:a", BITRATE, "-movflags", "+faststart", "-f", "mp4", str(tmp)],
                       capture_output=True, timeout=120)
    if r.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(r.stderr.decode(errors="replace").strip()[-160:])
    with open(tmp, "rb") as f:
        os.fsync(f.fileno())
    os.replace(tmp, dst)
    return gain


def finish_all(con) -> tuple[int, int]:
    """Cut every kept clip that is not cut yet (this run's, and any an earlier run or version left)."""
    pre, length = preset()
    cut = failed = 0
    for seq, rel, det, ts, scientific, b, month in con.execute(
            "select seq, file, det, ts, scientific, band, month from kept where collected = 0 and sha256 is null order by seq").fetchall():
        ok = finish(con, seq, rel, det, ts, scientific, b, month, pre, length)
        cut += ok is True
        failed += ok is False
    return cut, failed


def finish(con, seq, rel, det, ts, scientific, b, month, pre, length) -> bool | None:
    """One clip: cut to its final form, or left as it is when it cannot be cut. True when cut, False when left,
    None when its file was gone."""
    src = HOME / rel
    if not src.exists():
        con.execute("update kept set collected = 1, via = 'lost', gone_at = ? where seq = ?", (int(time.time()), seq))
        con.commit()
        return None
    sr = rate(src)
    slow = SLOW if sr > 48000 else 1
    a, z = cut_window(pre, length, slow)
    final, timing, expansion, gain, error = rel, (length, pre, pre + 3), None, None, None
    if FFMPEG:
        # local time first, so a folder lists in the order the node heard them; the detection id keeps two apart
        name = f"{datetime.fromtimestamp(ts, TZ):%Y%m%d-%H%M%S}_{safe(scientific)}_{b}_{det}"
        out = Path("clips") / month / (name + (f".x{slow}" if slow > 1 else "") + ".m4a")
        try:
            (HOME / out).parent.mkdir(parents=True, exist_ok=True)
            gain = convert(src, HOME / out, sr, slow, a, z)
            final, timing, expansion = str(out), (z - a, pre - a, min(pre + 3, z) - a), (slow if slow > 1 else None)
        except Exception as e:  # noqa: BLE001 - the clip stays as BirdNET-Go wrote it
            error = f"not cut: {e}"[:200]
    else:
        error = "not cut: no ffmpeg"
    data = HOME / final
    con.execute("""update kept set file = ?, clip_s = ?, from_s = ?, to_s = ?, expansion = ?, gain_db = ?, bytes = ?,
                   sha256 = ?, error = ? where seq = ?""",
                (str(final), round(timing[0], 3), round(timing[1], 3), round(timing[2], 3), expansion, gain,
                 data.stat().st_size, sha256(data), error, seq))
    con.commit()
    if final != rel:
        src.unlink(missing_ok=True)
    return error is None


def purge(con) -> None:
    """LIFE_KEEP_CLIPS=0: every clip goes."""
    for d in (EXPORT, HOME / "sample", HOME / "clips", HOME / "incoming"):
        if d and d.exists():
            for p in d.rglob("*"):
                if p.is_file():
                    p.unlink(missing_ok=True)
    for t in ("kept", "seen", "batches", "handed"):
        con.execute(f"delete from {t}")
    con.commit()
    write_status(con)
    say("clip keeping is off; every clip on the node deleted")


def free_mb(p: Path) -> float:
    try:
        st = os.statvfs(p)
        return st.f_bavail * st.f_frsize / 1e6
    except OSError:
        return float("inf")


def status(con) -> dict:
    waiting, size, first = con.execute(
        "select count(*), coalesce(sum(bytes), 0), min(month) from kept where collected = 0").fetchone()
    batches = con.execute("select batch, n from batches order by at desc limit 40").fetchall()
    return {"keep": KEEP, "waiting": waiting, "mb": round(size / 1e6, 1), "oldestMonth": first,
            "collectedAt": meta(con, "collected_at"), "sentAt": meta(con, "sent_at"),
            "handed": ",".join(f"{b}:{n}" for b, n in batches) or None, "upload": meta(con, "upload_note"),
            "full": KEEP and free_mb(HOME) < MIN_FREE_MB}


def write_status(con) -> None:
    tmp = HOME / "status.json.tmp"
    tmp.write_text(json.dumps(status(con)))
    os.replace(tmp, HOME / "status.json")


def sha256(p: Path | bytes) -> str:
    h = hashlib.sha256()
    if isinstance(p, bytes):
        h.update(p)
        return h.hexdigest()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# --- the node sends its clips itself, over the cable or the WiFi ---

def device(route: str) -> str | None:
    """The interface in `ip route get`: '1.1.1.1 via 192.168.2.254 dev wlan0 src ...' -> 'wlan0'; None without one."""
    words = route.split()
    if not words or words[0] in ("unreachable", "prohibit", "blackhole", "throw"):
        return None
    return words[words.index("dev") + 1] if "dev" in words[:-1] else None


def way_out() -> str | None:
    """The interface the node's internet traffic leaves by, if that is the cable or the WiFi for IPv4 and the same or
    none for IPv6; None for anything that may be the SIM (life-tailscale decides the same way)."""
    ways = {}
    for fam, addr in PROBES:
        try:
            r = subprocess.run(["ip", fam, "route", "get", addr], capture_output=True, text=True, timeout=10)
        except (OSError, subprocess.TimeoutExpired):
            return None
        ways[fam] = device(r.stdout) if r.returncode == 0 else None
    v4, v6 = ways.get("-4"), ways.get("-6")
    return v4 if v4 in WAYS and (v6 is None or v6 == v4 or v6 in WAYS) else None


class Oracle:
    """POSTs to the oracle on one kept-alive connection whose socket is bound to one interface (SO_BINDTODEVICE): if
    the cable or the WiFi goes, the connection fails, and nothing falls back to the 4G stick."""

    def __init__(self, dev: str | None, api: str | None = None):
        u = urllib.parse.urlsplit(api or API)
        self.https = u.scheme == "https"
        self.host, self.port = u.hostname, u.port or (443 if u.scheme == "https" else 80)
        self.base, self.dev, self.conn = u.path.rstrip("/"), dev, None

    def _open(self):
        err = None
        for af, kind, proto, _, addr in socket.getaddrinfo(self.host, self.port, 0, socket.SOCK_STREAM):
            s = socket.socket(af, kind, proto)
            try:
                if self.dev and BIND:
                    s.setsockopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, self.dev.encode())
                s.settimeout(60)
                s.connect(addr)
                break
            except OSError as e:
                err = e
                s.close()
                s = None
        if s is None:
            raise err or OSError(f"no address for {self.host}")
        if self.https:
            c = http.client.HTTPSConnection(self.host, self.port, timeout=60)
            c.sock = ssl.create_default_context().wrap_socket(s, server_hostname=self.host)
        else:
            c = http.client.HTTPConnection(self.host, self.port, timeout=60)
            c.sock = s
        return c

    def post(self, path: str, body: bytes, ctype: str, auth: str) -> tuple[int, dict]:
        """(status, answer); status 0 when the oracle could not be reached. One retry on a stale connection: the oracle
        keeps a clip once per name, so a POST sent twice is kept once."""
        for attempt in (1, 2):
            try:
                if self.conn is None:
                    self.conn = self._open()
                self.conn.request("POST", self.base + path, body=body, headers={"content-type": ctype, "authorization": auth})
                r = self.conn.getresponse()
                raw = r.read()
            except (http.client.HTTPException, OSError) as e:
                self.close()
                if attempt == 2:
                    return 0, {"error": str(e)[:200]}
                continue
            try:
                out = json.loads(raw or b"{}")
            except ValueError:
                out = {"error": raw[:200].decode(errors="replace")}
            return r.status, out if isinstance(out, dict) else {}
        return 0, {}

    def close(self) -> None:
        if self.conn is not None:
            self.conn.close()
            self.conn = None


def multipart(fields: dict, name: str, data: bytes, mime: str) -> tuple[bytes, str]:
    b = uuid.uuid4().hex
    out = io.BytesIO()
    for k, v in fields.items():
        if v not in (None, ""):
            out.write(f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    out.write(f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: {mime}\r\n\r\n".encode())
    out.write(data)
    out.write(f"\r\n--{b}--\r\n".encode())
    return out.getvalue(), f"multipart/form-data; boundary={b}"


MIME = {".m4a": "audio/mp4", ".opus": "audio/ogg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".flac": "audio/flac", ".mp3": "audio/mpeg"}
COLS = ("seq, ref, file, ts, scientific, confidence, band, detector, source, clip_s, from_s, to_s, expansion, gain_db, "
        "bytes, sha256")


def fields_of(r: sqlite3.Row) -> dict:
    """A clip's facts as the oracle takes them (POST /clips), and as a laptop gets them from the node."""
    return {"detection": r["ref"], "time_utc": datetime.fromtimestamp(r["ts"], timezone.utc).isoformat(timespec="seconds"),
            "scientific": r["scientific"], "score": f"{r['confidence']:.3f}", "band": r["band"], "detector": r["detector"],
            "source": r["source"], "clip_s": r["clip_s"], "detection_from_s": r["from_s"], "detection_to_s": r["to_s"],
            "expansion": r["expansion"], "gain_db": r["gain_db"]}


def upload(seconds: float = 600, now=time.time) -> int:
    """Send what waits, oldest first, for at most `seconds`, while the way out stays the cable or the WiFi."""
    if not KEEP or not UPLOAD:
        say("clip upload is off (LIFE_KEEP_CLIPS / LIFE_CLIPS_UPLOAD); nothing sent")
        return 0
    if not TOKEN.startswith("lo_dev_"):
        say("no device token (LIFE_DEVICE_TOKEN); nothing sent")
        return 0
    dev = way_out()
    if dev is None:
        say("the way out is not the cable or the WiFi; nothing sent (sound never goes over the SIM)")
        return 0
    HOME.mkdir(parents=True, exist_ok=True)
    lock = open(HOME / ".upload-lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        say("another upload is running")
        return 0
    con = connect()
    con.row_factory = sqlite3.Row
    oracle = Oracle(dev)
    deadline = time.monotonic() + seconds
    sent = refused = 0
    stop = None
    try:
        while stop is None and time.monotonic() < deadline:
            rows = con.execute(f"""select {COLS} from kept where collected = 0 and sha256 is not null and tries < ?
                                   and next_try <= ? order by ts limit 50""", (TRIES, int(now()))).fetchall()
            if not rows:
                break
            for r in rows:
                if time.monotonic() >= deadline:
                    break
                if way_out() != dev:
                    stop = "the way out changed"   # the hotspot went and the 4G took over, or the cable came out
                    break
                con.execute("update kept set sending = ? where seq = ?", (int(now()), r["seq"]))
                con.commit()
                path = HOME / r["file"]
                try:
                    data = path.read_bytes()
                except FileNotFoundError:
                    con.execute("update kept set collected = 1, via = 'lost', gone_at = ?, sending = 0 where seq = ?", (int(now()), r["seq"]))
                    con.commit()
                    continue
                h = sha256(data)   # what the card holds now is what goes; the oracle's answer must name the same
                mime = MIME.get(path.suffix.lower(), "application/octet-stream")
                body, ctype = multipart({**fields_of(r), "sha256": h}, path.name, data, mime)
                code, out = oracle.post("/clips", body, ctype, f"Bearer {TOKEN}")
                if code in (200, 201) and out.get("ok") and out.get("created") is False and out.get("sha256") != h:
                    # the oracle holds other sound under this clip's name (an earlier send of it): the node's is the one
                    body, ctype = multipart({**fields_of(r), "sha256": h, "replace": "1"}, path.name, data, mime)
                    code, out = oracle.post("/clips", body, ctype, f"Bearer {TOKEN}")
                if code in (200, 201) and out.get("ok") and out.get("sha256") == h:
                    path.unlink(missing_ok=True)
                    con.execute("update kept set collected = 1, via = 'upload', gone_at = ?, sending = 0, error = null where seq = ?", (int(now()), r["seq"]))
                    con.commit()
                    sent += 1
                    continue
                con.execute("update kept set sending = 0 where seq = ?", (r["seq"],))
                if code in (401, 403):
                    stop = f"the oracle refused the node's token ({code})"
                elif code == 0 or code == 429 or code >= 500 or (code in (200, 201) and not out.get("ok")):
                    stop = f"the oracle could not take it ({code or 'unreachable'}: {str(out.get('error', ''))[:80]})"
                else:   # this clip, not the link: try it again later, and the rest now
                    tries = con.execute("select tries from kept where seq = ?", (r["seq"],)).fetchone()[0] + 1
                    con.execute("update kept set tries = ?, next_try = ?, error = ? where seq = ?",
                                (tries, int(now()) + min(86400, 600 * 2 ** tries), f"{code}: {str(out.get('error', ''))[:150]}", r["seq"]))
                    refused += 1
                con.commit()
                if stop:
                    break
        if sent:
            if way_out() == dev:
                bands(oracle, con)
            meta(con, "sent_at", datetime.now(timezone.utc).isoformat(timespec="seconds"))
        meta(con, "upload_note", stop or ("" if not refused else f"{refused} refused"))
        con.commit()
    finally:
        oracle.close()
        con.row_factory = None
        write_status(con)
        con.close()
        lock.close()
    say(f"{sent} clips sent to the oracle over {dev}" + (f", {refused} refused" if refused else "") + (f"; stopped: {stop}" if stop else ""))
    return 0


def band_rows(con, months: int | None = None) -> list[dict]:
    """Per month, species and score band: the detections the sampler saw and the clips it kept from them. A clip's
    weight is detections / kept; without it a checked sample of five per band says how often the detector is right in
    a band, but not how often it is right over all it reported. `months` limits it to the latest few."""
    as_of = datetime.now(timezone.utc).isoformat(timespec="seconds")
    since = ""
    if months:
        last = con.execute("select max(substr(cell, 1, 7)) from seen").fetchone()[0]
        if last:
            y, m = int(last[:4]), int(last[5:7]) - (months - 1)
            while m < 1:
                y, m = y - 1, m + 12
            since = f"{y:04d}-{m:02d}"
    out = []
    for cell, n in con.execute("select cell, n from seen where cell >= ? order by cell", (since,)).fetchall():
        month, scientific, b = cell.split("|")
        k = con.execute("select count(*) from kept where cell = ?", (cell,)).fetchone()[0]
        out.append({"month": month, "scientific": scientific, "band": b, "detections": n, "kept": k, "as_of_utc": as_of})
    return out


def bands(oracle: Oracle, con) -> None:
    rows = band_rows(con, months=2)
    if rows:
        code, out = oracle.post("/clips/bands", json.dumps({"rows": rows}).encode(), "application/json", f"Bearer {TOKEN}")
        if code != 200:
            say(f"band counts not sent ({code} {str(out.get('error', ''))[:80]})")


# --- a laptop on the node's own WiFi (life-visit serves these to it) ---

def manifest(after: int = 0, limit: int = 1000) -> list[dict]:
    """The waiting clips after `after`, in the order they were kept: what a laptop downloads."""
    con = connect()
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(f"select {COLS} from kept where collected = 0 and sha256 is not null and seq > ? order by seq limit ?",
                           (after, max(1, min(limit, 5000)))).fetchall()
        return [{**fields_of(r), "seq": r["seq"], "file": r["file"], "bytes": r["bytes"], "sha256": r["sha256"]} for r in rows]
    finally:
        con.close()


def clip_file(rel: str) -> Path | None:
    """A waiting clip's file, only if it is one; a laptop names files only from the manifest."""
    con = connect()
    try:
        ok = con.execute("select 1 from kept where file = ? and collected = 0", (rel,)).fetchone()
    finally:
        con.close()
    p = (HOME / rel).resolve()
    return p if ok and p.is_file() and HOME.resolve() in p.parents else None


def counts(now: float | None = None) -> dict:
    """What a visit finds: the clips a laptop can take and their size, and how many an upload would send now (not
    refused too often, not waiting for a retry)."""
    con = connect()
    try:
        n, size = con.execute("select count(*), coalesce(sum(bytes), 0) from kept where collected = 0 and sha256 is not null").fetchone()
        ready = con.execute("select count(*) from kept where collected = 0 and sha256 is not null and tries < ? and next_try <= ?",
                            (TRIES, int(now or time.time()))).fetchone()[0]
        return {"waiting": n, "mb": round(size / 1e6, 1), "ready": ready}
    finally:
        con.close()


def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def node_id() -> str | None:
    """The node's device id on the oracle, from the last visit settings it sent (life-visit apply)."""
    try:
        return json.loads((STATE_DIR / "visit.json").read_text()).get("device") or None
    except (OSError, ValueError):
        return None


def items_hash(items: list[tuple[str, str]]) -> str:
    """The batch's fingerprint, the same on the oracle: SHA-256 over 'ref sha256\\n' per clip, sorted by ref."""
    return hashlib.sha256("".join(f"{ref} {h}\n" for ref, h in sorted(items)).encode()).hexdigest()


def grant(batch: str, items: list[tuple[str, str]], now: float | None = None) -> str | None:
    """lg1.<payload>.<signature>: lets whoever holds it send exactly these clips to the oracle as this node, for
    GRANT_DAYS. Signed with HMAC-SHA256 under the SHA-256 of the node's token, which is what the oracle keeps of it,
    so the token itself never leaves the node."""
    d = node_id()
    if not d or not TOKEN.startswith("lo_dev_"):
        return None
    payload = {"v": 1, "d": d, "b": batch, "n": len(items), "h": items_hash(items),
               "e": int((now or time.time()) + GRANT_DAYS * 86400)}
    p = b64url(json.dumps(payload, separators=(",", ":")).encode())
    key = hashlib.sha256(TOKEN.encode()).hexdigest().encode()
    return f"lg1.{p}.{b64url(hmac.new(key, p.encode(), hashlib.sha256).digest())}"


def handover(refs: list[str], laptop: str = "") -> dict:
    """A laptop has these clips, each checked against its SHA-256: they become one batch, still on the node and
    still waiting, and the laptop gets the batch's grant. They are deleted when the oracle confirms the batch."""
    con = connect()
    try:
        have = []
        for i in range(0, len(refs), 500):
            chunk = refs[i:i + 500]
            have += con.execute(f"select seq, ref, sha256 from kept where collected = 0 and sha256 is not null and ref in ({','.join('?' * len(chunk))})",
                                chunk).fetchall()
        if not have:
            return {"batch": None, "n": 0, "grant": None}
        batch = secrets.token_hex(6)
        items = [(ref, h) for _, ref, h in have]
        g = grant(batch, items)
        if g is None:   # without it the oracle would refuse the laptop's clips; they stay on the node, waiting
            return {"batch": None, "n": 0, "grant": None,
                    "error": "the node does not know its own id yet: it learns it from the oracle's answer to its next heartbeat"}
        con.execute("insert into batches (batch, n, at, laptop) values (?, ?, ?, ?)", (batch, len(have), int(time.time()), laptop[:80]))
        con.executemany("insert into handed (batch, seq) values (?, ?)", [(batch, seq) for seq, _, _ in have])
        con.commit()
        write_status(con)
        # the laptop registers exactly this list with the oracle (POST /clips/batches); a ref it asked for that is not
        # here any more (sent meanwhile over a hotspot) is simply not in it
        return {"batch": batch, "n": len(have), "grant": g, "hash": items_hash(items),
                "items": [{"ref": ref, "sha256": h} for ref, h in sorted(items)]}
    finally:
        con.close()


def receipt(batches: list[str]) -> int:
    """The oracle has every clip of these batches: delete them from the node."""
    con = connect()
    n = 0
    try:
        for b in batches:
            rows = con.execute("select k.seq, k.file from kept k join handed h on h.seq = k.seq where h.batch = ? and k.collected = 0", (b,)).fetchall()
            for seq, rel in rows:
                (HOME / rel).unlink(missing_ok=True)
                con.execute("update kept set collected = 1, via = 'laptop', gone_at = ? where seq = ?", (int(time.time()), seq))
                n += 1
            con.execute("delete from handed where batch = ?", (b,))
            con.execute("delete from batches where batch = ?", (b,))
        con.commit()
        write_status(con)
    finally:
        con.close()
    if n or batches:
        say(f"the oracle has batch {', '.join(batches)}: {n} clips deleted from the node")
    return n


# --- a visit takes the clips away on a stick ---

def fsync_dir(d: Path) -> None:
    try:
        fd = os.open(d, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass  # FAT and exFAT accept no fsync on a directory; the umount writes it


def collect(dest: Path) -> int:
    con = state()
    try:
        return _collect(con, dest)
    finally:
        con.close()
        release()


def _collect(con, dest: Path) -> int:
    finish_all(con)   # a stick that comes before the next sample takes this run's clips cut too
    con.row_factory = sqlite3.Row
    rows = con.execute(f"select {COLS} from kept where collected = 0 order by ts").fetchall()
    con.row_factory = None
    host = os.environ.get("NODE_HOSTNAME") or socket.gethostname()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = dest / "life-clips" / host / stamp
    out.mkdir(parents=True, exist_ok=True)
    sums, done = {}, []
    with open(out / "clips.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["file", "detection", "time_local", "time_utc", "scientific", "score", "band", "detector",
                    "clip_s", "detection_from_s", "detection_to_s", "label", "true_species", "checked_by", "note",
                    "ref", "sha256", "source", "gain_db", "expansion", "ready"])
        for r in rows:
            src = HOME / r["file"]
            month = datetime.fromtimestamp(r["ts"], TZ).strftime("%Y-%m")
            target = out / month / Path(r["file"]).name
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                shutil.copyfile(src, target)
                h = sha256(src)
            except FileNotFoundError:  # sent to the oracle meanwhile, or gone in a power cut before it was marked so
                target.unlink(missing_ok=True)
                con.execute("update kept set collected = 1, via = coalesce(via, 'lost'), gone_at = ? where seq = ? and collected = 0",
                            (int(time.time()), r["seq"]))
                continue
            with open(target, "rb") as t:
                os.fsync(t.fileno())
            sums[target.relative_to(out).as_posix()] = h
            t_utc = datetime.fromtimestamp(r["ts"], timezone.utc)
            num = lambda v: "" if v is None else f"{v:g}"  # noqa: E731
            w.writerow([target.relative_to(out).as_posix(), r["ref"].split("@")[0], t_utc.astimezone(TZ).isoformat(timespec="seconds"),
                        t_utc.isoformat(timespec="seconds"), r["scientific"], f"{r['confidence']:.3f}", r["band"], r["detector"],
                        num(r["clip_s"]), num(r["from_s"]), num(r["to_s"]), "", "", "", "",
                        r["ref"], r["sha256"] or "", r["source"] or "", num(r["gain_db"]), num(r["expansion"]),
                        "1" if src.suffix == ".m4a" else "0"])
            done.append((r["seq"], src))
        f.flush()
        os.fsync(f.fileno())
    # How many detections each kept clip stands for: per month, species and score band (band_rows)
    with open(out / "bands.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["month", "scientific", "band", "detections", "kept", "as_of_utc"])
        for b in band_rows(con):
            w.writerow([b["month"], b["scientific"], b["band"], b["detections"], b["kept"], b["as_of_utc"]])
        f.flush()
        os.fsync(f.fileno())
    lists = {"bands.csv": sha256(out / "bands.csv")}
    (out / "SHA256SUMS").write_text("".join(f"{h}  {n}\n" for n, h in sorted({**sums, **lists}.items())))
    for d in {out, *[out / Path(n).parent for n in sums]}:
        fsync_dir(d)
    # read it back from the stick before anything leaves the node
    bad = [n for n, h in {**sums, **lists}.items() if sha256(out / n) != h]
    if bad:
        (out / "FAILED.txt").write_text(f"{len(bad)} of {len(sums)} clips did not copy cleanly; nothing was deleted from the node.\n")
        print(f"life-clips: {len(bad)} clips did not copy cleanly onto {dest}; nothing deleted", file=sys.stderr)
        return 1
    for seq, src in done:
        src.unlink(missing_ok=True)
        con.execute("update kept set collected = 1, via = 'stick', gone_at = ? where seq = ?", (int(time.time()), seq))
    meta(con, "collected_at", datetime.now(timezone.utc).isoformat(timespec="seconds"))
    con.commit()
    write_status(con)
    mb = sum((out / n).stat().st_size for n in sums) / 1e6
    (out / "RECEIPT.txt").write_text(
        f"{len(sums)} clips ({mb:.1f} MB) from {host}, copied {stamp}, checked against SHA256SUMS and deleted from the node.\n"
        "clips.csv lists each clip: species, score, where in the clip the detected three seconds are, and the gain it was\n"
        "levelled by. A checker fills in label (right, wrong or unsure) and, when wrong, the species that sang.\n"
        "bands.csv says how many detections each month's clips were drawn from, per species and score band: the weights that\n"
        "turn the checked sample into the share of all detections that were right.\n")
    say(f"{len(sums)} clips ({mb:.1f} MB) copied to {out} and deleted from the node")
    return 0


def led(ok: bool) -> None:
    """The green light: on for ten seconds when the copy is good, blinking for ten when it is not."""
    act = next((p for p in (Path("/sys/class/leds/ACT"), Path("/sys/class/leds/led0")) if p.exists()), None)
    if not act:
        return
    try:
        old = re.search(r"\[(\S+)\]", (act / "trigger").read_text())
        (act / "trigger").write_text("none" if ok else "timer")
        if ok:
            (act / "brightness").write_text("1")
        time.sleep(10)
        (act / "trigger").write_text(old.group(1) if old else "mmc0")
    except OSError:
        pass


def collect_device(dev: str) -> int:
    MOUNT.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(["mount", "-o", "nosuid,nodev,noexec,noatime", dev, str(MOUNT)], capture_output=True, text=True)
    if r.returncode != 0:
        print(f"life-clips: could not mount {dev}: {r.stderr.strip()}", file=sys.stderr)
        led(False)
        return 1
    try:
        rc = collect(MOUNT)
    finally:
        subprocess.run(["sync"])
        subprocess.run(["umount", str(MOUNT)])
    led(rc == 0)
    return rc


def export_dir() -> Path:
    """BirdNET-Go's clip directory: realtime.audio.export.path, relative to its working directory (BIRDNET_DIR)."""
    path = yaml_get(CONFIG.read_text(), ("realtime", "audio", "export", "path")) if CONFIG.exists() else None
    p = Path(path or "clips/")
    return p if p.is_absolute() else BNG / p


def main() -> int:
    global EXPORT
    EXPORT = EXPORT or export_dir()
    args = sys.argv[1:]
    cmd = args[0] if args else "status"
    if cmd == "setup":
        return setup()
    if cmd == "sample":
        return sample()
    if cmd == "upload":
        return upload(float(args[args.index("--for") + 1]) if "--for" in args else 600)
    if cmd == "collect":
        if "--to" not in args:
            print("usage: life-clips collect --to DIR", file=sys.stderr)
            return 2
        return collect(Path(args[args.index("--to") + 1]))
    if cmd == "collect-device":
        return collect_device(args[1])
    if cmd == "receipt":
        receipt([a for a in args[1:] if re.fullmatch(r"[0-9a-f]{6,32}", a)])
        return 0
    if cmd == "apply":   # life-push hands over the oracle's answer to a heartbeat
        try:
            answer = json.load(sys.stdin)
        except ValueError:
            return 0
        got = answer.get("clipsReceived") if isinstance(answer, dict) else None
        if isinstance(got, list) and got:
            receipt([b for b in got if isinstance(b, str) and re.fullmatch(r"[0-9a-f]{6,32}", b)])
        return 0
    if cmd == "status":
        con = connect()
        s = status(con)
        con.close()
        print(json.dumps(s) if "--json" in args else
              f"clip keeping {'on' if s['keep'] else 'off'}; {s['waiting']} clips ({s['mb']} MB) waiting"
              + (f", oldest from {s['oldestMonth']}" if s["oldestMonth"] else "")
              + (f"; last sent {s['sentAt']}" if s["sentAt"] else "")
              + (f"; last collected {s['collectedAt']}" if s["collectedAt"] else "")
              + (f"; with a laptop: {s['handed']}" if s["handed"] else ""))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
