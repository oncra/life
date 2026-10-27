#!/usr/bin/env python3
"""Life node clip sample: the sound an expert checks, kept on the node's own card (content/spec.md, section 2.2).

To give every species its own threshold, someone has to hear what the detector heard. The node sends no sound over
the air, so it keeps a small sample of BirdNET-Go's clips on /data and nothing else, and a visit takes the sample
away by hand on a USB stick named LIFECLIPS.

    life-clips setup                     before BirdNET-Go starts: clip export on or off in its config
    life-clips sample                    every 15 minutes: keep the sample, delete every other clip
    life-clips collect --to DIR          copy the sample, its list and the band counts into DIR, check the copy, delete it from the node
    life-clips collect-device /dev/sdX1  the same onto a stick named LIFECLIPS (udev starts this when one is plugged in)
    life-clips status [--json]           what is waiting for a visit

What the sample is:
- only detections of bird and bat species (BirdNET-Go label type `species`), only inside the listening windows of
  their own day (life-schedule-wpi), and only clips BirdNET-Go actually wrote: its privacy filter writes no clip in
  which it hears a human voice, and its speech detector (Privacy Guard, `realtime.privacyfilter.vad`) drops such a
  detection outright;
- per species, per month and per score band of 0.1, at most LIFE_CLIPS_PER_BAND (5) clips: a uniform random sample of
  that month's detections in that band (reservoir sampling), so the checking covers the whole score range;
- every other clip is deleted at the first run after BirdNET-Go has finished writing it (SETTLE_S), and anything still
  in BirdNET-Go's export directory after ORPHAN_S is deleted too, so no sound piles up;
- a kept clip is deleted once a visit has copied it, and after LIFE_CLIPS_KEEP_DAYS (365) if no visit came. A collected
  clip keeps its place in the month's sample, so a visit halfway through a month does not let more than five through.

BirdNET-Go writes clips of 10 to 60 seconds (default 15, with 3 s before the detection). The node keeps those
defaults: the same two numbers set the window in which BirdNET-Go confirms a bird, and changing them would change what
the node reports. The list beside the clips says where in each clip the detected three seconds are.

To have detections in the low score bands at all, `setup` puts BirdNET-Go's own threshold at 0.1 while clips are kept.
What the node sends to the oracle does not follow: life-push keeps its floor of 0.7 (LIFE_MIN_CONFIDENCE_FLOOR, set in
the units), the score the Diversity reading counts from.

LIFE_KEEP_CLIPS=0 turns all of it off: export goes off in BirdNET-Go's config at the next boot, its threshold returns
to 0.7, and the next run deletes every clip on the node, the sample included.

env: LIFE_KEEP_CLIPS (1), LIFE_CLIPS_PER_BAND (5), LIFE_CLIPS_KEEP_DAYS (365), LIFE_CLIPS_ANYTIME (0; 1 keeps clips
     outside the windows too, for a bench), BIRDNET_DIR (/data/birdnet-go), BIRDNET_DB, BIRDNET_CONFIG, BIRDNET_CLIPS,
     LIFE_CLIPS_DIR (/data/life-clips), LIFE_SCHEDULE_WPI (/usr/local/sbin/life-schedule-wpi), NODE_TZ, NODE_HOSTNAME
"""
import csv
import fcntl
import hashlib
import importlib.machinery
import importlib.util
import json
import os
import random
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

BNG = Path(os.environ.get("BIRDNET_DIR", "/data/birdnet-go"))
DB = Path(os.environ.get("BIRDNET_DB") or BNG / "birdnet.db")
CONFIG = Path(os.environ.get("BIRDNET_CONFIG") or BNG / "config.yaml")
EXPORT = Path(os.environ["BIRDNET_CLIPS"]) if os.environ.get("BIRDNET_CLIPS") else None  # else from the config
HOME = Path(os.environ.get("LIFE_CLIPS_DIR", "/data/life-clips"))
SCHEDULE = os.environ.get("LIFE_SCHEDULE_WPI", "/usr/local/sbin/life-schedule-wpi")
TZ = ZoneInfo(os.environ.get("NODE_TZ") or "Europe/Amsterdam")
KEEP = os.environ.get("LIFE_KEEP_CLIPS", "1").strip() != "0"
ANYTIME = os.environ.get("LIFE_CLIPS_ANYTIME", "0").strip() == "1"
PER_BAND = int(os.environ.get("LIFE_CLIPS_PER_BAND") or 5)
KEEP_DAYS = int(os.environ.get("LIFE_CLIPS_KEEP_DAYS") or 365)
SETTLE_S = 15 * 60   # BirdNET-Go may still be encoding a clip ten minutes after the detection (its ClipRecencyWindow)
ORPHAN_S = 30 * 60   # anything in its export directory longer than this was never going to be sampled
STICK = "LIFECLIPS"
MOUNT = Path("/run/life-clips-usb")

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
        print(f"life-clips: no BirdNET-Go config at {CONFIG}; nothing to set")
        return 0
    text = orig = CONFIG.read_text()
    for path, value in (ON if KEEP else OFF):
        text, what = yaml_set(text, path, value)
        if what == "missing":
            # the privacy guard needs BirdNET-Go 20261014 or later; without it the human-voice filter still stands
            print(f"life-clips: {'.'.join(path)} not in this BirdNET-Go's config, left alone")
        elif what != "same":
            print(f"life-clips: {'.'.join(path)} = {value} ({what})")
    if text != orig:
        tmp = CONFIG.with_suffix(".yaml.life-clips")
        tmp.write_text(text)
        os.replace(tmp, CONFIG)
    print(f"life-clips: clip keeping {'on' if KEEP else 'off'}")
    return 0


