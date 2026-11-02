"""Tests for node/life-visit.py: a visit takes the clips over a phone hotspot or onto a laptop, and leaves the node's
WiFi, firewall and radio as they were.

    python3 -B -m unittest discover -s node/tests -v

Standard library only. A visit runs as its own process, as on the node, against the real life-clips with a node from
test_life_clips (its BirdNET-Go database, its clips) and that file's small oracle. What a Pi has and a laptop does not
is faked on PATH and nothing else is: nmcli (radio, scan, connections, a phone hotspot that is there or not and knows
its password), ip (the way out: the 4G stick, the hotspot, a cable), nft, dnsmasq, systemctl, pinctrl and life-window,
each writing down what it was asked. The clip server listens on 127.0.0.1 instead of the node's own WiFi.
"""
import importlib.machinery
import importlib.util
import json
import os
import random
import signal
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_life_clips as tlc  # noqa: E402

NODE = Path(__file__).resolve().parents[1]
DEVICE = "cmvisualnode0001x7k2qp"
AP_PSK = "vzp6-6dhy-vxug"
PHONE_PSK = "geheim-wachtwoord-1"

FAKES = {
    "nmcli": r'''
import json, os, sys
d = os.environ["FAKE_NET"]
a = sys.argv[1:]
def rd(name, default=""):
    try:
        return open(os.path.join(d, name)).read()
    except FileNotFoundError:
        return default
def wr(name, text):
    open(os.path.join(d, name), "w").write(text)
with open(os.path.join(d, "nmcli.log"), "a") as f:
    f.write(json.dumps(a) + "\n")
cons = json.loads(rd("cons.json", "{}"))
active = [x for x in rd("active").split("\n") if x]
def save():
    wr("cons.json", json.dumps(cons))
    wr("active", "\n".join(active))
while a and a[0].startswith("-") and a[0] != "--active":   # global options: -t, -f FIELDS, --wait N
    a = a[2:] if a[0] in ("-f", "--wait") else a[1:]
radio = rd("radio", "disabled").strip()
visible = [s for s in rd("visible").split("\n") if s]
if a[:2] == ["radio", "wifi"]:
    if len(a) == 2:
        print(radio)
    else:
        wr("radio", "enabled" if a[2] == "on" else "disabled")
    sys.exit(0)
if a == ["device"]:
    print("wlan0:" + ("disconnected" if radio == "enabled" else "unavailable"))
    print("eth1:connected")
    sys.exit(0)
if a[:3] == ["device", "wifi", "list"]:
    for s in visible if radio == "enabled" else []:
        print(s.replace("\\", "\\\\").replace(":", "\\:"))
    sys.exit(0)
if a[:2] == ["connection", "add"]:
    rest = a[4:] if a[2:4] == ["save", "no"] else a[2:]
    kv = dict(zip(rest[::2], rest[1::2]))
    kv["saved"] = a[2:4] != ["save", "no"]
    cons[kv["con-name"]] = kv
    save()
    sys.exit(0)
if a[:2] == ["connection", "delete"]:
    if a[2] not in cons:
        print("Error: unknown connection", file=sys.stderr)
        sys.exit(10)
    del cons[a[2]]
    if a[2] in active:
        active.remove(a[2])
        if a[2] == "life-visit-hotspot":
            wr("way", "usb0")
    save()
    sys.exit(0)
if a[:2] == ["connection", "up"]:
    c = cons.get(a[2])
    if c is None:
        sys.exit(10)
    if c.get("802-11-wireless.mode") == "ap":
        if os.path.exists(os.path.join(d, "ap_fail")):
            print("Error: Connection activation failed: IP configuration could not be reserved", file=sys.stderr)
            sys.exit(4)
    else:
        if radio != "enabled" or c["ssid"] not in visible:
            print("Error: Connection activation failed: The Wi-Fi network could not be found", file=sys.stderr)
            sys.exit(4)
        if c.get("wifi-sec.psk") != rd("phone_psk", "12345678").strip():
            print("Error: Connection activation failed: Secrets were required, but not provided", file=sys.stderr)
            sys.exit(4)
        wr("way", "wlan0")
    if a[2] not in active:
        active.append(a[2])
    save()
    sys.exit(0)
if a == ["connection", "show", "--active"]:
    print("\n".join(active))
sys.exit(0)
''',
    "ip": r'''
import os, sys
if sys.argv[1] == "-6":
    print("RTNETLINK answers: Network is unreachable", file=sys.stderr)
    sys.exit(2)
p = os.path.join(os.environ["FAKE_NET"], "way")
way = open(p).read().strip() if os.path.exists(p) else "usb0"
print(f"{sys.argv[-1]} via 10.0.0.1 dev {way} src 10.0.0.2 uid 0")
''',
    "nft": r'''
import os, sys
d = os.environ["FAKE_NET"]
a = sys.argv[1:]
with open(os.path.join(d, "nft.log"), "a") as f:
    f.write(" ".join(a) + "\n")
if os.path.exists(os.path.join(d, "nft_fail")):
    sys.exit(1)
t = os.path.join(d, "table")
if a == ["-f", "-"]:
    rules = sys.stdin.read()
    open(t, "w").write(rules)
    open(os.path.join(d, "tables.log"), "a").write(rules + "---\n")
elif a[0] == "list":
    sys.exit(0 if os.path.exists(t) else 1)
elif a[0] == "delete":
    if not os.path.exists(t):
        sys.exit(1)
    os.remove(t)
''',
    "dnsmasq": r'''
import os, signal, sys, time
d = os.environ["FAKE_NET"]
null = os.open(os.devnull, os.O_RDWR)
os.dup2(null, 1)
os.dup2(null, 2)
with open(os.path.join(d, "dnsmasq.log"), "a") as f:
    f.write(" ".join(sys.argv[1:]) + "\n")
if os.path.exists(os.path.join(d, "dnsmasq_fail")):
    sys.exit(1)
def bye(*_):
    with open(os.path.join(d, "dnsmasq.log"), "a") as f:
        f.write("stopped\n")
    sys.exit(0)
signal.signal(signal.SIGTERM, bye)
while True:
    time.sleep(0.1)
''',
    "systemctl": r'''
import os, sys
with open(os.path.join(os.environ["FAKE_NET"], "systemctl.log"), "a") as f:
    f.write(" ".join(sys.argv[1:]) + "\n")
if sys.argv[1:] == ["is-system-running"]:
    print("running")
''',
    "life-window": r'''
import os, sys
with open(os.path.join(os.environ["FAKE_NET"], "window.log"), "a") as f:
    f.write(" ".join(sys.argv[1:]) + "\n")
print("life-window: outside the windows: next start ..., powering off")
''',
    "pinctrl": r'''
import os, sys
d = os.environ["FAKE_NET"]
a = sys.argv[1:]
if a[0] == "get":
    p = os.path.join(d, "pin" + a[1])
    v = open(p).read().strip() if os.path.exists(p) else "0"
    print(f"{a[1]}: ip pn | {'hi' if v == '1' else 'lo'} // GPIO{a[1]} = input")
else:
    with open(os.path.join(d, "pinctrl.log"), "a") as f:
        f.write(" ".join(a) + "\n")
''',
}

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def tearDownModule():
    for con in tlc.OPEN:
        con.close()


