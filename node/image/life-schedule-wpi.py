#!/usr/bin/env python3
"""The listening schedule of a Life node, for its own place and this day (content/spec.md, section 2.2).

One rule for every node and every year, and the only hours the oracle's readings count:

    March to October      4 h from civil dawn and 1 h from sunset
    November to February  2 h from civil dawn

The node listens to exactly these windows, so its effort is the same on every day of a season (until 13 October 2026
the dawn window was 6 h in May to July and a node added extra hours when its battery allowed; one length all season is
easier to read and leaves the battery more slack). Every morning window starts at civil dawn (until 4 November 2026 the
winter one started at sunrise, after the busiest half hour of a winter morning). Why these hours: a year of four Dutch 24-hour BirdNET stations
replayed against every schedule, and the battery simulated hour by hour on PVGIS weather for 2005 to 2023
(content/spec.md).

They are written as rules, built in here as METHOD and on the oracle as METHOD_RULES (src/lib/listening.ts): a length
from a moment of the sun (civil dawn, sunrise, solar noon, sunset, civil dusk) or of the clock, in some months. The
oracle sends its rules with its answer to a heartbeat and life-config keeps them in LIFE_CONFIG, so a new version of
the method reaches every node without a visit; a node without them, or with rules it cannot read, keeps the built-in
ones. A rule is {"name": "dawn", "months": "3-10", "from": "dawn", "min": 240}, with months as "3-10", "11-2" (over the
new year), "6" or a list, from one of dawn, sunrise, noon, sunset, dusk or clock ("at": "05:30", local time), an
"offset" in minutes from that moment (-240 to 240) and the length "min" (15 to 720). A node takes rules only when every
month has a window, so it wakes every day, and no month holds more than 16 hours; windows of a day that overlap become
one (far north, where the sun sets within three hours of civil dawn, that one runs on to the dawn window's end).

On top of these the place's owner may turn on a night window for meadow birds (grutto, kievit and watersnip call most
in the first hours of darkness): by default from 1 h to 2 h after sunset, 25 March to 30 June, set on the node's page
on the oracle and kept here by life-window in night.json. It never overlaps the windows above, ends at least MERGE
before the next day's first one, and the readings never count it, so a node with it is read exactly like one without.
With its battery option, life-window lets it run only while the battery holds the owner's minimum.

The Witty Pi script is anchored on the first window of the day that holds --now (a boot after midnight, before the
first window, still belongs to the previous day), and its states run exactly to the next day's first window, whatever
that day's rule is, so the first of March and the first of November switch cleanly. Windows less than MERGE apart are
one ON state: the night window right after the dusk window is listened through, not a shutdown and a boot. life-schedule
rewrites the script at every boot, so the drift of the sun is never more than a day old. All arithmetic is in UTC: two
datetimes that share a ZoneInfo subtract as wall-clock times, which would put the last Sunday of October an hour out.

    life-schedule-wpi [--now 2026-06-21T23:30]               the Witty Pi script
    life-schedule-wpi --windows [--now 2026-06-21T06:00]     the day's windows as JSON, the one --now falls in, the
                                                             start of the next one and the night window's settings
                                                             (life-window uses it)

    life-schedule-wpi --check RULES.json                     whether a node takes these rules, and what they give
                                                             here on the longest and the shortest day

env: NODE_LAT, NODE_LON (a node without them gets the middle of the Netherlands), NODE_TZ (default Europe/Amsterdam),
     each read from LIFE_ENV (default /data/life-node/env) when the environment lacks it, as in a unit made with
     systemd-run; LIFE_STATE (default /data/life-node), LIFE_NIGHT (default $LIFE_STATE/night.json), LIFE_CONFIG
     (default $LIFE_STATE/config.json, life-config's)
"""
import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from astral import Observer
from astral.sun import dawn, dusk, noon, sunrise, sunset


def _env_file(path: str) -> dict:
    """KEY=value lines of the node's env file; the last one of a key wins, as for systemd and the shell."""
    out = {}
    try:
        for line in Path(path).read_text().splitlines():
            m = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", line.strip())
            if m:
                out[m.group(1)] = m.group(2).split(" #")[0].strip().strip("'\"")
    except OSError:
        pass
    return out


_FILE = _env_file(os.environ.get("LIFE_ENV", "/data/life-node/env"))


def setting(key: str) -> str:
    v = os.environ.get(key)
    return v if v is not None else _FILE.get(key, "")


LAT = float(setting("NODE_LAT") or 52.37)
LON = float(setting("NODE_LON") or 5.0)
TZ = ZoneInfo(setting("NODE_TZ") or "Europe/Amsterdam")
H = timedelta(hours=1)
obs = Observer(latitude=LAT, longitude=LON)
CONFIG = Path(os.environ.get("LIFE_CONFIG") or Path(os.environ.get("LIFE_STATE") or "/data/life-node") / "config.json")

