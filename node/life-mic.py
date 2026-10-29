#!/usr/bin/env python3
"""Life node microphones: the AudioMoth USB Microphone and the I2S one, and what BirdNET-Go runs on each.

    life-mic setup             before BirdNET-Go starts: the AudioMoth at its rate, BirdNET-Go's config to match
    life-mic sync              every five minutes (life-mic.timer): the same, and BirdNET-Go restarted when its config
                               changed, which on a node that stays on is the bat model coming or going with the sun
    life-mic status [--json]   what is plugged in, the mode, and what BirdNET-Go is told

Three ways to listen, chosen with LIFE_BIRD_MIC:
- `i2s` (the default): birds on the I2S microphone, and the AudioMoth beside it as the bat microphone, a second source
  "Bat microphone" that runs only the bat model and is quiet from an hour before sunrise until BAT_LEAD_MIN minutes
  before sunset, so it never runs in the dawn window;
- `audiomoth`: the AudioMoth is the node's one microphone. One source, "AudioMoth", runs the bird models all the time
  and adds the bat model from BAT_LEAD_MIN minutes before sunset until just before civil dawn. The I2S source is taken
  out;
- `both`: the comparison of the two. Birds on the I2S microphone as in `i2s`, and on the AudioMoth BirdNET by day and
  only the bat model at night, so the processor carries no more than in `i2s`: the bat model alone keeps a Pi 4 about
  90 per cent busy (`kit/bench-log.csv`, 1.5). With LIFE_TEST_SOURCES=AudioMoth in the node's env, life-push marks the
  AudioMoth's bird detections as test, so the oracle keeps them for the comparison and counts them nowhere. BirdNET-Go
  keeps one pause per species for all its sources together (`realtime.interval`, 15 s): with both microphones on the
  bird model, the first to report a bird takes it, and the other's detection of the same bird is never saved, even when
  the first was a faint test detection and the second a sure one that would have counted. So `both` sets the pause to 0
  while the AudioMoth hears birds, and the pause goes back to BirdNET-Go's 15 s when that ends.

Why one source and not two on the AudioMoth: BirdNET-Go refuses two sources on one device, and its own
`bat.nighttimeonly` waits for civil dusk, 35 to 50 minutes into the hour after sunset in which the bats come out. So
the bat model is switched in the source's list of models instead. A node on its schedule boots into each window with
the right list: the evening window starts at sunset and gets the bat model from its first minute, the dawn window
starts at civil dawn and never gets it, so the bat model does not compete with the dawn chorus for the processor. A
node that stays on across the switch (on the bench, on mains, started by hand) gets it from `sync`, which restarts
BirdNET-Go once, about half a minute without listening.

What setup does at every boot:
- looks for the AudioMoth USB Microphone on USB (vendor 16d0, product 06f3). With the board's switch on USB/OFF it
  shows up as AudioMoth's configuration device instead (10c4:0002) and is no microphone; setup says so. The switch
  belongs on DEFAULT;
- if it reports another rate than BAT_SAMPLE_RATE, sets it with Open Acoustic Devices' command-line tool and stores
  that in the microphone (persist), so later boots find it set and nothing is written to its flash again;
- finds the microphone's ALSA card, and the card of the I2S microphone, because the two can swap numbers;
- writes BirdNET-Go's config for the mode: the bat model among the enabled models when its files are there, and the
  sources described above. Without the microphone, the node falls back to the I2S microphone for its birds, and
  without the model files or with LIFE_BATS=0 the bats are left out, so a node runs on whatever it has.

192 kHz covers the bats of the Netherlands, whose calls stay under about 90 kHz; BirdNET-Go resamples to the 256 kHz
its bat model was trained on and to the 48 kHz of the bird model, and 192 kHz is half the data of 384 kHz for the Pi.

Every change goes into BirdNET-Go's config only if it differs, and setup never stops BirdNET-Go from starting: when
something is not as expected it says so and leaves that part out.

env: LIFE_BIRD_MIC (i2s | audiomoth | both), LIFE_BATS (1; 0 takes the bats out), BAT_SAMPLE_RATE (192000),
     BAT_LEAD_MIN (15), NODE_LAT, NODE_LON, NODE_TZ (the place and its clock, as for the schedule),
     BAT_MODEL_DIR (/data/birdnet-go/models/bat), AUDIOMOTH_CMD (/usr/local/bin/AudioMoth-USB-Microphone),
     BIRDNET_DIR (/data/birdnet-go), BIRDNET_CONFIG, LIFE_MIC_RESTART_CMD (systemctl try-restart birdnet-go.service),
     LIFE_MIC_NOW (an ISO time, for tests), LIFE_BATS_PROC (/proc), LIFE_BATS_SYS (/sys), LIFE_BATS_WAIT_S (20)
"""
import json
import math
import os
import re
import shlex
import subprocess
import sys
import time
from datetime import date, datetime, timedelta, timezone
from datetime import time as clock
from pathlib import Path
from zoneinfo import ZoneInfo

