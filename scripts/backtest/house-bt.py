"""house.py with option C: b_eff = b * f(time to lock). Usage: house_bt.py DATA SCHED RETAIL"""
import sys, math
import numpy as np
DATA, SCHED, VOL = sys.argv[1], sys.argv[2], float(sys.argv[3])
sys.argv = [sys.argv[0], DATA]
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import house as H
from house import *

TT = 23.0  # open (24 h before close) to lock (1 h before)
SCHEDS = {
    "const": lambda tau: 1.0,
    "sqrt_f0.25": lambda tau: max(0.25, math.sqrt(tau / TT)),
    "sqrt_f0.5": lambda tau: max(0.5, math.sqrt(tau / TT)),
    "linear_f0.25": lambda tau: max(0.25, tau / TT),
}
FEE = H.FEES["2% rising to 5%"]
f = SCHEDS[SCHED]
H.RNG = np.random.default_rng(7)

def run(sym, retail):
    t, c = load(sym)
    res, var, last, seed = [], None, None, []
    for T in closes(sym, t):
        pc, po = price_at(t, c, T), price_at(t, c, T - DAY)
        if pc is None or po is None:
            continue
        if var is None:
            if last is not None:
                seed.append(math.log(pc / last[1]) ** 2 * DAY / (T - last[0]))
            last = (T, pc)
            if len(seed) >= 30:
                var = float(np.mean(seed))
            continue
        sd_day = math.sqrt(var)
        step = min(max(sd_day / K_BANDS, MIN_STEP), MAX_STEP)
        var_bands = max(var / step ** 2, 0.25)
        lw = np.maximum(0.0, L_PEAK - MID ** 2 / (2 * var_bands))
        p0 = np.exp(lw - lse(lw))
        b0 = 1.0 / math.log(1 / p0.min())
        k = int(min(max(math.floor(math.log(pc / po) / step) + 32, 0), 63))
        paid = owed = fees = sharp_pnl = r_paid = r_owed = 0.0
        for h in range(24, 0, -1):
            ph = price_at(t, c, T - h * HOUR)
            if ph is None:
                continue
            b = b0 * f(h - 1)
            fee = FEE(h)
            here = math.log(ph / po) / step
            for _ in range(2):
                amt = retail / 48
                if amt <= 0:
                    break
                band = int(H.RNG.integers(0, BINS)) if H.RNG.random() < 0.2 else int(min(max(round(here + H.RNG.normal(0, 4)) + 32, 0), 63))
                lw2, cost = retail_trade(lw, b, band, amt)
                shares = b * (lw2[band] - lw[band])
                lw = lw2
                paid += cost; fees += fee * cost; r_paid += cost * (1 + fee)
                if band == k:
                    owed += shares; r_owed += shares
            q = belief(here, sd_day * math.sqrt(h * HOUR / DAY) / step)
            lw2, cost, shares = sharp_trade(lw, b, q, fee)
            if cost > 0:
                lw = lw2
                paid += cost; fees += fee * cost
                owed += shares[k]
                sharp_pnl += shares[k] - cost * (1 + fee)
        res.append((paid - owed + LP_SHARE * fees, sharp_pnl, fees * LP_SHARE, r_owed - r_paid, sym in STOCK))
        var = min(max(LAM * var + (1 - LAM) * math.log(pc / last[1]) ** 2 * DAY / (T - last[0]), 1e-6), 0.09)
        last = (T, pc)
    return res

allr = []
for sym in ASSETS:
    allr += run(sym, VOL)
a = np.array(allr, dtype=float)
def row(m, tag):
    x = a[m]
    return f"{tag} n={len(x)} house {x[:,0].mean()*100:6.1f}% p5 {np.percentile(x[:,0],5)*100:6.1f}% wins {(x[:,0]>0).mean()*100:3.0f}% sharp {x[:,1].mean()*100:5.1f}% fees {x[:,2].mean()*100:5.1f}% retail_pnl {x[:,3].mean()*100:6.1f}%"
print(f"{SCHED:13s} retail {VOL:4.0f}x | " + row(np.ones(len(a),bool),"all") + " || " + row(a[:,4]==0,"crypto") + " || " + row(a[:,4]==1,"stock"))
