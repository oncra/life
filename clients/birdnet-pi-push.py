#!/usr/bin/env python3
"""Push new BirdNET-Pi / BirdNET-Go detections to the Life Oracle.

Reads the local detections database, posts rows newer than the stored cursor,
and advances the cursor. Run every 10 minutes from cron:

    */10 * * * * . /etc/life-oracle.env && /usr/local/bin/life-push

Environment:
    LIFE_DEVICE_TOKEN   required, lo_dev_...
    LIFE_API            default https://life.oncra.org/api/v1
    BIRDNET_DB          default ~/BirdNET-Pi/scripts/birds.db (BirdNET-Pi) or birdnet.db (BirdNET-Go)
    LIFE_MIN_CONFIDENCE default 0.5
    LIFE_MIN_CONFIDENCE_FLOOR optional: nothing under it goes out, whatever LIFE_MIN_CONFIDENCE says. The Life node
                        sets 0.7, the score its readings count from, because its clip sample has BirdNET-Go detect
                        down to 0.1 (node/life-clips.py)
    LIFE_HEARTBEAT_CMD  optional: a command printing one JSON heartbeat (the Life node sets
                        `life-heartbeat --json`); it rides on the post, and a post goes out even with no detections
    LIFE_HEARTBEAT_EVENT optional: boot | hourly | shutdown | manual, passed to that command as --event
    LIFE_HEARTBEAT_APPLY_CMD optional: gets the oracle's heartbeat answer on stdin (the Life node sets
                        `life-guard apply`, which caches the maintenance window and disarms the guard inside it)
    LIFE_SOIL_QUEUE     optional: the soil agent's queue file (the Life node sets /var/lib/life-node/queue.jsonl).
                        Its rows are posted to /ingest/soil on the same connection, each under its own token
    LIFE_KEEP_MODELS    optional: BirdNET-Go models whose detections stay on the node, comma separated as the
                        detector field names them (battybirdnet). For a model still on trial at a place: node 1's
                        first night outdoors, in rain, named Savi's pipistrelle at 0.99 every twenty seconds
    LIFE_TEST_SOURCES   optional: BirdNET-Go audio sources, by name, whose bird detections go out marked test, so the
                        oracle keeps them and counts them nowhere. For a microphone on trial beside the standard one:
                        node 1 hears its birds on the I2S microphone and on the AudioMoth at once while the two are
                        compared (node/life-mic.py, mode both). The detector field ends in @ and the source's name;
                        bat detections from such a source go out as usual

Everything a run posts goes over one connection. On a SIM the TLS handshake is most of what a post costs
(about 6.5 kB against 1 to 3 kB of payload), so sound, heartbeat and soil share one.
"""
import fcntl, http.client, json, os, shlex, sqlite3, subprocess, sys, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = os.environ.get("LIFE_API", "https://life.oncra.org/api/v1").rstrip("/")
TOKEN = os.environ.get("LIFE_DEVICE_TOKEN")
MINCONF = max(float(os.environ.get("LIFE_MIN_CONFIDENCE", "0.5")), float(os.environ.get("LIFE_MIN_CONFIDENCE_FLOOR") or 0))
CURSOR = Path(os.environ.get("LIFE_CURSOR", str(Path.home() / ".life-oracle-cursor")))
SOIL_QUEUE = os.environ.get("LIFE_SOIL_QUEUE")
KEEP = {m.strip().lower() for m in os.environ.get("LIFE_KEEP_MODELS", "").split(",") if m.strip()}
# the I2S microphone as the AudioMoth's witness (node/life-mic.py) is always test: its birds are the AudioMoth's twice
TEST_SOURCES = {m.strip().lower() for m in os.environ.get("LIFE_TEST_SOURCES", "").split(",") if m.strip()} | {"i2s witness"}
BAT_MODELS = {"battybirdnet", "bat"}
if not TOKEN:
    sys.exit("LIFE_DEVICE_TOKEN not set")

_url = urllib.parse.urlsplit(API)
_conn = None

def post(path, token, body):
    """POST JSON to the oracle on the run's one connection and return the decoded answer."""
    global _conn
    data = json.dumps(body).encode()
    headers = {"content-type": "application/json", "authorization": f"Bearer {token}"}
    while True:
        reused = _conn is not None
        if not reused:
            _conn = (http.client.HTTPSConnection if _url.scheme == "https" else http.client.HTTPConnection)(_url.netloc, timeout=60)
        try:
            _conn.request("POST", _url.path + path, body=data, headers=headers)
            resp = _conn.getresponse(); raw = resp.read()
            break
        except (http.client.HTTPException, OSError):
            _conn.close(); _conn = None
            if not reused: raise        # a fresh connection failed: the network, not a stale keep-alive
    if resp.status >= 400:
        raise RuntimeError(f"{path}: HTTP {resp.status} {raw[:200]!r}")
    return json.loads(raw)