MODES = ("i2s", "audiomoth", "both")
MODE = (os.environ.get("LIFE_BIRD_MIC") or "i2s").strip().lower()
ON = os.environ.get("LIFE_BATS", "1").strip() != "0"
RATE = int(os.environ.get("BAT_SAMPLE_RATE") or 192000)
LEAD = int(os.environ.get("BAT_LEAD_MIN") or 15)
DAWN_QUIET = 60  # minutes before sunrise the bat source goes quiet in mode i2s: before civil dawn in every season
LAT = float(os.environ.get("NODE_LAT") or 52.37)
LON = float(os.environ.get("NODE_LON") or 5.0)
TZ = ZoneInfo(os.environ.get("NODE_TZ") or "Europe/Amsterdam")
BNG = Path(os.environ.get("BIRDNET_DIR", "/data/birdnet-go"))
CONFIG = Path(os.environ.get("BIRDNET_CONFIG") or BNG / "config.yaml")
MODELS = Path(os.environ.get("BAT_MODEL_DIR") or BNG / "models" / "bat")
CMD = os.environ.get("AUDIOMOTH_CMD", "/usr/local/bin/AudioMoth-USB-Microphone")
RESTART = os.environ.get("LIFE_MIC_RESTART_CMD", "systemctl try-restart birdnet-go.service")
PROC = Path(os.environ.get("LIFE_BATS_PROC", "/proc"))
SYS = Path(os.environ.get("LIFE_BATS_SYS", "/sys"))
WAIT_S = float(os.environ.get("LIFE_BATS_WAIT_S") or 20)
USB_ID = ("16d0", "06f3")
SETUP_ID = ("10c4", "0002")  # the same board with its switch on USB/OFF: AudioMoth's own configuration mode
SOURCE = "Bat microphone"    # the AudioMoth as the bat microphone only (mode i2s)
MOTH = "AudioMoth"           # the AudioMoth as the node's microphone (modes audiomoth and both)
I2S = "I2S microphone"       # the name of a bird source this program writes itself
MIN_RATE = 96000  # BirdNET-Go's floor for its bat model
BIRD_RATE = 48000  # what the bird model listens at; below it the AudioMoth is no bird microphone either
PAUSE = 15  # BirdNET-Go's own realtime.interval: seconds between two saved detections of one species, all sources


def say(msg: str) -> None:
    print(f"life-mic: {msg}", flush=True)


# --- the sun: when the bat model runs ---

def sun_crossing(d: date, altitude: float, rising: bool) -> datetime | None:
    """When the sun's centre crosses `altitude` degrees on day d at the node, rising or setting (UTC). The sunrise
    equation as NOAA simplifies it, good to a minute or two; None on a day the sun never crosses that altitude."""
    j = (d - date(2000, 1, 1)).days - LON / 360  # mean solar noon, in days from 2000-01-01 12:00 UTC
    m = math.radians((357.5291 + 0.98560028 * j) % 360)
    c = 1.9148 * math.sin(m) + 0.02 * math.sin(2 * m) + 0.0003 * math.sin(3 * m)
    lam = math.radians((math.degrees(m) + c + 180 + 102.9372) % 360)
    noon = j + 0.0053 * math.sin(m) - 0.0069 * math.sin(2 * lam)
    dec = math.asin(math.sin(lam) * math.sin(math.radians(23.4397)))
    phi = math.radians(LAT)
    cos_w = (math.sin(math.radians(altitude)) - math.sin(phi) * math.sin(dec)) / (math.cos(phi) * math.cos(dec))
    if not -1 <= cos_w <= 1:
        return None
    w = math.degrees(math.acos(cos_w)) / 360
    return datetime(2000, 1, 1, 12, tzinfo=timezone.utc) + timedelta(days=noon - w if rising else noon + w)