# --- the sample ---

_lock = None


def state() -> sqlite3.Connection:
    """The sample's bookkeeping on /data, taken by one run at a time (the timer and a stick can meet)."""
    global _lock
    HOME.mkdir(parents=True, exist_ok=True)
    if _lock is None:
        _lock = open(HOME / ".lock", "w")
        fcntl.flock(_lock, fcntl.LOCK_EX)
    con = sqlite3.connect(HOME / "state.db", timeout=30)
    con.executescript("""
        create table if not exists meta (key text primary key, value text);
        create table if not exists seen (cell text primary key, n integer not null);
        create table if not exists kept (
            id integer primary key, cell text not null, slot integer not null, file text not null,
            ts integer not null, scientific text not null, confidence real not null, band text not null,
            month text not null, detector text, collected integer not null default 0,
            unique (cell, slot));
    """)
    return con


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


def detections(after: int):
    """BirdNET-Go's detections after id `after`, oldest first: (id, epoch, confidence, clip, scientific, kind, model)."""
    if not DB.exists():
        return
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=30)
    try:
        tables = {r[0] for r in con.execute("select name from sqlite_master where type = 'table'")}
        if {"detections", "labels", "label_types"} <= tables:
            models = "m.name" if "ai_models" in tables else "null"
            join = "left join ai_models m on m.id = d.model_id" if "ai_models" in tables else ""
            q = f"""select d.id, d.detected_at, d.confidence, d.clip_name, l.scientific_name, t.name, {models}
                    from detections d join labels l on l.id = d.label_id join label_types t on t.id = l.label_type_id
                    {join} where d.id > ? order by d.id"""
            yield from con.execute(q, (after,))
        elif "notes" in tables:  # the older schema: no label types, so a label without a genus and species is no bird
            for r in con.execute("select id, date, time, confidence, clip_name, scientific_name from notes where id > ? order by id", (after,)):
                ts = int(datetime.fromisoformat(f"{r[1]}T{r[2]}").replace(tzinfo=TZ).timestamp())
                kind = "species" if re.fullmatch(r"[A-Z][a-z]+ [a-z-]+", r[5] or "") else "other"
                yield (r[0], ts, r[3], r[4], r[5], kind, None)
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


def in_window(ts: int) -> bool:
    """Whether a detection falls inside the listening windows of its own day (content/spec.md, section 2.2)."""
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
    return any(w["start"] <= t < w["end"] for w in _windows(t.astimezone(TZ).date()))


def band(confidence: float) -> str:
    return f"{min(int(round(confidence * 1000)) // 100, 9) / 10:.1f}"


def remove(p: Path) -> None:
    """Delete a clip and whatever BirdNET-Go keeps beside it under the same name (a spectrogram)."""
    for q in [p, *p.parent.glob(p.stem + ".*"), *p.parent.glob(p.stem + "_*")]:
        try:
            q.unlink()
        except FileNotFoundError:
            pass


