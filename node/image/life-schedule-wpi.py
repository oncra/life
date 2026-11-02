#!/usr/bin/env python3
"""The listening schedule of a Life node, for its own place and this day (content/spec.md, section 2.2).

One rule for every node and every year, and the only hours the oracle's readings count:

    March to October      4 h from civil dawn and 1 h from sunset
    November to February  2 h from sunrise

The node listens to exactly these windows, so its effort is the same on every day of a season (until 13 October 2026
the dawn window was 6 h in May to July and a node added extra hours when its battery allowed; one length all season is
easier to read and leaves the battery more slack). Why these hours: a year of four Dutch 24-hour BirdNET stations
replayed against every schedule, and the battery simulated hour by hour on PVGIS weather for 2005 to 2023
(content/spec.md).

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

env: NODE_LAT, NODE_LON (a node without them gets the middle of the Netherlands), NODE_TZ (default Europe/Amsterdam),
     LIFE_STATE (default /data/life-node), LIFE_NIGHT (default $LIFE_STATE/night.json)
"""
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from astral import Observer
from astral.sun import dawn, sunrise, sunset

LAT = float(os.environ.get("NODE_LAT") or 52.37)
LON = float(os.environ.get("NODE_LON") or 5.0)
TZ = ZoneInfo(os.environ.get("NODE_TZ") or "Europe/Amsterdam")
H = timedelta(hours=1)
obs = Observer(latitude=LAT, longitude=LON)

DAWN_HOURS = 4          # from civil dawn, March to October
DUSK_HOURS = 1          # from sunset, March to October
WINTER_HOURS = 2        # from sunrise, November to February
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


def core_windows(d: date) -> list[dict]:
    """The listening windows of local date d that the readings count: name, start and end (UTC)."""
    if season_month(d) in (11, 12, 1, 2):
        s = at(sunrise, d, 8)
        return [{"name": "winter", "start": s, "end": s + WINTER_HOURS * H}]
    a, e = at(dawn, d, 5), at(sunset, d, 21)
    morning = {"name": "dawn", "start": a, "end": a + DAWN_HOURS * H}
    evening = {"name": "dusk", "start": e, "end": e + DUSK_HOURS * H}
    if evening["start"] <= morning["end"]:  # days too short for two windows: one, from dawn to the end of the dusk
        return [{"name": "day", "start": a, "end": evening["end"]}]
    return [morning, evening]


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
    out = [f"# Life node listening schedule at {LAT:.4f}, {LON:.4f} ({TZ.key}), written by life-schedule at every boot",
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
            "active": None if active is None else out(active), "next": iso(nxt), "night": night_config()}


def main() -> None:
    args = sys.argv[1:]
    now = datetime.now(timezone.utc)
    if "--now" in args:
        now = datetime.fromisoformat(args[args.index("--now") + 1]).replace(tzinfo=TZ).astimezone(timezone.utc)
    if "--windows" in args:
        print(json.dumps(window_info(now)))
    else:
        print(script(now))


if __name__ == "__main__":
    main()
