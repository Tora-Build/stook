"""
Which opening odds, and which band width, should a round use?

Replays every daily round over two years of hourly prices (crypto) and three
of market hours (SPY, GLD) under several rules, against the worst trader the
house faces: one who, at the lock, knows the price at the lock and moves the
market to where the close really is likely to land from there.

For each round:
  open  = close − 24 h: the grid centres on the price then
  lock  = close − gap (1 h for a daily round)
  var   = EWMA of daily log returns between past closes only (no lookahead)
  house = one deposit D; b = D / ln(1/p_min) at the opening odds
  trade = at the lock the market is moved to the trader's belief q:
          N(ln(P_lock/p0), var·gap/day) over the bands (open-ended tails)
  house P&L at the settled band k = b·ln(p_k / q_k), before fees

Usage: python3 explore.py DATA_DIR   (one <SYMBOL>.json of [t, close] each)
"""
import json, math, sys
import numpy as np

DATA = sys.argv[1]
ASSETS = {  # symbol: (close hour UTC or "ny16", fixed step bps the shipped rule used)
    "BTC-USD": (20, 50), "ETH-USD": (20, 100), "SOL-USD": (20, 100), "DOGE-USD": (20, 100),
    "ZEC-USD": (20, 100), "SPY": ("ny16", 25), "GLD": ("ny16", 25),
}
BINS, DAY = 64, 86400
MIN_STEP, MAX_STEP = 10e-4, 2000e-4


def load(sym):
    rows = json.load(open(f"{DATA}/{sym}.json"))
    t = np.array([r[0] for r in rows], dtype=np.int64)
    c = np.array([r[1] for r in rows], dtype=float)
    return t, c


def price_at(t, c, T):
    """Close of the last bar that started before T (an hour bar starting at
    T−1h closes at T). None if there is no bar within 4 h."""
    i = np.searchsorted(t, T, side="left") - 1
    if i < 0 or T - t[i] > 4 * 3600:
        return None
    return c[i]


def closes(sym, t):
    hour = ASSETS[sym][0]
    day0, day1 = t[0] // DAY + 1, t[-1] // DAY
    out = []
    for d in range(day0, day1):
        if hour == "ny16":
            if (d + 4) % 7 in (0, 6):  # weekend
                continue
            # 16:00 New York: 20:00 UTC in summer time, 21:00 in winter
            import datetime as dt, zoneinfo
            ny = dt.datetime.fromtimestamp(d * DAY, dt.timezone.utc).date()
            T = int(dt.datetime(ny.year, ny.month, ny.day, 16, tzinfo=zoneinfo.ZoneInfo("America/New_York")).timestamp())
        else:
            T = d * DAY + hour * 3600
        out.append(T)
    return out


def gauss_logw(var_bins2, L):
    d = np.arange(BINS) - 31.5
    return np.maximum(0.0, L - d * d / (2 * var_bins2))


def student_logw(var_bins2, L, nu):
    d = np.arange(BINS) - 31.5
    lw = -(nu + 1) / 2 * np.log1p(d * d / (nu * var_bins2))
    return np.maximum(lw - lw.min(), 0.0) if L is None else np.maximum(0.0, L + lw)


def probs_from_logw(lw):
    w = np.exp(lw - lw.max())
    return w / w.sum()


def belief(mu_bins, sd_bins):
    """Gaussian over bands with open-ended tails, in band units."""
    edges = np.arange(1, BINS) - 32.0  # band i spans [i−32, i−31) in log/step units
    cdf = 0.5 * (1 + np.vectorize(math.erf)((edges - mu_bins) / (sd_bins * math.sqrt(2))))
    q = np.diff(np.concatenate([[0.0], cdf, [1.0]]))
    return np.maximum(q, 1e-15)


