"""Tests for node/life-config.py (settings over the air) and the rules in node/image/life-schedule-wpi.py.

    python3 -B -m unittest discover -s node/tests -v

Standard library only; the tests that compute windows need astral (python3-astral on a node) and are skipped
without it. systemctl, systemd-run, i2cget and life-wittypi are fakes that write down what they were asked.
"""
import importlib.machinery
import importlib.util
import io
import json
import os
import random
import stat
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import date, datetime, timezone
from pathlib import Path

NODE = Path(__file__).resolve().parents[1]
WPI = NODE / "image" / "life-schedule-wpi.py"
try:
    import astral  # noqa: F401
    ASTRAL = True
except ImportError:
    ASTRAL = False

FAKE = r'''#!{py}
import os, sys
name = os.path.basename(sys.argv[0])
with open(os.path.join(os.environ["FAKE_LOG"], name + ".log"), "a") as f:
    f.write(" ".join(sys.argv[1:]) + "\n")
if name == "systemctl" and sys.argv[1:2] == ["is-system-running"]:
    print("stopping" if os.environ.get("FAKE_STOPPING") else "running")
if name == "i2cget":
    v = os.environ.get("FAKE_VIN")
    if not v:
        sys.exit(1)
    whole, frac = v.split(".")
    print(hex(int(whole)) if sys.argv[-1] == "1" else hex(int(frac.ljust(2, "0")[:2])))
if name == "life-wittypi":
    print("life-wittypi: guard set")
'''

BASE_ENV = """# life-node.env
NODE_HOSTNAME=life-node-9
NODE_LAT=52.3838
NODE_LON=4.9014
LIFE_DEVICE_TOKEN=lo_dev_secret
LIFE_CLIPS_ALL_FROM=0.5
WITTYPI_LOW_V=12.6
"""
REV1, REV2, REV3 = "a1b2c3d4", "b2c3d4e5", "c3d4e5f6"
DAWN_ONLY = [{"name": "dawn", "months": "1-12", "from": "dawn", "min": 240}]


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.state = self.dir / "state"
        self.state.mkdir()
        self.env = self.state / "env"
        self.env.write_text(BASE_ENV)
        self.env.chmod(0o600)
        bin_ = self.dir / "bin"
        bin_.mkdir()
        for name in ("systemctl", "systemd-run", "i2cget", "life-wittypi"):
            (bin_ / name).write_text(FAKE.format(py=sys.executable))
            (bin_ / name).chmod(0o755)
        self.old = dict(os.environ)
        os.environ.update({"PATH": f"{bin_}:{os.environ['PATH']}", "FAKE_LOG": str(self.dir), "LIFE_STATE": str(self.state),
                           "LIFE_ENV": str(self.env), "LIFE_CONFIG": str(self.state / "config.json"), "LIFE_SCHEDULE_WPI": str(WPI),
                           "LIFE_SCHEDULE_CMD": "/usr/local/sbin/life-schedule", "WITTYPI_BUS": "1", "LIFE_WITTYPI_BIN": str(bin_ / "life-wittypi"),
                           "LIFE_BOOT_ID": "boot-1", "LIFE_NOW": "1793000000"})
        for k in ("FAKE_VIN", "FAKE_STOPPING", "NODE_LAT", "NODE_LON", "NODE_TZ"):
            os.environ.pop(k, None)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.old)
        self._tmp.cleanup()

    def cfg(self):
        loader = importlib.machinery.SourceFileLoader(f"life_config_{random.random()}", str(NODE / "life-config.py"))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        mod = importlib.util.module_from_spec(spec)
        loader.exec_module(mod)
        return mod

    def run_cfg(self, fn, *args):
        out = io.StringIO()
        with redirect_stdout(out):
            fn(*args)
        return out.getvalue()

    def apply(self, answer, **env):
        os.environ.update({k: str(v) for k, v in env.items()})
        return self.run_cfg(self.cfg().apply, answer)

    def boot(self, boot_id):
        os.environ["LIFE_BOOT_ID"] = boot_id
        return self.run_cfg(self.cfg().boot)

    def report(self):
        return self.cfg().report()

    def block(self):
        text = self.env.read_text()
        m = self.cfg()
        return m.parse_env(text[len(m.without_block(text)):]) if m.BEGIN in text else {}

    def state_(self):
        return json.loads((self.state / "config.json").read_text())

    def log(self, name):
        p = self.dir / f"{name}.log"
        return p.read_text() if p.exists() else ""