def now() -> datetime:
    t = os.environ.get("LIFE_MIC_NOW")
    if not t:
        return datetime.now(timezone.utc)
    t = datetime.fromisoformat(t)
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def bat_time(t: datetime) -> bool:
    """From LEAD minutes before sunset until ten minutes before civil dawn at the node: the evening window whole, the
    dawn window not at all. The margins are wider than the minute or two by which this sum and the schedule's sun can
    differ, so a node waking for a window never finds the list about to change. Where the sun does not set or rise
    that day, from 21:00 to 05:00 local time, as the schedule falls back."""
    local = t.astimezone(TZ)
    d = local.date()
    sunset = sun_crossing(d, -0.833, False) or datetime.combine(d, clock(21), TZ)
    dawn = sun_crossing(d, -6.0, True) or datetime.combine(d, clock(5), TZ)
    return t >= sunset - timedelta(minutes=LEAD) or t < dawn - timedelta(minutes=10)


# --- the hardware ---

def usb_state() -> str | None:
    """'mic' when the microphone is plugged in (whatever ALSA has made of it yet), 'switch' when an AudioMoth is
    plugged in with its switch on USB/OFF, where it is no microphone at all, else None."""
    found = None
    for dev in (SYS / "bus" / "usb" / "devices").glob("*"):
        try:
            ids = ((dev / "idVendor").read_text().strip(), (dev / "idProduct").read_text().strip())
        except OSError:
            continue
        if ids == USB_ID:
            return "mic"
        if ids == SETUP_ID:
            try:
                if "audiomoth" in (dev / "product").read_text().lower():
                    found = "switch"
            except OSError:
                pass
    return found


def on_usb() -> bool:
    return usb_state() == "mic"


def cards() -> dict[int, dict]:
    """ALSA cards that can record: their USB id (None for the I2S microphone) and the rate a USB one offers."""
    out = {}
    for d in sorted((PROC / "asound").glob("card[0-9]*")):
        n = int(d.name[4:])
        if not (d / "pcm0c").exists():
            continue  # playback only (HDMI)
        usbid = (d / "usbid").read_text().strip().lower() if (d / "usbid").exists() else None
        rate = None
        if (d / "stream0").exists():
            capture = (d / "stream0").read_text().split("Capture:", 1)
            m = re.search(r"Rates:\s*(\d+)", capture[1]) if len(capture) > 1 else None
            rate = int(m.group(1)) if m else None
        out[n] = {"usbid": usbid, "rate": rate}
    return out


def find_cards() -> tuple[int | None, int | None, int | None, set[int]]:
    """(microphone's card, its rate, bird card, all recording cards). The bird card is the one recording card that is
    not on USB, if exactly one is: the I2S microphone on the standard node."""
    cs = cards()
    moth = next((n for n, c in cs.items() if c["usbid"] == ":".join(USB_ID)), None)
    others = [n for n, c in cs.items() if c["usbid"] is None]
    return moth, (cs[moth]["rate"] if moth is not None else None), (others[0] if len(others) == 1 else None), set(cs)


def wait_for(cond, seconds: float):
    """Poll until cond() returns something true, at most `seconds`; returns its last value."""
    end = time.monotonic() + seconds
    while True:
        v = cond()
        if v or time.monotonic() >= end:
            return v
        time.sleep(0.5)


def tool(*args: str) -> bool:
    try:
        r = subprocess.run([CMD, *args], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired) as e:
        say(f"{Path(CMD).name} {' '.join(args)} failed: {e}")
        return False
    out = (r.stdout + r.stderr).strip().replace("\n", " | ")
    ok = r.returncode == 0 and "[ERROR]" not in out and "No AudioMoth" not in out
    say(f"{Path(CMD).name} {' '.join(args)}: {out or r.returncode}")
    return ok


