#!/usr/bin/env python3
"""A visit to a Life node: its clips leave over the visitor's phone, or onto a laptop (content/spec.md, section 2.2).

A node in a field keeps its clips on its card and sends no sound over its SIM (life-clips). A visit takes them away.
It starts with a magnet held against the box over the visit contact (a reed switch that wakes a sleeping node through
the Witty Pi's button input, and that this program reads on GPIO 22 while the node is up), or with the button itself:

1. The node joins the visitor's phone hotspot: the name and password its owner set on the node's page on the oracle,
   "hotspot" and 12345678 until then. A visible name that differs only in case, spaces or the kind of apostrophe is
   taken too (an iPhone calls its hotspot "Sven’s iPhone", with a curly one). On the hotspot life-clips sends the
   waiting clips to the oracle itself, and life-push posts, so the visitor sees on the node's page that they arrived.
   Each clip is deleted from the card once the oracle has it, checked by its SHA-256.
2. Without a hotspot within VISIT_HOTSPOT_WAIT_S, or with clips still waiting when the hotspot is done, the node opens
   its own WiFi: life- and the last six characters of its id, with the password on its page. The Life Clips app on a
   laptop takes the clips from http://10.42.0.1 (or 169.254.42.1, when the laptop got no address), with a grant the
   node signs for exactly those clips, and sends them to the oracle once it is online again. The node deletes them when
   the oracle's answer to a heartbeat names the batch (life-clips receipt); until then they stay, and leave any way.

A node on a cable or a WiFi of its own already sends its clips (life-clips upload); a visit there only sends them now.

The node's own WiFi leads nowhere: its DHCP answers carry no gateway and no DNS server, and a firewall table lets a
laptop on it reach the clip server and DHCP and nothing else on the node. Without that table (nftables) the WiFi stays
closed. On a visitor's hotspot a table of the same name lets in only the answers to the node's own connections. A visit lasts at most VISIT_MAX_MIN minutes, after which the WiFi radio is off again if it was (a field node
keeps it off). A visit that woke the node (life-window starts it) ends with the node asleep until its next listening
window, unless the owner has a maintenance window open; one inside a listening window ends with the window at the latest.

    life-visit apply < answer        the oracle's answer to a heartbeat, from life-push: its `visit` settings (the hotspot,
                                     the password of the node's own WiFi, the node's id) go to LIFE_STATE/visit.json
    life-visit run [boot|magnet]     the visit (life-visit@.service)
    life-visit watch                 while the node is up: a magnet on the visit contact starts a visit
    life-visit end                   end a running visit now
    life-visit teardown              put the WiFi back as it was (the unit's ExecStopPost; harmless at any time)
    life-visit status [--json]

env: LIFE_VISIT (1 = visits on), LIFE_VISIT_PIN (the contact's BCM pin, 22; empty when none is fitted),
     LIFE_VISIT_PULL (pn: the contact's circuit holds the line), VISIT_MAX_MIN (30, at most 60), VISIT_HOTSPOT_WAIT_S (90),
     LIFE_STATE (/data/life-node), LIFE_CLIPS_BIN (/usr/local/bin/life-clips), LIFE_WINDOW_BIN (/usr/local/sbin/life-window),
     LIFE_PUSH_UNIT (life-sound.service); for the tests: LIFE_VISIT_IFACE (wlan0), VISIT_RUN (/run/life-visit),
     VISIT_BIND and VISIT_PORT (where the clip server listens instead of the node's own WiFi), VISIT_RETRY_S (15)
"""
import fcntl
import importlib.machinery
import importlib.util
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.parse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ENABLED = os.environ.get("LIFE_VISIT", "0").strip() == "1"
PIN = os.environ.get("LIFE_VISIT_PIN", "").strip()
PULL = os.environ.get("LIFE_VISIT_PULL", "pn").strip() or "pn"
_max = float(os.environ.get("VISIT_MAX_MIN") or 30)
MAX_S = min(_max if _max > 0 else 30, 60) * 60   # the unit's RuntimeMaxSec (65 min) is the backstop
HOTSPOT_S = float(os.environ.get("VISIT_HOTSPOT_WAIT_S") or 90)
RETRY_S = float(os.environ.get("VISIT_RETRY_S") or 15)   # between uploads that sent nothing
SEND_MIN_S = min(30.0, MAX_S / 20)   # no new upload with less of the visit left than this
WIFI_MIN_S = min(60.0, MAX_S / 10)   # nor the node's own WiFi
CHECK_S = min(15.0, MAX_S / 10)      # how often the node's own WiFi is checked to be up
STATE = Path(os.environ.get("LIFE_STATE", "/data/life-node"))
SETTINGS = STATE / "visit.json"
LAST = STATE / "visit-last.json"
RUN = Path(os.environ.get("VISIT_RUN", "/run/life-visit"))
CLIPS_BIN = os.environ.get("LIFE_CLIPS_BIN", "/usr/local/bin/life-clips")
WINDOW_BIN = os.environ.get("LIFE_WINDOW_BIN", "/usr/local/sbin/life-window")
PUSH_UNIT = os.environ.get("LIFE_PUSH_UNIT", "life-sound.service")
IFACE = os.environ.get("LIFE_VISIT_IFACE", "wlan0")
BIND = os.environ.get("VISIT_BIND", "").strip()
PORT = int(os.environ.get("VISIT_PORT") or 80)
AP_ADDRS = (("10.42.0.1", 24), ("169.254.42.1", 16))   # the second for a laptop that falls back to a link-local address
HOTSPOT_CON, AP_CON = "life-visit-hotspot", "life-visit-ap"
DEFAULTS = {"ssid": "hotspot", "psk": "12345678"}    # as on the oracle (src/lib/node-visit.ts)
HELD = 3             # reads in a row, a second apart, before the contact counts: a magnet held, not a knock
TABLE = "life_visit"
DEVICE = re.compile(r"[A-Za-z0-9_-]{6,64}")
STOP = threading.Event()   # SIGTERM (the unit stopped) or SIGUSR1 (life-visit end): wind the visit down