class Settings(Base):
    def test_takes_settings_into_a_block_at_the_end_of_the_env_file(self):
        out = self.apply({"config": {"rev": REV1, "env": {"LIFE_CLIPS_ALL_FROM": 0.6, "LIFE_BIRD_MIC": "Both", "VISIT_MAX_MIN": "20"}}})
        self.assertIn(f"settings {REV1} from the oracle", out)
        text = self.env.read_text()
        self.assertTrue(text.startswith(BASE_ENV), "the builder's part stays as it was")
        self.assertEqual(self.block(), {"LIFE_BIRD_MIC": "both", "LIFE_CLIPS_ALL_FROM": "0.6", "LIFE_TEST_SOURCES": "AudioMoth", "VISIT_MAX_MIN": "20"})
        self.assertEqual(stat.S_IMODE(self.env.stat().st_mode), 0o600)
        # the last value of a key counts, for the shell as for systemd
        got = subprocess.run(["bash", "-c", f"set -a; . {self.env}; echo $LIFE_CLIPS_ALL_FROM"], capture_output=True, text=True).stdout.strip()
        self.assertEqual(got, "0.6")
        st = self.state_()
        self.assertEqual(st["current"]["rev"], REV1)
        self.assertIsNotNone(st["trial"])

    def test_new_settings_replace_the_block_and_none_take_it_away(self):
        self.apply({"config": {"rev": REV1, "env": {"LIFE_CLIPS_SECONDS": 5, "LIFE_BATS": 0}}})
        os.environ["LIFE_BOOT_ID"] = "boot-2"
        self.apply({"config": {"rev": REV2, "env": {"LIFE_CLIPS_SECONDS": 9}}})
        self.assertEqual(self.block(), {"LIFE_CLIPS_SECONDS": "9"})
        os.environ["LIFE_BOOT_ID"] = "boot-3"
        self.apply({"config": {"rev": REV3, "env": {}}})
        self.assertEqual(self.env.read_text(), BASE_ENV)

    def test_a_setting_the_node_does_not_know_is_left_out_and_named(self):
        self.apply({"config": {"rev": REV1, "env": {"LIFE_DEVICE_TOKEN": "lo_dev_evil", "SCHEDULE": "none", "LIFE_API": "https://x", "LIFE_CLIPS_SECONDS": 5}}})
        self.assertEqual(self.block(), {"LIFE_CLIPS_SECONDS": "5"})
        self.assertIn("LIFE_DEVICE_TOKEN=lo_dev_secret", self.env.read_text())
        self.assertNotIn("evil", self.env.read_text())
        self.assertEqual(self.report()["cfgIgnored"], "LIFE_API,LIFE_DEVICE_TOKEN,SCHEDULE")

    def test_a_value_out_of_bounds_refuses_the_whole_set(self):
        for env in ({"LIFE_CLIPS_SECONDS": 99}, {"LIFE_MIN_CONFIDENCE": 0.2}, {"LIFE_BIRD_MIC": "usb"}, {"LIFE_CLIPS_PER_BAND": 2.5},
                    {"WITTYPI_LOW_V": 0}, {"LIFE_BATS": True}, {"OFFWINDOW_GRACE_MIN": "ten"}, {"LIFE_CLIPS_SECONDS": float("nan")}):
            with self.subTest(env=env):
                out = self.apply({"config": {"rev": REV1, "env": {"VISIT_MAX_MIN": 20, **env}}})
                self.assertIn("refused", out)
                self.assertEqual(self.env.read_text(), BASE_ENV)
                r = self.report()
                self.assertEqual((r["cfgRev"], r["cfgRefused"]), ("", REV1))
                self.assertTrue(r["cfgWhy"])
                (self.state / "config.json").unlink()

    def test_refused_settings_are_not_tried_again_until_others_come(self):
        self.apply({"config": {"rev": REV1, "env": {"LIFE_CLIPS_SECONDS": 99}}})
        out = self.apply({"config": {"rev": REV1, "env": {"LIFE_CLIPS_SECONDS": 99}}})
        self.assertIn("refused before", out)
        self.apply({"config": {"rev": REV2, "env": {"LIFE_CLIPS_SECONDS": 9}}})
        self.assertEqual(self.block(), {"LIFE_CLIPS_SECONDS": "9"})
        self.assertNotIn("cfgRefused", self.report())

    def test_no_rev_no_settings(self):
        self.apply({"config": {"env": {"LIFE_CLIPS_SECONDS": 5}}})
        self.assertEqual(self.env.read_text(), BASE_ENV)

    def test_an_answer_without_settings_changes_nothing(self):
        self.apply({"ok": True, "maintenance": None})
        self.assertFalse((self.state / "config.json").exists())
        self.assertEqual(self.env.read_text(), BASE_ENV)


