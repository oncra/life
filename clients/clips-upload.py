#!/usr/bin/env python3
"""Bring a bench node's clip sample to the oracle's triage page (/triage), over the local network.

A node in a field keeps its clip sample on its card for a visit (node/life-clips.py) and sends no sound over the air.
A node on the bench, with its steward's yes (LIFE_KEEP_CLIPS=1 and LIFE_CLIPS_ANYTIME=1 in /data/life-node/env), can
have its sample fetched by a computer on the same network, which is what this does. It never uses the node's SIM: the
node sends nothing, this computer pulls over ssh. Run it from launchd or cron every half hour; it does nothing while
the node is off or out of reach. A server in the steward's tailnet can run it instead, sandboxed, with
clients/lifeclips-upload.service and LIFE_NODE_SSH set to the node's tailnet address.

    clips-upload.py            fetch what the node has kept, then send everything not yet sent
    clips-upload.py --send     only send what is already here
    clips-upload.py --send --replace   send again, and let each clip's new sound take the old one's place on the oracle
                               (verdicts stay): for clips first sent in a form nobody could judge; take a batch from
                               done/ back to incoming/ and strike its detections from sent.txt first
    clips-upload.py --resend   cut, level and send again every clip kept here, done/ included, each in its old one's
                               place (verdicts stay): after a change in how clips are cut or levelled

Steps:
1. on the node: if clips are waiting, `life-clips collect --to /tmp/life-clips-out`: the sample, its clips.csv and
   bands.csv, checked against SHA256SUMS and deleted from the node's store. /tmp on the node is memory, so a batch left
   there is gone at the node's next shutdown, which comes after every listening window;
2. that batch comes here over ssh as a tar stream and is checked against its SHA256SUMS again; on the node it is then
   renamed, so the next run does not fetch it twice;
3. per clip, the microphone (BirdNET-Go's audio source for the detection) and the common name, from the node;
4. each clip becomes AAC (.m4a), which every browser plays, Safari on a phone included. It is cut to the detected part
   with a second before and after it (the node keeps 15 s with the detection at 3 to 6), and turned up or down until its
   loudest moment is at -2 dBFS, at most 60 dB up, so the I2S microphone is heard as well as the AudioMoth: in the
   detected seconds of node 1's first 256 bird clips its peaks were 22 dB lower (median -49 against -27 dBFS). A clip recorded faster than 48 kHz (the AudioMoth on the bat model, a WAV at 192 kHz) is slowed
   down ten times on the way (.x10.m4a): AAC keeps nothing above about 18 kHz, where every bat calls, and slowed down a
   call at 40 kHz is heard at 4 kHz; its second before and after is a tenth of a second of the recording;
5. clip by clip to POST /api/v1/clips with the node's own token, read from the node over ssh and kept in memory only,
   then bands.csv to /api/v1/clips/bands. A batch whose every clip went is moved to done/.

env: LIFE_NODE_SSH (life@192.168.2.114), LIFE_API (https://life.oncra.org/api/v1),
     LIFE_CLIPS_HOME (~/Library/Application Support/life-clips), FFMPEG (ffmpeg, then /opt/homebrew/bin/ffmpeg),
     LIFE_TOKEN and LIFE_DEVICE: an admin or steward key and the node's device id, to send while the node is off; pass
     the key in from where it is kept for this one run, never into a file
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.error
import urllib.request
import uuid
import wave
from pathlib import Path

NODE = os.environ.get("LIFE_NODE_SSH", "life@192.168.2.114")
API = os.environ.get("LIFE_API", "https://life.oncra.org/api/v1").rstrip("/")
HOME = Path(os.environ.get("LIFE_CLIPS_HOME") or Path.home() / "Library/Application Support/life-clips")
SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", NODE]
OUT = "/tmp/life-clips-out"
ENV = "set -a; . /data/life-node/env >/dev/null 2>&1; set +a"
SLOW = 10  # time expansion for a clip recorded faster than 48 kHz: 192 kHz becomes 19.2 kHz, a call at 40 kHz plays at 4
LEAD_S, TAIL_S = 1.0, 1.0  # heard seconds before and after the detected part
PEAK_DB = -2.0  # every clip's loudest moment ends up here, with room for the AAC encoder to overshoot
MAX_GAIN_DB = 60.0  # enough for the I2S microphone, whose clips peak near -49 dBFS; digital silence stays silent
CUT = "c1"  # the cut and level above; a clip converted another way is converted again


def say(msg: str) -> None:
    print(f"clips-upload: {msg}", flush=True)


def node(cmd: str, data: bytes | None = None, timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(SSH + [cmd], input=data, capture_output=True, timeout=timeout)


def ffmpeg() -> str | None:
    for c in (os.environ.get("FFMPEG"), shutil.which("ffmpeg"), "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"):
        if c and Path(c).exists():
            return c
    return None


def fetch() -> None:
    """Steps 1 and 2: collect on the node when clips are waiting, and bring every batch in its /tmp here."""
    st = node(f"sudo bash -c '{ENV}; /usr/local/bin/life-clips status --json'")
    if st.returncode != 0:
        say("node not reachable or no life-clips on it; nothing fetched")
        return
    waiting = json.loads(st.stdout or b"{}").get("waiting", 0)
    if waiting:
        c = node(f"sudo bash -c '{ENV}; mkdir -p {OUT} && /usr/local/bin/life-clips collect --to {OUT}'", timeout=600)
        say((c.stdout or c.stderr).decode(errors="replace").strip() or f"collect ended with {c.returncode}")
    t = node(f"sudo bash -c 'cd {OUT} 2>/dev/null && ls -d life-clips/*/* 2>/dev/null' || true")
    batches = [b for b in t.stdout.decode().split() if b and not b.endswith(".fetched")]
    for b in batches:
        tar = node(f"sudo tar -C {OUT} -cf - {b}", timeout=600)
        if tar.returncode != 0:
            say(f"could not read {b} from the node: {tar.stderr.decode(errors='replace').strip()}")
            continue
        dest = HOME / "incoming"
        dest.mkdir(parents=True, exist_ok=True)
        with tarfile.open(fileobj=io.BytesIO(tar.stdout)) as tf:
            members = [m for m in tf.getmembers() if (m.isfile() or m.isdir()) and not m.name.startswith(("/", "..")) and ".." not in Path(m.name).parts]
            tf.extractall(dest, members=members)
        here = dest / b
        if not verified(here):
            say(f"{b}: the copy here does not match its SHA256SUMS; left on the node, try again")
            shutil.rmtree(here, ignore_errors=True)
            continue
        node(f"sudo mv {OUT}/{b} {OUT}/{b}.fetched")
        say(f"{b}: {sum(1 for _ in rows(here))} clips fetched")


def verified(batch: Path) -> bool:
    sums = batch / "SHA256SUMS"
    if not sums.exists():
        return False
    for line in sums.read_text().splitlines():
        h, _, name = line.partition("  ")
        f = batch / name
        if not f.exists() or hashlib.sha256(f.read_bytes()).hexdigest() != h:
            return False
    return True


def rows(batch: Path):
    with open(batch / "clips.csv", newline="") as f:
        yield from csv.DictReader(f)


def details(ids: list[str], names: list[str]) -> tuple[dict, dict]:
    """Step 3: the microphone per detection id and the common name per scientific name, from the node's BirdNET-Go."""
    script = f"""
import json, sqlite3, urllib.request
ids, names = {json.dumps(ids)}, set({json.dumps(names)})
con = sqlite3.connect("file:/data/birdnet-go/birdnet.db?mode=ro", uri=True)
src = {{}}
try:
    q = "select d.id, s.display_name from detections d join audio_sources s on s.id = d.source_id where d.id in (%s)" % ",".join("?" * len(ids))
    src = {{str(i): n for i, n in con.execute(q, ids)}} if ids else {{}}
except Exception:
    pass
common = {{}}
try:
    with urllib.request.urlopen("http://127.0.0.1:8080/api/v2/detections?limit=1000", timeout=10) as r:
        for d in json.load(r).get("data", []):
            if d.get("scientificName") in names and d.get("commonName"):
                common[d["scientificName"]] = d["commonName"]
except Exception:
    pass
print(json.dumps({{"source": src, "common": common}}))
"""
    r = node("sudo python3 -", data=script.encode(), timeout=60)
    try:
        d = json.loads(r.stdout or b"{}")
        return d.get("source", {}), d.get("common", {})
    except json.JSONDecodeError:
        return {}, {}


