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

The Witty Pi script is anchored on the first window of the day that holds --now (a boot after midnight, before the
first window, still belongs to the previous day), and its states run exactly to the next day's first window, whatever
that day's rule is, so the first of March and the first of November switch cleanly. life-schedule rewrites it at
every boot, so the drift of the sun is never more than a day old. All arithmetic is in UTC: two datetimes that share
a ZoneInfo subtract as wall-clock times, which would put the last Sunday of October an hour out.

    life-schedule-wpi [--now 2026-06-21T23:30]               the Witty Pi script
    life-schedule-wpi --windows [--now 2026-06-21T06:00]     the day's windows as JSON, the one --now falls in, and
                                                             the start of the next one (life-window uses it)

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

DAWN_HOURS = 4          # from civil dawn, March to October
DUSK_HOURS = 1          # from sunset, March to October
WINTER_HOURS = 2        # from sunrise, November to February
EARLY = timedelta(minutes=10)   # a boot this much before a window still belongs to it (RTC drift, a slow boot)


def season_month(d: date) -> int:
    """The month the rule follows: south of the equator the seasons are six months on."""
    return d.month if LAT >= 0 else (d.month + 5) % 12 + 1


def at(fn, d: date, fallback_hour: int) -> datetime:
    try:
        return fn(obs, d, tzinfo=TZ).astimezone(timezone.utc)
    except ValueError:  # no civil dawn or no sunset that day (far north): a fixed local hour
        return datetime(d.year, d.month, d.day, fallback_hour, tzinfo=TZ).astimezone(timezone.utc)


def windows(d: date) -> list[dict]:
    """The listening windows of local date d: name, start and end (UTC)."""
    if season_month(d) in (11, 12, 1, 2):
        s = at(sunrise, d, 8)
        return [{"name": "winter", "start": s, "end": s + WINTER_HOURS * H}]
    a, e = at(dawn, d, 5), at(sunset, d, 21)
    morning = {"name": "dawn", "start": a, "end": a + DAWN_HOURS * H}
    evening = {"name": "dusk", "start": e, "end": e + DUSK_HOURS * H}
    if evening["start"] <= morning["end"]:  # days too short for two windows: one, from dawn to the end of the dusk
        return [{"name": "day", "start": a, "end": evening["end"]}]
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
            "active": None if active is None else out(active), "next": iso(nxt)}


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