class Guard(Base):
    def test_the_guard_moves_at_once(self):
        out = self.apply({"config": {"rev": REV1, "env": {"WITTYPI_LOW_V": 12.8, "WITTYPI_RECOVERY_V": 13.3}}}, FAKE_VIN="13.20")
        self.assertIn("guard set", out)
        self.assertEqual(self.block(), {"WITTYPI_LOW_V": "12.8", "WITTYPI_RECOVERY_V": "13.3"})
        self.assertTrue(self.log("life-wittypi"))

    def test_a_stop_above_the_input_now_is_refused(self):
        out = self.apply({"config": {"rev": REV1, "env": {"WITTYPI_LOW_V": 12.9}}}, FAKE_VIN="12.85")
        self.assertIn("would switch it off at once", out)
        self.assertEqual(self.env.read_text(), BASE_ENV)
        self.assertFalse(self.log("life-wittypi"))

    def test_recovery_must_clear_the_stop(self):
        out = self.apply({"config": {"rev": REV1, "env": {"WITTYPI_LOW_V": 12.8, "WITTYPI_RECOVERY_V": 12.9}}}, FAKE_VIN="13.2")
        self.assertIn("at least 0.3 V above", out)

    def test_a_guard_switched_off_at_the_node_stays_off(self):
        self.env.write_text(BASE_ENV.replace("WITTYPI_LOW_V=12.6", "WITTYPI_LOW_V=0"))
        out = self.apply({"config": {"rev": REV1, "env": {"WITTYPI_LOW_V": 12.4}}}, FAKE_VIN="12.1")
        self.assertIn("only at the node", out)
        self.assertNotIn(self.cfg().BEGIN, self.env.read_text())

    def test_nothing_moves_while_the_node_shuts_down(self):
        out = self.apply({"config": {"rev": REV1, "env": {"WITTYPI_LOW_V": 12.8}}}, FAKE_VIN="13.2", FAKE_STOPPING="1")
        self.assertIn("shutting down", out)
        self.assertEqual(self.block(), {"WITTYPI_LOW_V": "12.8"})
        self.assertFalse(self.log("life-wittypi"))


