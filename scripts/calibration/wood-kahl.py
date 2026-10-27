# Wood and Kahl (2024) calibration, run on open data: their own Phainopepla sample (Springer supplementary material)
# and TABMON's expert labels (Zenodo record 21103360, CC BY 4.0; annotators Tom Osteras (Norway), Tanguy Lois /
# BioPhonia (France), Lluis Brotons / CTFC and ICO (Spain)). For each species: logistic regression of the expert's
# right/wrong on logit(BirdNET score), the score at which Pr(right) = 0.95, and a bootstrap interval for it. Then a
# simulation of the Life node's own sampling design (at most five clips per 0.1 score band per month) to show how
# many checked clips a threshold needs. Behind content/confidence.md, section 2. Nothing is stored but the inputs.
#   uv run --with numpy --with scipy python scripts/calibration/wood-kahl.py [DATA]   (DATA defaults to ~/scratch/calibration)
import csv
import json
import math
import re
import sys
from collections import defaultdict

import numpy as np
from scipy.optimize import minimize

PHAINOPEPLA = "https://static-content.springer.com/esm/art%3A10.1007%2Fs10336-024-02144-5/MediaObjects/10336_2024_2144_MOESM2_ESM.csv"
TABMON = "https://zenodo.org/api/records/21103360/files/tabmon_annotations.zip/content"


def fetch(data):
    """Download what is missing: the Phainopepla CSV, and the three TABMON label tables out of the annotation zip."""
    import os
    import urllib.request
    import zipfile

    os.makedirs(data, exist_ok=True)
    ph = os.path.join(data, "phainopepla.csv")
    if not os.path.exists(ph):
        urllib.request.urlretrieve(PHAINOPEPLA, ph)
    tdir = os.path.join(data, "tabmon_annotation")
    if not os.path.exists(os.path.join(tdir, "annotation_table_ES1.csv")):
        z = os.path.join(data, "tabmon_annotations.zip")
        urllib.request.urlretrieve(TABMON, z)  # 275 MB, mostly audio; only the tables are kept
        with zipfile.ZipFile(z) as f:
            for c in ("NO1", "FR1", "ES1"):
                f.extract(f"tabmon_annotation/annotation_table_{c}.csv", data)
        os.remove(z)
    return ph, tdir


RNG = np.random.default_rng(20261027)


def logit(p):
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def expit(x):
    return 1 / (1 + np.exp(-x))


def fit(x, y):
    """Logistic regression y ~ a + b x by maximum likelihood (tiny ridge for separation)."""
    x = np.asarray(x, float)
    y = np.asarray(y, float)

    def nll(t):
        a, b = t
        eta = a + b * x
        return -np.sum(y * eta - np.logaddexp(0, eta)) + 1e-3 * (a * a + b * b)

    r = minimize(nll, [0.0, 1.0], method="BFGS")
    return r.x


def thr(a, b, p=0.95):
    """Score (0..1) at which Pr(right) = p, or None when the curve does not rise with the score."""
    if b <= 0:
        return None
    return float(expit((logit(p) - a) / b))


def boot_thr(x, y, p=0.95, reps=1000):
    n = len(x)
    out = []
    for _ in range(reps):
        i = RNG.integers(0, n, n)
        yy = y[i]
        if yy.min() == yy.max():
            out.append(1.0 if yy.max() == 0 else 0.0)
            continue
        a, b = fit(x[i], yy)
        t = thr(a, b, p)
        out.append(1.0 if t is None else t)
    out = np.array(out)
    return float(np.quantile(out, 0.025)), float(np.quantile(out, 0.975)), float(np.quantile(out, 0.95))


