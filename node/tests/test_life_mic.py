"""Tests for node/life-mic.py: the AudioMoth found, set to its rate, and BirdNET-Go's config written for the mode.

    python3 -B -m unittest discover -s node/tests -v

Standard library only. The microphone is a fake /proc/asound and /sys tree; its command-line tool is a small script
that changes the rate the fake card reports, as the real microphone does when it comes back on USB. The config is the
layout BirdNET-Go 20260823 writes (four spaces, a list of sources), with the Perch model the image adds.
"""
import importlib.machinery
import importlib.util
import json
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

# the same config with the two blocks BirdNET-Go writes on its first run for its sound levels and its metrics page
FULL = CONFIG.replace("""        ffmpegpath: ""
""", """        ffmpegpath: ""
        soundlevel:
            enabled: false
            interval: 10
""").replace("""webserver:
""", """    telemetry:
        enabled: false
        listen: localhost:9090
webserver:
""")

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


DAY = "2026-10-21T12:00:00+02:00"      # midday
EVENING = "2026-10-21T18:40:00+02:00"  # six minutes after sunset (18:34)
DAWN = "2026-10-21T07:45:00+02:00"     # five minutes after civil dawn (07:40), in the dawn window


class Node:
    """A temporary node: /proc, /sys, BirdNET-Go's directory, the model files and the microphone's tool."""

    def __init__(self, moth_card=1, bird_card=0, rate=192000, plugged=True, files=True, tool=True, config=CONFIG):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.proc, self.sys = self.root / "proc", self.root / "sys"
        self.bng = self.root / "birdnet-go"
        self.models = self.bng / "models" / "bat"
        self.models.mkdir(parents=True)
        (self.bng / "config.yaml").write_text(config)
        self.state = self.root / "state"
        self.metrics = self.root / "metrics.txt"
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
        self.restarts = self.root / "restarts.log"
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

    def run(self, *args, on="1", mode="i2s", at=DAY, check="1", check_day="sun"):
        # every path set here, also the ones with a default: other test files leave theirs in the environment
        env = {"LIFE_BATS": on, "BIRDNET_DIR": str(self.bng), "BIRDNET_CONFIG": str(self.bng / "config.yaml"),
               "BAT_MODEL_DIR": str(self.models), "LIFE_BATS_PROC": str(self.proc),
               "LIFE_BATS_SYS": str(self.sys), "AUDIOMOTH_CMD": str(self.tool), "LIFE_BATS_WAIT_S": "1",
               "LIFE_BIRD_MIC": mode, "LIFE_MIC_NOW": at, "NODE_LAT": "52.37", "NODE_LON": "4.90",
               "NODE_TZ": "Europe/Amsterdam", "LIFE_MIC_RESTART_CMD": f"sh -c 'echo restart >> {self.restarts}'",
               "LIFE_MIC_CHECK": check, "LIFE_STATE": str(self.state), "LIFE_MIC_METRICS": self.metrics.as_uri(),
               "LIFE_MIC_SAMPLES": "1", "LIFE_MIC_SAMPLE_GAP_S": "0", "LIFE_MIC_CHECK_DAY": check_day}
        old = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        try:
            loader = importlib.machinery.SourceFileLoader("life_mic", str(NODE / "life-mic.py"))
            spec = importlib.util.spec_from_loader("life_mic", loader)
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

    def restart_count(self):
        return len(self.restarts.read_text().split()) if self.restarts.exists() else 0

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
        self.assertEqual(n.run("setup", at=EVENING), 0)
        c = n.config
        self.assertIn("        - perch_v2\n        - bat\nlowmemory:", c)
        self.assertIn("            - name: Bat microphone\n              device: \":1,0\"\n              samplerate: 192000", c)
        # no quiet hours: in BirdNET-Go one sound card in its quiet hours stops every sound card
        self.assertIn("              models:\n                - bat\n              quietHours:\n                enabled: false\n", c)
        self.assertIn(f"    embeddingmodel: {n.models}/birdnet-v24-embeddings.onnx", c)
        self.assertIn(f"    classifiermodel: {n.models}/BattyBirdNET-EU-256kHz_fp32.onnx", c)
        self.assertIn(f"    labelpath: {n.models}/BattyBirdNET-EU-256kHz_Labels.txt", c)
        self.assertIn("    nighttimeonly: false", c)
        # the bird source keeps its device and its models, and the rest of the file is untouched
        self.assertIn('            - name: Sound Card 1\n              device: ":0,0"', c)
        self.assertIn("                - birdnet\n                - perch_v2\n              quietHours:", c)
        self.assertTrue(c.endswith('webserver:\n    port: "8080"\n'))
        self.assertEqual(n.tool_calls(), [])  # already at 192 kHz: nothing sent to the microphone

    def test_by_day_the_bat_microphone_is_taken_out(self):
        n = self.node()
        n.run("setup", at=EVENING)
        self.assertIn("name: Bat microphone", n.config)
        n.run("setup", at=DAWN)
        c = n.config
        self.assertNotIn("Bat microphone", c)
        self.assertIn("        - perch_v2\n        - bat\nlowmemory:", c)  # the model stays loaded for the evening
        self.assertIn('            - name: Sound Card 1\n              device: ":0,0"', c)

    def test_second_run_changes_nothing(self):
        n = self.node()
        n.run("setup")
        first = n.config
        n.run("setup")
        self.assertEqual(n.config, first)

    def test_microphone_at_another_rate_is_set_and_persisted(self):
        n = self.node(rate=48000)
        n.run("setup", at=EVENING)
        self.assertEqual(n.tool_calls(), ["config 192000", "persist"])
        self.assertIn("samplerate: 192000", n.config)

    def test_without_the_tool_a_low_rate_keeps_bats_out(self):
        n = self.node(rate=48000, tool=False)
        n.run("setup")
        self.assertEqual(n.config, CONFIG)

    def test_without_the_tool_a_high_rate_is_used_as_it_is(self):
        n = self.node(rate=384000, tool=False)
        n.run("setup", at=EVENING)
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
        n.run("setup", at=EVENING)
        c = n.config
        self.assertIn('            - name: Sound Card 1\n              device: ":1,0"', c)
        self.assertIn('            - name: Bat microphone\n              device: ":0,0"', c)

    def test_bird_source_follows_its_card_without_the_bat_microphone(self):
        n = self.node(plugged=False, bird_card=2)
        n.run("setup")
        self.assertIn('            - name: Sound Card 1\n              device: ":2,0"', n.config)

    def test_card_change_updates_our_source(self):
        n = self.node()
        n.run("setup", at=EVENING)
        n.unplug(1)
        n.plug(2, 192000)
        n.run("setup", at=EVENING)
        c = n.config
        self.assertIn('            - name: Bat microphone\n              device: ":2,0"', c)
        self.assertEqual(c.count("Bat microphone"), 1)

    def test_switch_on_usb_off(self):
        n = self.node(plugged=False)
        dev = n.sys / "bus" / "usb" / "devices" / "1-1.3"
        dev.mkdir(parents=True)
        (dev / "idVendor").write_text("10c4\n")
        (dev / "idProduct").write_text("0002\n")
        (dev / "product").write_text("AudioMoth\n")
        n.run("setup")
        self.assertEqual(n.config, CONFIG)

    def test_status(self):
        n = self.node()
        n.run("setup")
        self.assertEqual(n.run("status", "--json"), 0)