# The node's own WiFi admits DHCP, the clip server and a ping, and nothing else; nothing crosses it to elsewhere. The
# first two lines make loading it again replace it in one go.
RULES = """table inet life_visit {{}}
delete table inet life_visit
table inet life_visit {{
    chain input {{
        type filter hook input priority -10; policy accept;
        iifname "{i}" udp dport 67 accept
        iifname "{i}" tcp dport {port} accept
        iifname "{i}" icmp type echo-request accept
        iifname "{i}" drop
    }}
    chain forward {{
        type filter hook forward priority -10; policy accept;
        iifname "{i}" drop
        oifname "{i}" drop
    }}
}}
"""
# On a visitor's hotspot the node is a guest on somebody else's network: nothing there may open a connection to it (its
# SSH, BirdNET-Go's page); only the answers to the node's own connections come in, and the phone's address offers.
GUEST = """table inet life_visit {{}}
delete table inet life_visit
table inet life_visit {{
    chain input {{
        type filter hook input priority -10; policy accept;
        iifname "{i}" ct state established,related accept
        iifname "{i}" udp dport {{ 68, 546 }} accept
        iifname "{i}" meta l4proto ipv6-icmp accept
        iifname "{i}" drop
    }}
}}
"""


def say(msg: str) -> None:
    print(f"life-visit: {msg}", flush=True)


def sh(cmd: list[str], timeout: float = 60, stdin: str | None = None) -> subprocess.CompletedProcess:
    """A command whose failure, absence or hang is an answer, not an exception. Its arguments are never printed: the
    ones for nmcli carry WiFi passwords."""
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=max(1.0, timeout), input=stdin)
    except (OSError, subprocess.TimeoutExpired) as e:
        return subprocess.CompletedProcess(cmd, 127, "", str(e))


def nm(*args: str, timeout: float = 60) -> subprocess.CompletedProcess:
    return sh(["nmcli", *args], timeout)


