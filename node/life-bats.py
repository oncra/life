#!/usr/bin/env python3
"""Life node bat microphone: an AudioMoth USB Microphone beside the bird microphone, heard by BirdNET-Go's bat model.

    life-bats setup             before BirdNET-Go starts: the microphone at its rate, BirdNET-Go's config to match
    life-bats status [--json]   what is plugged in, and what BirdNET-Go is told

What setup does at every boot:
- looks for the AudioMoth USB Microphone on USB (vendor 16d0, product 06f3). With the board's switch on USB/OFF it
  shows up as AudioMoth's configuration device instead (10c4:0002) and is no microphone; setup says so. The switch
  belongs on DEFAULT;
- if it reports another rate than BAT_SAMPLE_RATE, sets it with Open Acoustic Devices' command-line tool and stores
  that in the microphone (persist), so later boots find it set and nothing is written to its flash again;
- finds the microphone's ALSA card, and the card of the I2S bird microphone, because the two can swap numbers;
- writes BirdNET-Go's config: the bat model (BattyBirdNET, its files in BAT_MODEL_DIR) among the enabled models, a
  second audio source "Bat microphone" at the microphone's rate that runs only the bat model and is quiet from
  sunrise to sunset, and the bird source on the I2S card;
- without the microphone, without the model files, or with LIFE_BATS=0, takes the bat source and the bat model out
  again, so a node without one runs exactly as before.

192 kHz covers the bats of the Netherlands, whose calls stay under about 90 kHz; BirdNET-Go resamples to the 256 kHz
its bat model was trained on, and 192 kHz is half the data of 384 kHz for the Pi to carry.

Quiet from sunrise to sunset rather than BirdNET-Go's own `bat.nighttimeonly`: that waits for civil dusk, 35 to 50
minutes after sunset, while the node's evening window is the first hour after sunset, when the bats come out. The
morning window is mostly after sunrise, so the bat model costs almost nothing there.

Every change goes into BirdNET-Go's config only if it differs, and setup never stops BirdNET-Go from starting: when
something is not as expected it says so and leaves the bats out.

env: LIFE_BATS (1; 0 takes the bats out), BAT_SAMPLE_RATE (192000), BAT_MODEL_DIR (/data/birdnet-go/models/bat),
     AUDIOMOTH_CMD (/usr/local/bin/AudioMoth-USB-Microphone), BIRDNET_DIR (/data/birdnet-go), BIRDNET_CONFIG,
     LIFE_BATS_PROC (/proc), LIFE_BATS_SYS (/sys), LIFE_BATS_WAIT_S (20)
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ON = os.environ.get("LIFE_BATS", "1").strip() != "0"
RATE = int(os.environ.get("BAT_SAMPLE_RATE") or 192000)
BNG = Path(os.environ.get("BIRDNET_DIR", "/data/birdnet-go"))
CONFIG = Path(os.environ.get("BIRDNET_CONFIG") or BNG / "config.yaml")
MODELS = Path(os.environ.get("BAT_MODEL_DIR") or BNG / "models" / "bat")
CMD = os.environ.get("AUDIOMOTH_CMD", "/usr/local/bin/AudioMoth-USB-Microphone")
PROC = Path(os.environ.get("LIFE_BATS_PROC", "/proc"))
SYS = Path(os.environ.get("LIFE_BATS_SYS", "/sys"))
WAIT_S = float(os.environ.get("LIFE_BATS_WAIT_S") or 20)
USB_ID = ("16d0", "06f3")
SETUP_ID = ("10c4", "0002")  # the same board with its switch on USB/OFF: AudioMoth's own configuration mode
SOURCE = "Bat microphone"
MIN_RATE = 96000  # BirdNET-Go's floor for its bat model


def say(msg: str) -> None:
    print(f"life-bats: {msg}", flush=True)


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


def bat_source(i: int, card: int, rate: int) -> list[str]:
    a, b, c = " " * i, " " * (i + 2), " " * (i + 4)
    return [f"{a}- name: {SOURCE}", f'{b}device: ":{card},0"', f"{b}samplerate: {rate}", f"{b}gain: 0",
            f"{b}models:", f"{c}- bat", f"{b}quietHours:", f"{c}enabled: true", f"{c}mode: solar",
            f'{c}startTime: ""', f'{c}endTime: ""', f"{c}startEvent: sunrise", f"{c}startOffset: 0",
            f"{c}endEvent: sunset", f"{c}endOffset: 0"]


def model_files() -> dict | None:
    """The three files BirdNET-Go's bat model needs, if they are all there."""
    clf = sorted(MODELS.glob("BattyBirdNET-*_fp32.onnx"))
    lab = sorted(MODELS.glob("BattyBirdNET-*_Labels.txt"))
    emb = MODELS / "birdnet-v24-embeddings.onnx"
    if clf and lab and emb.exists():
        return {"embeddingmodel": emb, "classifiermodel": clf[0], "labelpath": lab[0]}
    return None


