#!/usr/bin/env python3
"""Life node heartbeat: how the node is doing, and which cell it is on.

Prints one JSON object (--json) or posts it to /ingest/heartbeat. `life-push` runs it with --json and rides the
result on the hourly detections post, so the SIM pays for one TLS handshake per hour, not two.

The cell comes from the 4G stick's own web API (Huawei HiLink, http://192.168.8.1): PLMN from
/api/net/current-plmn, cell id, PCI, band and signal from /api/device/signal. Nothing is written to the stick.
The oracle remembers the first cell it hears as the node's home cell and raises an alert when a later heartbeat
comes from another one: the box has travelled, and the cell id says roughly where to. No coin cell, no extra
hardware, and nothing for a thief to notice. On a bench without the stick the cell is simply absent.

Power and box health ride along, from what is already in the box:
- the Witty Pi 4 over I2C (no extra hardware): its input voltage, which on a node is the charge controller's load
  output and so the battery less a few tenths; what the Pi draws (output volts x amps); the board's own temperature
  sensor, i.e. the air inside the box; and why it last switched the Pi on (schedule, low voltage, power back, ...).
- the Victron charge controller over VE.Direct, when a VE.Direct-to-USB cable is plugged in (v1.1): battery volts and
  amps, panel volts and watts, charge state, error code, and today's and yesterday's yield.
All of it is a dozen numbers, about 250 bytes on a post that is sent anyway: no extra TLS handshake, under 2% of the
SIM's ten-year budget. The boot heartbeat matters most, because it carries the battery after the night.

Environment:
    LIFE_DEVICE_TOKEN   the node's SOUND device token (the heartbeat is the node's, not a probe's)
    LIFE_API            default https://life.oncra.org/api/v1
    MODEM_HOST          default 192.168.8.1; set empty to skip the modem
    LIFE_QUEUE          default /var/lib/life-node/queue.jsonl (unsent soil rows)
    WITTYPI_BUS         default 1; set empty to skip the Witty Pi
    VEDIRECT_PORT       default: the first /dev/serial/by-id/*VE_Direct*; set "none" to skip; a /dev/ttyUSB0 for a
                        home-made cable
"""
import glob, json, os, subprocess, sys, time, urllib.request, xml.etree.ElementTree as ET
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


WAKE = {1: "alarm", 2: "alarm", 3: "button", 4: "low-voltage", 5: "voltage-restored", 6: "over-temp", 7: "under-temp",
        8: "alarm", 9: "usb-5v", 10: "power-connected", 11: "reboot", 12: "guaranteed-wake"}


def i2c(bus, reg, word=False):
    out = subprocess.run(["i2cget", "-y", bus, "0x08", str(reg)] + (["w"] if word else []), capture_output=True, text=True, timeout=5)
    if out.returncode != 0:
        raise OSError(out.stderr.strip() or f"i2cget {reg} failed")
    return int(out.stdout.strip(), 16)


def wittypi():
    """Volts, watts, box temperature and wake reason from the Witty Pi 4 (registers as in UUGear's utilities.sh)."""
    bus = os.environ.get("WITTYPI_BUS", "1").strip()
    if not bus:
        return {}
    m = {}
    try:
        i2c(bus, 0)
    except Exception:  # noqa: BLE001 - no Witty Pi on this bus (a bench Pi): nothing to say
        return {}
    try:
        m["vinV"] = round(i2c(bus, 1) + i2c(bus, 2) / 100, 2)
        vout, iout = i2c(bus, 3) + i2c(bus, 4) / 100, i2c(bus, 5) + i2c(bus, 6) / 100
        m["piW"] = round(vout * iout, 2)
    except Exception as e:  # noqa: BLE001
        print(f"wittypi power: {e}", file=sys.stderr)
    try:
        w = i2c(bus, 50, word=True)
        raw = (((w & 0xFF) << 8) | ((w & 0xFF00) >> 8)) >> 5
        if raw != 0x7FF:  # 0xffff reads back as 0x7ff: no reading
            m["boxTempC"] = round(((raw & 0x3FF) - 1024 if raw >= 0x400 else raw) * 0.125, 1)
    except Exception as e:  # noqa: BLE001
        print(f"wittypi temp: {e}", file=sys.stderr)
    try:
        m["wake"] = WAKE.get(i2c(bus, 11), "unknown")
    except Exception:  # noqa: BLE001
        pass
    return m


# VE.Direct text protocol: charge state codes, and the labels we keep with their scale.
CHARGE = {0: "off", 2: "fault", 3: "bulk", 4: "absorption", 5: "float", 7: "equalize", 245: "starting", 247: "equalize",
          252: "external"}


def vedirect_frame(raw: bytes):
    """The last complete, checksummed block in a stretch of VE.Direct text, as {label: value}; None if none checks out.
    A block is label<TAB>value<CR><LF> lines ending in a Checksum line; all bytes of a block sum to 0 mod 256."""
    best, start = None, raw.find(b"\r\n")
    while start != -1:
        end = raw.find(b"Checksum\t", start)
        if end == -1 or end + 10 >= len(raw):
            break
        block = raw[start:end + 10]
        if sum(block) % 256 == 0:
            fields = {}
            for line in block.split(b"\r\n"):
                if b"\t" in line and not line.startswith(b"Checksum"):
                    k, v = line.split(b"\t", 1)
                    fields[k.decode("ascii", "replace")] = v.decode("ascii", "replace")
            best = fields
        start = end + 10
    return best


def vedirect():
    port = os.environ.get("VEDIRECT_PORT", "").strip()
    if port.lower() == "none":
        return {}
    if not port:
        found = sorted(glob.glob("/dev/serial/by-id/*VE_Direct*"))
        if not found:
            return {}
        port = found[0]
    try:
        import serial  # python3-serial, installed by provision.sh
        raw = b""
        with serial.Serial(port, 19200, timeout=0.5) as ser:
            deadline = time.monotonic() + 3  # the controller sends a block every second
            while time.monotonic() < deadline:
                raw += ser.read(512)
                f = vedirect_frame(raw)
                if f and "V" in f:
                    break
        f = vedirect_frame(raw)
    except Exception as e:  # noqa: BLE001
        print(f"vedirect {port}: {e}", file=sys.stderr)
        return {}
    if not f:
        print(f"vedirect {port}: no complete block in 3 s", file=sys.stderr)
        return {}
    def n(key, scale=1.0):
        try:
            return round(int(f[key]) * scale, 3)
        except (KeyError, ValueError):
            return None
    m = {"battV": n("V", 0.001), "battA": n("I", 0.001), "pvV": n("VPV", 0.001), "pvW": n("PPV"),
         "yieldTodayWh": n("H20", 10), "yieldYdayWh": n("H22", 10), "pvMaxTodayW": n("H21")}
    cs = n("CS")
    if cs is not None:
        m["charge"] = CHARGE.get(int(cs), str(int(cs)))
    err = n("ERR")
    if err:
        m["mpptErr"] = int(err)
    if "LOAD" in f:
        m["loadOn"] = f["LOAD"].upper() == "ON"
    return {k: v for k, v in m.items() if v is not None}


def power():
    return {**wittypi(), **vedirect()}


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
    m.update(power())
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
    if "--power" in args:
        print(json.dumps(power()))
        return
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
