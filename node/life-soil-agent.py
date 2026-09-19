#!/usr/bin/env python3
"""Life node soil agent: reads wired RS485 (Modbus RTU) soil probes and posts readings to the oracle.

Config /etc/life-node.env:
    LIFE_DEVICE_TOKEN_SOIL_1=lo_dev_...      # token of the 10 cm probe device
    LIFE_DEVICE_TOKEN_SOIL_2=lo_dev_...      # token of the 30 cm probe device (optional)
    LIFE_API=https://life.oncra.org/api/v1
    RS485_PORT=/dev/ttyUSB0                  # USB-RS485 adapter
    PROBE_ADDRESSES=1,2                      # Modbus slave ids in the same order as the tokens
    PROBE_PROFILE=sen0600                    # sen0600 | generic-thc | seeed-mtec02 | smt100
    LIFE_POST_BATCH=3                        # post once every N runs (3 x 20 min = hourly), to spare the SIM's data budget
    PROBE_POWER_GPIO=26                      # BCM pin driving the MOSFET on the 12 V probe rail; unset = rail always on
    PROBE_SETTLE_S=2                         # seconds to wait after powering the rail before the first Modbus query
Bench modes, for a probe that has never been read before:
    life-soil-agent --scan                     # walk Modbus addresses, print raw registers and decoded values
    life-soil-agent --set-address 2 --addr 1    # write register 0x07D0 on the ONE probe on the bus
Runs every 20 minutes from a systemd timer. Reads go to /var/lib/life-node/queue.jsonl and are posted every
LIFE_POST_BATCH runs, or at once with --flush (the shutdown unit calls that), so nothing is lost and the
per-post TLS overhead stays inside a 500 MB / 10 yr SIM.
"""
import json, os, sys, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path
try:
    import minimalmodbus, serial
except ImportError:
    sys.exit("pip install minimalmodbus pyserial")

API = os.environ.get("LIFE_API", "https://life.oncra.org/api/v1").rstrip("/")
PORT = os.environ.get("RS485_PORT", "/dev/ttyUSB0")
ADDRS = [int(a) for a in os.environ.get("PROBE_ADDRESSES", "1").split(",") if a.strip()]
PROFILE = os.environ.get("PROBE_PROFILE", "generic-thc")
QUEUE = Path("/var/lib/life-node/queue.jsonl"); QUEUE.parent.mkdir(parents=True, exist_ok=True)
RUNS = QUEUE.with_name("runs")                      # counts runs since the last post
BATCH = int(os.environ.get("LIFE_POST_BATCH", "3"))
FLUSH = "--flush" in sys.argv
SCAN = "--scan" in sys.argv

def flag(name, default=None):
    """Value of --name X, or None."""
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv): return sys.argv[i + 1]
    return default
PWR_GPIO = os.environ.get("PROBE_POWER_GPIO")
SETTLE = float(os.environ.get("PROBE_SETTLE_S", "2"))

def rail(on):
    """Switch the 12 V probe rail via a logic-level MOSFET on a GPIO. Left alone if PROBE_POWER_GPIO is unset."""
    if not PWR_GPIO: return
    base = Path(f"/sys/class/gpio/gpio{PWR_GPIO}")
    if not base.exists(): Path("/sys/class/gpio/export").write_text(PWR_GPIO)
    (base / "direction").write_text("out"); (base / "value").write_text("1" if on else "0")
    if on: time.sleep(SETTLE)

# register maps: (start register, count, decoder) -> dict(vwc, tempC, ec)
PROFILES = {
    # the common Chinese RS485 "soil temperature/humidity/EC" probes and Seeed S-Soil MTEC-02: 0x0000 moisture x10 %, 0x0001 temp x10 °C (signed), 0x0002 EC µS/cm
    "generic-thc": (0x0000, 3, lambda r: {"vwc": r[0] / 10, "tempC": (r[1] - 65536 if r[1] > 32767 else r[1]) / 10, "ec": r[2]}),
    # SEN0600 is moisture + temperature only: 0x0000 moisture x10 %, 0x0001 temp x10 C (signed). It has no EC register.
    "sen0600": (0x0000, 2, lambda r: {"vwc": r[0] / 10, "tempC": (r[1] - 65536 if r[1] > 32767 else r[1]) / 10, "ec": None}),
    "seeed-mtec02": (0x0000, 3, lambda r: {"vwc": r[0] / 10, "tempC": (r[1] - 65536 if r[1] > 32767 else r[1]) / 10, "ec": r[2]}),
    # Truebner SMT100 Modbus: 0x0000 count, 0x0001 permittivity x100, 0x0002 VWC x100 (%), 0x0003 temp x100 (°C), 0x0004 voltage
    "smt100": (0x0000, 5, lambda r: {"vwc": r[2] / 100, "tempC": (r[3] - 65536 if r[3] > 32767 else r[3]) / 100, "ec": None}),
}

