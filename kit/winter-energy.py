#!/usr/bin/env python3
"""Does a node get through the winter? Ten real winters, hour by hour, on KNMI's measurements at Schiphol.

    python3 kit/winter-energy.py            # harvest per month, then windows lost per share of a free panel's harvest
    python3 kit/winter-energy.py 2026-10-30 # what a free panel would have given on one day

Radiation and temperature per hour come from KNMI (station 240, no key needed) and are kept in ~/.cache/life-winter.
Each hour's radiation is split into direct and diffuse (Erbs), laid on a panel facing south (Hay-Davies), and taken at
15 % system losses, as PVGIS is here, and -0.37 % per degree above 25 C. The node draws a floor of 4.6 Wh/day all the time and the rest
of its day in the two hours from sunrise; under 15 % of the battery it stops, and starts again at 35 %. The BMS takes no
charge below 0 C. This is a calculation: what was measured is in kit/bench-log.csv.
"""
import datetime as dt
import json
import math
import os
import sys
import urllib.parse
import urllib.request

LAT, LON = 52.3838, 4.9014
WP, LOSSES, GAMMA = 40, 0.85, -0.0037
FLOOR = 4.6        # Wh/day, the charge controller's own use and the converter's idle (bench-log, step 2.4)
DAY = 12.0         # Wh on a winter day: 3.1 W for two hours through a 90 % converter, a boot, and the floor
WINTERS = range(2016, 2026)
CACHE = os.path.expanduser("~/.cache/life-winter")


def knmi(start, end):
    """Hourly Q (J/cm2) and T (0.1 C) at Schiphol, as (middle of the hour in UTC, W/m2, C)."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{start}-{end}.json")
    if not os.path.exists(path):
        body = urllib.parse.urlencode({"start": start, "end": end, "vars": "Q:T", "stns": 240, "fmt": "json"}).encode()
        with urllib.request.urlopen("https://www.daggegevens.knmi.nl/klimatologie/uurgegevens", body, timeout=120) as r, open(path, "wb") as f:
            f.write(r.read())
    return [(dt.datetime.strptime(r["date"][:10], "%Y-%m-%d") + dt.timedelta(hours=r["hour"] - 0.5), (r["Q"] or 0) * 10000 / 3600, (r["T"] or 0) / 10)
            for r in json.load(open(path))]


def sun(t):
    """Zenith angle and azimuth from north, in radians (NOAA's low-precision formulas)."""
    g = 2 * math.pi / 365 * ((t - dt.datetime(t.year, 1, 1)).total_seconds() / 86400)
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    dec = 0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g)
    ha = math.radians((t.hour * 60 + t.minute + eqt + 4 * LON) / 4 - 180)
    lat = math.radians(LAT)
    z = math.acos(max(-1, min(1, math.sin(lat) * math.sin(dec) + math.cos(lat) * math.cos(dec) * math.cos(ha))))
    return z, math.atan2(math.sin(ha), math.cos(ha) * math.sin(lat) - math.tan(dec) * math.cos(lat)) + math.pi


def diffuse_share(kt):
    if kt <= 0.22:
        return 1 - 0.09 * kt
    return 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4 if kt <= 0.8 else 0.165


def panel_w(ghi, t, temp, tilt):
    """What a free panel facing south gives in this hour, in W."""
    z, az = sun(t)
    if ghi <= 0 or z >= math.radians(89.5):
        return 0.0
    i0 = 1361 * (1 + 0.033 * math.cos(2 * math.pi * t.timetuple().tm_yday / 365))
    dhi = ghi * diffuse_share(min(1.0, ghi / (i0 * math.cos(z))))
    dni = (ghi - dhi) / max(math.cos(z), 0.05)
    b = math.radians(tilt)
    cosi = max(0, math.cos(z) * math.cos(b) + math.sin(z) * math.sin(b) * math.cos(az - math.pi))
    a = min(1, dni / i0)   # the share of the diffuse light that comes from around the sun
    poa = dni * cosi + dhi * (a * cosi / max(math.cos(z), 0.087) + (1 - a) * (1 + math.cos(b)) / 2) + ghi * 0.2 * (1 - math.cos(b)) / 2
    return WP * poa / 1000 * (1 + GAMMA * (temp + poa * 0.03 - 25)) * LOSSES


def sunrise(day):
    for m in range(0, 24 * 60, 6):
        t = dt.datetime(day.year, day.month, day.day) + dt.timedelta(minutes=m)
        if 90 - math.degrees(sun(t)[0]) >= -0.83:
            return t
    return None


def winter(hours, share, tilt, ah):
    """Windows lost and the lowest charge over one winter, with the panel at this share of a free panel's harvest."""
    cap = ah * 12.8
    e, on, lost, total, low, rises = cap * 0.8, True, 0, 0, 1.0, {}
    awake = (DAY - FLOOR) / 2
    for t, ghi, temp in hours:
        e -= FLOOR / 24
        if temp > 0:
            e = min(cap, e + panel_w(ghi, t, temp, tilt) * share)
        on = False if e < cap * 0.15 else True if e >= cap * 0.35 else on
        rise = rises.setdefault(t.date(), sunrise(t.date()))
        if rise <= t < rise + dt.timedelta(hours=2):
            total += 1
            if on:
                e -= awake
            else:
                lost += 1
        e = max(e, 0)
        low = min(low, e / cap)
    return lost / 2, total / 2, low


def main():
    if len(sys.argv) > 1:
        day = sys.argv[1].replace("-", "")
        hours = [h for h in knmi(day + "01", day + "24") if h[0].strftime("%Y%m%d") == day]   # KNMI may send the next day too
        print(f"{sys.argv[1]}: {sum(g for _, g, _ in hours) / 1000:.2f} kWh/m2 on the flat, a free {WP} W panel at 30 degrees {sum(panel_w(g, t, c, 30) for t, g, c in hours):.0f} Wh")
        return
    data = {y: knmi(f"{y}110101", f"{y + 1}022824") for y in WINTERS}
    names = {11: "Nov", 12: "Dec", 1: "Jan", 2: "Feb"}
    for tilt in (30, 40):   # node 1's bench spot, the design
        days = {}
        for hours in data.values():
            for t, g, c in hours:
                days.setdefault(t.month, {}).setdefault(t.date(), 0)
                days[t.month][t.date()] += panel_w(g, t, c, tilt)
        print(f"free {WP} W panel at {tilt} degrees, Wh/day: " + ", ".join(f"{names[m]} {sum(days[m].values()) / len(days[m]):.0f} (one day in twenty under {sorted(days[m].values())[len(days[m]) // 20]:.0f})" for m in (11, 12, 1, 2)))
    print(f"a winter day of {DAY:.0f} Wh, {len(WINTERS)} winters, windows lost and the lowest charge:")
    for tilt in (30, 40):
        for ah in (10, 20):
            cells = []
            for share in (1, 0.75, 0.5, 0.4, 0.3, 0.2):
                r = [winter(h, share, tilt, ah) for h in data.values()]
                cells.append(f"{share:.0%} {100 * sum(x[0] for x in r) / sum(x[1] for x in r):.1f}% ({min(x[2] for x in r):.0%})")
            print(f"  {tilt} degrees, {ah} Ah: " + "  ".join(cells))


if __name__ == "__main__":
    main()