def write_json(p: Path, obj: dict, private: bool = False) -> None:
    """Atomically, so a power cut leaves the old file or the new one; mode 600 for the one with passwords."""
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600 if private else 0o644)
    with os.fdopen(fd, "w") as f:
        json.dump(obj, f)
        f.flush()
        os.fsync(f.fileno())
    if private:
        os.chmod(tmp, 0o600)
    os.replace(tmp, p)


# --- the settings, from the oracle ---

def valid_ssid(s) -> bool:
    return isinstance(s, str) and s == s.strip() and 0 < len(s.encode()) <= 32 and not any(ord(c) < 32 or ord(c) == 127 for c in s)


def valid_psk(s) -> bool:
    return isinstance(s, str) and re.fullmatch(r"[\x20-\x7e]{8,63}", s) is not None


def settings() -> dict:
    """What a visit uses: the owner's settings from the oracle's last word on them, the defaults where there are none."""
    try:
        v = json.loads(SETTINGS.read_text())
    except (OSError, ValueError):
        v = {}
    v = v if isinstance(v, dict) else {}
    rev = v.get("rev")
    return {"rev": rev if isinstance(rev, int) and not isinstance(rev, bool) else -1,
            "device": v["device"] if isinstance(v.get("device"), str) and DEVICE.fullmatch(v["device"]) else None,
            "ssid": v["ssid"] if valid_ssid(v.get("ssid")) else DEFAULTS["ssid"],
            "psk": v["psk"] if valid_psk(v.get("psk")) else DEFAULTS["psk"],
            "apPsk": v["apPsk"] if valid_psk(v.get("apPsk")) else None}


def own_ssid(v: dict) -> str | None:
    """The node's own WiFi: life- and the last six characters of its id, as the oracle shows it (apSsid)."""
    return f"life-{v['device'][-6:]}" if v.get("device") else None


def apply(answer) -> int:
    """The oracle sends the settings with a heartbeat answer only when they changed (the node reports `visitRev`)."""
    v = answer.get("visit") if isinstance(answer, dict) else None
    if not isinstance(v, dict) or not isinstance(v.get("rev"), int) or isinstance(v.get("rev"), bool):
        return 0
    rec = {"rev": v["rev"]}
    if isinstance(v.get("device"), str) and DEVICE.fullmatch(v["device"]):
        rec["device"] = v["device"]
    for key, ok in (("ssid", valid_ssid), ("psk", valid_psk), ("apPsk", valid_psk)):
        if ok(v.get(key)):
            rec[key] = v[key]
    write_json(SETTINGS, rec, private=True)
    say(f"visit settings {rec['rev']} from the oracle: hotspot \"{rec.get('ssid', DEFAULTS['ssid'])}\""
        + ("" if "apPsk" in rec and "device" in rec else "; the node's own WiFi has no id or password yet"))
    return 0


# --- what the node is doing ---

_clips = None


def clips():
    """life-clips, loaded as a module: its bookkeeping of the clips is the only one."""
    global _clips
    if _clips is None:
        loader = importlib.machinery.SourceFileLoader("life_clips", CLIPS_BIN)
        spec = importlib.util.spec_from_loader("life_clips", loader)
        mod = importlib.util.module_from_spec(spec)
        loader.exec_module(mod)
        _clips = mod
    return _clips


def note(**kw) -> None:
    """RUN/state.json: what the running visit is doing, for `status`, `end` and the tests."""
    p = RUN / "state.json"
    try:
        cur = json.loads(p.read_text())
    except (OSError, ValueError):
        cur = {}
    cur.update(kw)
    write_json(p, cur)


def window_end() -> float | None:
    """When the listening window the node is in ends (the Witty Pi switches it off then), if it is in one."""
    try:
        d = json.loads((STATE / "window.json").read_text())
        return datetime.fromisoformat(d["end"]).timestamp() if d.get("window") and d.get("end") else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def child(cmd: list[str], until: float) -> None:
    """A long step (an upload) that the visit can cut short; its output goes to the journal."""
    try:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    except OSError as e:
        say(f"{Path(cmd[0]).name} did not start: {e}")
        return
    lines: list[str] = []
    reader = threading.Thread(target=lambda: lines.extend(p.stdout), daemon=True)
    reader.start()
    while p.poll() is None:
        if STOP.is_set() or time.monotonic() > until:
            p.terminate()
            try:
                p.wait(15)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()
            break
        STOP.wait(1)
    reader.join(5)
    for line in lines:
        print(line.rstrip(), flush=True)