def phainopepla(path):
    s, y = [], []
    with open(path) as f:
        for r in csv.DictReader(f):
            s.append(float(r["confidence"]))
            y.append(int(r["correct"]))
    s, y = np.array(s), np.array(y)
    x = logit(s)
    a, b = fit(x, y)
    res = {"n": int(len(y)), "right": int(y.sum()), "a": float(a), "b": float(b)}
    for p in (0.90, 0.95, 0.99):
        res[f"thr{int(p * 100)}"] = thr(a, b, p)
    lo, hi, up95 = boot_thr(x, y)
    res["thr95_ci"] = [lo, hi]
    res["thr95_upper95"] = up95
    # 100 of the 200 were drawn at random from all detections >= 0.1 (the file is not in that order): all 89 below
    # 0.95 belong to that draw, plus about 11 of the rows at 0.95 or more. Rebuild that draw as the score distribution.
    hi = s[s >= 0.95]
    rand = np.concatenate([s[s < 0.95], RNG.choice(hi, 100 - int(np.sum(s < 0.95)), replace=False)])
    res["share_random_ge_thr95"] = float(np.mean(rand >= res["thr95"]))
    # Cumulative precision above the 0.95 point threshold, using the fitted curve over the real score distribution.
    above = rand[rand >= res["thr95"]]
    res["cum_precision_above_thr95"] = float(np.mean(expit(a + b * logit(above)))) if len(above) else None
    # And what single threshold gives cumulative precision 0.95 over the real distribution.
    best = None
    for t in np.linspace(0.1, 0.99, 891):
        sel = rand[rand >= t]
        if len(sel) == 0:
            break
        if np.mean(expit(a + b * logit(sel))) >= 0.95:
            best = float(t)
            break
    res["thr_for_cum_precision95"] = best
    res["precision_at_0.7_point"] = float(expit(a + b * logit(0.7)))
    return res, (a, b), rand


def read_tabmon(d):
    rows = []
    for c in ("NO1", "FR1", "ES1"):
        with open(f"{d}/annotation_table_{c}.csv", encoding="utf-8", errors="replace") as f:
            r = csv.reader(f, delimiter=";")
            next(r)
            for row in r:
                if not row or not row[0].strip():
                    continue
                row = (row + [""] * 6)[:6]
                preds = [p.strip() for p in re.split(r"[;,]", row[1]) if p.strip()]
                confs = [float(v) for v in re.findall(r"[0-9]*\.?[0-9]+(?:e-?\d+)?", row[2])]
                anns = [a.strip() for a in re.split(r"[;,]", row[3]) if a.strip()]
                aconf = row[4].strip() or "High"
                for p, s in zip(preds, confs):
                    genus = p.split()[0]
                    if any(a.lower().startswith("unknown") for a in anns) or not anns:
                        lab = None  # unsure
                    elif p in anns:
                        lab = 1
                    elif f"{genus} sp." in anns:
                        lab = None  # annotator could name only the genus
                    else:
                        lab = 0  # another species, or 'None'
                    rows.append({"c": c, "sp": p, "s": s, "lab": lab, "aconf": aconf})
    return rows