class Net:
    """The fake programs and what they were asked."""

    def __init__(self, tmp: Path):
        self.dir, self.bin = tmp / "net", tmp / "bin"
        self.dir.mkdir()
        self.bin.mkdir()
        for name, code in FAKES.items():
            (self.bin / name).write_text(f"#!{sys.executable}\n{code}")
            (self.bin / name).chmod(0o755)
        (self.bin / "python3").symlink_to(sys.executable)   # life-clips runs as `#!/usr/bin/env python3`

    def set(self, name: str, text: str = ""):
        (self.dir / name).write_text(text)

    def read(self, name: str) -> str:
        p = self.dir / name
        return p.read_text() if p.exists() else ""

    def lines(self, name: str) -> list[str]:
        return [x for x in self.read(name).splitlines() if x]

    def nmcli(self) -> list[list[str]]:
        return [json.loads(x) for x in self.lines("nmcli.log")]

    def cons(self) -> dict:
        return json.loads(self.read("cons.json") or "{}")

    def added(self, name: str) -> dict | None:
        """The last `connection add` of that name, as key -> value."""
        for a in reversed(self.nmcli()):
            if a[:2] == ["connection", "add"] and name in a:
                rest = a[4:] if a[2:4] == ["save", "no"] else a[2:]
                return {**dict(zip(rest[::2], rest[1::2])), "saved": a[2:4] != ["save", "no"]}
        return None