def set_rate(card: int | None, rate: int | None) -> tuple[int | None, int | None]:
    """Bring the microphone to RATE if it is elsewhere and the tool is there. Returns (card, rate) as found after."""
    if rate == RATE:
        return card, rate
    if not Path(CMD).exists():
        say(f"the microphone reports {rate} Hz and {CMD} is not installed; set it once to {RATE // 1000} kHz "
            f"with the AudioMoth USB Microphone app or `AudioMoth-USB-Microphone config {RATE}` and `... persist`")
        return card, rate
    if tool("config", str(RATE)):
        # the microphone comes back on USB with the new rate in its descriptors
        def ready():
            c, r, _, _ = find_cards()
            return (c, r) if c is not None and r == RATE else None
        found = wait_for(ready, WAIT_S)
        if found:
            tool("persist")
            card, rate = wait_for(ready, WAIT_S) or found
            return card, rate
        card, rate, _, _ = find_cards()
        say(f"after config the microphone reports {rate} Hz on card {card}")
    return card, rate


# --- BirdNET-Go's config.yaml: block-style YAML, edited line by line so its layout and comments survive ---
# (the same rules as life-clips: keys compared in lower case, a top-level block is never invented)

KEY = re.compile(r"^(\s*)([A-Za-z0-9_]+):(?:[ \t]|$)")
VALUE = re.compile(r"^(\s*[A-Za-z0-9_]+:[ \t]*)([^#\n]*?)([ \t]*(?:#.*)?)$")
DEVICE = re.compile(r'^(\s*(?:-\s+)?device:\s*)["\']?:(\d+),(\d+)["\']?\s*$')


def ind(line: str) -> int:
    return len(line) - len(line.lstrip())


def yaml_find(lines: list[str], path: tuple[str, ...]) -> int | None:
    want = [k.lower() for k in path]
    stack: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        body = line.lstrip()
        if not body or body.startswith("#"):
            continue
        n = ind(line)
        if body.startswith("- "):
            while stack and stack[-1][0] >= n:
                stack.pop()
            stack.append((n, "-"))
            continue
        m = KEY.match(line)
        if not m:
            continue
        while stack and stack[-1][0] >= n:
            stack.pop()
        stack.append((n, m.group(2).lower()))
        if [k for _, k in stack] == want:
            return i
    return None


def yaml_set(lines: list[str], path: tuple[str, ...], value: str) -> str:
    """Set a scalar in place, or add it at the top of its existing block. 'same', 'set', 'added' or 'missing'."""
    i = yaml_find(lines, path)
    if i is not None:
        m = VALUE.match(lines[i])
        if not m:
            return "missing"
        if m.group(2).strip().strip("'\"") == value.strip("'\""):
            return "same"
        lines[i] = m.group(1) + value + m.group(3)
        return "set"
    p = yaml_find(lines, path[:-1]) if len(path) > 1 else None
    if p is None:
        return "missing"
    child = next((ind(l) for l in lines[p + 1:] if l.strip() and not l.lstrip().startswith("#")), ind(lines[p]) + 4)
    lines.insert(p + 1, " " * max(child, ind(lines[p]) + 2) + f"{path[-1]}: {value}")
    return "added"


def list_span(lines: list[str], path: tuple[str, ...]):
    """The block list under the key at `path`: (key line, item indent, [(start, end)] per item, end of list)."""
    k = yaml_find(lines, path)
    if k is None:
        return None
    kind, items, item_ind, i = ind(lines[k]), [], None, k + 1
    while i < len(lines):
        line = lines[i]
        body = line.lstrip()
        if not body or body.startswith("#"):
            i += 1
            continue
        n = ind(line)
        if item_ind is None:
            if not body.startswith("- ") or n < kind:
                break
            item_ind = n
        if body.startswith("- ") and n == item_ind:
            items.append([i, i + 1])
        elif n > item_ind and items:
            items[-1][1] = i + 1
        else:
            break
        i += 1
    end = items[-1][1] if items else k + 1
    return k, (item_ind if item_ind is not None else kind + 4), [tuple(s) for s in items], end


def item_name(lines: list[str], span) -> str | None:
    m = re.match(r"^\s*-\s+name:\s*(.*?)\s*$", lines[span[0]])
    return m.group(1).strip("'\"") if m else None


def item_card(lines: list[str], span) -> tuple[int, int, int] | None:
    """(line, card, device) of a source's ALSA device written as ":card,device"; None for any other kind of source."""
    for j in range(span[0], span[1]):
        m = DEVICE.match(lines[j])
        if m:
            return j, int(m.group(2)), int(m.group(3))
    return None