ADDRESS_REGISTER = 0x07D0   # SEN0600 and the common Chinese RS485 probes: holding register that holds the slave id

def instrument(addr, timeout=0.4):
    inst = minimalmodbus.Instrument(PORT, addr)
    inst.serial.baudrate = int(os.environ.get("RS485_BAUD", "9600")); inst.serial.timeout = timeout
    inst.mode = minimalmodbus.MODE_RTU
    return inst

def read(addr):
    start, count, decode = PROFILES[PROFILE]
    return decode(instrument(addr, timeout=1.5).read_registers(start, count, functioncode=3))

def post(token, rows):
    req = urllib.request.Request(f"{API}/ingest/soil", data=json.dumps({"readings": rows}).encode(), headers={"content-type": "application/json", "authorization": f"Bearer {token}"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)

def scan():
    """Walk Modbus addresses and print what answers, raw words first.

    The raw registers are the point. Every profile here was written from a datasheet, so a probe that answers
    with stable words but nonsense values means the register map is wrong, not the probe. Air reads near zero
    moisture, a glass of water near saturation, a hand round the prongs moves the temperature within a minute.
    """
    lo, hi = (int(x) for x in os.environ.get("SCAN_RANGE", "1-16").split("-"))
    start, count, decode = PROFILES[PROFILE]
    print(f"scanning {PORT} addresses {lo}-{hi}, profile {PROFILE}, registers {start:#06x}+{count}")
    found = 0
    for addr in range(lo, hi + 1):
        try:
            regs = instrument(addr).read_registers(start, count, functioncode=3)
        except Exception:
            continue
        found += 1
        words = " ".join(f"{r:#06x}" for r in regs)
        try:
            v = decode(regs)
            decoded = ", ".join(f"{k}={v[k]}" for k in v if v[k] is not None)
        except Exception as e:
            decoded = f"profile {PROFILE} could not decode: {e}"
        print(f"  addr {addr:>3}: raw [{words}]  ->  {decoded}")
    if not found:
        print("  nothing answered. Check A/B are not swapped, the probe has 5 V, and the baud rate is 9600.")
    elif found > 1 and len(set(ADDRS)) < found:
        print(f"  {found} probes answered; give each its own address with --set-address before wiring them together.")
    return found

def set_address(new, old):
    """Write the slave id. ONE probe on the bus: every factory probe answers to 1, so a write reaches all of them."""
    print(f"writing address {new} to the probe at {old} (register {ADDRESS_REGISTER:#06x})")
    print("this must be the only probe on the bus, or every probe on it will take the new address")
    instrument(old).write_register(ADDRESS_REGISTER, new, functioncode=6)
    time.sleep(1.0)
    start, count, _ = PROFILES[PROFILE]
    try:
        instrument(new).read_registers(start, count, functioncode=3)
        print(f"confirmed: the probe answers at {new}")
        return True
    except Exception as e:
        print(f"no answer at {new} after the write: {e}", file=sys.stderr)
        print("some probes need a power cycle before the new address takes effect; cycle it and run --scan", file=sys.stderr)
        return False

def main():
    if SCAN:
        sys.exit(0 if scan() else 1)
    if "--set-address" in sys.argv:
        new = int(flag("--set-address"))
        if not 1 <= new <= 247: sys.exit("a Modbus slave id is 1 to 247")
        sys.exit(0 if set_address(new, int(flag("--addr", "1"))) else 1)
    now = datetime.now(timezone.utc).isoformat()
    pending = []
    if not FLUSH:
        rail(True)
        try:
            for i, addr in enumerate(ADDRS):
                token = os.environ.get(f"LIFE_DEVICE_TOKEN_SOIL_{i+1}")
                if not token: continue
                try:
                    v = read(addr)
                    pending.append({"token": token, "row": {"ts": now, **{k: v for k, v in v.items() if v is not None}, "raw": {"addr": addr, "profile": PROFILE}}})
                except Exception as e:
                    print(f"probe {addr}: {e}", file=sys.stderr)
        finally:
            rail(False)
    if QUEUE.exists():
        pending = [json.loads(l) for l in QUEUE.read_text().splitlines() if l.strip()] + pending
    runs = int(RUNS.read_text() or 0) + 1 if RUNS.exists() else 1
    if not FLUSH and runs < BATCH:
        QUEUE.write_text("".join(json.dumps(x) + "\n" for x in pending)); RUNS.write_text(str(runs))
        print(f"queued, {len(pending)} rows, run {runs}/{BATCH}"); return
    RUNS.write_text("0")
    left = []
    by_token = {}
    for p in pending: by_token.setdefault(p["token"], []).append(p["row"])
    for token, rows in by_token.items():
        try:
            out = post(token, rows); print(f"posted {out.get('readings')} rows")
        except Exception as e:
            print(f"post failed, queued: {e}", file=sys.stderr); left += [{"token": token, "row": r} for r in rows]
    QUEUE.write_text("".join(json.dumps(x) + "\n" for x in left))

if __name__ == "__main__":
    main()
