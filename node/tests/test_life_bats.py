"""Tests for node/life-bats.py: the bat microphone found, set to its rate, and BirdNET-Go's config written to match.

    python3 -B -m unittest discover -s node/tests -v

Standard library only. The microphone is a fake /proc/asound and /sys tree; its command-line tool is a small script
that changes the rate the fake card reports, as the real microphone does when it comes back on USB. The config is the
layout BirdNET-Go 20260823 writes (four spaces, a list of sources), with the Perch model the image adds.
"""
import importlib.machinery
import importlib.util
import os
import stat
import tempfile
import unittest
from pathlib import Path

NODE = Path(__file__).resolve().parents[1]

CONFIG = """birdnet:
    latitude: 52.38
    longitude: 4.90
perch:
    overridethreshold: false
    threshold: 0.5
bat:
    threshold: 0.5
    nighttimeonly: true
    falsepositivefilter:
        level: 2
bsg: {}
models:
    enabled:
        - birdnet
        - perch_v2
lowmemory:
    mode: auto
realtime:
    interval: 15
    audio:
        sources:
            - name: Sound Card 1
              device: ":0,0"
              gain: 0
              models:
                - birdnet
                - perch_v2
              quietHours:
                enabled: false
                mode: ""
                startTime: ""
                endTime: ""
                startEvent: ""
                startOffset: 0
                endEvent: ""
                endOffset: 0
        ffmpegpath: ""
        export:
            debug: false
            enabled: false
webserver:
    port: "8080"
"""

STREAM = """AudioMoth USB Microphone at usb-xhci-hcd.0-1.3, full speed : USB Audio

Capture:
  Status: Stop
  Interface 1
    Altset 1
    Format: S16_LE
    Channels: 1
    Endpoint: 0x81 (1 IN) (ASYNC)
    Rates: {rate}
"""


class Node:
    """A temporary node: /proc, /sys, BirdNET-Go's directory, the model files and the microphone's tool."""

    def __init__(self, moth_card=1, bird_card=0, rate=192000, plugged=True, files=True, tool=True):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.proc, self.sys = self.root / "proc", self.root / "sys"
        self.bng = self.root / "birdnet-go"
        self.models = self.bng / "models" / "bat"
        self.models.mkdir(parents=True)
        (self.bng / "config.yaml").write_text(CONFIG)
        (self.proc / "asound").mkdir(parents=True)
        (self.sys / "bus" / "usb" / "devices").mkdir(parents=True)
        self.card(bird_card, usbid=None)
        if plugged:
            self.plug(moth_card, rate)
        if files:
            for name in ("BattyBirdNET-EU-256kHz_fp32.onnx", "BattyBirdNET-EU-256kHz_Labels.txt",
                         "birdnet-v24-embeddings.onnx"):
                (self.models / name).write_text("x")
        self.log = self.root / "tool.log"
        self.tool = self.root / "AudioMoth-USB-Microphone"
        if tool:
            self.tool.write_text(f"""#!/bin/sh
echo "$@" >> {self.log}
if [ "$1" = config ]; then
  for f in {self.proc}/asound/card*/stream0; do
    [ -f "$f" ] && sed -i.bak "s/Rates: .*/Rates: $2/" "$f" && rm -f "$f.bak"
  done
  echo "Sent CONFIG command to device ID 24F3190363D79A1B."
fi
[ "$1" = persist ] && echo "Sent PERSIST command to device ID 24F3190363D79A1B."
exit 0
""")
            self.tool.chmod(self.tool.stat().st_mode | stat.S_IEXEC)

    def card(self, n, usbid, rate=None):
        d = self.proc / "asound" / f"card{n}"
        d.mkdir(parents=True, exist_ok=True)
        (d / "pcm0c").mkdir(exist_ok=True)
        if usbid:
            (d / "usbid").write_text(usbid + "\n")
            (d / "stream0").write_text(STREAM.format(rate=rate))

    def plug(self, n, rate):
        dev = self.sys / "bus" / "usb" / "devices" / "1-1.3"
        dev.mkdir(parents=True, exist_ok=True)
        (dev / "idVendor").write_text("16d0\n")
        (dev / "idProduct").write_text("06f3\n")
        self.card(n, usbid="16d0:06f3", rate=rate)

    def unplug(self, n):
        for d in (self.sys / "bus" / "usb" / "devices" / "1-1.3", self.proc / "asound" / f"card{n}"):
            for f in sorted(d.rglob("*"), reverse=True):
                f.rmdir() if f.is_dir() else f.unlink()
            d.rmdir()

    def run(self, *args, on="1"):
        env = {"LIFE_BATS": on, "BIRDNET_DIR": str(self.bng), "LIFE_BATS_PROC": str(self.proc),
               "LIFE_BATS_SYS": str(self.sys), "AUDIOMOTH_CMD": str(self.tool), "LIFE_BATS_WAIT_S": "1"}
        old = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        try:
            loader = importlib.machinery.SourceFileLoader("life_bats", str(NODE / "life-bats.py"))
            spec = importlib.util.spec_from_loader("life_bats", loader)
            mod = importlib.util.module_from_spec(spec)
            loader.exec_module(mod)
            return mod.main(list(args))
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    @property
    def config(self):
        return (self.bng / "config.yaml").read_text()

    def tool_calls(self):
        return self.log.read_text().split("\n")[:-1] if self.log.exists() else []

    def close(self):
        self.tmp.cleanup()