class Modes(unittest.TestCase):
    """LIFE_BIRD_MIC=audiomoth and =both: the AudioMoth as a bird microphone, with the bat model by night."""

    def setUp(self):
        self.nodes = []

    def tearDown(self):
        for n in self.nodes:
            n.close()

    def node(self, **kw):
        n = Node(**kw)
        self.nodes.append(n)
        return n

    def test_audiomoth_by_day_hears_the_birds_alone(self):
        n = self.node()
        n.run("setup", mode="audiomoth", at=DAY)
        c = n.config
        self.assertNotIn("Sound Card 1", c)
        self.assertNotIn("Bat microphone", c)
        self.assertIn('            - name: AudioMoth\n              device: ":1,0"\n              samplerate: 192000\n'
                      "              gain: 0\n              models:\n                - birdnet\n                - perch_v2\n"
                      "              quietHours:\n                enabled: false", c)
        self.assertIn("        - perch_v2\n        - bat\nlowmemory:", c)  # the bat model loaded, for the evening
        self.assertIn("    nighttimeonly: false", c)
        self.assertTrue(c.endswith('webserver:\n    port: "8080"\n'))

    def test_evening_adds_the_bat_model(self):
        n = self.node()
        n.run("setup", mode="audiomoth", at=EVENING)
        self.assertIn("              models:\n                - birdnet\n                - perch_v2\n                - bat\n"
                      "              quietHours:", n.config)

    def test_dawn_window_has_no_bat_model(self):
        n = self.node()
        n.run("setup", mode="audiomoth", at=DAWN)
        self.assertIn("                - perch_v2\n              quietHours:", n.config)
        self.assertNotIn("                - bat\n", n.config)

    def test_both_keeps_the_i2s_birds_and_adds_the_audiomoth(self):
        n = self.node()
        n.run("setup", mode="both", at=EVENING)
        c = n.config
        self.assertIn('            - name: Sound Card 1\n              device: ":0,0"', c)
        # at night the AudioMoth runs only the bat model: the I2S microphone has the birds, the Pi no room for more
        self.assertIn('            - name: AudioMoth\n              device: ":1,0"\n              samplerate: 192000\n'
                      "              gain: 0\n              models:\n                - bat\n              quietHours:", c)
        self.assertNotIn("Bat microphone", c)

    def test_both_by_day_runs_birdnet_alone_on_the_audiomoth(self):
        n = self.node()
        n.run("setup", mode="both", at=DAWN)
        c = n.config
        self.assertIn("                - birdnet\n                - perch_v2\n              quietHours:", c)  # the I2S
        self.assertIn("              models:\n                - birdnet\n              quietHours:", c)     # the AudioMoth
        self.assertEqual(c.count("- name: AudioMoth"), 1)

    def test_from_i2s_to_both_and_back(self):
        n = self.node()
        n.run("setup", mode="i2s", at=EVENING)
        self.assertIn("name: Bat microphone", n.config)
        n.run("setup", mode="both", at=EVENING)
        self.assertNotIn("Bat microphone", n.config)
        self.assertEqual(n.config.count("- name: AudioMoth"), 1)
        self.assertIn("name: Sound Card 1", n.config)
        n.run("setup", mode="i2s", at=EVENING)
        self.assertNotIn("name: AudioMoth", n.config)
        self.assertIn("name: Bat microphone", n.config)
        self.assertIn("realtime:\n    interval: 15\n", n.config)

    def test_both_gives_each_microphone_its_own_detections(self):
        # BirdNET-Go's pause per species is shared by its sources: in `both` it goes to 0, after `both` back to 15
        n = self.node()
        n.run("setup", mode="both", at=DAWN)
        self.assertIn("realtime:\n    interval: 0\n", n.config)
        n.run("setup", mode="both", at=EVENING)  # the bat model by night changes the models, not the pause
        self.assertIn("realtime:\n    interval: 0\n", n.config)
        n.run("setup", mode="audiomoth", at=EVENING)  # one microphone on the bird model at night: the pause is back
        self.assertIn("realtime:\n    interval: 15\n", n.config)

    def test_both_without_the_audiomoth_keeps_the_pause(self):
        n = self.node(plugged=False)
        n.run("setup", mode="both", at=DAWN)
        self.assertIn("realtime:\n    interval: 15\n", n.config)

    def test_a_pause_set_by_hand_is_left_alone(self):
        n = self.node()
        (n.bng / "config.yaml").write_text(CONFIG.replace("    interval: 15\n", "    interval: 30\n"))
        n.run("setup", mode="i2s", at=DAWN)
        self.assertIn("realtime:\n    interval: 30\n", n.config)

    def test_unplugged_audiomoth_falls_back_to_the_i2s_microphone(self):
        n = self.node()
        n.run("setup", mode="audiomoth", at=DAY)
        self.assertNotIn("Sound Card 1", n.config)
        n.unplug(1)
        n.run("setup", mode="audiomoth", at=DAY)
        c = n.config
        self.assertNotIn("name: AudioMoth", c)
        self.assertIn('            - name: I2S microphone\n              device: ":0,0"\n              gain: 0\n'
                      "              models:\n                - birdnet\n                - perch_v2\n", c)
        self.assertNotIn("        - bat\n", c)

    def test_too_low_for_bats_still_hears_birds(self):
        n = self.node(rate=48000, tool=False)
        n.run("setup", mode="audiomoth", at=EVENING)
        c = n.config
        self.assertIn('            - name: AudioMoth\n              device: ":1,0"\n              samplerate: 48000', c)
        self.assertIn("                - perch_v2\n              quietHours:", c)
        self.assertNotIn("        - bat\n", c)

    def test_bats_switched_off_keep_the_audiomoth_birds(self):
        n = self.node()
        n.run("setup", mode="audiomoth", at=EVENING, on="0")
        self.assertIn("name: AudioMoth", n.config)
        self.assertNotIn("- bat\n", n.config)

    def test_unknown_mode_changes_nothing(self):
        n = self.node()
        n.run("setup", mode="stereo")
        self.assertEqual(n.config, CONFIG)

    def test_second_run_changes_nothing(self):
        n = self.node()
        n.run("setup", mode="both", at=EVENING)
        first = n.config
        n.run("setup", mode="both", at=EVENING)
        self.assertEqual(n.config, first)

    def test_status_names_the_sources(self):
        n = self.node()
        n.run("setup", mode="both", at=EVENING)
        self.assertEqual(n.run("status", "--json", mode="both", at=EVENING), 0)