class Trial(Base):
    def test_the_next_answer_confirms_new_settings(self):
        self.apply({"config": {"rev": REV1, "env": {"LIFE_CLIPS_SECONDS": 5}}})
        self.apply({"ok": True}, LIFE_NOW="1793000030")      # the same post's run: not yet
        self.assertIsNotNone(self.state_()["trial"])
        out = self.apply({"ok": True}, LIFE_NOW="1793010800")  # the post three hours later
        self.assertIn("confirmed", out)
        self.assertIsNone(self.state_()["trial"])
        self.assertNotIn("cfgTrial", self.report())

    def test_an_answer_after_a_reboot_confirms_them(self):
        self.apply({"config": {"rev": REV1, "env": {"LIFE_CLIPS_SECONDS": 5}}})
        self.boot("boot-2")
        self.apply({"ok": True}, LIFE_BOOT_ID="boot-2", LIFE_NOW="1793000040")
        self.assertIsNone(self.state_()["trial"])

    def test_three_wakes_without_an_answer_and_the_node_goes_back(self):
        self.apply({"config": {"rev": REV1, "env": {"LIFE_CLIPS_SECONDS": 5}}})
        self.apply({"ok": True}, LIFE_BOOT_ID="boot-2")      # confirmed: the last good settings
        os.environ["LIFE_BOOT_ID"] = "boot-3"
        self.apply({"config": {"rev": REV2, "env": {"LIFE_CLIPS_SECONDS": 9, "WITTYPI_LOW_V": 12.8}}}, FAKE_VIN="13.2")
        for n, b in enumerate(("boot-4", "boot-5", "boot-6"), 1):
            out = self.boot(b)
            self.assertIn(f"wake {n} since they came", out)
            self.assertEqual(self.block()["LIFE_CLIPS_SECONDS"], "9")
        self.boot("boot-6")                                    # the same boot again (life-schedule retried): not counted
        self.assertEqual(self.state_()["trial"]["boots"], 3)
        out = self.boot("boot-7")
        self.assertIn("back to settings " + REV1, out)
        self.assertEqual(self.block(), {"LIFE_CLIPS_SECONDS": "5"})
        self.assertIn("guard set", out, "the guard goes back too")
        r = self.report()
        self.assertEqual((r["cfgRev"], r["cfgRefused"]), (REV1, REV2))
        self.assertIn("3 wakes", r["cfgWhy"])
        # offered again, they stay out; something else goes in
        self.apply({"config": {"rev": REV2, "env": {"LIFE_CLIPS_SECONDS": 9}}}, LIFE_BOOT_ID="boot-7")
        self.assertEqual(self.block(), {"LIFE_CLIPS_SECONDS": "5"})
        self.apply({"config": {"rev": REV3, "env": {"LIFE_CLIPS_SECONDS": 8}}}, LIFE_BOOT_ID="boot-7", LIFE_NOW="1793090000")
        self.assertEqual(self.block(), {"LIFE_CLIPS_SECONDS": "8"})

    def test_back_to_the_nodes_own_when_there_were_none_before(self):
        self.apply({"config": {"rev": REV1, "env": {"LIFE_CLIPS_SECONDS": 5}}})
        for b in ("b2", "b3", "b4", "b5"):
            out = self.boot(b)
        self.assertIn("the node's own settings", out)
        self.assertEqual(self.env.read_text(), BASE_ENV)
        self.assertEqual(self.report()["cfgRev"], "")

    def test_a_power_cut_between_the_two_writes_is_mended_at_boot(self):
        self.apply({"config": {"rev": REV1, "env": {"LIFE_CLIPS_SECONDS": 5}}})
        self.env.write_text(BASE_ENV)   # the env file as it was before
        out = self.boot("boot-2")
        self.assertIn("in step", out)
        self.assertEqual(self.block(), {"LIFE_CLIPS_SECONDS": "5"})