def rate(clip: Path) -> int:
    """The sample rate of a WAV clip; the Opus clips are 48 kHz."""
    if clip.suffix.lower() != ".wav":
        return 48000
    try:
        with wave.open(str(clip)) as w:
            return w.getframerate()
    except (wave.Error, EOFError):
        return 48000


def window(r: dict, slow: int) -> tuple[float, float] | None:
    """Where to cut a clip, in seconds of the recording: LEAD_S heard before the detected part to TAIL_S after it; None
    when its row does not say where the detection is."""
    try:
        a, b, n = float(r["detection_from_s"]), float(r["detection_to_s"]), float(r["clip_s"])
    except (KeyError, TypeError, ValueError):
        return None
    if not 0 <= a < b <= n:
        return None
    return max(0.0, a - LEAD_S / slow), min(n, b + TAIL_S / slow)


def convert(ff: str, clip: Path, out: Path, sr: int, slow: int, cut: tuple[float, float] | None) -> str | None:
    """Step 4: cut, slow down, level and encode one clip; None when it worked, else what ffmpeg said."""
    chain = [f"atrim=start={cut[0]:.3f}:end={cut[1]:.3f},asetpts=PTS-STARTPTS"] if cut else []
    if slow > 1:
        chain.append(f"asetrate={sr // slow},aresample=48000")
    probe = subprocess.run([ff, "-nostdin", "-hide_banner", "-i", str(clip), "-af", ",".join(chain + ["volumedetect"]), "-f", "null", "-"],
                           capture_output=True, text=True)
    m = re.search(r"max_volume:\s*(-inf|-?[\d.]+) dB", probe.stderr)
    if probe.returncode != 0 or not m:
        return (probe.stderr.strip() or "no level measured")[-200:]
    peak = -91.0 if m.group(1) == "-inf" else float(m.group(1))
    chain.append(f"volume={min(PEAK_DB - peak, MAX_GAIN_DB):.1f}dB")
    t = subprocess.run([ff, "-nostdin", "-loglevel", "error", "-y", "-i", str(clip), "-af", ",".join(chain), "-ac", "1", "-c:a", "aac", "-b:a", "96k", str(out)],
                       capture_output=True)
    return None if t.returncode == 0 else t.stderr.decode(errors="replace").strip()[:200]