# the method's rules (content/spec.md 2.2), the same as METHOD_RULES in src/lib/listening.ts (npm run config:test)
METHOD = [
    {"name": "dawn", "months": "3-10", "from": "dawn", "min": 240},
    {"name": "dusk", "months": "3-10", "from": "sunset", "min": 60},
    {"name": "winter", "months": "11-2", "from": "dawn", "min": 120},
]
ANCHORS = {"dawn": (dawn, 5), "sunrise": (sunrise, 8), "noon": (noon, 12), "sunset": (sunset, 21), "dusk": (dusk, 22)}
NAME = re.compile(r"[a-z][a-z0-9-]{0,15}")
MAX_RULES = 8
MAX_DAY_MIN = 16 * 60
EARLY = timedelta(minutes=10)   # a boot this much before a window still belongs to it (RTC drift, a slow boot)
MERGE = timedelta(minutes=15)   # windows closer than this are listened through: a shutdown and a boot cost more
MIN = timedelta(minutes=1)
NIGHT_FILE = Path(os.environ.get("LIFE_NIGHT") or Path(os.environ.get("LIFE_STATE") or "/data/life-node") / "night.json")
# the night window as it is until the owner turns it on: the oracle's defaults (src/lib/node-night.ts)
NIGHT = {"rev": -1, "on": False, "startMin": 60, "lenMin": 60, "from": "03-25", "to": "06-30", "battery": True, "minV": 13.1}


def season_month(d: date) -> int:
    """The month the rule follows: south of the equator the seasons are six months on."""
    return d.month if LAT >= 0 else (d.month + 5) % 12 + 1


def at(fn, d: date, fallback_hour: int) -> datetime:
    try:
        return fn(obs, d, tzinfo=TZ).astimezone(timezone.utc)
    except ValueError:  # no civil dawn or no sunset that day (far north): a fixed local hour
        return datetime(d.year, d.month, d.day, fallback_hour, tzinfo=TZ).astimezone(timezone.utc)


def months_of(v) -> frozenset:
    """"3-10" -> March to October, "11-2" -> November to February, "6" -> June, [4, 5] -> April and May."""
    if isinstance(v, list) and v and all(isinstance(m, int) and not isinstance(m, bool) and 1 <= m <= 12 for m in v):
        return frozenset(v)
    if isinstance(v, str):
        m = re.fullmatch(r"(\d{1,2})(?:-(\d{1,2}))?", v.strip())
        if m:
            a, b = int(m.group(1)), int(m.group(2) or m.group(1))
            if 1 <= a <= 12 and 1 <= b <= 12:
                return frozenset(((a - 1 + i) % 12) + 1 for i in range((b - a) % 12 + 1))
    raise ValueError(f"months {v!r}: say 3-10, 11-2, 6 or a list of month numbers")


def parse_rule(r) -> dict:
    if not isinstance(r, dict):
        raise ValueError("a rule is an object")
    name = r.get("name")
    if not isinstance(name, str) or not NAME.fullmatch(name):
        raise ValueError(f"name {name!r}: a to z, digits and -, at most 16, starting with a letter")
    frm = r.get("from")
    if frm not in (*ANCHORS, "clock"):
        raise ValueError(f"{name}: from {frm!r} is none of {', '.join((*ANCHORS, 'clock'))}")
    at_ = None
    if frm == "clock":
        m = re.fullmatch(r"([01]\d|2[0-3]):([0-5]\d)", str(r.get("at", "")))
        if not m:
            raise ValueError(f"{name}: a clock window needs at, as HH:MM")
        at_ = (int(m.group(1)), int(m.group(2)))
    off, length = r.get("offset", 0), r.get("min")
    for k, v, lo, hi in (("offset", off, -240, 240), ("min", length, 15, 720)):
        if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
            raise ValueError(f"{name}: {k} {v!r} must be a whole number of minutes from {lo} to {hi}")
    return {"name": name, "months": months_of(r.get("months")), "from": frm, "at": at_, "offset": off, "min": length}


def parse_rules(rules) -> list:
    """The rules a node takes, or ValueError saying why not. Every month must have a window, so the node wakes every
    day; no month may hold more than MAX_DAY_MIN minutes of them."""
    if not isinstance(rules, list) or not 1 <= len(rules) <= MAX_RULES:
        raise ValueError(f"the windows are a list of 1 to {MAX_RULES} rules")
    out = [parse_rule(r) for r in rules]
    names = [r["name"] for r in out]
    if len(set(names)) != len(names):
        raise ValueError("two rules have the same name")
    for m in range(1, 13):
        total = sum(r["min"] for r in out if m in r["months"])
        if total == 0:
            raise ValueError(f"no window in month {m}: the node would not wake")
        if total > MAX_DAY_MIN:
            raise ValueError(f"month {m} holds {total / 60:g} h of windows, more than {MAX_DAY_MIN // 60}")
    return out