def configure(text: str, card: int | None, rate: int | None, files: dict | None, bird: int | None = None,
              moth: int | None = None, recording: set[int] | None = None) -> tuple[str, list[str]]:
    """BirdNET-Go's config with the bats in (card, rate and files given) or out (card None). Returns (text, changes).
    A bird source whose card is the microphone's, or no recording card at all, is moved to the bird card."""
    lines, did = text.split("\n"), []
    want = card is not None and rate is not None and files is not None

    # the bat model's files, and no waiting for civil dusk (the source's quiet hours do that job)
    if want:
        for key, path in files.items():
            what = yaml_set(lines, ("bat", key), str(path))
            if what == "missing":
                return text, ["no bat: block in this BirdNET-Go's config (older than 20260823?); bats left out"]
            if what != "same":
                did.append(f"bat.{key} {what}")
        if yaml_set(lines, ("bat", "nighttimeonly"), "false") not in ("same", "missing"):
            did.append("bat.nighttimeonly false")

    # the enabled models
    span = list_span(lines, ("models", "enabled"))
    if span is None:
        if want:
            return text, ["no models.enabled list in BirdNET-Go's config; bats left out"]
    else:
        k, i, items, end = span
        bat_items = [s for s in items if lines[s[0]].strip() in ("- bat", '- "bat"', "- 'bat'")]
        if want and not bat_items:
            lines.insert(end, " " * i + "- bat")
            did.append("models.enabled + bat")
        elif not want and bat_items:
            for s in reversed(bat_items):
                del lines[s[0]:s[1]]
            did.append("models.enabled - bat")

    # the audio sources: ours added, replaced or taken out; the bird source on the I2S card
    span = list_span(lines, ("realtime", "audio", "sources"))
    if span is None:
        did.append("no realtime.audio.sources list; bat source not written")
    else:
        k, i, items, end = span
        ours = [s for s in items if item_name(lines, s) == SOURCE]
        if bird is not None:
            for s in items:
                if s in ours:
                    continue
                for j in range(s[0], s[1]):
                    m = re.match(r'^(\s*(?:-\s+)?device:\s*)["\']?:(\d+),(\d+)["\']?\s*$', lines[j])
                    if not m or int(m.group(2)) == bird:
                        continue
                    if int(m.group(2)) == moth or (recording is not None and int(m.group(2)) not in recording):
                        lines[j] = f'{m.group(1)}":{bird},{m.group(3)}"'
                        did.append(f"{item_name(lines, s)} device :{bird},{m.group(3)}")
        block = bat_source(i, card, rate) if want else []
        if ours:
            s = ours[0]
            if lines[s[0]:s[1]] != block:
                lines[s[0]:s[1]] = block
                did.append(f"{SOURCE} {'updated' if want else 'removed'}")
            for s in reversed(ours[1:]):  # a duplicate, from a hand edit
                del lines[s[0]:s[1]]
        elif want:
            lines[end:end] = block
            did.append(f"{SOURCE} added on :{card},0 at {rate} Hz")
    return "\n".join(lines), did


# --- commands ---

def setup() -> int:
    if not CONFIG.exists():
        say(f"no BirdNET-Go config at {CONFIG}; nothing to set")
        return 0
    card = rate = None
    files = model_files()
    state = usb_state()
    plugged = state == "mic"
    if plugged:  # at boot ALSA can be a second behind USB
        wait_for(lambda: find_cards()[0] is not None, WAIT_S)
    moth, moth_rate, bird, recording = find_cards()
    if not ON:
        say("LIFE_BATS=0: bats out")
    elif state == "switch":
        say("the AudioMoth is plugged in with its switch on USB/OFF, where it is no microphone: move the switch to "
            "DEFAULT. Bats out")
    elif not plugged:
        say("no AudioMoth USB Microphone on USB: bats out")
    elif files is None:
        say(f"the microphone is plugged in, but the bat model files are not in {MODELS}: bats out")
    elif moth is None:
        say("the microphone is on USB but ALSA has no card for it; is the cable a data cable? bats out")
    else:
        card, rate = set_rate(moth, moth_rate)
        moth, _, bird, recording = find_cards()
        if card is None or rate is None or rate < MIN_RATE:
            say(f"the microphone records at {rate} Hz, below the {MIN_RATE} Hz the bat model needs: bats out")
            card = None
    text = CONFIG.read_text()
    new, did = configure(text, card, rate, files, bird, moth, recording)
    if new != text:
        tmp = CONFIG.with_suffix(".yaml.life-bats")
        tmp.write_text(new)
        os.replace(tmp, CONFIG)
    for d in did:
        say(d)
    say(f"bats {'on: card ' + str(card) + ', ' + str(rate) + ' Hz' if card is not None else 'off'}"
        + ("" if did else " (config unchanged)"))
    return 0


def status(as_json: bool) -> int:
    card, rate, bird, _ = find_cards()
    lines = CONFIG.read_text().split("\n") if CONFIG.exists() else []
    span = list_span(lines, ("realtime", "audio", "sources")) if lines else None
    configured = bool(span and any(item_name(lines, s) == SOURCE for s in span[2]))
    st = {"plugged": on_usb(), "switchOff": usb_state() == "switch", "card": card, "rate": rate, "birdCard": bird, "modelFiles": model_files() is not None,
          "configured": configured, "enabled": ON}
    print(json.dumps(st) if as_json else "\n".join(f"{k}: {v}" for k, v in st.items()))
    return 0


def main(argv: list[str]) -> int:
    if argv[:1] == ["setup"]:
        return setup()
    if argv[:1] == ["status"]:
        return status("--json" in argv)
    print(__doc__.strip().split("\n\n")[1])
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