def post_soil():
    """Post what the soil agent queued, per device token; what fails stays in the queue for the next run."""
    queue = Path(SOIL_QUEUE)
    with open(SOIL_QUEUE + ".lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)           # the soil agent appends under the same lock
        if not queue.exists(): return
        by_token = {}
        for line in queue.read_text().splitlines():
            if line.strip():
                p = json.loads(line); by_token.setdefault(p["token"], []).append(p["row"])
        left = []
        for token, readings in by_token.items():
            try:
                out = post("/ingest/soil", token, {"readings": readings}); print(f"posted {out.get('readings')} soil rows")
            except Exception as e:  # noqa: BLE001 - one probe's post must not lose the other's rows
                print(f"soil post failed, kept in the queue: {e}", file=sys.stderr); left += [{"token": token, "row": r} for r in readings]
        queue.write_text("".join(json.dumps(x) + "\n" for x in left))

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
elif "detections" in tables and "labels" in tables and "label_id" in [c[1] for c in con.execute("pragma table_info(detections)")]:
    # BirdNET-Go schema since mid 2026: detections(label_id, detected_at in unix seconds, begin_time/end_time in ms,
    # confidence) joined to labels(scientific_name) and label_types; only labels of type 'species' are birds or bats.
    # The database carries no common name, so ask BirdNET-Go's own local API for the names it has shown lately and
    # fall back to the scientific name: a detection must never wait for a name.
    names = {}
    try:
        # BirdNET-Go caches the answer to each identical query for minutes, so a repeated query returns names that
        # miss the newest species; a changing parameter gets a fresh page
        with urllib.request.urlopen(os.environ.get("BIRDNET_API", "http://127.0.0.1:8080/api/v2") + f"/detections?limit=1000&_={int(datetime.now().timestamp())}", timeout=10) as resp:
            names = {d["scientificName"]: d["commonName"] for d in json.load(resp).get("data", []) if d.get("scientificName") and d.get("commonName")}
    except Exception as e:  # noqa: BLE001 - BirdNET-Go is down at shutdown; the rows still go out
        print(f"common names skipped: {e}", file=sys.stderr)
    # Which model heard it: with more than one classifier enabled (BirdNET beside Perch v2), one detection can be
    # backed by several models, recorded in detection_model_contributions. The detector field names them all, e.g.
    # "birdnet-go:birdnet+perch", so the oracle can compare models without counting one bird twice.
    models, contrib = {}, {}
    if "ai_models" in tables:
        models = {r[0]: r[1].lower().split()[0] for r in con.execute("select id, name from ai_models")}
    since_epoch = int(datetime.fromisoformat(since.replace("+00:00", "")[:19]).timestamp())
    if models and "detection_model_contributions" in tables:
        for r in con.execute("""select c.detection_id, c.model_id from detection_model_contributions c join detections d on d.id = c.detection_id
                                where d.detected_at > ?""", (since_epoch,)):
            contrib.setdefault(r[0], set()).add(models.get(r[1], str(r[1])))
    # BirdNET-Go marks a detection `unlikely` when its own check finds no real ultrasonic call in the sound (bats: a
    # flat noise floor instead of pulses). Those stay on the node: on node 1's first evening indoors the bat model
    # named a barbastelle and a long-eared bat in three minutes, all three marked unlikely.
    cols = [c[1] for c in con.execute("pragma table_info(detections)")]
    likely = " and coalesce(d.unlikely, 0) = 0" if "unlikely" in cols else ""
    # Which microphone heard it: BirdNET-Go keeps one row per audio source and its id on each detection, so a
    # microphone on trial (LIFE_TEST_SOURCES) can go out as test while the standard one counts
    sources = next((t for t in ("audio_sources", "v2_audio_sources") if t in tables), None) if "source_id" in cols else None
    source = f", coalesce(s.display_name, s.source_uri) as source" if sources else ", null as source"
    join = f" left join {sources} s on s.id = d.source_id" if sources else ""
    if TEST_SOURCES and not sources:
        print("LIFE_TEST_SOURCES is set but this BirdNET-Go keeps no source on its detections; nothing is marked test",
              file=sys.stderr)
    q = f"""select d.id, d.model_id, d.detected_at, d.begin_time, d.end_time, d.confidence, l.scientific_name{source} from detections d
           join labels l on l.id = d.label_id join label_types t on t.id = l.label_type_id{join}
           where t.name = 'species' and d.detected_at > ?{likely} order by d.detected_at"""
    for r in con.execute(q, (since_epoch,)):
        at = datetime.fromtimestamp(r["detected_at"])
        det = {"ts": at.astimezone().isoformat(), "species": names.get(r["scientific_name"], r["scientific_name"]), "scientific": r["scientific_name"], "confidence": float(r["confidence"]), "detector": "birdnet-go"}
        heard_by = contrib.get(r["id"]) or ({models[r["model_id"]]} if r["model_id"] in models else set())
        if heard_by and heard_by <= KEEP:
            continue
        if heard_by:
            det["detector"] = "birdnet-go:" + "+".join(sorted(heard_by))
        if r["source"] and r["source"].lower() in TEST_SOURCES and not (heard_by and heard_by <= BAT_MODELS):
            det["test"] = True
            det["detector"] += "@" + r["source"].lower().replace(" ", "-")
        if r["begin_time"] and r["end_time"] and r["end_time"] > r["begin_time"]:
            det["durationS"] = round((r["end_time"] - r["begin_time"]) / 1000, 1)
        rows.append((at.isoformat(timespec="seconds"), det))
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
    print("nothing new")

batches = ([rows[i:i + 2000] for i in range(0, len(rows), 2000)] or [[]]) if rows or heartbeat else []
for n, batch in enumerate(batches):
    body = {"detections": [d for _, d in batch]}
    if heartbeat and n == len(batches) - 1:
        body["heartbeat"] = heartbeat
    out = post("/ingest/sound", TOKEN, body)
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

if SOIL_QUEUE:
    post_soil()
if _conn is not None:
    _conn.close()
