#!/usr/bin/env python3
"""Print the summer Witty Pi schedule for this node and this day: DAY_HOURS from civil dawn (the dawn chorus and
the morning) and DUSK_HOURS from sunset (the evening chorus and the first hours of the bats), for the node's own
place, computed with astral. life-schedule writes the result to /data/wittypi/schedule.wpi at every boot.

The script is anchored on the most recent dawn, so a boot just after midnight (the evening window runs past it in
June) still belongs to the day that began at the previous dawn. Its four states add up to exactly one day, dawn to
next dawn, and the Witty Pi repeats them; the next boot rewrites them, so the drift of sunrise and sunset is never
more than a day old.

    life-schedule-wpi [--now 2026-06-21T23:30]     (env: NODE_LAT, NODE_LON, NODE_TZ, DAY_HOURS, DUSK_HOURS)
"""
import os
import sys
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from astral import Observer
from astral.sun import dawn, sunset

LAT = float(os.environ.get("NODE_LAT") or 52.37)   # a node without coordinates gets the middle of the Netherlands
LON = float(os.environ.get("NODE_LON") or 5.0)     # (sunset moves about four minutes across the country)
TZ = ZoneInfo(os.environ.get("NODE_TZ") or "Europe/Amsterdam")
DAY = timedelta(hours=float(os.environ.get("DAY_HOURS") or 8))
DUSK = timedelta(hours=float(os.environ.get("DUSK_HOURS") or 2))
obs = Observer(latitude=LAT, longitude=LON)


# All arithmetic in UTC: two datetimes that share a ZoneInfo subtract as wall-clock times, which would put the
# last Sunday of October an hour out. The Witty Pi adds the durations to BEGIN in real seconds.
def day_start(d: date) -> datetime:
    try:
        t = dawn(obs, d, tzinfo=TZ)
    except ValueError:  # no civil dawn (far north in midsummer): start at 05:00
        t = datetime(d.year, d.month, d.day, 5, tzinfo=TZ)
    return t.astimezone(timezone.utc)


def evening_start(d: date) -> datetime:
    try:
        t = sunset(obs, d, tzinfo=TZ)
    except ValueError:
        t = datetime(d.year, d.month, d.day, 20, tzinfo=TZ)
    return t.astimezone(timezone.utc)


def span(t: timedelta) -> str:
    s = max(int(round(t.total_seconds())), 1)
    return f"H{s // 3600} M{s % 3600 // 60} S{s % 60}"


now = datetime.now(TZ)
if len(sys.argv) == 3 and sys.argv[1] == "--now":
    now = datetime.fromisoformat(sys.argv[2]).replace(tzinfo=TZ)

d = now.date()
if now.astimezone(timezone.utc) < day_start(d):
    d -= timedelta(days=1)
a = day_start(d)                       # this schedule day: from this dawn ...
nxt = day_start(d + timedelta(days=1))  # ... to the next
e = evening_start(d)
day_end = a + DAY
eve_end = min(e + DUSK, nxt - timedelta(minutes=1))
if e <= day_end:                        # windows touch (short days, long DAY_HOURS): one window, dawn to dusk end
    states = [("ON", eve_end - a), ("OFF", nxt - eve_end)]
else:
    states = [("ON", DAY), ("OFF", e - day_end), ("ON", eve_end - e), ("OFF", nxt - eve_end)]

f = "%Y-%m-%d %H:%M:%S"
loc = lambda t: t.astimezone(TZ)  # noqa: E731 - BEGIN and END are read by the Witty Pi as local clock time
print(f"# Life node, summer: {DAY.total_seconds() / 3600:g} h from civil dawn and {DUSK.total_seconds() / 3600:g} h from sunset at {LAT:.4f}, {LON:.4f}")
print(f"# {d}: dawn {loc(a):%H:%M}, sunset {loc(e):%H:%M}, next dawn {loc(nxt):%Y-%m-%d %H:%M} ({TZ.key}); written by life-schedule at every boot")
print(f"BEGIN\t{loc(a).strftime(f)}")
print(f"END\t{loc(a + timedelta(days=30)).strftime(f)}")
for s, t in states:
    print(f"{s}\t{span(t)}")