def item_models(lines: list[str], span) -> list[str]:
    """The models a source lists under `models:`."""
    out, inside = [], None
    for j in range(span[0], span[1]):
        body = lines[j].strip()
        if inside is None:
            if re.match(r"^(?:-\s+)?models:\s*$", body):
                inside = ind(lines[j]) + (2 if body.startswith("- ") else 0)
            continue
        if body.startswith("- ") and ind(lines[j]) > inside:
            out.append(body[2:].strip().strip("'\""))
        elif body:
            break
    return out


def quiet_off(c: str) -> list[str]:
    return [f"{c}enabled: false", f'{c}mode: ""', f'{c}startTime: ""', f'{c}endTime: ""', f'{c}startEvent: ""',
            f"{c}startOffset: 0", f'{c}endEvent: ""', f"{c}endOffset: 0"]


def bat_source(i: int, card: int, rate: int) -> list[str]:
    a, b, c = " " * i, " " * (i + 2), " " * (i + 4)
    return [f"{a}- name: {SOURCE}", f'{b}device: ":{card},0"', f"{b}samplerate: {rate}", f"{b}gain: 0",
            f"{b}models:", f"{c}- bat", f"{b}quietHours:", f"{c}enabled: true", f"{c}mode: solar",
            f'{c}startTime: ""', f'{c}endTime: ""', f"{c}startEvent: sunrise", f"{c}startOffset: -{DAWN_QUIET}",
            f"{c}endEvent: sunset", f"{c}endOffset: -{LEAD}"]


def moth_source(i: int, card: int, rate: int, models: list[str]) -> list[str]:
    a, b, c = " " * i, " " * (i + 2), " " * (i + 4)
    return ([f"{a}- name: {MOTH}", f'{b}device: ":{card},0"', f"{b}samplerate: {rate}", f"{b}gain: 0",
             f"{b}models:"] + [f"{c}- {m}" for m in models] + [f"{b}quietHours:"] + quiet_off(c))


def i2s_source(i: int, card: int, models: list[str]) -> list[str]:
    a, b, c = " " * i, " " * (i + 2), " " * (i + 4)
    return ([f"{a}- name: {I2S}", f'{b}device: ":{card},0"', f"{b}gain: 0", f"{b}models:"]
            + [f"{c}- {m}" for m in models] + [f"{b}quietHours:"] + quiet_off(c))


def model_files() -> dict | None:
    """The three files BirdNET-Go's bat model needs, if they are all there."""
    clf = sorted(MODELS.glob("BattyBirdNET-*_fp32.onnx"))
    lab = sorted(MODELS.glob("BattyBirdNET-*_Labels.txt"))
    emb = MODELS / "birdnet-v24-embeddings.onnx"
    if clf and lab and emb.exists():
        return {"embeddingmodel": emb, "classifiermodel": clf[0], "labelpath": lab[0]}
    return None


