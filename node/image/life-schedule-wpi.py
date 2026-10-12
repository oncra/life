#!/usr/bin/env python3
"""The listening schedule of a Life node, for its own place and this day (content/spec.md, section 2.2).

The schedule has a core and extra hours. The core is the same at every node and every year, and it is the only part
of the day the oracle's readings count:

    March to October      4 h from civil dawn (6 h in May, June and July) and 1 h from sunset
    November to February  2 h from sunrise

On top of the core a node may listen longer from March to October, when its battery can carry it: the dawn window
continues to 6 h after civil dawn and the dusk window to 2 h after sunset. The Witty Pi is given these full windows;
`life-extra` ends a window at the end of its core when the battery is low at wake-up, so an overgrown panel costs
extra hours and never the core. Why these hours: a year of four Dutch 24-hour BirdNET stations replayed against every
schedule, and the battery simulated hour by hour on PVGIS weather for 2005 to 2023 (content/spec.md).

The Witty Pi script is anchored on the first window of the day that holds --now (a boot after midnight, before the
first window, still belongs to the previous day), and its states run exactly to the next day's first window, whatever
that day's rule is, so the first of March and the first of November switch cleanly. life-schedule rewrites it at
every boot, so the drift of the sun is never more than a day old. All arithmetic is in UTC: two datetimes that share
a ZoneInfo subtract as wall-clock times, which would put the last Sunday of October an hour out.

    life-schedule-wpi [--now 2026-06-21T23:30]               the Witty Pi script
    life-schedule-wpi --windows [--now 2026-06-21T06:00]     the day's windows as JSON, and the one --now falls in

env: NODE_LAT, NODE_LON (a node without them gets the middle of the Netherlands), NODE_TZ (default Europe/Amsterdam)
"""
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from astral import Observer
from astral.sun import dawn, sunrise, sunset

LAT = float(os.environ.get("NODE_LAT") or 52.37)
LON = float(os.environ.get("NODE_LON") or 5.0)
TZ = ZoneInfo(os.environ.get("NODE_TZ") or "Europe/Amsterdam")
H = timedelta(hours=1)
obs = Observer(latitude=LAT, longitude=LON)

DAWN_HOURS = 6          # the full dawn window, core and extra together
DUSK_HOURS = 2          # the full dusk window
DUSK_CORE = 1
WINTER_HOURS = 2
EARLY = timedelta(minutes=10)   # a boot this much before a window still belongs to it (RTC drift, a slow boot)


def season_month(d: date) -> int:
    """The month the rule follows: south of the equator the seasons are six months on."""
    return d.month if LAT >= 0 else (d.month + 5) % 12 + 1


def dawn_core_hours(d: date) -> int:
    return 6 if season_month(d) in (5, 6, 7) else 4


def at(fn, d: date, fallback_hour: int) -> datetime:
    try:
        return fn(obs, d, tzinfo=TZ).astimezone(timezone.utc)
    except ValueError:  # no civil dawn or no sunset that day (far north): a fixed local hour
        return datetime(d.year, d.month, d.day, fallback_hour, tzinfo=TZ).astimezone(timezone.utc)


def windows(d: date) -> list[dict]:
    """The listening windows of local date d: name, start, end of the core, end of the window (UTC)."""
    if season_month(d) in (11, 12, 1, 2):
        s = at(sunrise, d, 8)
        return [{"name": "winter", "start": s, "core_end": s + WINTER_HOURS * H, "end": s + WINTER_HOURS * H}]
    a, e = at(dawn, d, 5), at(sunset, d, 21)
    morning = {"name": "dawn", "start": a, "core_end": a + dawn_core_hours(d) * H, "end": a + DAWN_HOURS * H}
    evening = {"name": "dusk", "start": e, "core_end": e + DUSK_CORE * H, "end": e + DUSK_HOURS * H}
    if evening["start"] <= morning["end"]:  # days too short for two windows: one, from dawn to the end of the dusk
        return [{"name": "day", "start": a, "core_end": evening["core_end"], "end": evening["end"]}]
    return [morning, evening]


def cycle_day(now: datetime) -> date:
    """The local date whose first window began most recently (or is about to begin, within EARLY)."""
    d = now.astimezone(TZ).date()
    if now < windows(d)[0]["start"] - EARLY:
        d -= timedelta(days=1)
    return d


def span(t: timedelta) -> str:
    s = max(int(round(t.total_seconds())), 1)
    return f"H{s // 3600} M{s % 3600 // 60} S{s % 60}"


def script(now: datetime) -> str:
    d = cycle_day(now)
    ws, nxt = windows(d), windows(d + timedelta(days=1))[0]["start"]
    states = []
    for i, w in enumerate(ws):
        follow = ws[i + 1]["start"] if i + 1 < len(ws) else nxt
        end = min(w["end"], follow - timedelta(minutes=1))
        states += [("ON", end - w["start"]), ("OFF", follow - end)]
    f = "%Y-%m-%d %H:%M:%S"
    loc = lambda t: t.astimezone(TZ)  # noqa: E731 - BEGIN and END are read by the Witty Pi as local clock time
    desc = "; ".join(f"{w['name']} {loc(w['start']):%H:%M}-{loc(w['end']):%H:%M} (core to {loc(w['core_end']):%H:%M})" for w in ws)
    out = [f"# Life node listening schedule at {LAT:.4f}, {LON:.4f} ({TZ.key}), written by life-schedule at every boot",
           f"# {d}: {desc}; next start {loc(nxt):%Y-%m-%d %H:%M}",
           f"BEGIN\t{loc(ws[0]['start']).strftime(f)}",
           f"END\t{loc(ws[0]['start'] + timedelta(days=30)).strftime(f)}"]
    out += [f"{s}\t{span(t)}" for s, t in states]
    return "\n".join(out)


def window_info(now: datetime) -> dict:
    d = cycle_day(now)
    ws = windows(d)
    active = next((w for w in ws if w["start"] - EARLY <= now < w["end"]), None)
    iso = lambda t: t.isoformat(timespec="seconds")  # noqa: E731
    return {
        "date": d.isoformat(),
        "now": iso(now),
        "windows": [{"name": w["name"], "start": iso(w["start"]), "coreEnd": iso(w["core_end"]), "end": iso(w["end"])} for w in ws],
        "active": None if active is None else {"name": active["name"], "start": iso(active["start"]),
                                               "coreEnd": iso(active["core_end"]), "end": iso(active["end"])},
    }


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