_rules = None
SOURCE = "built in"


def rules() -> list:
    """The method's rules as the oracle last sent them (life-config keeps them in LIFE_CONFIG), else the built-in ones."""
    global _rules, SOURCE
    if _rules is None:
        _rules = parse_rules(METHOD)
        try:
            cur = json.loads(CONFIG.read_text()).get("current") or {}
            if cur.get("windows") is not None:
                _rules = parse_rules(cur["windows"])
                SOURCE = f"from the oracle, {cur.get('rev', '?')}"
        except FileNotFoundError:
            pass
        except Exception as e:  # noqa: BLE001 - rules the node cannot read: the built-in ones keep it listening
            print(f"life-schedule-wpi: the oracle's windows in {CONFIG} cannot be read ({e}); using the built-in ones",
                  file=sys.stderr)
    return _rules


def anchor(r: dict, d: date) -> datetime:
    if r["from"] == "clock":
        return datetime(d.year, d.month, d.day, *r["at"], tzinfo=TZ).astimezone(timezone.utc)
    fn, fallback = ANCHORS[r["from"]]
    return at(fn, d, fallback)


def core_windows(d: date, rule_list: list | None = None) -> list[dict]:
    """The listening windows of local date d that the readings count: name, start and end (UTC), from the method's
    rules. Two that overlap become one (a day too short for both: from dawn to the end of the later one)."""
    m = season_month(d)
    ws = []
    for r in rule_list if rule_list is not None else rules():
        if m in r["months"]:
            s = anchor(r, d) + timedelta(minutes=r["offset"])
            ws.append({"name": r["name"], "start": s, "end": s + timedelta(minutes=r["min"])})
    ws.sort(key=lambda w: w["start"])
    out = []
    for w in ws:
        if out and w["start"] <= out[-1]["end"]:
            out[-1]["end"] = max(out[-1]["end"], w["end"])
            out[-1]["name"] += "+" + w["name"]
        else:
            out.append(dict(w))
    return out


def month_day(s: object) -> tuple[int, int]:
    """'03-25' as (3, 25); anything that is not a day of the year raises ValueError (29 February is one)."""
    if not isinstance(s, str) or len(s) != 5 or s[2] != "-":
        raise ValueError(f"not a month and day: {s!r}")
    m, d = int(s[:2]), int(s[3:])
    date(2024, m, d)
    return m, d


def in_season(d: date, frm: str, to: str) -> bool:
    """Whether d falls from frm to to, both included; a season may run over the new year."""
    a, b, x = month_day(frm), month_day(to), (d.month, d.day)
    return a <= x <= b if a <= b else (x >= a or x <= b)


def night_config() -> dict:
    """The night window as the owner set it (life-window apply keeps the oracle's answer in night.json), each value held
    to the range the oracle allows: a missing or damaged file is the default, which is off."""
    try:
        raw = json.loads(NIGHT_FILE.read_text())
        if not isinstance(raw, dict):
            raise ValueError("not an object")
        c = {"rev": int(raw.get("rev", -1)), "on": raw.get("on") is True,
             "startMin": min(max(int(raw.get("startMin", NIGHT["startMin"])), 0), 360),
             "lenMin": min(max(int(raw.get("lenMin", NIGHT["lenMin"])), 15), 180),
             "from": raw.get("from", NIGHT["from"]), "to": raw.get("to", NIGHT["to"]),
             "battery": raw.get("battery") is not False,   # only an explicit no lets it run on any battery
             "minV": round(min(max(float(raw.get("minV", NIGHT["minV"])), 12.0), 14.0), 2)}
        month_day(c["from"]), month_day(c["to"])
        return c
    except (OSError, ValueError, TypeError):
        return dict(NIGHT)


def night(d: date, core: list[dict], c: dict) -> dict | None:
    """The night window of local date d when the owner turned it on and d is in its season: startMin after sunset for
    lenMin, starting no earlier than the end of the day's last core window and ending MERGE before the next day's first.
    What that leaves of it under 15 minutes, the shortest the owner can set, is no window (a boot costs more)."""
    if not c["on"] or not in_season(d, c["from"], c["to"]):
        return None
    s = at(sunset, d, 21) + c["startMin"] * MIN
    e = s + c["lenMin"] * MIN
    s = max(s, core[-1]["end"])
    e = min(e, core_windows(d + timedelta(days=1))[0]["start"] - MERGE)
    if e - s < 15 * MIN:
        return None
    return {"name": "night", "start": s, "end": e}