def configure(text: str, card: int | None, rate: int | None, files: dict | None, bird: int | None = None,
              moth: int | None = None, recording: set[int] | None = None, mode: str = "i2s",
              night: bool = False) -> tuple[str, list[str]]:
    """BirdNET-Go's config for the mode. `card` and `rate` are the AudioMoth's when it can be used (else None),
    `files` the bat model's (None leaves the bats out), `bird` the I2S card, `night` whether it is bat time.
    Returns (text, changes)."""
    lines, did = text.split("\n"), []
    usable = card is not None and rate is not None
    bats = usable and files is not None and rate >= MIN_RATE
    moth_birds = mode in ("audiomoth", "both") and usable and rate >= BIRD_RATE

    # the bat model's files, and no waiting for civil dusk (the source's quiet hours or its list of models do that)
    if bats:
        for key, path in files.items():
            what = yaml_set(lines, ("bat", key), str(path))
            if what == "missing":
                return text, ["no bat: block in this BirdNET-Go's config (older than 20260823?); microphones left as they are"]
            if what != "same":
                did.append(f"bat.{key} {what}")
        if yaml_set(lines, ("bat", "nighttimeonly"), "false") not in ("same", "missing"):
            did.append("bat.nighttimeonly false")

    # the enabled models; the bird models are all of them but the bat model
    span = list_span(lines, ("models", "enabled"))
    if span is None:
        if bats or moth_birds:
            return text, ["no models.enabled list in BirdNET-Go's config; microphones left as they are"]
        enabled = []
    else:
        k, i, items, end = span
        enabled = [lines[s[0]].strip()[2:].strip().strip("'\"") for s in items]
        bat_items = [s for s in items if lines[s[0]].strip() in ("- bat", '- "bat"', "- 'bat'")]
        if bats and not bat_items:
            lines.insert(end, " " * i + "- bat")
            did.append("models.enabled + bat")
        elif not bats and bat_items:
            for s in reversed(bat_items):
                del lines[s[0]:s[1]]
            did.append("models.enabled - bat")
    birds = [m for m in enabled if m != "bat"] or ["birdnet"]

    # one pause per species for every source together: two microphones on the bird model would take each other's
    # detections, so in `both` each keeps its own (pause 0), and BirdNET-Go's 15 s comes back after; a pause someone
    # set by hand to anything but 0 is left as it is
    own = mode == "both" and moth_birds
    j = yaml_find(lines, ("realtime", "interval"))
    m = VALUE.match(lines[j]) if j is not None else None
    pause = m.group(2).strip().strip("'\"") if m else None
    if own and pause != "0" and yaml_set(lines, ("realtime", "interval"), "0") in ("set", "added"):
        did.append("realtime.interval 0: each microphone keeps its own detections of a bird")
    elif not own and pause == "0" and yaml_set(lines, ("realtime", "interval"), str(PAUSE)) == "set":
        did.append(f"realtime.interval {PAUSE} again: one microphone on the bird model")

    # the audio sources
    span = list_span(lines, ("realtime", "audio", "sources"))
    if span is None:
        did.append("no realtime.audio.sources list; sources not written")
        return "\n".join(lines), did
    k, i, items, end = span
    want_bat = mode == "i2s" and bats            # the AudioMoth as the bat microphone only
    want_moth = moth_birds                       # the AudioMoth as a bird (and bat) microphone
    want_i2s = mode != "audiomoth" or not moth_birds  # in audiomoth mode the I2S source is only the fallback
    if mode == "both":  # one model at a time beside the I2S microphone's: the processor has no room for more
        moth_models = ["bat"] if bats and night else ["birdnet" if "birdnet" in birds else birds[0]]
    else:
        moth_models = birds + (["bat"] if bats and night else [])
    have = {SOURCE: False, MOTH: False, "i2s": False}
    for s in reversed(items):  # from the end, so a change never moves an item still to be looked at
        name = item_name(lines, s)
        if name in (SOURCE, MOTH):
            keep = want_bat if name == SOURCE else want_moth
            if keep and not have[name]:
                block = bat_source(i, card, rate) if name == SOURCE else moth_source(i, card, rate, moth_models)
                if lines[s[0]:s[1]] != block:
                    old = item_models(lines, s)
                    lines[s[0]:s[1]] = block
                    if name == MOTH and old != moth_models and old:
                        did.append(f"{MOTH} models {'+'.join(moth_models)}")
                    else:
                        did.append(f"{name} updated")
                have[name] = True
            else:  # not wanted, or a duplicate from a hand edit
                del lines[s[0]:s[1]]
                did.append(f"{name} removed")
            continue
        dev = item_card(lines, s)
        if dev is None:
            continue  # a stream or a file: not a microphone of this node's
        j, n, sub = dev
        if not want_i2s:
            del lines[s[0]:s[1]]
            did.append(f"{name} removed: the AudioMoth hears the birds")
            continue
        have["i2s"] = True
        if bird is not None and n != bird and (n == moth or (recording is not None and n not in recording)):
            m = DEVICE.match(lines[j])
            lines[j] = f'{m.group(1)}":{bird},{sub}"'
            did.append(f"{name} device :{bird},{sub}")
    span = list_span(lines, ("realtime", "audio", "sources"))
    end = span[3]
    add: list[str] = []
    if want_i2s and not have["i2s"] and bird is not None:
        add += i2s_source(i, bird, birds)
        did.append(f"{I2S} added on :{bird},0")
    if want_moth and not have[MOTH]:
        add += moth_source(i, card, rate, moth_models)
        did.append(f"{MOTH} added on :{card},0 at {rate} Hz with {'+'.join(moth_models)}")
    if want_bat and not have[SOURCE]:
        add += bat_source(i, card, rate)
        did.append(f"{SOURCE} added on :{card},0 at {rate} Hz")
    lines[end:end] = add
    return "\n".join(lines), did