# --- the WiFi ---

def radio_on() -> None:
    """A field node keeps its WiFi radio off (NetworkManager's stock state on this image). Teardown switches it off
    again only if it was off, which is written down before anything changes."""
    flag = RUN / "radio"
    was = nm("radio", "wifi").stdout.strip()
    if not flag.exists():
        RUN.mkdir(parents=True, exist_ok=True)
        flag.write_text(was or "unknown")
    if was != "enabled":
        nm("radio", "wifi", "on")
        end = time.monotonic() + 20
        while time.monotonic() < end and not STOP.is_set():   # the device leaves "unavailable" a moment later
            states = dict(line.split(":", 1) for line in nm("-t", "-f", "DEVICE,STATE", "device").stdout.splitlines() if ":" in line)
            if states.get(IFACE, "unavailable") != "unavailable":
                break
            STOP.wait(1)


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    for c in "’‘`´ʼ":
        s = s.replace(c, "'")
    return " ".join(s.split()).casefold()


def visible() -> list[str]:
    """The WiFi names in range, after a fresh scan when NetworkManager allows one."""
    r = nm("-t", "-f", "SSID", "device", "wifi", "list", "--rescan", "yes", "ifname", IFACE, timeout=45)
    if r.returncode != 0:
        r = nm("-t", "-f", "SSID", "device", "wifi", "list", "ifname", IFACE, timeout=30)
    return [re.sub(r"\\(.)", r"\1", line) for line in r.stdout.splitlines() if line.strip()]   # terse mode escapes : and \


def wait_way(dev: str, seconds: float) -> bool:
    """Until the node's way to the internet is `dev` (a phone hands out its address after the WiFi is joined)."""
    end = time.monotonic() + seconds
    while time.monotonic() < end and not STOP.is_set():
        if clips().way_out() == dev:
            return True
        STOP.wait(1)
    return False


def hotspot(v: dict, until: float) -> bool:
    """Join the visitor's phone hotspot; True once the node's way to the internet is it."""
    end = min(until, time.monotonic() + HOTSPOT_S)
    if not firewall(GUEST):
        say("no firewall table (is nftables installed?): on the hotspot the node takes connections as on any WiFi")
    say(f"looking for the hotspot \"{v['ssid']}\" for {max(0, int(end - time.monotonic()))} s")
    while time.monotonic() < end and not STOP.is_set():
        seen = visible()
        name = next((s for s in seen if s == v["ssid"]), None) or next((s for s in seen if norm(s) == norm(v["ssid"])), None)
        if name:
            nm("connection", "delete", HOTSPOT_CON)
            r = nm("connection", "add", "save", "no", "type", "wifi", "con-name", HOTSPOT_CON, "ifname", IFACE, "ssid", name,
                   "wifi-sec.key-mgmt", "wpa-psk", "wifi-sec.psk", v["psk"], "connection.autoconnect", "no",
                   "ipv4.route-metric", "600", "ipv6.route-metric", "600")
            up = nm("--wait", "30", "connection", "up", HOTSPOT_CON, timeout=45) if r.returncode == 0 else r
            if up.returncode == 0 and wait_way(IFACE, 30):
                say(f"on the hotspot \"{name}\"")
                note(phase="hotspot")
                return True
            say(f"could not join \"{name}\": {(up.stderr or up.stdout).strip()[:160]}")
        STOP.wait(max(0.0, min(5.0, end - time.monotonic())))
    say("no hotspot")
    return False