class Report(Base):
    def test_the_settings_go_up_once_after_each_change(self):
        r = self.report()
        self.assertEqual(r["cfgRev"], "")
        self.assertEqual(r["settings"], {"LIFE_CLIPS_ALL_FROM": "0.5", "WITTYPI_LOW_V": "12.6"})
        self.assertIn("settings", self.report(), "until an answer says they arrived")
        self.apply({"ok": True})
        self.assertNotIn("settings", self.report())
        self.apply({"config": {"rev": REV1, "env": {"LIFE_CLIPS_ALL_FROM": 0.7}}}, LIFE_NOW="1793000100")
        r = self.report()
        self.assertEqual((r["cfgRev"], r["cfgTrial"], r["settings"]["LIFE_CLIPS_ALL_FROM"]), (REV1, True, "0.7"))
        self.apply({"ok": True}, LIFE_NOW="1793010000")
        self.assertEqual(set(self.report()), {"cfgRev"})

    def test_the_heartbeat_carries_it(self):
        loader = importlib.machinery.SourceFileLoader(f"life_heartbeat_{random.random()}", str(NODE / "life-heartbeat.py"))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        hb = importlib.util.module_from_spec(spec)
        exe = self.dir / "life-config"
        exe.write_text(f"#!{sys.executable}\nimport json; print(json.dumps({{'cfgRev': '{REV1}', 'cfgTrial': True}}))\n")
        exe.chmod(0o755)
        os.environ.update({"LIFE_CONFIG_BIN": str(exe), "MODEM_HOST": "", "WITTYPI_BUS": "", "VEDIRECT_PORT": "none"})
        loader.exec_module(hb)
        m = hb.build("hourly")["metrics"]
        self.assertEqual((m["cfgRev"], m["cfgTrial"]), (REV1, True))
        os.environ["LIFE_CONFIG_BIN"] = str(self.dir / "absent")
        self.assertNotIn("cfgRev", hb.build("hourly")["metrics"], "a node without life-config reports nothing, so it is sent nothing")


