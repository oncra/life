#!/usr/bin/env python3
"""Post BirdNET-Analyzer CSV results (from AudioMoth or any recorder) to the life oracle.

    birdnet-analyzer analyze /media/card --lat 52.05 --lon 5.05 --week -1 --rtype csv --output ./out
    python3 audiomoth-birdnet-push.py ./out --token lo_dev_... --tz Europe/Amsterdam [--min-conf 0.5] [--dry-run]

Timestamps: AudioMoth names files YYYYMMDD_HHMMSS.WAV in the device's clock time (UTC by default).
Use --file-tz UTC (default) or the zone the recorder was set to; --tz is only used for display.
BirdWeather CSV exports are accepted with --birdweather-csv FILE.
"""
import argparse, csv, json, re, sys, urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ap = argparse.ArgumentParser()
ap.add_argument("folder", nargs="?", help="BirdNET-Analyzer output folder with *.BirdNET.results.csv files")
ap.add_argument("--token", required=True)
ap.add_argument("--api", default="https://life.oncra.org/api/v1")
ap.add_argument("--file-tz", default="UTC")
ap.add_argument("--tz", default="UTC")
ap.add_argument("--min-conf", type=float, default=0.5)
ap.add_argument("--birdweather-csv")
ap.add_argument("--dry-run", action="store_true")
a = ap.parse_args()

dets = []
if a.birdweather_csv:
    with open(a.birdweather_csv, newline="") as f:
        for r in csv.DictReader(f):
            ts = r.get("Timestamp") or r.get("timestamp")
            conf = float(r.get("Confidence") or r.get("confidence") or 0)
            if conf < a.min_conf: continue
            dets.append({"ts": datetime.fromisoformat(ts.replace("Z", "+00:00")).isoformat(), "species": r.get("Common Name") or r.get("common_name"), "scientific": r.get("Scientific Name") or r.get("scientific_name"), "confidence": conf, "detector": "birdweather-puc"})
else:
    if not a.folder: sys.exit("folder required")
    pat = re.compile(r"(\d{8})_(\d{6})")
    for p in sorted(Path(a.folder).rglob("*.csv")):
        m = pat.search(p.name)
        if not m: continue
        start = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").replace(tzinfo=ZoneInfo(a.file_tz))
        with open(p, newline="") as f:
            for r in csv.DictReader(f):
                conf = float(r.get("Confidence", 0))
                if conf < a.min_conf: continue
                s0 = float(r.get("Start (s)", 0)); s1 = float(r.get("End (s)", s0 + 3))
                dets.append({"ts": (start + timedelta(seconds=s0)).isoformat(), "species": r.get("Common name"), "scientific": r.get("Scientific name"), "confidence": conf, "detector": "birdnet-analyzer", "durationS": round(s1 - s0, 1)})

print(f"{len(dets)} detections >= {a.min_conf}")
if a.dry_run or not dets: sys.exit(0)
for i in range(0, len(dets), 2000):
    batch = dets[i:i + 2000]
    req = urllib.request.Request(f"{a.api.rstrip('/')}/ingest/sound", data=json.dumps({"detections": batch}).encode(), headers={"content-type": "application/json", "authorization": f"Bearer {a.token}"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as resp:
        print(json.load(resp))