def run(sym, rule, lam=0.94, gap=3600):
    t, c = load(sym)
    Ts = closes(sym, t)
    res, var, last = [], None, None
    seed = []
    for T in Ts:
        p_close = price_at(t, c, T)
        p_open = price_at(t, c, T - DAY)
        p_lock = price_at(t, c, T - gap)
        if None in (p_close, p_open, p_lock):
            continue
        if last is not None:
            r2 = math.log(p_close / last[1]) ** 2 * DAY / (T - last[0])
            if var is None:
                seed.append(r2)
                if len(seed) >= 30:
                    var = float(np.mean(seed))
                last = (T, p_close)
                continue
            # evaluate this round with var known BEFORE its close, then update
            res.append(evaluate(rule, var, p_open, p_lock, p_close, gap, sym))
            var = lam * var + (1 - lam) * r2
            var = min(max(var, 1e-6), 0.09)
        last = (T, p_close)
    return res


def evaluate(rule, var_day, p0, p_lock, p_close, gap, sym):
    kind = rule["kind"]
    window = DAY
    var_w = var_day * window / DAY
    sd_w = math.sqrt(var_w)
    if kind == "flat":
        step = rule["step"]
        lw = np.zeros(BINS)
    elif kind == "fixed_tier":
        step = ASSETS[sym][1] * 1e-4
        lw = gauss_logw(16.0, rule["L"])
    else:
        step = min(max(sd_w / rule["k"], MIN_STEP), MAX_STEP)
        var_bins2 = var_w / step ** 2
        lw = gauss_logw(var_bins2, rule["L"]) if kind == "gauss" else student_logw(var_bins2, rule["L"], rule["nu"])
    p = probs_from_logw(lw)
    b_over_D = 1.0 / math.log(1.0 / p.min())
    k = int(min(max(math.floor(math.log(p_close / p0) / step) + 32, 0), 63))
    sd_gap = math.sqrt(var_day * gap / DAY) / step
    q = belief(math.log(p_lock / p0) / step, sd_gap)
    pnl = b_over_D * math.log(p[k] / q[k])
    z = math.log(p_close / p0) / sd_w
    return dict(pnl=pnl, z=z, k=k, live=int((p > 0.01).sum()), span=math.exp(32 * step) - 1)


RULES = {
    "flat 1% (first design)": dict(kind="flat", step=0.01),
    "bell, fixed band per coin (shipped today)": dict(kind="fixed_tier", L=7),
}
for k in (3, 4, 5, 6):
    for L in (5, 7, 9, 12):
        RULES[f"gauss k={k} L={L}"] = dict(kind="gauss", k=k, L=L)
    for nu in (3, 5):
        for L in (7, 9, 12):
            RULES[f"student nu={nu} k={k} L={L}"] = dict(kind="student", k=k, L=L, nu=nu)

if __name__ == "__main__":
    rows = []
    for name, rule in RULES.items():
        per = {}
        for sym in ASSETS:
            r = run(sym, rule)
            per[sym] = r
        allr = [x for v in per.values() for x in v]
        pn = np.array([x["pnl"] for x in allr])
        z = np.array([x["z"] for x in allr])
        rows.append((name, pn.mean(), np.percentile(pn, 5), (pn < -0.5).mean(), (pn <= -0.99).mean(),
                     min(np.mean([x["pnl"] for x in v]) for v in per.values()),
                     np.mean([x["live"] for x in allr]), (np.abs(z) < 1).mean(), (np.abs(z) < 2).mean(), len(allr)))
    rows.sort(key=lambda r: -r[1])
    print(f"{'rule':42s} {'mean':>7s} {'p5':>7s} {'>50%':>6s} {'wiped':>6s} {'worst coin':>10s} {'bands>1%':>8s} {'|z|<1':>6s} {'|z|<2':>6s} n")
    for r in rows:
        print(f"{r[0]:42s} {r[1]*100:6.1f}% {r[2]*100:6.1f}% {r[3]*100:5.1f}% {r[4]*100:5.1f}% {r[5]*100:9.1f}% {r[6]:8.1f} {r[7]*100:5.1f}% {r[8]*100:5.1f}% {r[9]}")