def tabmon(d, min_n=25):
    rows = read_tabmon(d)
    by = defaultdict(list)
    for r in rows:
        if r["lab"] is not None:
            by[(r["c"], r["sp"])].append(r)
    unsure = sum(1 for r in rows if r["lab"] is None)
    out = []
    for (c, sp), rr in sorted(by.items(), key=lambda kv: -len(kv[1])):
        if len(rr) < min_n:
            continue
        s = np.array([r["s"] for r in rr])
        y = np.array([r["lab"] for r in rr], float)
        x = logit(s)
        row = {"country": c, "species": sp, "n": len(rr), "right": int(y.sum()), "share_right": float(y.mean())}
        if 0 < y.sum() < len(y):
            a, b = fit(x, y)
            row.update(a=float(a), b=float(b), thr95=thr(a, b, 0.95), thr90=thr(a, b, 0.90))
            row["p_at_0.7"] = float(expit(a + b * logit(0.7)))
            lo, hi, up = boot_thr(x, y)
            row.update(thr95_lo=lo, thr95_hi=hi, thr95_up95=up)
            # High-confidence labels only, as a check on how much 'Low'/'Medium' labels move the threshold.
            hh = [r for r in rr if r["aconf"] == "High"]
            if len(hh) >= 15:
                sh = np.array([r["s"] for r in hh])
                yh = np.array([r["lab"] for r in hh], float)
                if 0 < yh.sum() < len(yh):
                    ah, bh = fit(logit(sh), yh)
                    row["thr95_high_only"] = thr(ah, bh, 0.95)
        out.append(row)
    # Same species in two countries: does one curve fit both? Likelihood-ratio test of a country-specific curve.
    pairs = []
    sp_c = defaultdict(dict)
    for (c, sp), rr in by.items():
        sp_c[sp][c] = rr
    for sp, cc in sp_c.items():
        big = {c: rr for c, rr in cc.items() if len(rr) >= 12}
        if len(big) < 2:
            continue
        cs = sorted(big)
        allr = [r for c in cs for r in big[c]]
        y = np.array([r["lab"] for r in allr], float)
        if y.min() == y.max():
            continue
        x = logit([r["s"] for r in allr])

        def ll(xx, yy):
            if yy.min() == yy.max():
                return 0.0
            a, b = fit(xx, yy)
            eta = a + b * xx
            return float(np.sum(yy * eta - np.logaddexp(0, eta)))

        l0 = ll(x, y)
        l1 = 0.0
        per = {}
        for c in cs:
            xx = logit([r["s"] for r in big[c]])
            yy = np.array([r["lab"] for r in big[c]], float)
            l1 += ll(xx, yy)
            if 0 < yy.sum() < len(yy):
                a, b = fit(xx, yy)
                per[c] = {"n": len(yy), "share_right": float(yy.mean()), "thr95": thr(a, b), "p_at_0.7": float(expit(a + b * logit(0.7)))}
            else:
                per[c] = {"n": len(yy), "share_right": float(yy.mean())}
        lr = 2 * (l1 - l0)
        from scipy.stats import chi2

        df = 2 * (len(cs) - 1)
        pairs.append({"species": sp, "countries": per, "LR": lr, "df": df, "p": float(chi2.sf(max(lr, 0), df))})
    return out, pairs, len(rows), unsure


def upper_thr(x, y, aa, bb, target=0.95, z=1.645):
    """One-sided 95% upper bound of the threshold, delta method on the logit scale."""
    eta = aa + bb * x
    w = expit(eta) * (1 - expit(eta))
    X = np.column_stack([np.ones_like(x), x])
    try:
        cov = np.linalg.inv(X.T @ (X * w[:, None]))
    except np.linalg.LinAlgError:
        return 0.999
    L = logit(target)
    tl = (L - aa) / bb
    g = np.array([-1 / bb, -(L - aa) / bb ** 2])
    se = math.sqrt(max(float(g @ cov @ g), 0.0))
    return float(expit(tl + z * se))


