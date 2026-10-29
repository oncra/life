# Do dry and wet summers move the water loop's uptake number? (content/soil-water.md, "Dry and wet summers")
# Reads the per-station result of run.ts and the KNMI daily rain and Makkink evaporation it used:
#   npx tsx scripts/soil-noise/run.ts ~/scratch/twente > ~/scratch/twente/result.json
#   python3 scripts/soil-noise/extremes.py ~/scratch/twente
# A summer's dryness is KNMI's potential precipitation deficit: the running sum of evaporation minus rain from 1 April,
# never below zero, at its highest by 30 September, averaged over Twenthe, Hupsel and Heino. Each season at a station
# is compared with the station's own median under the same land use (stations with four seasons or more of it).
import json, math, os, statistics as st, sys, datetime as dt
from collections import defaultdict
DATA = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/scratch/twente')
rows = defaultdict(lambda: defaultdict(list))
for r in json.load(open(os.path.join(DATA, 'knmi', 'daily.json'))):
    t = dt.date.fromisoformat(r['date'][:10])
    if 4 <= t.month <= 9 and r['EV24'] is not None and r['RH'] is not None:
        rows[t.year][r['station_code']].append((t, r['EV24'] / 10 - max(0, r['RH']) / 10))
deficit = {}
for y, by in rows.items():
    peaks = []
    for v in by.values():
        c = m = 0.0
        for _, e in sorted(v):
            c = max(0.0, c + e); m = max(m, c)
        peaks.append(m)
    deficit[y] = st.mean(peaks)
per = json.load(open(os.path.join(DATA, 'result.json')))['perStation']
dev, pairs = defaultdict(list), []
for s in per.values():
    u = {int(k): v for k, v in s['uptake'].items()}
    for lu in {s['use'][y - 2009] for y in u} - {'-'}:
        vals = {y: v for y, v in u.items() if s['use'][y - 2009] == lu}
        if len(vals) < 4: continue
        med = st.median(vals.values())
        for y, v in vals.items(): dev[y].append(v - med)
        pairs += [(y, vals[y] - vals[y - 1]) for y in vals if y - 1 in vals]
years = sorted(y for y in dev if y in deficit)
shift = {y: st.median(dev[y]) for y in years}
print('year  deficit mm  stations  median shift')
for y in years: print(y, f'{deficit[y]:9.0f}', f'{len(dev[y]):8d}', f'{shift[y]:+12.3f}')
x = [deficit[y] for y in years]; z = [shift[y] for y in years]
mx, mz = st.mean(x), st.mean(z)
r = sum((a - mx) * (b - mz) for a, b in zip(x, z)) / math.sqrt(sum((a - mx) ** 2 for a in x) * sum((b - mz) ** 2 for b in z))
allv = [(y, v) for y in years for v in dev[y]]
g = st.mean(v for _, v in allv); ym = {y: st.mean(dev[y]) for y in years}
shared = sum((ym[y] - g) ** 2 for y, _ in allv) / sum((v - g) ** 2 for _, v in allv)
print(f'correlation of the median shift with the deficit: {r:.2f} over {len(years)} summers')
print(f'share of the variance shared by all stations in the same year: {shared:.2f}')
order = sorted(years, key=lambda y: deficit[y])
extreme = set(order[:3]) | set(order[-3:])
for name, sel in (('ending in one of the three driest or wettest summers', lambda y: y in extreme), ('ending in another summer', lambda y: y not in extreme)):
    p = [d for y, d in pairs if sel(y)]
    print(f'{name} ({sorted(extreme) if "driest" in name else "rest"}): {sum(abs(d) > 0.41 for d in p)} of {len(p)} beyond the one-season threshold 0.41')