def windows(d: date) -> list[dict]:
    """The listening windows of local date d: the core windows and, when it is on and in season, the night window."""
    ws = core_windows(d)
    n = night(d, ws, night_config())
    return ws + [n] if n else ws


def cycle_day(now: datetime) -> date:
    """The local date whose first window began most recently (or is about to begin, within EARLY)."""
    d = now.astimezone(TZ).date()
    if now < core_windows(d)[0]["start"] - EARLY:
        d -= timedelta(days=1)
    return d


def span(t: timedelta) -> str:
    s = max(int(round(t.total_seconds())), 1)
    return f"H{s // 3600} M{s % 3600 // 60} S{s % 60}"


def script(now: datetime) -> str:
    d = cycle_day(now)
    ws, nxt = windows(d), core_windows(d + timedelta(days=1))[0]["start"]
    spans: list[list[datetime]] = []   # windows less than MERGE apart are one ON state
    for w in ws:
        if spans and w["start"] - spans[-1][1] < MERGE:
            spans[-1][1] = max(spans[-1][1], w["end"])
        else:
            spans.append([w["start"], w["end"]])
    states = []
    for i, (start, stop) in enumerate(spans):
        follow = spans[i + 1][0] if i + 1 < len(spans) else nxt
        end = min(stop, follow - MIN)
        states += [("ON", end - start), ("OFF", follow - end)]
    f = "%Y-%m-%d %H:%M:%S"
    loc = lambda t: t.astimezone(TZ)  # noqa: E731 - the comment lines, for people
    utc = lambda t: t.astimezone(timezone.utc)  # noqa: E731 - BEGIN and END: the Witty Pi's scripts run in UTC
    desc = "; ".join(f"{w['name']} {loc(w['start']):%H:%M}-{loc(w['end']):%H:%M}" for w in ws)
    out = [f"# Life node listening schedule at {LAT:.4f}, {LON:.4f} ({TZ.key}), written by life-schedule at every boot; method windows {SOURCE}",
           f"# {d}: {desc}; next start {loc(nxt):%Y-%m-%d %H:%M}",
           f"BEGIN\t{utc(ws[0]['start']).strftime(f)}",
           f"END\t{utc(ws[0]['start'] + timedelta(days=30)).strftime(f)}"]
    out += [f"{s}\t{span(t)}" for s, t in states]
    return "\n".join(out)


def window_info(now: datetime) -> dict:
    d = cycle_day(now)
    ws = windows(d)
    active = next((w for w in ws if w["start"] - EARLY <= now < w["end"]), None)
    nxt = next(w["start"] for w in ws + windows(d + timedelta(days=1)) if w["start"] - EARLY > now)
    iso = lambda t: t.isoformat(timespec="seconds")  # noqa: E731
    out = lambda w: {"name": w["name"], "start": iso(w["start"]), "end": iso(w["end"])}  # noqa: E731
    return {"date": d.isoformat(), "now": iso(now), "windows": [out(w) for w in ws],
            "active": None if active is None else out(active), "next": iso(nxt), "night": night_config(), "rules": SOURCE}


def check(path: str) -> int:
    """For people: would a node take these rules, and what do they give at this place?"""
    try:
        raw = json.loads(Path(path).read_text())
        rs = parse_rules(raw.get("windows") if isinstance(raw, dict) else raw)
    except (OSError, ValueError) as e:
        print(json.dumps({"ok": False, "why": str(e)}))
        return 1
    y = datetime.now(TZ).year
    days = {"longest": date(y, 6, 21), "shortest": date(y, 12, 21)} if LAT >= 0 else {"longest": date(y, 12, 21), "shortest": date(y, 6, 21)}
    show = {k: [f"{w['name']} {w['start'].astimezone(TZ):%H:%M}-{w['end'].astimezone(TZ):%H:%M}" for w in core_windows(d, rs)] for k, d in days.items()}
    print(json.dumps({"ok": True, "rules": len(rs), **show}))
    return 0


def main() -> None:
    args = sys.argv[1:]
    if "--check" in args:
        sys.exit(check(args[args.index("--check") + 1]))
    now = datetime.now(timezone.utc)
    if "--now" in args:
        now = datetime.fromisoformat(args[args.index("--now") + 1]).replace(tzinfo=TZ).astimezone(timezone.utc)
    if "--windows" in args:
        print(json.dumps(window_info(now)))
    else:
        print(script(now))


if __name__ == "__main__":
    main()