def send(dev: str, until: float) -> int:
    """life-clips upload over `dev` until nothing waits, the time is up or the way out changes; then life-push over the
    same way, so the owner's page shows what arrived. How many clips left the node meanwhile."""
    c = clips()
    start, idle = c.counts()["waiting"], 0
    while not STOP.is_set() and until - time.monotonic() > SEND_MIN_S and c.way_out() == dev:
        before = c.counts()
        if not before["ready"]:
            break
        child([CLIPS_BIN, "upload", "--for", str(max(1, int(until - time.monotonic() - SEND_MIN_S / 2)))], until)
        if c.counts()["waiting"] < before["waiting"]:
            idle = 0
            continue
        idle += 1   # the oracle unreachable over this phone, an upload already running, uploads off (LIFE_CLIPS_UPLOAD)
        if idle >= 3:
            say("no clip went out in three tries (life-clips status says why)")
            break
        STOP.wait(RETRY_S)
    sent = max(0, start - c.counts()["waiting"])
    if c.way_out() == dev and not STOP.is_set():
        sh(["systemctl", "start", PUSH_UNIT], timeout=min(180.0, until - time.monotonic()))
    return sent


def firewall(rules: str = RULES) -> bool:
    """The visit's table: RULES for the node's own WiFi, GUEST on a hotspot; loading one replaces the other."""
    if not shutil.which("nft"):
        return False
    r = sh(["nft", "-f", "-"], stdin=rules.format(i=IFACE, port=PORT))
    return r.returncode == 0 and sh(["nft", "list", "table", "inet", TABLE]).returncode == 0


def dhcp() -> subprocess.Popen | None:
    """Addresses for laptops on the node's own WiFi, and nothing more: no DNS (port 0), no gateway, no DNS server."""
    exe = shutil.which("dnsmasq")
    if not exe:
        say("no dnsmasq: a laptop gets no address and finds the node at 169.254.42.1")
        return None
    try:
        p = subprocess.Popen([exe, "--keep-in-foreground", "--conf-file=/dev/null", "--port=0", f"--interface={IFACE}",
                              "--bind-interfaces", "--except-interface=lo", "--dhcp-range=10.42.0.10,10.42.0.250,255.255.255.0,15m",
                              "--dhcp-option=3", "--dhcp-option=6", "--dhcp-authoritative", "--leasefile-ro",
                              f"--pid-file={RUN / 'dnsmasq.pid'}", "--log-facility=-"])
    except OSError as e:
        say(f"dnsmasq did not start: {e}")
        return None
    if STOP.wait(1) or p.poll() is not None:
        say("dnsmasq stopped at once; a laptop finds the node at 169.254.42.1")
        return None
    return p


def active(con: str) -> bool:
    return con in nm("-t", "-f", "NAME", "connection", "show", "--active").stdout.splitlines()


# --- the clip server, on the node's own WiFi ---

class Visit:
    """What the clip server serves, until when, and what happened on it."""

    def __init__(self, ssid: str, device: str, until: float):
        self.ssid, self.device, self.until = ssid, device, until
        self.finished = threading.Event()
        self.handed, self.files, self.laptops = 0, 0, set()
        self.lock = threading.Lock()

    def until_epoch(self) -> int:
        t = time.time() + max(0.0, self.until - time.monotonic())
        w = window_end()
        return int(min(t, w) if w and w > time.time() else t)