def token() -> str | None:
    r = node("sudo bash -c '. /data/life-node/env >/dev/null 2>&1; printf %s \"$LIFE_DEVICE_TOKEN\"'")
    t = r.stdout.decode().strip()
    return t if t.startswith("lo_dev_") else None


def post(path: str, tok: str, body: bytes, ctype: str) -> tuple[int, dict]:
    req = urllib.request.Request(f"{API}{path}", data=body, method="POST", headers={"authorization": f"Bearer {tok}", "content-type": ctype})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read()[:200].decode(errors="replace")}


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


def send() -> int:
    """Steps 4 and 5 for every batch in incoming/."""
    batches = sorted(p.parent for p in (HOME / "incoming").glob("life-clips/*/*/clips.csv"))
    if not batches:
        return 0
    tok = os.environ.get("LIFE_TOKEN") or token()
    if not tok:
        say("no device token from the node (is it on?); the batches wait here")
        return 0
    replace = "--replace" in sys.argv[1:] or "--resend" in sys.argv[1:]
    ff = ffmpeg()
    if not ff:
        say("no ffmpeg on this computer; install it (brew install ffmpeg) to send the clips")
        return 1
    failed = 0
    for batch in batches:
        todo = list(rows(batch))
        src, common = details([r["detection"] for r in todo], sorted({r["scientific"] for r in todo}))
        sent_log = batch / "sent.txt"
        sent = set(sent_log.read_text().split()) if sent_log.exists() else set()
        for r in todo:
            if r["detection"] in sent:
                continue
            clip = batch / r["file"]
            sr = rate(clip)
            slow = SLOW if sr > 48000 else 1
            cut = window(r, slow)
            m4a = clip.with_suffix(f".x{slow}.{CUT}.m4a" if slow > 1 else f".{CUT}.m4a")
            if not m4a.exists():
                err = convert(ff, clip, m4a, sr, slow, cut)
                if err:
                    say(f"{clip.name}: ffmpeg failed: {err}")
                    failed += 1
                    continue
            fields = {k: r.get(k) for k in ("detection", "time_utc", "scientific", "score", "band", "detector", "clip_s", "detection_from_s", "detection_to_s")}
            if cut:  # the timing of the cut clip: where the detected part now starts and ends in it
                fields["clip_s"] = f"{cut[1] - cut[0]:.3f}"
                fields["detection_from_s"] = f"{float(r['detection_from_s']) - cut[0]:.3f}"
                fields["detection_to_s"] = f"{float(r['detection_to_s']) - cut[0]:.3f}"
            fields["source"] = src.get(r["detection"])
            fields["species"] = common.get(r["scientific"])
            fields["expansion"] = slow if slow > 1 else None
            fields["replace"] = "1" if replace else None
            fields["device"] = os.environ.get("LIFE_DEVICE")
            body, ctype = multipart(fields, m4a.name, m4a.read_bytes(), "audio/mp4")
            status, out = post("/clips", tok, body, ctype)
            if status in (200, 201):
                with open(sent_log, "a") as f:
                    f.write(r["detection"] + "\n")
            else:
                say(f"{clip.name}: the oracle answered {status} {out.get('error', '')}")
                failed += 1
        with open(batch / "bands.csv", newline="") as f:
            bands = list(csv.DictReader(f))
        if bands:
            dev = {"device": os.environ["LIFE_DEVICE"]} if os.environ.get("LIFE_DEVICE") else {}
            status, out = post("/clips/bands", tok, json.dumps({"rows": bands, **dev}).encode(), "application/json")
            if status != 200:
                say(f"{batch.name}: bands not sent ({status} {out.get('error', '')})")
                failed += 1
        left = [r for r in todo if r["detection"] not in set(sent_log.read_text().split() if sent_log.exists() else [])]
        if not left:
            done = HOME / "done" / batch.relative_to(HOME / "incoming")
            done.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(batch), str(done))
            say(f"{batch.name}: {len(todo)} clips sent")
    return 1 if failed else 0


def again() -> None:
    """--resend: every batch back to incoming/ with its sent list struck, so each clip goes out again in its new form."""
    for csv_file in sorted((HOME / "done").glob("life-clips/*/*/clips.csv")):
        back = HOME / "incoming" / csv_file.parent.relative_to(HOME / "done")
        back.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(csv_file.parent), str(back))
    for sent in (HOME / "incoming").glob("life-clips/*/*/sent.txt"):
        sent.unlink()


def main() -> int:
    HOME.mkdir(parents=True, exist_ok=True)
    if "--resend" in sys.argv[1:]:
        again()
    elif "--send" not in sys.argv[1:]:
        fetch()
    return send()


if __name__ == "__main__":
    sys.exit(main())
