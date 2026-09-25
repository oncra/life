#!/usr/bin/env python3
"""Life node heartbeat: how the node is doing, and which cell it is on.

Prints one JSON object (--json) or posts it to /ingest/heartbeat. `life-push` runs it with --json and rides the
result on the hourly detections post, so the SIM pays for one TLS handshake per hour, not two.

The cell comes from the 4G stick's own web API (Huawei HiLink, http://192.168.8.1): PLMN from
/api/net/current-plmn, cell id, PCI, band and signal from /api/device/signal. Nothing is written to the stick.
The oracle remembers the first cell it hears as the node's home cell and raises an alert when a later heartbeat
comes from another one: the box has travelled, and the cell id says roughly where to. No coin cell, no extra
hardware, and nothing for a thief to notice. On a bench without the stick the cell is simply absent.

Environment:
    LIFE_DEVICE_TOKEN   the node's SOUND device token (the heartbeat is the node's, not a probe's)
    LIFE_API            default https://life.oncra.org/api/v1
    MODEM_HOST          default 192.168.8.1; set empty to skip the modem
    LIFE_QUEUE          default /var/lib/life-node/queue.jsonl (unsent soil rows)
"""
import json, os, subprocess, sys, urllib.request, xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

API = os.environ.get("LIFE_API", "https://life.oncra.org/api/v1").rstrip("/")
TOKEN = os.environ.get("LIFE_DEVICE_TOKEN")
MODEM = os.environ.get("MODEM_HOST", "192.168.8.1").strip()
QUEUE = Path(os.environ.get("LIFE_QUEUE", "/var/lib/life-node/queue.jsonl"))


def hilink(path, cookie):
    req = urllib.request.Request(f"http://{MODEM}{path}", headers={"Cookie": cookie} if cookie else {})
    with urllib.request.urlopen(req, timeout=5) as r:
        return ET.fromstring(r.read())


def cell():
    """Serving cell from the HiLink API; None when there is no stick or it does not answer."""
    if not MODEM:
        return None
    try:
        # any GET on the UI sets the session cookie the API wants
        req = urllib.request.Request(f"http://{MODEM}/api/webserver/SesTokInfo")
        with urllib.request.urlopen(req, timeout=5) as r:
            tok = ET.fromstring(r.read())
            cookie = (tok.findtext("SesInfo") or "").strip()
        plmn = hilink("/api/net/current-plmn", cookie)
        sig = hilink("/api/device/signal", cookie)
    except Exception as e:  # noqa: BLE001 - the modem is optional; say why it is missing
        print(f"modem: {e}", file=sys.stderr)
        return None
    def num(el, key):
        v = (sig.findtext(key) or "").strip().replace("dBm", "").replace("dB", "").replace("&gt;", "")
        try:
            return float(v) if v not in ("", "-") else None
        except ValueError:
            return None
    out = {
        "plmn": (plmn.findtext("Numeric") or "").strip() or None,
        "operator": (plmn.findtext("FullName") or "").strip() or None,
        "cellId": (sig.findtext("cell_id") or "").strip() or None,
        "tac": (sig.findtext("tac") or sig.findtext("lac") or "").strip() or None,
        "pci": num(sig, "pci"),
        "band": (sig.findtext("band") or "").strip() or None,
        "rsrp": num(sig, "rsrp"),
        "rssi": num(sig, "rssi"),
        "sinr": num(sig, "sinr"),
        "mode": (sig.findtext("mode") or "").strip() or None,
    }
    if out["pci"] is not None:
        out["pci"] = int(out["pci"])
    return {k: v for k, v in out.items() if v is not None}


def metrics():
    m = {}
    try:
        m["uptimeS"] = int(float(Path("/proc/uptime").read_text().split()[0]))
    except Exception:  # noqa: BLE001
        pass
    try:
        m["cpuTempC"] = round(int(Path("/sys/class/thermal/thermal_zone0/temp").read_text()) / 1000, 1)
    except Exception:  # noqa: BLE001
        pass
    try:
        st = os.statvfs(QUEUE.parent if QUEUE.parent.exists() else "/")
        m["diskFreeMb"] = int(st.f_bavail * st.f_frsize / 1e6)
    except Exception:  # noqa: BLE001
        pass
    try:
        m["load1"] = round(os.getloadavg()[0], 2)
    except Exception:  # noqa: BLE001
        pass
    m["unsent"] = sum(1 for l in QUEUE.read_text().splitlines() if l.strip()) if QUEUE.exists() else 0
    throttled = Path("/sys/devices/platform/soc/soc:firmware/get_throttled")
    if throttled.exists():
        try:
            m["throttled"] = throttled.read_text().strip()
        except Exception:  # noqa: BLE001
            pass
    return m


def guard():
    """What the tamper guard reports, when the board is fitted (GUARD=1); see life-guard.py."""
    if os.environ.get("GUARD", "0") != "1":
        return None
    try:
        return json.loads(subprocess.run(["life-guard", "status"], capture_output=True, text=True, timeout=10, check=True).stdout)
    except Exception as e:  # noqa: BLE001
        print(f"guard: {e}", file=sys.stderr)
        return None


def build(event):
    hb = {"ts": datetime.now(timezone.utc).isoformat(), "event": event, "metrics": metrics()}
    g = guard()
    if g and g.get("enabled"):
        hb["metrics"]["guardAlarm"] = bool(g.get("alarm"))
        if g.get("alarm"):
            hb["event"] = "alarm"
            hb["tamper"] = {"loop": g.get("loop", "unknown") if g.get("loop") in ("lid", "panel", "tilt") else "unknown"}
    c = cell()
    if c:
        hb["cell"] = c
    return hb


def main():
    args = sys.argv[1:]
    event = "hourly"
    for i, a in enumerate(args):
        if a == "--event" and i + 1 < len(args):
            event = args[i + 1]
    if event not in ("boot", "hourly", "shutdown", "manual"):
        sys.exit("--event must be boot, hourly, shutdown or manual")
    if "--cell-only" in args:
        print(json.dumps(cell() or {}))
        return
    hb = build(event)
    if "--json" in args:
        print(json.dumps(hb))
        return
    if not TOKEN:
        sys.exit("LIFE_DEVICE_TOKEN not set")
    req = urllib.request.Request(f"{API}/ingest/heartbeat", data=json.dumps({"heartbeat": hb}).encode(), headers={"content-type": "application/json", "authorization": f"Bearer {TOKEN}"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        out = json.load(resp)
    print(f"heartbeat {event}: {out}")


if __name__ == "__main__":
    main()