class Witness(unittest.TestCase):
    """Mode audiomoth: the I2S microphone beside the AudioMoth by day, and both microphones' levels for the check."""

    def setUp(self):
        self.nodes = []

    def tearDown(self):
        for n in self.nodes:
            n.close()

    def node(self, **kw):
        n = Node(config=FULL, **kw)
        self.nodes.append(n)
        return n

    def test_by_day_the_i2s_microphone_is_the_witness(self):
        n = self.node()
        n.run("setup", mode="audiomoth", at=DAY)
        c = n.config
        self.assertIn('            - name: AudioMoth\n              device: ":1,0"\n              samplerate: 192000\n'
                      "              gain: 0\n              models:\n                - birdnet\n                - perch_v2\n", c)
        self.assertIn('            - name: I2S witness\n              device: ":0,0"\n              gain: 0\n'
                      "              models:\n                - birdnet\n              quietHours:\n                enabled: false", c)
        self.assertNotIn("Sound Card 1", c)
        self.assertIn("realtime:\n    interval: 0\n", c)                  # each microphone keeps its own detections
        self.assertIn("        soundlevel:\n            enabled: true\n", c)
        self.assertIn('    telemetry:\n        enabled: true\n        listen: "127.0.0.1:9090"\n', c)

    def test_at_night_the_witness_leaves_and_the_levels_stop(self):
        n = self.node()
        n.run("setup", mode="audiomoth", at=DAY)
        n.run("setup", mode="audiomoth", at=EVENING)
        c = n.config
        self.assertNotIn("I2S witness", c)
        self.assertIn("                - perch_v2\n                - bat\n", c)
        self.assertIn("realtime:\n    interval: 15\n", c)
        self.assertIn("        soundlevel:\n            enabled: false\n", c)
        self.assertIn("    telemetry:\n        enabled: true\n", c)    # the page stays: no restart for it at dawn
        n.run("setup", mode="audiomoth", at=DAWN)
        self.assertIn("name: I2S witness", n.config)

    def test_the_check_switched_off(self):
        n = self.node()
        n.run("setup", mode="audiomoth", at=DAY, check="0")
        c = n.config
        self.assertNotIn("I2S witness", c)
        self.assertIn("realtime:\n    interval: 15\n", c)
        self.assertIn("        soundlevel:\n            enabled: false\n", c)
        self.assertIn("    telemetry:\n        enabled: false\n", c)

    def test_without_the_audiomoth_the_i2s_microphone_hears_the_birds(self):
        n = self.node()
        n.run("setup", mode="audiomoth", at=DAY)
        n.unplug(1)
        n.run("setup", mode="audiomoth", at=DAY)
        c = n.config
        self.assertNotIn("I2S witness", c)
        self.assertIn('            - name: I2S microphone\n              device: ":0,0"', c)
        self.assertIn("realtime:\n    interval: 15\n", c)
        self.assertIn("        soundlevel:\n            enabled: false\n", c)

    def test_both_measures_both_by_day(self):
        n = self.node()
        n.run("setup", mode="both", at=DAWN)
        self.assertIn("        soundlevel:\n            enabled: true\n", n.config)
        n.run("setup", mode="both", at=EVENING)
        self.assertIn("        soundlevel:\n            enabled: false\n", n.config)

    # --- once a week ---

    SUNDAY = "2026-10-25T12:00:00+01:00"

    def learned(self, n):
        n.state.mkdir(parents=True, exist_ok=True)
        (n.state / "mic-checks.json").write_text(json.dumps({f"2026-10-0{d}": 40 for d in range(1, 6)}))

    def test_once_learned_the_witness_listens_on_the_check_day_only(self):
        n = self.node()
        self.learned(n)
        n.run("setup", mode="audiomoth", at=DAY)          # a Wednesday: the AudioMoth alone
        c = n.config
        self.assertNotIn("I2S witness", c)
        self.assertIn("realtime:\n    interval: 15\n", c)
        self.assertIn("        soundlevel:\n            enabled: false\n", c)
        n.run("setup", mode="audiomoth", at=self.SUNDAY)  # the check day
        c = n.config
        self.assertIn("name: I2S witness", c)
        self.assertIn("realtime:\n    interval: 0\n", c)
        self.assertIn("        soundlevel:\n            enabled: true\n", c)

    def test_the_check_day_can_be_another_day(self):
        n = self.node()
        self.learned(n)
        n.run("setup", mode="audiomoth", at=DAY, check_day="wed")
        self.assertIn("name: I2S witness", n.config)

    def test_a_new_node_checks_every_day_until_it_has_five_good_check_days(self):
        n = self.node()
        n.state.mkdir(parents=True, exist_ok=True)
        (n.state / "mic-checks.json").write_text(json.dumps({"2026-10-01": 40, "2026-10-02": 3, "2026-10-03": 40,
                                                             "2026-10-04": 40, "2026-10-05": 40}))
        n.run("setup", mode="audiomoth", at=DAY)          # four good days and one with three readings: still learning
        self.assertIn("name: I2S witness", n.config)

    def test_the_comparison_measures_every_day(self):
        n = self.node()
        self.learned(n)
        n.run("setup", mode="both", at=DAY)
        self.assertIn("        soundlevel:\n            enabled: true\n", n.config)

    def test_levels_count_the_check_day(self):
        n = self.node()
        n.run("setup", mode="audiomoth", at=DAY)
        self.page(n, 1)
        n.run("levels", mode="audiomoth", at=DAY)
        self.assertEqual(json.loads((n.state / "mic-checks.json").read_text()), {"2026-10-21": 1})

    # --- life-mic levels ---

    LABELS = {250: "250.0_Hz", 500: "500.0_Hz", 1000: "1.0_kHz", 2000: "2.0_kHz", 4000: "4.0_kHz", 8000: "8.0_kHz",
              12500: "12.5_kHz"}

    @staticmethod
    def sid(card):
        import hashlib
        return "audio_card_" + hashlib.sha256(f":{card},0".encode()).hexdigest()[:8]

    def page(self, n, updates, moth=-40.0, i2s=-75.0, with_i2s=True):
        lines = ["# HELP myaudio_octave_band_mean_db Mean sound level", "# TYPE myaudio_octave_band_mean_db gauge"]
        mics = [(self.sid(1), moth, updates)] + ([(self.sid(0), i2s, updates + 100)] if with_i2s else [])
        for sid, level, upd in mics:
            lines.append(f'myaudio_sound_level_updates_total{{name="{sid}",source="{sid}"}} {upd}')
            for hz, label in list(self.LABELS.items()) + [(25, "25.0_Hz")]:
                lines.append(f'myaudio_octave_band_mean_db{{frequency_band="{label}",name="{sid}",source="{sid}"}} {level + hz / 1000}')
                lines.append(f'myaudio_octave_band_min_db{{frequency_band="{label}",name="{sid}",source="{sid}"}} {level - 20}')
        n.metrics.write_text("\n".join(lines) + "\n")

    def summary(self, n):
        return json.loads((n.state / "mics.json").read_text())

    def test_levels_give_the_day_its_difference(self):
        n = self.node()
        n.run("setup", mode="audiomoth", at=DAY)
        self.page(n, 1)
        n.run("levels", mode="audiomoth", at=DAY)
        self.page(n, 2, moth=-38.0)
        n.run("levels", mode="audiomoth", at=DAY)
        d = self.summary(n)
        self.assertEqual(d["day"], "2026-10-21")
        self.assertEqual(d["n"], 2)
        self.assertEqual(d["bands"], [250, 500, 1000, 2000, 4000, 8000, 12500])
        self.assertEqual(d["diff"], [36.0] * 7)                       # medians of 35 and 37
        self.assertEqual(d["fi"], [-95.0] * 7)
        self.assertNotIn("missing", d)
        rows = (n.state / "mic-levels" / "2026-10-21.jsonl").read_text().splitlines()
        self.assertEqual(len(rows), 2)

    def test_the_same_ten_seconds_are_read_once(self):
        n = self.node()
        n.run("setup", mode="audiomoth", at=DAY)
        self.page(n, 5)
        n.run("levels", mode="audiomoth", at=DAY)
        n.run("levels", mode="audiomoth", at=DAY)
        self.assertEqual(self.summary(n)["n"], 1)

    def test_a_microphone_that_gives_no_levels_is_reported(self):
        n = self.node()
        n.run("setup", mode="audiomoth", at=DAY)
        for k in range(3):
            self.page(n, k, with_i2s=False)
            n.run("levels", mode="audiomoth", at=DAY)
            self.assertEqual("missing" in self.summary(n), k == 2)   # three runs, a quarter of an hour
        self.assertEqual(self.summary(n)["missing"], ["i2s"])

    def test_no_levels_with_one_microphone(self):
        n = self.node()
        n.run("setup", mode="i2s", at=DAY)
        self.page(n, 1)
        n.run("levels", mode="i2s", at=DAY)
        self.assertFalse((n.state / "mics.json").exists())

    def test_sync_reads_the_levels_unless_it_restarted_birdnet_go(self):
        n = self.node()
        n.run("setup", mode="audiomoth", at=DAY)
        self.page(n, 1)
        n.run("sync", mode="audiomoth", at=DAY)
        self.assertEqual(n.restart_count(), 0)
        self.assertEqual(self.summary(n)["n"], 1)