class Setup(unittest.TestCase):
    def setUp(self):
        self.nodes = []

    def tearDown(self):
        for n in self.nodes:
            n.close()

    def node(self, **kw):
        n = Node(**kw)
        self.nodes.append(n)
        return n

    def test_bats_in_when_plugged_and_set(self):
        n = self.node()
        self.assertEqual(n.run("setup"), 0)
        c = n.config
        self.assertIn("        - perch_v2\n        - bat\nlowmemory:", c)
        self.assertIn("            - name: Bat microphone\n              device: \":1,0\"\n              samplerate: 192000", c)
        self.assertIn("              models:\n                - bat\n              quietHours:\n                enabled: true\n"
                      "                mode: solar", c)
        self.assertIn("startEvent: sunrise", c)
        self.assertIn("endEvent: sunset", c)
        self.assertIn(f"    embeddingmodel: {n.models}/birdnet-v24-embeddings.onnx", c)
        self.assertIn(f"    classifiermodel: {n.models}/BattyBirdNET-EU-256kHz_fp32.onnx", c)
        self.assertIn(f"    labelpath: {n.models}/BattyBirdNET-EU-256kHz_Labels.txt", c)
        self.assertIn("    nighttimeonly: false", c)
        # the bird source keeps its device and its models, and the rest of the file is untouched
        self.assertIn('            - name: Sound Card 1\n              device: ":0,0"', c)
        self.assertIn("                - birdnet\n                - perch_v2\n              quietHours:", c)
        self.assertTrue(c.endswith('webserver:\n    port: "8080"\n'))
        self.assertEqual(n.tool_calls(), [])  # already at 192 kHz: nothing sent to the microphone

    def test_second_run_changes_nothing(self):
        n = self.node()
        n.run("setup")
        first = n.config
        n.run("setup")
        self.assertEqual(n.config, first)

    def test_microphone_at_another_rate_is_set_and_persisted(self):
        n = self.node(rate=48000)
        n.run("setup")
        self.assertEqual(n.tool_calls(), ["config 192000", "persist"])
        self.assertIn("samplerate: 192000", n.config)

    def test_without_the_tool_a_low_rate_keeps_bats_out(self):
        n = self.node(rate=48000, tool=False)
        n.run("setup")
        self.assertEqual(n.config, CONFIG)

    def test_without_the_tool_a_high_rate_is_used_as_it_is(self):
        n = self.node(rate=384000, tool=False)
        n.run("setup")
        self.assertIn("samplerate: 384000", n.config)

    def test_unplugged_takes_everything_out_again(self):
        n = self.node()
        n.run("setup")
        n.unplug(1)
        n.run("setup")
        c = n.config
        self.assertNotIn("Bat microphone", c)
        self.assertNotIn("        - bat\n", c)
        self.assertIn("        - birdnet\n        - perch_v2\nlowmemory:", c)

    def test_off_switch(self):
        n = self.node()
        n.run("setup")
        n.run("setup", on="0")
        self.assertNotIn("Bat microphone", n.config)
        self.assertNotIn("        - bat\n", n.config)

    def test_no_model_files_no_bats(self):
        n = self.node(files=False)
        n.run("setup")
        self.assertEqual(n.config, CONFIG)

    def test_swapped_cards_move_the_bird_source(self):
        # the USB microphone came up first and took card 0; the I2S microphone is card 1
        n = self.node(moth_card=0, bird_card=1)
        n.run("setup")
        c = n.config
        self.assertIn('            - name: Sound Card 1\n              device: ":1,0"', c)
        self.assertIn('            - name: Bat microphone\n              device: ":0,0"', c)

    def test_bird_source_follows_its_card_without_the_bat_microphone(self):
        n = self.node(plugged=False, bird_card=2)
        n.run("setup")
        self.assertIn('            - name: Sound Card 1\n              device: ":2,0"', n.config)

    def test_card_change_updates_our_source(self):
        n = self.node()
        n.run("setup")
        n.unplug(1)
        n.plug(2, 192000)
        n.run("setup")
        c = n.config
        self.assertIn('            - name: Bat microphone\n              device: ":2,0"', c)
        self.assertEqual(c.count("Bat microphone"), 1)

    def test_status(self):
        n = self.node()
        n.run("setup")
        self.assertEqual(n.run("status", "--json"), 0)


if __name__ == "__main__":
    unittest.main()