def simulate(a, b, months_list=(1, 2, 4, 8, 16, 32), reps=2000, per_band=5, bands=9, target=0.95, tp_scores=None):
    """The node's design: per month at most `per_band` clips in each 0.1 band from 0.1 to 1.0, uniform in the band.

    Truth is the curve (a, b) on the logit scale. For each n, estimate the threshold and record (i) its spread, (ii)
    the true Pr(right) at the estimated threshold, (iii) the same when the node uses the bootstrap-free conservative
    rule: the upper 95% profile of the threshold from a quick parametric bootstrap.
    """
    true_t = thr(a, b, target)
    res = []
    for m in months_list:
        n_band = per_band * m
        ests, true_p_at_est, cons_p, cons_recall = [], [], [], []
        for _ in range(reps):
            s = np.concatenate([RNG.uniform(0.1 + 0.1 * k, 0.1 + 0.1 * (k + 1), n_band) for k in range(bands)])
            s = np.clip(s, 0.1, 0.999)
            x = logit(s)
            y = (RNG.uniform(size=len(s)) < expit(a + b * x)).astype(float)
            if y.min() == y.max():
                continue
            aa, bb = fit(x, y)
            t = thr(aa, bb, target)
            if t is None:
                t = 0.999
            ests.append(t)
            true_p_at_est.append(float(expit(a + b * logit(t))))
            u = upper_thr(x, y, aa, bb, target) if bb > 0 else 0.999
            cons_p.append(float(expit(a + b * logit(u))))
            if tp_scores is not None:
                base = np.mean(tp_scores >= true_t)
                cons_recall.append(float(np.mean(tp_scores >= u) / base) if base > 0 else float("nan"))
        ests = np.array(ests)
        tp = np.array(true_p_at_est)
        res.append({
            "months": m, "clips": n_band * bands, "true_thr": true_t,
            "thr_q025": float(np.quantile(ests, 0.025)), "thr_q975": float(np.quantile(ests, 0.975)),
            "share_true_p_below_0.95": float(np.mean(tp < target)),
            "share_true_p_below_0.90": float(np.mean(tp < 0.90)),
            "true_p_q05": float(np.quantile(tp, 0.05)),
            "conservative_share_true_p_below_0.95": float(np.mean(np.array(cons_p) < target)),
            "conservative_recall_vs_true_thr_median": (float(np.nanmedian(cons_recall)) if cons_recall else None),
        })
    return res


def main():
    import os

    data = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/scratch/calibration")
    ph, tdir = fetch(data)
    out_dir = data
    res = {}
    res["phainopepla"], (a, b), rand = phainopepla(ph)
    # True detections in the real score distribution: each random-draw score kept with Pr(right) from the curve.
    tp = rand[RNG.uniform(size=len(rand)) < expit(a + b * logit(rand))]
    tp = np.repeat(tp, 50) + RNG.normal(0, 0.005, len(tp) * 50)
    res["tabmon_species"], res["tabmon_pairs"], res["tabmon_rows"], res["tabmon_unsure"] = tabmon(tdir)
    res["sim_phainopepla_curve"] = simulate(a, b, tp_scores=np.clip(tp, 0.1, 0.999))
    # A second, flatter curve: a species whose detections are right about half the time at 0.5 (common in Europe).
    fl = [r for r in res["tabmon_species"] if r.get("thr95") and 0.4 < r["share_right"] < 0.8]
    if fl:
        med = sorted(fl, key=lambda r: r["b"])[len(fl) // 2]
        res["sim_tabmon_median_curve"] = {"species": med["species"], "country": med["country"], "a": med["a"], "b": med["b"],
                                          "runs": simulate(med["a"], med["b"])}
    with open(f"{out_dir}/calib-results.json", "w") as f:
        json.dump(res, f, indent=1)
    print(json.dumps(res["phainopepla"], indent=1))
    print("tabmon rows", res["tabmon_rows"], "unsure", res["tabmon_unsure"])
    for r in res["tabmon_species"]:
        print(r["country"], r["species"], r["n"], "right", round(r["share_right"], 2),
              "thr95", None if r.get("thr95") is None else round(r["thr95"], 3),
              "CI", None if r.get("thr95_lo") is None else (round(r["thr95_lo"], 3), round(r["thr95_hi"], 3)),
              "p@0.7", None if r.get("p_at_0.7") is None else round(r["p_at_0.7"], 3),
              "highonly", None if r.get("thr95_high_only") is None else round(r["thr95_high_only"], 3))
    print("--- same species, two countries")
    for p in sorted(res["tabmon_pairs"], key=lambda p: p["p"]):
        print(p["species"], {c: {k: (round(v, 3) if isinstance(v, float) else v) for k, v in d.items()} for c, d in p["countries"].items()}, "LR p", round(p["p"], 4))
    print("--- simulation, Phainopepla curve")
    for r in res["sim_phainopepla_curve"]:
        print(r)
    if "sim_tabmon_median_curve" in res:
        m = res["sim_tabmon_median_curve"]
        print("--- simulation,", m["species"], m["country"])
        for r in m["runs"]:
            print(r)


if __name__ == "__main__":
    main()
