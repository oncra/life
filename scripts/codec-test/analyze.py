"""Compare each lossy version with the lossless hour and with the experts' marks: analyze.py DATADIR

DATADIR holds the .flac hours, annotations.csv and scores/ (birdnet_run.py's output, named <file>.npz).
BIRDNET_DATA is BirdNET-Go's internal/classifier/data, for the labels and the eBird codes.
"""
import csv, json, collections, numpy as np, sys, os
D = sys.argv[1].rstrip("/") + "/"
B = os.environ["BIRDNET_DATA"].rstrip("/") + "/"
LAB = [l.strip() for l in open(B + "labels/V2.4/BirdNET_GLOBAL_6K_V2.4_Labels_en_us.txt")]
ebird = json.load(open(B + "eBird_taxonomy_codes_2021E.json"))
# the codes file maps code->"Sci_Common" with English common names that may differ from en_us label; match on scientific name
sci2idx = {}
for i, l in enumerate(LAB):
    sci2idx.setdefault(l.split("_")[0], i)
code2idx = {}
for k, v in ebird.items():
    if "_" in v and "_" not in k:
        i = sci2idx.get(v.split("_")[0])
        if i is not None: code2idx[k] = i
files = sorted(f[:-5] for f in os.listdir(D) if f.endswith(".flac"))
ann = collections.defaultdict(list); unknown = collections.Counter()
for r in csv.DictReader(open(D + "annotations.csv")):
    b = r["Filename"][:-5]
    if b not in files: continue
    i = code2idx.get(r["Species eBird Code"])
    if i is None: unknown[r["Species eBird Code"]] += 1; continue
    ann[b].append((float(r["Start Time (s)"]), float(r["End Time (s)"]), i))
VARS = ["flac", "aac128.m4a", "aac96.m4a", "aac64.m4a", "mp3_96.mp3", "opus64.ogg", "opus32.ogg"]
def load(b, v):
    p = D + "scores/" + b + ("." + v if v != "flac" else ".flac") + ".npz"
    if not os.path.exists(p): return None
    z = np.load(p); d = z["det"]
    return {(int(c), int(l)): s / 1e4 for c, l, s in d}
res = collections.defaultdict(lambda: collections.Counter())
shift = collections.defaultdict(list)
for b in files:
    F = load(b, "flac")
    truth_chunks = collections.defaultdict(set)   # label -> chunks overlapping an annotation
    for s, e, i in ann[b]:
        for c in range(int(s // 3), int(min(e, 3599.99) // 3) + 1): truth_chunks[i].add(c)
    for v in VARS:
        V = load(b, v)
        if V is None: continue
        for T in (0.1, 0.5, 0.7):
            f = {k for k, s in F.items() if s >= T}; x = {k for k, s in V.items() if s >= T}
            res[(v, T)]["flac_n"] += len(f); res[(v, T)]["n"] += len(x); res[(v, T)]["both"] += len(f & x)
            # species per hour
            fs = {l for _, l in f}; xs = {l for _, l in x}
            res[(v, T)]["sp_flac"] += len(fs); res[(v, T)]["sp_both"] += len(fs & xs); res[(v, T)]["sp_new"] += len(xs - fs)
            # vs experts: recall over annotated events, precision over detections
            hit = 0
            for s, e, i in ann[b]:
                if any((c, i) in x for c in range(int(s // 3), int(min(e, 3599.99) // 3) + 1)): hit += 1
            res[(v, T)]["ev"] += len(ann[b]); res[(v, T)]["hit"] += hit
            res[(v, T)]["tp"] += sum(1 for (c, l) in x if c in truth_chunks.get(l, ()))
        common = [(k, s) for k, s in F.items() if s >= 0.1]
        shift[v] += [V.get(k, 0.0) - s for k, s in common]
print("annotations mapped:", sum(len(a) for a in ann.values()), "unmapped:", sum(unknown.values()), dict(unknown.most_common(5)))
for T in (0.1, 0.5, 0.7):
    print(f"\n--- threshold {T} ---")
    print(f"{'format':15s} {'dets':>6s} {'kept%':>6s} {'new%':>6s} {'sp kept%':>8s} {'sp new':>6s} {'recall%':>7s} {'prec%':>6s}")
    for v in VARS:
        r = res[(v, T)]
        if not r["n"] and v != "flac": continue
        print(f"{v:15s} {r['n']:6d} {100*r['both']/max(1,r['flac_n']):6.1f} {100*(r['n']-r['both'])/max(1,r['flac_n']):6.1f} {100*r['sp_both']/max(1,r['sp_flac']):8.1f} {r['sp_new']:6d} {100*r['hit']/max(1,r['ev']):7.1f} {100*r['tp']/max(1,r['n']):6.1f}")
print("\nmean score change on lossless detections >= 0.1 (signed, abs):")
for v in VARS:
    if shift[v]: a = np.array(shift[v]); print(f"{v:15s} {a.mean():+.3f} {np.abs(a).mean():.3f}  n={len(a)}")