def handler_for(visit: Visit):
    c = clips()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"   # keep-alive: a laptop fetches thousands of small files
        timeout = 30
        server_version = "life-visit/1"
        sys_version = ""

        def log_message(self, *a):
            pass

        def answer(self, code: int, obj) -> None:
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            with visit.lock:
                visit.laptops.add(self.client_address[0])
            u = urllib.parse.urlsplit(self.path)
            if u.path == "/api/hello":
                n = c.counts()
                return self.answer(200, {"version": 1, "node": visit.ssid, "device": visit.device, "waiting": n["waiting"],
                                         "mb": n["mb"], "until": visit.until_epoch()})
            if u.path == "/api/clips":
                q = urllib.parse.parse_qs(u.query)
                try:
                    after, limit = int(q.get("after", ["0"])[0] or 0), int(q.get("limit", ["1000"])[0] or 1000)
                except ValueError:
                    return self.answer(400, {"error": "after and limit are numbers"})
                limit = max(1, min(limit, 1000))
                rows = c.manifest(after, limit)
                return self.answer(200, {"clips": rows, "next": rows[-1]["seq"] if len(rows) == limit else None})
            p = c.clip_file(urllib.parse.unquote(u.path).lstrip("/"))
            try:
                f = open(p, "rb") if p else None
            except OSError:   # sent or deleted between the check and now
                f = None
            if f is None:
                return self.answer(404, {"error": "no such clip waiting on this node"})
            with f:
                self.send_response(200)
                self.send_header("content-type", c.MIME.get(p.suffix.lower(), "application/octet-stream"))
                self.send_header("content-length", str(os.fstat(f.fileno()).st_size))
                self.end_headers()
                shutil.copyfileobj(f, self.wfile, 1 << 16)
            with visit.lock:
                visit.files += 1

        def do_POST(self):
            path = urllib.parse.urlsplit(self.path).path
            try:
                n = int(self.headers.get("content-length") or 0)
            except ValueError:
                n = -1
            if n < 0 or n > 1 << 20:
                self.close_connection = True
                return self.answer(413, {"error": "a body of at most 1 MB"})
            raw = self.rfile.read(n) if n else b""
            if path == "/api/done":
                self.answer(200, {"ok": True})
                threading.Timer(1.0, visit.finished.set).start()   # after the answer has gone out
                return
            if path != "/api/handover":
                return self.answer(404, {"error": "not found"})
            try:
                body = json.loads(raw or b"{}")
            except ValueError:
                body = None
            refs = body.get("refs") if isinstance(body, dict) else None
            if not isinstance(refs, list) or not 0 < len(refs) <= 2000 or not all(isinstance(r, str) and 0 < len(r) <= 120 for r in refs):
                return self.answer(400, {"error": "send {refs: [...], laptop}: 1 to 2000 refs (`detection`) from /api/clips"})
            laptop = body.get("laptop")
            out = c.handover(list(dict.fromkeys(refs)), laptop if isinstance(laptop, str) else "")
            with visit.lock:
                visit.handed += out.get("n") or 0
            return self.answer(200, out)

    return Handler


def serve(visit: Visit) -> list[ThreadingHTTPServer]:
    """On the node's own WiFi addresses only: never on a cable, a bench's WiFi or the SIM."""
    servers = []
    for addr in ((BIND,) if BIND else tuple(a for a, _ in AP_ADDRS)):
        try:
            s = ThreadingHTTPServer((addr, PORT), handler_for(visit))
        except OSError as e:
            say(f"no clip server on {addr}:{PORT} ({e})")
            continue
        threading.Thread(target=s.serve_forever, daemon=True).start()
        servers.append(s)
    return servers