class Sync(unittest.TestCase):
    """life-mic sync: BirdNET-Go restarted when the list of models changes with the sun, and only then."""

    def test_restart_only_when_the_config_changes(self):
        n = Node()
        try:
            n.run("setup", mode="audiomoth", at=DAY)
            n.run("sync", mode="audiomoth", at=DAY)
            self.assertEqual(n.restart_count(), 0)
            n.run("sync", mode="audiomoth", at=EVENING)
            self.assertEqual(n.restart_count(), 1)
            self.assertIn("                - bat\n              quietHours:", n.config)
            n.run("sync", mode="audiomoth", at=EVENING)
            self.assertEqual(n.restart_count(), 1)
            n.run("sync", mode="audiomoth", at=DAWN)
            self.assertEqual(n.restart_count(), 2)
            self.assertNotIn("                - bat\n", n.config)
        finally:
            n.close()


class Sun(unittest.TestCase):
    """When the bat model runs: from fifteen minutes before sunset until ten minutes before civil dawn."""

    def bat_time(self, local):
        env = {"NODE_LAT": "52.37", "NODE_LON": "4.90", "NODE_TZ": "Europe/Amsterdam"}
        old = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        try:
            loader = importlib.machinery.SourceFileLoader("life_mic_sun", str(NODE / "life-mic.py"))
            spec = importlib.util.spec_from_loader("life_mic_sun", loader)
            mod = importlib.util.module_from_spec(spec)
            loader.exec_module(mod)
            from datetime import datetime
            return mod.bat_time(datetime.fromisoformat(local))
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    def test_midsummer(self):
        # Amsterdam, 21 June: sunset 22:06, civil dawn 04:28 (CEST)
        self.assertTrue(self.bat_time("2026-06-21T21:55:00+02:00"))
        self.assertFalse(self.bat_time("2026-06-21T21:45:00+02:00"))
        self.assertTrue(self.bat_time("2026-06-21T04:10:00+02:00"))
        self.assertFalse(self.bat_time("2026-06-21T04:25:00+02:00"))

    def test_midwinter(self):
        # Amsterdam, 21 December: sunset 16:28, civil dawn 08:06 (CET)
        self.assertTrue(self.bat_time("2026-12-21T16:20:00+01:00"))
        self.assertFalse(self.bat_time("2026-12-21T16:05:00+01:00"))
        self.assertTrue(self.bat_time("2026-12-21T07:50:00+01:00"))
        self.assertFalse(self.bat_time("2026-12-21T08:00:00+01:00"))

    def test_the_times_the_other_tests_use(self):
        self.assertFalse(self.bat_time(DAY))
        self.assertTrue(self.bat_time(EVENING))
        self.assertFalse(self.bat_time(DAWN))

if __name__ == "__main__":
    unittest.main()
