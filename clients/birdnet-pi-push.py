#!/usr/bin/env python3
"""Push new BirdNET-Pi / BirdNET-Go detections to the life oracle.

Reads the local detections database, posts rows newer than the stored cursor,
and advances the cursor. Run every 10 minutes from cron:

    */10 * * * * . /etc/life-oracle.env && /usr/local/bin/life-push

Environment:
    LIFE_DEVICE_TOKEN   required, lo_dev_...
    LIFE_API            default https://life.oncra.org/api/v1
    BIRDNET_DB          default ~/BirdNET-Pi/scripts/birds.db (BirdNET-Pi) or birdnet.db (BirdNET-Go)
    LIFE_MIN_CONFIDENCE default 0.5
    LIFE_HEARTBEAT_CMD  optional: a command printing one JSON heartbeat (the Life node sets
                        `life-heartbeat --json`); it rides on the post, and a post goes out even with no detections
    LIFE_HEARTBEAT_EVENT optional: boot | hourly | shutdown | manual, passed to that command as --event
    LIFE_HEARTBEAT_APPLY_CMD optional: gets the oracle's heartbeat answer on stdin (the Life node sets
                        `life-guard apply`, which caches the maintenance window and disarms the guard inside it)
"""
import json, os, shlex, sqlite3, subprocess, sys, urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = os.environ.get("LIFE_API", "https://life.oncra.org/api/v1").rstrip("/")
TOKEN = os.environ.get("LIFE_DEVICE_TOKEN")
MINCONF = float(os.environ.get("LIFE_MIN_CONFIDENCE", "0.5"))
CURSOR = Path(os.environ.get("LIFE_CURSOR", str(Path.home() / ".life-oracle-cursor")))
if not TOKEN:
    sys.exit("LIFE_DEVICE_TOKEN not set")

candidates = [os.environ.get("BIRDNET_DB"), str(Path.home() / "BirdNET-Pi/scripts/birds.db"), str(Path.home() / "BirdNET-Go/data/birdnet.db"), "/var/lib/birdnet-go/birdnet.db"]
db = next((c for c in candidates if c and Path(c).exists()), None)
if not db:
    sys.exit("no BirdNET database found; set BIRDNET_DB")

con = sqlite3.connect(db)
con.row_factory = sqlite3.Row
since = CURSOR.read_text().strip() if CURSOR.exists() else "1970-01-01T00:00:00"
rows = []
tables = {r[0] for r in con.execute("select name from sqlite_master where type='table'")}
if "detections" in tables and "Com_Name" in [c[1] for c in con.execute("pragma table_info(detections)")]:
    # BirdNET-Pi schema: Date, Time, Sci_Name, Com_Name, Confidence
    for r in con.execute("select Date, Time, Sci_Name, Com_Name, Confidence from detections where (Date || 'T' || Time) > ? order by Date, Time", (since.replace("+00:00", "")[:19],)):
        ts = f"{r['Date']}T{r['Time']}"
        rows.append((ts, {"ts": datetime.fromisoformat(ts).astimezone().isoformat(), "species": r["Com_Name"], "scientific": r["Sci_Name"], "confidence": float(r["Confidence"]), "detector": "birdnet-pi"}))
elif "notes" in tables:
    # BirdNET-Go schema: date, time, scientific_name, common_name, confidence
    for r in con.execute("select date, time, scientific_name, common_name, confidence from notes where (date || 'T' || time) > ? order by date, time", (since[:19],)):
        ts = f"{r['date']}T{r['time']}"
        rows.append((ts, {"ts": datetime.fromisoformat(ts).astimezone().isoformat(), "species": r["common_name"], "scientific": r["scientific_name"], "confidence": float(r["confidence"]), "detector": "birdnet-go"}))
else:
    sys.exit(f"unknown schema in {db}: tables {sorted(tables)}")

rows = [(t, d) for t, d in rows if d["confidence"] >= MINCONF]

heartbeat = None
if os.environ.get("LIFE_HEARTBEAT_CMD"):
    cmd = shlex.split(os.environ["LIFE_HEARTBEAT_CMD"])
    if os.environ.get("LIFE_HEARTBEAT_EVENT"):
        cmd += ["--event", os.environ["LIFE_HEARTBEAT_EVENT"]]
    try:
        heartbeat = json.loads(subprocess.run(cmd, capture_output=True, text=True, timeout=30, check=True).stdout)
    except Exception as e:  # noqa: BLE001 - a missing heartbeat must not hold back the detections
        print(f"heartbeat skipped: {e}", file=sys.stderr)

if not rows and not heartbeat:
    print("nothing new"); sys.exit(0)

batches = [rows[i:i + 2000] for i in range(0, len(rows), 2000)] or [[]]
for n, batch in enumerate(batches):
    body = {"detections": [d for _, d in batch]}
    if heartbeat and n == len(batches) - 1:
        body["heartbeat"] = heartbeat
    req = urllib.request.Request(f"{API}/ingest/sound", data=json.dumps(body).encode(), headers={"content-type": "application/json", "authorization": f"Bearer {TOKEN}"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as resp:
        out = json.load(resp)
    if batch:
        CURSOR.write_text(batch[-1][0])
        print(f"pushed {out.get('detections')} detections up to {batch[-1][0]}")
    if "heartbeat" in body:
        print(f"heartbeat: {out.get('heartbeat')}")
        if os.environ.get("LIFE_HEARTBEAT_APPLY_CMD"):
            try:
                subprocess.run(shlex.split(os.environ["LIFE_HEARTBEAT_APPLY_CMD"]), input=json.dumps(out.get("heartbeat") or {}), text=True, timeout=30, check=False)
            except Exception as e:  # noqa: BLE001
                print(f"heartbeat apply skipped: {e}", file=sys.stderr)
