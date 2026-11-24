"""Tests for node/apply-models.sh: what it refuses, and the config edit that puts the models on the bird sources.

    python3 -B -m unittest discover -s node/tests -v

Standard library only. The script's own BirdNET-Go install needs a node; these check the parts that do not.
"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "apply-models.sh"
CONFIG = """models:
    enabled:
        - birdnet
        - perch_v2
        - bat
realtime:
    audio:
        sources:
            - name: I2S microphone
              device: ":0,0"
              gain: 0
              models:
                - birdnet
                - perch_v2
              quietHours:
                enabled: false
            - name: I2S witness
              device: ":0,0"
              models:
                - birdnet
              quietHours:
                enabled: false
            - name: Bat microphone
              device: ":1,0"
              models:
                - bat
              quietHours:
                enabled: false
"""
WANT = ["birdnet", "perch_v2", "birdnet_plus_v3.0"]


class Edit(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        src = SCRIPT.read_text()
        self.code = self.root / "edit.py"
        self.code.write_text(src[src.index("<<'PY2'\n") + 8:src.index("\nPY2\n")])
        self.cfg = self.root / "config.yaml"
        self.cfg.write_text(CONFIG)

    def tearDown(self):
        self.tmp.cleanup()

    def edit(self) -> str:
        r = subprocess.run([sys.executable, "-I", str(self.code), str(self.cfg), *WANT], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.strip()

    def models_of(self, name: str) -> list[str]:
        lines, out = self.cfg.read_text().split("\n"), []
        k = lines.index(f"            - name: {name}")
        j = lines.index("              models:", k) + 1
        while lines[j].startswith("                - "):
            out.append(lines[j].strip()[2:]); j += 1
        return out

    def test_every_bird_source_gets_the_three_and_nothing_else_changes(self):
        self.assertIn("birdnet_plus_v3.0", self.edit())
        text = self.cfg.read_text()
        self.assertIn("        - bat\n        - birdnet_plus_v3.0\n", text)          # models.enabled, the bat model kept
        self.assertEqual(self.models_of("I2S microphone"), WANT)
        self.assertEqual(self.models_of("I2S witness"), ["birdnet"])                 # the check keeps BirdNET alone
        self.assertEqual(self.models_of("Bat microphone"), ["bat"])

    def test_a_second_run_changes_nothing(self):
        self.edit()
        once = self.cfg.read_text()
        self.assertIn("already", self.edit())
        self.assertEqual(self.cfg.read_text(), once)


class Refuses(unittest.TestCase):
    def run_script(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(["bash", str(SCRIPT), *args], capture_output=True, text=True, timeout=60,
                              env={**os.environ, "BIRDNET_CONFIG": str(SCRIPT)})

    def test_without_a_tarball(self):
        r = self.run_script()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("usage", r.stdout)

    def test_without_agreeing_to_the_policy(self):
        with tempfile.NamedTemporaryFile(suffix=".tar.gz") as f:
            r = self.run_script(f.name, "--dry-run")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--accept-birdnet-aup", r.stdout)

    def test_a_tarball_that_is_not_the_release(self):
        with tempfile.NamedTemporaryFile(suffix=".tar.gz") as f:
            f.write(b"not birdnet-go"); f.flush()
            r = self.run_script(f.name, "--accept-birdnet-aup", "--dry-run")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("not BirdNET-Go 20261122 as published", r.stdout)


if __name__ == "__main__":
    unittest.main()