@unittest.skipUnless(ASTRAL, "astral is not installed (python3-astral on a node)")
class Windows(Base):
    def wpi(self, **env):
        os.environ.update(env)
        loader = importlib.machinery.SourceFileLoader(f"life_schedule_wpi_{random.random()}", str(WPI))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        mod = importlib.util.module_from_spec(spec)
        loader.exec_module(mod)
        return mod

    def test_months(self):
        m = self.wpi().months_of
        self.assertEqual(sorted(m("3-10")), list(range(3, 11)))
        self.assertEqual(sorted(m("11-2")), [1, 2, 11, 12])
        self.assertEqual(sorted(m("6")), [6])
        self.assertEqual(sorted(m([4, 5])), [4, 5])
        for bad in ("13", "0-3", "x", [], [0], True):
            with self.assertRaises(ValueError):
                m(bad)

    def test_rules_a_node_refuses(self):
        p = self.wpi().parse_rules
        method = self.wpi().METHOD
        for bad, why in (([], "1 to 8"), ([{"name": "dawn", "months": "3-10", "from": "dawn", "min": 240}], "month 1"),
                         (method + [{"name": "all", "months": "6", "from": "noon", "offset": -240, "min": 720}], "more than 16"),
                         (method + [{"name": "Night", "months": "6", "from": "dusk", "min": 60}], "name"),
                         (method + [{"name": "n", "months": "6", "from": "clock", "min": 60}], "HH:MM"),
                         (method + [{"name": "n", "months": "6", "from": "moonrise", "min": 60}], "none of"),
                         (method + [{"name": "n", "months": "6", "from": "dusk", "min": 5}], "15 to 720"),
                         (method + [{"name": "n", "months": "6", "from": "dusk", "offset": 300, "min": 60}], "-240 to 240"),
                         (method + [{"name": "dawn", "months": "6", "from": "dusk", "min": 60}], "same name")):
            with self.subTest(why=why):
                with self.assertRaisesRegex(ValueError, why):
                    p(bad)

    def test_a_new_version_of_the_method_reaches_the_node(self):
        v2 = [dict(r, min=300) if r["name"] == "dawn" else r for r in self.wpi().METHOD]
        self.apply({"config": {"rev": REV1, "windows": v2, "env": {}}})
        w = self.wpi(NODE_LAT="52.3838", NODE_LON="4.9014")
        ws = w.core_windows(date(2026, 5, 15))
        self.assertEqual([x["name"] for x in ws], ["dawn", "dusk"])
        self.assertEqual((ws[0]["end"] - ws[0]["start"]).total_seconds(), 5 * 3600)
        self.assertIn(f"from the oracle, {REV1}", w.script(datetime(2026, 5, 15, 12, tzinfo=timezone.utc)))
        self.assertEqual([x["name"] for x in w.core_windows(date(2026, 12, 15))], ["winter"])

    def test_windows_that_overlap_become_one(self):
        w = self.wpi(NODE_LAT="52.3838", NODE_LON="4.9014")
        rules = w.parse_rules([{"name": "dawn", "months": "1-12", "from": "dawn", "min": 240}, {"name": "early", "months": "1-12", "from": "dawn", "offset": -60, "min": 90}])
        ws = w.core_windows(date(2026, 5, 15), rules)
        self.assertEqual(ws[0]["name"], "early+dawn")
        self.assertEqual((ws[0]["end"] - ws[0]["start"]).total_seconds(), 5 * 3600)

    def test_a_clock_window_and_the_south(self):
        rules = [{"name": "noon", "months": "1-12", "from": "clock", "at": "12:30", "min": 30}]
        w = self.wpi(NODE_LAT="-33.9", NODE_LON="18.4", NODE_TZ="Africa/Johannesburg")
        ws = w.core_windows(date(2026, 7, 1), w.parse_rules(rules))
        self.assertEqual(ws[0]["start"].astimezone(w.TZ).strftime("%H:%M"), "12:30")
        self.assertEqual(w.season_month(date(2026, 7, 1)), 1, "July is midwinter in the south: the rules read it as January")

    def test_unreadable_windows_from_the_oracle_leave_the_built_in_ones(self):
        (self.state / "config.json").write_text(json.dumps({"current": {"rev": REV1, "windows": [{"name": "x"}]}}))
        w = self.wpi(NODE_LAT="52.3838", NODE_LON="4.9014")
        self.assertEqual([x["name"] for x in w.core_windows(date(2026, 5, 15))], ["dawn", "dusk"])
        self.assertEqual(w.SOURCE, "built in")

    def test_node_place_from_the_env_file(self):
        w = self.wpi(LIFE_ENV=str(self.env))
        self.assertEqual((w.LAT, w.LON), (52.3838, 4.9014), "a unit made with systemd-run has no env file of its own")

    def test_bad_windows_refuse_the_set(self):
        out = self.apply({"config": {"rev": REV1, "windows": [{"name": "dawn", "months": "3-10", "from": "dawn", "min": 240}], "env": {"LIFE_CLIPS_SECONDS": 5}}})
        self.assertIn("would not wake", out)
        self.assertEqual(self.env.read_text(), BASE_ENV)

    def test_new_windows_write_the_schedule_again_now(self):
        v2 = [dict(r, min=300) if r["name"] == "dawn" else r for r in self.wpi().METHOD]
        out = self.apply({"config": {"rev": REV1, "windows": v2, "env": {}}})
        self.assertIn("writing the schedule again", out)
        self.assertIn("--unit=life-schedule-again --collect /usr/local/sbin/life-schedule again", self.log("systemd-run"))

    def test_the_same_windows_again_write_nothing(self):
        method = self.wpi().METHOD
        self.apply({"config": {"rev": REV1, "windows": method, "env": {}}})
        self.assertFalse(self.log("systemd-run"), "the method's windows are the built-in ones: nothing moves")
        self.apply({"config": {"rev": REV2, "windows": method, "env": {"LIFE_CLIPS_SECONDS": 5}}}, LIFE_BOOT_ID="boot-2")
        self.assertFalse(self.log("systemd-run"), "only a change of windows writes the schedule")

    def test_nothing_is_written_while_the_node_shuts_down(self):
        v2 = [dict(r, min=300) if r["name"] == "dawn" else r for r in self.wpi().METHOD]
        out = self.apply({"config": {"rev": REV1, "windows": v2, "env": {}}}, FAKE_STOPPING="1")
        self.assertIn("shutting down", out)
        self.assertFalse(self.log("systemd-run"))

    def test_a_bench_schedule_has_no_windows_to_follow(self):
        self.env.write_text(BASE_ENV + "SCHEDULE=none\n")
        v2 = [dict(r, min=300) if r["name"] == "dawn" else r for r in self.wpi().METHOD]
        out = self.apply({"config": {"rev": REV1, "windows": v2, "env": {}}})
        self.assertIn("SCHEDULE=none", out)
        self.assertFalse(self.log("systemd-run"))


if __name__ == "__main__":
    unittest.main()