# --- commands ---

def look(wait: bool) -> tuple[int | None, int | None, dict | None, int | None, int | None, set[int]]:
    """(the AudioMoth's card and rate when it can be used, the bat files, the bird card, its card, recording cards)."""
    card = rate = None
    files = model_files()
    state = usb_state()
    plugged = state == "mic"
    if plugged and wait:  # at boot ALSA can be a second behind USB
        wait_for(lambda: find_cards()[0] is not None, WAIT_S)
    moth, moth_rate, bird, recording = find_cards()
    wanted = (ON and files is not None) or MODE != "i2s"
    if state == "switch":
        say("the AudioMoth is plugged in with its switch on USB/OFF, where it is no microphone: move the switch to "
            "DEFAULT")
    elif not plugged:
        say("no AudioMoth USB Microphone on USB" + (", birds on the I2S microphone" if MODE != "i2s" else ""))
    elif moth is None:
        say("the microphone is on USB but ALSA has no card for it; is the cable a data cable?")
    elif wanted:
        card, rate = set_rate(moth, moth_rate)
        moth, _, bird, recording = find_cards()
        if card is None or rate is None or rate < BIRD_RATE:
            say(f"the microphone records at {rate} Hz, too low to use")
            card = rate = None
    if not ON:
        say("LIFE_BATS=0: bats out")
        files = None
    elif files is None and plugged:
        say(f"the microphone is plugged in, but the bat model files are not in {MODELS}: bats out")
    return card, rate, files, bird, moth, recording


def apply(wait: bool) -> bool:
    """Write BirdNET-Go's config for what is plugged in and the time of day. True when the file changed."""
    if MODE not in MODES:
        say(f"LIFE_BIRD_MIC={MODE} is none of {', '.join(MODES)}; microphones left as they are")
        return False
    if not CONFIG.exists():
        say(f"no BirdNET-Go config at {CONFIG}; nothing to set")
        return False
    card, rate, files, bird, moth, recording = look(wait)
    night = bat_time(now())
    text = CONFIG.read_text()
    new, did = configure(text, card, rate, files, bird, moth, recording, MODE, night)
    if new != text:
        tmp = CONFIG.with_suffix(".yaml.life-mic")
        tmp.write_text(new)
        os.replace(tmp, CONFIG)
    for d in did:
        say(d)
    bats = files is not None and card is not None and rate is not None and rate >= MIN_RATE
    if MODE == "i2s":
        say(f"bats {'on: card ' + str(card) + ', ' + str(rate) + ' Hz' if bats else 'off'}"
            + ("" if did else " (config unchanged)"))
    else:
        say(f"mode {MODE}: " + (f"the AudioMoth on card {card} at {rate} Hz, bat model "
                                f"{'on' if bats and night else 'off' if bats else 'not available'}"
                                if card is not None else "no AudioMoth")
            + ("" if new != text else " (config unchanged)"))
    return new != text


def setup() -> int:
    apply(wait=True)
    return 0


def sync() -> int:
    if apply(wait=False):
        r = subprocess.run(shlex.split(RESTART), capture_output=True, text=True)
        say(f"BirdNET-Go restarted ({RESTART}: {r.returncode})")
    return 0


def status(as_json: bool) -> int:
    card, rate, bird, _ = find_cards()
    lines = CONFIG.read_text().split("\n") if CONFIG.exists() else []
    span = list_span(lines, ("realtime", "audio", "sources")) if lines else None
    sources = {item_name(lines, s): item_models(lines, s) for s in span[2]} if span else {}
    st = {"mode": MODE, "plugged": on_usb(), "switchOff": usb_state() == "switch", "card": card, "rate": rate,
          "birdCard": bird, "modelFiles": model_files() is not None, "batTime": bat_time(now()),
          "configured": SOURCE in sources or MOTH in sources, "sources": sources, "enabled": ON}
    print(json.dumps(st) if as_json else "\n".join(f"{k}: {v}" for k, v in st.items()))
    return 0


def main(argv: list[str]) -> int:
    if argv[:1] == ["setup"]:
        return setup()
    if argv[:1] == ["sync"]:
        return sync()
    if argv[:1] == ["status"]:
        return status("--json" in argv)
    print(__doc__.strip().split("\n\n")[1])
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