def own_wifi(v: dict, until: float) -> dict:
    """The node's own WiFi for a laptop, until the visit's time is up or the laptop says it is done."""
    ssid = own_ssid(v)
    if not ssid or not v["apPsk"]:
        say("the node's own WiFi stays closed: it has no id and password from the oracle yet (a heartbeat answer brings them)")
        return {}
    if not firewall():
        say("the node's own WiFi stays closed: its firewall table did not load (is nftables installed?)")
        return {}
    nm("connection", "delete", HOTSPOT_CON)   # the radio is one thing at a time
    nm("connection", "delete", AP_CON)
    r = nm("connection", "add", "save", "no", "type", "wifi", "con-name", AP_CON, "ifname", IFACE, "ssid", ssid,
           "802-11-wireless.mode", "ap", "802-11-wireless.band", "bg", "802-11-wireless.channel", "6",
           "wifi-sec.key-mgmt", "wpa-psk", "wifi-sec.proto", "rsn", "wifi-sec.pairwise", "ccmp", "wifi-sec.group", "ccmp",
           "wifi-sec.psk", v["apPsk"], "ipv4.method", "manual", "ipv4.addresses", ",".join(f"{a}/{m}" for a, m in AP_ADDRS),
           "ipv4.never-default", "yes", "ipv6.method", "disabled", "connection.autoconnect", "no")
    up = nm("--wait", "30", "connection", "up", AP_CON, timeout=45) if r.returncode == 0 else r
    if up.returncode != 0:
        say(f"the node's own WiFi did not come up: {(up.stderr or up.stdout).strip()[:160]}")
        return {}
    dns = dhcp()
    visit = Visit(ssid, v["device"], until)
    servers = serve(visit)
    if not servers:
        if dns:
            dns.terminate()
        return {}
    note(phase="wifi", ssid=ssid, port=servers[0].server_address[1], until=visit.until_epoch())
    say(f"the node's own WiFi \"{ssid}\" is open until {datetime.fromtimestamp(visit.until_epoch()).strftime('%H:%M')}; "
        "the clips are at http://10.42.0.1")
    checked = time.monotonic()
    while not STOP.is_set() and not visit.finished.is_set() and time.monotonic() < until:
        visit.finished.wait(max(0.0, min(5.0, until - time.monotonic())))
        if time.monotonic() - checked >= CHECK_S:
            checked = time.monotonic()
            if not active(AP_CON) and nm("--wait", "30", "connection", "up", AP_CON, timeout=45).returncode != 0:
                say("the node's own WiFi went down and did not come back")
                break
    for s in servers:
        s.shutdown()
        s.server_close()
    if dns:
        dns.terminate()
        try:
            dns.wait(10)
        except subprocess.TimeoutExpired:
            dns.kill()
    if visit.finished.is_set():
        say("the laptop is done")
    return {"opened": True, "handed": visit.handed, "files": visit.files, "laptop": bool(visit.laptops)}


def teardown() -> int:
    """The WiFi as it was before the visit: no visit connections, no firewall table, the radio off if it was off."""
    for con in (AP_CON, HOTSPOT_CON):
        nm("connection", "delete", con, timeout=30)
    if shutil.which("nft"):
        sh(["nft", "delete", "table", "inet", TABLE])
    pid = RUN / "dnsmasq.pid"
    try:
        n = int(pid.read_text().strip())
        if "dnsmasq" in Path(f"/proc/{n}/cmdline").read_text():
            os.kill(n, signal.SIGTERM)
    except (OSError, ValueError):
        pass
    pid.unlink(missing_ok=True)
    flag = RUN / "radio"
    if flag.exists():
        if flag.read_text().strip() != "enabled":
            nm("radio", "wifi", "off")
        flag.unlink(missing_ok=True)
    (RUN / "state.json").unlink(missing_ok=True)
    return 0


# --- the visit ---

def run(reason: str) -> int:
    if not ENABLED:
        say("visits are off (LIFE_VISIT=1 turns them on)")
        return 0
    RUN.mkdir(parents=True, exist_ok=True)
    lock = open(RUN / "lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        say("a visit is already running")
        return 0
    for sig in (signal.SIGTERM, signal.SIGUSR1):
        signal.signal(sig, lambda *_: STOP.set())
    t0 = time.monotonic()
    until = t0 + MAX_S
    rec = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "reason": reason, "how": "none", "sent": 0, "handed": 0}
    note(pid=os.getpid(), reason=reason, phase="start", until=int(time.time() + MAX_S))
    say(f"a visit ({reason}), at most {MAX_S / 60:g} minutes")
    try:
        v = settings()
        c = clips()
        dev = c.way_out()
        if dev:
            say(f"the node is online over {dev} already: sending its clips now")
            rec["how"], rec["sent"] = "online", send(dev, until)
        else:
            radio_on()
            if hotspot(v, until):
                rec["how"], rec["sent"] = "hotspot", send(IFACE, until)
            if not STOP.is_set() and c.counts()["waiting"] and until - time.monotonic() > WIFI_MIN_S:
                got = own_wifi(v, until)
                if got.get("opened"):
                    rec["how"] = "hotspot+wifi" if rec["how"] == "hotspot" else "wifi"
                    rec["handed"], rec["laptop"] = got["handed"], got["laptop"]
    finally:
        teardown()
        try:
            left = clips().counts()["waiting"]
        except Exception:  # noqa: BLE001 - the summary must not stop the node going back to sleep
            left = None
        rec["minutes"] = round((time.monotonic() - t0) / 60, 1)
        write_json(LAST, rec)
        say(f"visit over after {rec['minutes']} min ({rec['how']}): {rec['sent']} clips sent, {rec['handed']} handed to a laptop"
            + (f", {left} still on the node" if left is not None else ""))
        lock.close()
        # a visit that woke the node ends with it asleep until its next window, unless the owner keeps it on
        if reason == "boot" and sh(["systemctl", "is-system-running"]).stdout.strip() != "stopping":
            r = sh([WINDOW_BIN, "stop", "--unless-maintenance"], timeout=120)
            for line in (r.stdout + r.stderr).splitlines():
                print(line, flush=True)
    return 0