def safe(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_") or "unknown"


def sample(rng: random.Random | None = None, now: float | None = None) -> int:
    try:
        return _sample(rng, now)
    finally:
        release()


def _sample(rng: random.Random | None = None, now: float | None = None) -> int:
    rng = rng or random.Random()
    now = time.time() if now is None else now
    con = state()
    if not KEEP:
        purge(con)
        return 0
    cursor = int(meta(con, "cursor") or 0)
    if cursor and cursor > last_id():
        cursor = 0  # BirdNET-Go's database started again; its ids did too
    done = cursor
    kept = dropped = 0
    for det_id, ts, conf, clip_name, scientific, kind, model in detections(cursor):
        if ts > now - SETTLE_S:
            break  # BirdNET-Go may still be writing this clip; the next run takes it
        done = det_id
        clip = EXPORT / clip_name if clip_name else None
        if clip is None or not clip.is_file():
            continue  # no clip written: the privacy filter heard a voice, or export was off at the time
        if kind != "species" or not in_window(ts):
            remove(clip)
            dropped += 1
            continue
        b, month = band(conf), datetime.fromtimestamp(ts, TZ).strftime("%Y-%m")
        cell = f"{month}|{scientific}|{b}"
        n = (con.execute("select n from seen where cell = ?", (cell,)).fetchone() or (0,))[0] + 1
        con.execute("insert into seen (cell, n) values (?, ?) on conflict (cell) do update set n = excluded.n", (cell, n))
        slots = {r[0]: (r[1], r[2]) for r in con.execute("select slot, file, collected from kept where cell = ?", (cell,))}
        if len(slots) < PER_BAND:
            slot = next(s for s in range(PER_BAND) if s not in slots)
        else:
            j = rng.randrange(n)  # reservoir sampling: the n-th detection replaces a kept one with chance PER_BAND/n
            if j >= PER_BAND or slots[j][1]:  # outside the sample, or that place went to a checker already
                remove(clip)
                dropped += 1
                continue
            slot = j
            remove(HOME / slots[j][0])
            con.execute("delete from kept where cell = ? and slot = ?", (cell, slot))
        rel = Path("sample") / month / f"{det_id}_{safe(scientific)}_{b}{clip.suffix}"
        (HOME / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(clip), HOME / rel)
        remove(clip)  # a spectrogram BirdNET-Go may have drawn beside it
        detector = f"birdnet-go:{model.lower().split()[0]}" if model else "birdnet-go"
        con.execute("insert into kept (id, cell, slot, file, ts, scientific, confidence, band, month, detector) values (?,?,?,?,?,?,?,?,?,?)",
                    (det_id, cell, slot, str(rel), ts, scientific, conf, b, month, detector))
        kept += 1
    meta(con, "cursor", done)
    # nothing else stays: whatever is left in BirdNET-Go's export directory once it is old enough to be finished
    orphans = 0
    if EXPORT.exists():
        for p in EXPORT.rglob("*"):
            if p.is_file() and now - p.stat().st_mtime > ORPHAN_S:
                p.unlink(missing_ok=True)
                orphans += 1
    # and nothing stays for ever
    expired = 0
    for cell, slot, rel in con.execute("select cell, slot, file from kept where ts < ?", (int(now - KEEP_DAYS * 86400),)).fetchall():
        (HOME / rel).unlink(missing_ok=True)
        con.execute("delete from kept where cell = ? and slot = ?", (cell, slot))
        expired += 1
    con.execute("delete from seen where cell < ?", (datetime.fromtimestamp(now - KEEP_DAYS * 86400, TZ).strftime("%Y-%m"),))
    con.commit()
    write_status(con)
    print(f"life-clips: {kept} into the sample, {dropped} deleted, {orphans} left over deleted, {expired} past {KEEP_DAYS} days deleted")
    return 0


def purge(con) -> None:
    """LIFE_KEEP_CLIPS=0: every clip goes, the sample included."""
    for d in (EXPORT, HOME / "sample"):
        if d.exists():
            for p in d.rglob("*"):
                if p.is_file():
                    p.unlink(missing_ok=True)
    con.execute("delete from kept")
    con.execute("delete from seen")
    con.commit()
    write_status(con)
    print("life-clips: clip keeping is off; every clip on the node deleted")


def status(con) -> dict:
    rows = con.execute("select file from kept where collected = 0").fetchall()
    size = sum((HOME / r[0]).stat().st_size for r in rows if (HOME / r[0]).exists())
    first = con.execute("select min(month) from kept where collected = 0").fetchone()[0]
    return {"keep": KEEP, "waiting": len(rows), "mb": round(size / 1e6, 1), "oldestMonth": first,
            "collectedAt": meta(con, "collected_at")}


def write_status(con) -> None:
    tmp = HOME / "status.json.tmp"
    tmp.write_text(json.dumps(status(con)))
    os.replace(tmp, HOME / "status.json")


# --- a visit takes the sample away ---

def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fsync_dir(d: Path) -> None:
    try:
        fd = os.open(d, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass  # FAT and exFAT accept no fsync on a directory; the umount writes it


def preset() -> tuple[float, float]:
    """Where the detected three seconds sit in a clip: after BirdNET-Go's pre-capture."""
    text = CONFIG.read_text() if CONFIG.exists() else ""
    pre = float(yaml_get(text, ("realtime", "audio", "export", "precapture")) or 3)
    length = float(yaml_get(text, ("realtime", "audio", "export", "length")) or 15)
    return pre, length


def collect(dest: Path) -> int:
    try:
        return _collect(dest)
    finally:
        release()


def _collect(dest: Path) -> int:
    con = state()
    rows = con.execute("""select id, file, ts, scientific, confidence, band, month, detector, cell, slot
                          from kept where collected = 0 order by ts""").fetchall()
    host = os.environ.get("NODE_HOSTNAME") or socket.gethostname()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = dest / "life-clips" / host / stamp
    out.mkdir(parents=True, exist_ok=True)
    pre, length = preset()
    sums, done = {}, []
    with open(out / "clips.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["file", "detection", "time_local", "time_utc", "scientific", "score", "band", "detector",
                    "clip_s", "detection_from_s", "detection_to_s", "label", "true_species", "checked_by", "note"])
        for det_id, rel, ts, scientific, conf, b, month, detector, cell, slot in rows:
            src = HOME / rel
            if not src.exists():
                continue
            target = out / month / Path(rel).name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, target)
            with open(target, "rb") as t:
                os.fsync(t.fileno())
            sums[target.relative_to(out).as_posix()] = sha256(src)
            t_utc = datetime.fromtimestamp(ts, timezone.utc)
            w.writerow([target.relative_to(out).as_posix(), det_id, t_utc.astimezone(TZ).isoformat(timespec="seconds"),
                        t_utc.isoformat(timespec="seconds"), scientific, f"{conf:.3f}", b, detector,
                        f"{length:g}", f"{pre:g}", f"{pre + 3:g}", "", "", "", ""])
            done.append((cell, slot, src))
        f.flush()
        os.fsync(f.fileno())
    # How many detections each kept clip stands for: per month, species and score band, the detections the sampler saw
    # and the clips it kept from them. A clip's weight is detections / kept; without it a checked sample of five per
    # band says how often the detector is right in a band, but not how often it is right over all it reported.
    with open(out / "bands.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["month", "scientific", "band", "detections", "kept", "as_of_utc"])
        as_of = datetime.now(timezone.utc).isoformat(timespec="seconds")
        for cell, n in con.execute("select cell, n from seen order by cell").fetchall():
            month, scientific, b = cell.split("|")
            k = con.execute("select count(*) from kept where cell = ?", (cell,)).fetchone()[0]
            w.writerow([month, scientific, b, n, k, as_of])
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
    for cell, slot, src in done:
        src.unlink(missing_ok=True)
        con.execute("update kept set collected = 1 where cell = ? and slot = ?", (cell, slot))
    meta(con, "collected_at", datetime.now(timezone.utc).isoformat(timespec="seconds"))
    con.commit()
    write_status(con)
    mb = sum((out / n).stat().st_size for n in sums) / 1e6
    (out / "RECEIPT.txt").write_text(
        f"{len(sums)} clips ({mb:.1f} MB) from {host}, copied {stamp}, checked against SHA256SUMS and deleted from the node.\n"
        "clips.csv lists each clip: species, score and where in the clip the detected three seconds are. A checker fills in\n"
        "label (right, wrong or unsure) and, when wrong, the species that sang; the labels go to the oracle, the sound does not.\n"
        "bands.csv says how many detections each month's clips were drawn from, per species and score band: the weights that\n"
        "turn the checked sample into the share of all detections that were right.\n")
    print(f"life-clips: {len(sums)} clips ({mb:.1f} MB) copied to {out} and deleted from the node")
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
    if cmd == "collect":
        if "--to" not in args:
            print("usage: life-clips collect --to DIR", file=sys.stderr)
            return 2
        return collect(Path(args[args.index("--to") + 1]))
    if cmd == "collect-device":
        return collect_device(args[1])
    if cmd == "status":
        s = status(state())
        release()
        print(json.dumps(s) if "--json" in args else
              f"clip keeping {'on' if s['keep'] else 'off'}; {s['waiting']} clips ({s['mb']} MB) waiting for a visit"
              + (f", oldest from {s['oldestMonth']}" if s["oldestMonth"] else "")
              + (f"; last collected {s['collectedAt']}" if s["collectedAt"] else ""))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