class VisitTest(unittest.TestCase):
    """A node with six clips waiting (score 0.85), its 4G stick the way out, its WiFi radio off, no hotspot in range."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.oracle = tlc.Oracle()
        self.node = tlc.Node(self.tmp / "n", all_from="0.5", api=self.oracle.api)
        for i in range(6):
            self.node.detect(1, 0.85, tlc.MAY + timedelta(minutes=i))
        self.node.mod.sample(random.Random(1), now=tlc.NOW)
        self.net = Net(self.tmp)
        self.net.set("way", "usb0")
        self.net.set("radio", "disabled")
        self.net.set("phone_psk", PHONE_PSK)
        self.run_dir = self.tmp / "run"
        self.settings({"rev": 2, "device": DEVICE, "ssid": "hotspot", "psk": PHONE_PSK, "apPsk": AP_PSK})
        self.env = {"HOME": str(self.tmp), "PYTHONUTF8": "1", **self.node.env, "PATH": str(self.net.bin),
                    "FAKE_NET": str(self.net.dir), "LIFE_VISIT": "1", "VISIT_MAX_MIN": "1", "VISIT_HOTSPOT_WAIT_S": "1",
                    "VISIT_RETRY_S": "0.2", "VISIT_RUN": str(self.run_dir), "VISIT_BIND": "127.0.0.1", "VISIT_PORT": "0",
                    "LIFE_CLIPS_BIN": str(NODE / "life-clips.py"), "LIFE_WINDOW_BIN": str(self.net.bin / "life-window"),
                    "LIFE_CLIPS_BIND": "0", "LIFE_API": self.oracle.api, "LIFE_STATE": str(self.node.state)}

    def tearDown(self):
        self.oracle.close()
        self._tmp.cleanup()

    def settings(self, v: dict | None):
        p = self.node.state / "visit.json"
        if v is None:
            p.unlink(missing_ok=True)
        else:
            p.write_text(json.dumps(v))

    def start(self, reason="magnet", **env) -> subprocess.Popen:
        return subprocess.Popen([sys.executable, "-B", str(NODE / "life-visit.py"), "run", reason], env={**self.env, **env},
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    def finish(self, p: subprocess.Popen, timeout=60) -> str:
        out = p.communicate(timeout=timeout)[0]
        self.assertEqual(p.returncode, 0, out)
        return out

    def visit(self, reason="magnet", **env) -> str:
        return self.finish(self.start(reason, **env))

    def port(self, p: subprocess.Popen) -> int:
        end = time.time() + 20
        while time.time() < end:
            try:
                s = json.loads((self.run_dir / "state.json").read_text())
                if s.get("port"):
                    return s["port"]
            except (OSError, ValueError):
                pass
            if p.poll() is not None:
                self.fail(f"the visit ended before its WiFi opened:\n{p.communicate()[0]}")
            time.sleep(0.1)
        self.fail("the node's own WiFi did not open")

    def get(self, port: int, path: str) -> tuple[int, bytes]:
        try:
            with OPENER.open(f"http://127.0.0.1:{port}{path}", timeout=10) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def post(self, port: int, path: str, body) -> tuple[int, dict]:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, method="POST", headers={"content-type": "application/json"})
        try:
            with OPENER.open(req, timeout=30) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def last(self) -> dict:
        return json.loads((self.node.state / "visit-last.json").read_text())

    def assertPutBack(self):
        """Nothing of the visit is left: no connection, no firewall table, no dnsmasq, the radio off again."""
        self.assertEqual(self.net.cons(), {})
        self.assertFalse((self.net.dir / "table").exists())
        self.assertEqual(self.net.read("radio").strip(), "disabled")
        self.assertFalse((self.run_dir / "state.json").exists())
        log = self.net.read("dnsmasq.log")
        if log:
            self.assertTrue(log.rstrip().endswith("stopped"), log)


class Hotspot(VisitTest):
    def test_the_clips_go_over_the_phone_and_leave_the_node(self):
        self.net.set("visible", "Buurman\nhotspot\n")
        out = self.visit()
        self.assertEqual(len(self.oracle.clips), 6)
        self.assertEqual(self.node.waiting(), [])
        self.assertEqual(self.node.files(), [])
        self.assertEqual({r["via"] for r in self.node.rows()}, {"upload"})
        con = self.net.added("life-visit-hotspot")
        self.assertEqual((con["ssid"], con["wifi-sec.psk"], con["saved"]), ("hotspot", PHONE_PSK, False))   # never written to the card
        self.assertIn("start life-sound.service", self.net.lines("systemctl.log"))   # life-push over the hotspot: the page shows it
        self.assertIsNone(self.net.added("life-visit-ap"))                           # nothing left for a laptop
        self.assertNotIn(PHONE_PSK, out)
        self.assertEqual({k: self.last()[k] for k in ("reason", "how", "sent", "handed")}, {"reason": "magnet", "how": "hotspot", "sent": 6, "handed": 0})
        self.assertEqual(self.net.lines("window.log"), [])                           # the node was up already: it stays up
        guest = self.net.read("tables.log")                                          # a guest on the phone's network
        for rule in ('iifname "wlan0" ct state established,related accept', 'iifname "wlan0" udp dport { 68, 546 } accept',
                     'iifname "wlan0" drop'):
            self.assertIn(rule, guest)
        self.assertLess(guest.index("established"), guest.index('iifname "wlan0" drop'))
        self.assertNotIn("tcp dport", guest)                                         # no clip server, no SSH, no BirdNET-Go page
        self.assertPutBack()

    def test_the_hotspot_works_without_nftables(self):
        (self.net.bin / "nft").unlink()
        self.net.set("visible", "hotspot\n")
        out = self.visit()
        self.assertIn("no firewall table", out)
        self.assertEqual(len(self.oracle.clips), 6)
        self.assertEqual(self.last()["how"], "hotspot")
        self.assertPutBack()

    def test_an_iphone_name_with_a_curly_apostrophe(self):
        self.settings({"rev": 2, "device": DEVICE, "ssid": "Sven's iPhone", "psk": PHONE_PSK, "apPsk": AP_PSK})
        self.net.set("visible", "Sven’s iPhone\n")
        self.visit()
        self.assertEqual(self.net.added("life-visit-hotspot")["ssid"], "Sven’s iPhone")   # the name the phone sends
        self.assertEqual(len(self.oracle.clips), 6)

    def test_a_name_with_a_colon_survives_the_scan(self):
        self.settings({"rev": 2, "device": DEVICE, "ssid": "veld:3", "psk": PHONE_PSK, "apPsk": AP_PSK})
        self.net.set("visible", "veld:3\n")
        self.visit()
        self.assertEqual(len(self.oracle.clips), 6)

    def test_the_defaults_without_settings(self):
        self.settings(None)
        self.net.set("visible", "hotspot\n")
        self.net.set("phone_psk", "12345678")
        self.visit()
        self.assertEqual(self.net.added("life-visit-hotspot")["wifi-sec.psk"], "12345678")
        self.assertEqual(len(self.oracle.clips), 6)

    def test_a_wrong_password_leaves_the_laptop_way_open(self):
        self.net.set("visible", "hotspot\n")
        self.net.set("phone_psk", "een-ander-wachtwoord")
        p = self.start()
        port = self.port(p)
        self.assertEqual(self.post(port, "/api/done", {})[0], 200)
        self.finish(p)
        self.assertEqual(self.oracle.clips, {})
        self.assertEqual(self.last()["how"], "wifi")
        self.assertPutBack()

    def test_a_phone_without_data_leaves_the_laptop_way_open(self):
        self.net.set("visible", "hotspot\n")
        self.oracle.mode = "down"
        p = self.start()
        port = self.port(p)
        self.post(port, "/api/done", {})
        out = self.finish(p)
        self.assertIn("three tries", out)
        self.assertEqual(len(self.node.waiting()), 6)
        self.assertEqual(self.last()["how"], "hotspot+wifi")
        self.assertPutBack()

    def test_a_node_on_a_cable_sends_without_touching_its_wifi(self):
        self.net.set("way", "eth0")
        self.visit()
        self.assertEqual(len(self.oracle.clips), 6)
        self.assertEqual([a for a in self.net.nmcli() if a[:1] == ["radio"] or a[:2] == ["connection", "add"]], [])
        self.assertEqual(self.last()["how"], "online")

    def test_nothing_waiting_and_no_hotspot_is_a_short_visit(self):
        self.node.execute("update kept set collected = 1")
        out = self.visit()
        self.assertIsNone(self.net.added("life-visit-ap"))
        self.assertEqual(self.last()["how"], "none")
        self.assertIn("visit over", out)
        self.assertPutBack()


class Laptop(VisitTest):
    def test_a_laptop_takes_the_clips_and_the_oracle_lets_the_node_delete_them(self):
        p = self.start()
        port = self.port(p)
        code, hello = self.get(port, "/api/hello")
        hello = json.loads(hello)
        self.assertEqual((code, hello["node"], hello["device"], hello["waiting"], hello["version"]), (200, "life-x7k2qp", DEVICE, 6, 1))
        self.assertAlmostEqual(hello["until"], time.time() + 60, delta=10)
        first = json.loads(self.get(port, "/api/clips?limit=4")[1])
        self.assertEqual(len(first["clips"]), 4)
        rest = json.loads(self.get(port, f"/api/clips?after={first['next']}&limit=4")[1])
        self.assertEqual((len(rest["clips"]), rest["next"]), (2, None))
        clips = first["clips"] + rest["clips"]
        for c in clips:
            code, data = self.get(port, "/" + c["file"])
            self.assertEqual((code, tlc.sha(data), len(data)), (200, c["sha256"], c["bytes"]))
        for bad in ("/state.db", "/../life-node/visit.json", "/clips/%2e%2e/state.db", "/", "/nothing.m4a"):
            self.assertEqual(self.get(port, bad)[0], 404, bad)
        self.assertEqual(self.post(port, "/api/handover", {"refs": ["x"] * 2001})[0], 400)
        self.assertEqual(self.post(port, "/api/handover", b"{not json")[0], 400)
        self.assertEqual(self.post(port, "/api/handover", {"refs": []})[0], 400)
        code, out = self.post(port, "/api/handover", {"refs": [c["detection"] for c in clips] * 2, "laptop": "veldlaptop"})
        self.assertEqual((code, out["n"], len(out["items"])), (200, 6, 6))
        self.assertTrue(out["grant"].startswith("lg1."))
        self.assertEqual(self.post(port, "/api/done", {}), (200, {"ok": True}))
        self.finish(p)
        last = self.last()
        self.assertEqual((last["how"], last["handed"], last["laptop"]), ("wifi", 6, True))
        self.assertEqual(len(self.node.files()), 6)                  # the laptop has them; the node keeps them until the oracle does
        con = self.net.added("life-visit-ap")
        self.assertEqual((con["802-11-wireless.mode"], con["ssid"], con["wifi-sec.psk"], con["ipv4.never-default"], con["saved"]),
                         ("ap", "life-x7k2qp", AP_PSK, "yes", False))
        self.assertEqual(con["ipv4.addresses"], "10.42.0.1/24,169.254.42.1/16")
        args = self.net.lines("dnsmasq.log")[0].split()
        self.assertLessEqual({"--port=0", "--dhcp-option=3", "--dhcp-option=6", "--interface=wlan0", "--leasefile-ro"}, set(args))
        rules = self.net.read("nft.log")
        self.assertIn("-f -", rules)
        self.assertPutBack()
        r = subprocess.run([sys.executable, "-I", str(NODE / "life-clips.py"), "apply"], input=json.dumps({"clipsReceived": [out["batch"]]}),
                           env={**os.environ, **self.node.env}, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.node.files(), [])

    def test_the_firewall_lets_a_laptop_reach_the_clips_and_nothing_else(self):
        p = self.start()
        self.port(p)
        table = self.net.read("table")
        for rule in ('iifname "wlan0" udp dport 67 accept', 'iifname "wlan0" tcp dport 0 accept', 'iifname "wlan0" drop',
                     'oifname "wlan0" drop', "hook forward"):
            self.assertIn(rule, table)
        self.assertLess(table.index("tcp dport"), table.index('iifname "wlan0" drop'))
        os.kill(p.pid, signal.SIGUSR1)                                 # life-visit end
        self.finish(p)
        self.assertPutBack()

    def test_no_firewall_no_wifi(self):
        (self.net.bin / "nft").unlink()
        out = self.visit()
        self.assertIn("nftables", out)
        self.assertIsNone(self.net.added("life-visit-ap"))
        self.assertEqual(self.net.read("dnsmasq.log"), "")
        self.assertEqual(self.last()["how"], "none")
        self.assertPutBack()

    def test_a_firewall_that_will_not_load_is_no_wifi_either(self):
        self.net.set("nft_fail")
        self.visit()
        self.assertIsNone(self.net.added("life-visit-ap"))

    def test_without_its_id_the_node_keeps_its_wifi_closed(self):
        self.settings({"rev": 0, "ssid": "hotspot", "psk": PHONE_PSK})
        out = self.visit()
        self.assertIn("no id and password", out)
        self.assertIsNone(self.net.added("life-visit-ap"))

    def test_a_wifi_that_does_not_come_up(self):
        self.net.set("ap_fail")
        out = self.visit()
        self.assertIn("did not come up", out)
        self.assertEqual(self.net.read("dnsmasq.log"), "")
        self.assertPutBack()

    def test_without_dhcp_the_laptop_still_finds_the_node(self):
        self.net.set("dnsmasq_fail")
        p = self.start()
        port = self.port(p)
        self.assertEqual(self.get(port, "/api/hello")[0], 200)
        self.post(port, "/api/done", {})
        out = self.finish(p)
        self.assertIn("169.254.42.1", out)

    def test_the_visit_ends_on_time(self):
        p = self.start(VISIT_MAX_MIN="0.15")
        port = self.port(p)
        t = time.monotonic()
        self.finish(p, timeout=30)
        self.assertLess(time.monotonic() - t, 12)
        with self.assertRaises(urllib.error.URLError):                 # the clip server is gone with the WiFi
            self.get(port, "/api/hello")
        self.assertPutBack()

    def test_a_wifi_that_drops_and_stays_down_ends_the_visit(self):
        p = self.start(VISIT_MAX_MIN="0.5")   # checked every 3 s
        self.port(p)
        self.net.set("ap_fail")
        self.net.set("active", "")
        out = self.finish(p, timeout=40)
        self.assertIn("went down", out)
        self.assertPutBack()

    def test_one_visit_at_a_time(self):
        p = self.start()
        port = self.port(p)
        out = self.visit()
        self.assertIn("already running", out)
        self.assertEqual(self.get(port, "/api/hello")[0], 200)       # the first is untouched
        self.post(port, "/api/done", {})
        self.finish(p)

    def test_stopping_the_unit_puts_everything_back(self):
        p = self.start()
        self.port(p)
        p.send_signal(signal.SIGTERM)
        self.finish(p, timeout=30)
        self.assertPutBack()

    def test_end_ends_it(self):
        p = self.start()
        self.port(p)
        r = subprocess.run([sys.executable, "-B", str(NODE / "life-visit.py"), "end"], env=self.env, capture_output=True, text=True, timeout=30)
        self.assertIn("ends now", r.stdout)
        self.finish(p, timeout=30)
        self.assertPutBack()

    def test_a_boot_visit_sends_the_node_back_to_sleep(self):
        p = self.start("boot")
        port = self.port(p)
        self.post(port, "/api/done", {})
        out = self.finish(p)
        self.assertEqual(self.net.lines("window.log"), ["stop --unless-maintenance"])
        self.assertIn("powering off", out)
        self.assertEqual(self.last()["reason"], "boot")

    def test_a_radio_that_was_on_stays_on(self):
        self.net.set("radio", "enabled")
        p = self.start()
        self.post(self.port(p), "/api/done", {})
        self.finish(p)
        self.assertEqual(self.net.read("radio").strip(), "enabled")
        self.assertNotIn(["radio", "wifi", "off"], self.net.nmcli())

    def test_visits_off(self):
        out = self.visit(LIFE_VISIT="0")
        self.assertIn("visits are off", out)
        self.assertEqual(self.net.nmcli(), [])


class Settings(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.state = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def apply(self, answer) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, "-B", str(NODE / "life-visit.py"), "apply"], input=answer if isinstance(answer, str) else json.dumps(answer),
                              env={"PATH": os.environ["PATH"], "LIFE_STATE": str(self.state), "PYTHONUTF8": "1"}, capture_output=True, text=True, timeout=30)

    def saved(self) -> dict | None:
        p = self.state / "visit.json"
        return json.loads(p.read_text()) if p.exists() else None

    def test_the_answer_is_kept_privately_and_never_printed(self):
        r = self.apply({"ok": True, "visit": {"rev": 3, "device": DEVICE, "ssid": "Sven’s iPhone", "psk": PHONE_PSK, "apPsk": AP_PSK}})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.saved(), {"rev": 3, "device": DEVICE, "ssid": "Sven’s iPhone", "psk": PHONE_PSK, "apPsk": AP_PSK})
        self.assertEqual((self.state / "visit.json").stat().st_mode & 0o777, 0o600)
        self.assertNotIn(PHONE_PSK, r.stdout + r.stderr)
        self.assertNotIn(AP_PSK, r.stdout + r.stderr)

    def test_what_cannot_be_used_is_left_out(self):
        self.apply({"visit": {"rev": 4, "device": "x;rm", "ssid": "a" * 33, "psk": "short", "apPsk": "ünïcode-password"}})
        self.assertEqual(self.saved(), {"rev": 4})
        self.apply({"visit": {"rev": 5, "ssid": "line\nbreak", "psk": "x" * 64}})
        self.assertEqual(self.saved(), {"rev": 5})

    def test_an_answer_without_settings_changes_nothing(self):
        self.apply({"visit": {"rev": 1, "device": DEVICE}})
        for answer in ("", "not json", "[]", "{}", {"visit": None}, {"visit": {"rev": "2"}}, {"visit": {"rev": True}}, {"maintenance": None}):
            self.assertEqual(self.apply(answer).returncode, 0)
        self.assertEqual(self.saved(), {"rev": 1, "device": DEVICE})

    def test_status_without_passwords(self):
        self.apply({"visit": {"rev": 3, "device": DEVICE, "ssid": "hotspot", "psk": PHONE_PSK, "apPsk": AP_PSK}})
        r = subprocess.run([sys.executable, "-B", str(NODE / "life-visit.py"), "status", "--json"],
                           env={"PATH": os.environ["PATH"], "LIFE_STATE": str(self.state), "VISIT_RUN": str(self.state / "run"), "LIFE_VISIT": "1"},
                           capture_output=True, text=True, timeout=30)
        s = json.loads(r.stdout)
        self.assertEqual((s["enabled"], s["rev"], s["hotspot"], s["ownWifi"], s["ownWifiReady"], s["running"]), (True, 3, "hotspot", "life-x7k2qp", True, None))
        self.assertNotIn(PHONE_PSK, r.stdout)
        self.assertNotIn(AP_PSK, r.stdout)


class FakeTime:
    def __init__(self):
        self.t = 1000.0

    def sleep(self, s):
        self.t += s

    def monotonic(self):
        return self.t

    def time(self):
        return self.t


class Contact(unittest.TestCase):
    """The watcher reads the contact once a second (on a fake clock here) and starts a visit for a magnet held three."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.net = Net(Path(self._tmp.name))
        self.old = dict(os.environ)
        os.environ.update({"PATH": f"{self.net.bin}:{os.environ['PATH']}", "FAKE_NET": str(self.net.dir), "LIFE_VISIT": "1", "LIFE_VISIT_PIN": "22"})

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.old)
        self._tmp.cleanup()

    def watch(self, levels: str, **env) -> int:
        """Run the watcher over `levels` (one character per second: 1 magnet, 0 none); the visits it started."""
        os.environ.update(env)
        loader = importlib.machinery.SourceFileLoader(f"life_visit_{random.random()}", str(NODE / "life-visit.py"))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        mod = importlib.util.module_from_spec(spec)
        loader.exec_module(mod)
        clock, seq = FakeTime(), iter(levels)
        self.net.set("pin22", next(seq))

        def sleep(s):
            clock.t += s
            self.net.set("pin22", next(seq, "0"))
        clock.sleep = sleep
        mod.time = clock
        mod.watch(rounds=len(levels) - 1)
        return self.net.lines("systemctl.log").count("start --no-block life-visit@magnet.service")

    def test_a_magnet_held_starts_one_visit(self):
        self.assertEqual(self.watch("0011100000"), 1)
        self.assertIn("set 22 ip pn", self.net.lines("pinctrl.log"))

    def test_left_on_the_box_it_starts_no_second(self):
        self.assertEqual(self.watch("0" + "1" * 30), 1)

    def test_a_knock_is_no_visit(self):
        self.assertEqual(self.watch("01101101010"), 0)

    def test_the_magnet_that_woke_the_node_is_not_a_second_visit(self):
        self.assertEqual(self.watch("1111110111"), 1)                 # only once it has gone and come back

    def test_held_again_later_starts_another(self):
        self.assertEqual(self.watch("0111000000111"), 2)

    def test_no_contact_fitted_reads_nothing(self):
        self.assertEqual(self.watch("0111", LIFE_VISIT_PIN=""), 0)
        self.assertEqual(self.net.lines("pinctrl.log"), [])


if __name__ == "__main__":
    unittest.main()