def watch(every: float = 1.0, rounds: int | None = None) -> int:
    """While the node is up a magnet cannot wake it (the contact's circuit holds the button input off then, or the
    press would shut the node down), so read the contact here and start a visit when it is held. A magnet already
    there when this starts is the one that woke the node: life-window has started that visit. rounds is for the tests."""
    if not ENABLED or not PIN:
        say("no visit contact to watch (LIFE_VISIT=1 and LIFE_VISIT_PIN)")
        return 0

    def closed() -> bool:
        return "| hi" in sh(["pinctrl", "get", PIN], timeout=10).stdout

    sh(["pinctrl", "set", PIN, "ip", PULL], timeout=10)
    held, streak, n = closed(), 0, 0
    while rounds is None or n < rounds:
        n += 1
        time.sleep(every)
        if not closed():
            held, streak = False, 0
            continue
        streak += 1
        if streak >= HELD and not held:
            held = True
            say("a magnet on the visit contact: a visit starts")
            sh(["systemctl", "start", "--no-block", "life-visit@magnet.service"], timeout=30)
    return 0


def end() -> int:
    try:
        os.kill(int(json.loads((RUN / "state.json").read_text())["pid"]), signal.SIGUSR1)
        say("the visit ends now")
    except (OSError, ValueError, KeyError, TypeError):
        say("no visit is running")
    return 0


def status(as_json: bool) -> int:
    v = settings()
    try:
        now = json.loads((RUN / "state.json").read_text())
    except (OSError, ValueError):
        now = None
    try:
        last = json.loads(LAST.read_text())
    except (OSError, ValueError):
        last = None
    s = {"enabled": ENABLED, "contactPin": int(PIN) if PIN.isdigit() else None, "rev": v["rev"], "device": v["device"],
         "hotspot": v["ssid"], "ownWifi": own_ssid(v), "ownWifiReady": bool(own_ssid(v) and v["apPsk"]),
         "running": {k: now[k] for k in ("reason", "phase", "until") if k in now} if now else None, "last": last}
    if as_json:
        print(json.dumps(s))
        return 0
    print(f"visits {'on' if ENABLED else 'off'}; contact {'GPIO ' + PIN if PIN else 'not fitted'}; hotspot \"{v['ssid']}\"; "
          + (f"own WiFi {s['ownWifi']}" + ("" if s["ownWifiReady"] else " (no password yet)") if s["ownWifi"] else "own WiFi not known yet")
          + (f"; running: {now.get('reason')} ({now.get('phase')})" if now else "")
          + (f"; last visit {last.get('at')}: {last.get('how')}, {last.get('sent')} sent, {last.get('handed')} handed" if last else ""))
    return 0


def main() -> int:
    args = sys.argv[1:]
    cmd = args[0] if args else "status"
    if cmd == "apply":
        try:
            return apply(json.load(sys.stdin))
        except ValueError:
            return 0
    if cmd == "run":
        return run(args[1] if len(args) > 1 and args[1] in ("boot", "magnet") else "by-hand")
    if cmd == "watch":
        return watch()
    if cmd == "end":
        return end()
    if cmd == "teardown":
        return teardown()
    if cmd == "status":
        return status("--json" in args)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
