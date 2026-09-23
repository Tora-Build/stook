"""
Can the house make money, and does a fee that rises toward the lock help?

Replays every daily round over two years of hourly prices (BTC, ETH, SOL,
DOGE, ZEC) and three of market hours (SPY, GLD) with a whole day of trading:

  the round    opens 24 h before its close on the price then, locks 1 h
               before; bands and opening bell sized from the coin's EWMA
               volatility exactly as the program does (σ_window / 4)
  sharp flow   every hour, a trader who knows the current price believes the
               close is N(now, σ² · time left) and buys every band the market
               sells below that belief by more than the fee: it moves each
               such band to belief/(1+fee), so a higher fee means less of it
  retail flow  every hour, people buying one band: 80% near the current price
               (±4 bands), 20% a long shot anywhere; they hold to the close.
               Total per round = RETAIL × the house deposit
  the house    one deposit D; b = D / ln(1/p_min). Result = what traders paid
               − what winners are owed + 90% of every fee

Fee schedules: flat 1% / 2% / 3%, and two that rise over the last hours:
1% until 6 h before the close then up to 5% at the lock, and 1% until 3 h
before then up to 10%.

Usage: python3 house.py DATA_DIR
"""
import datetime as dt
import json
import math
import sys
import zoneinfo

import numpy as np

DATA = sys.argv[1]
ASSETS = ["BTC-USD", "ETH-USD", "SOL-USD", "DOGE-USD", "ZEC-USD", "SPY", "GLD"]
STOCK = {"SPY", "GLD"}
BINS, DAY, HOUR = 64, 86400, 3600
LAM, L_PEAK, K_BANDS = 0.94, 7.0, 4.0
MIN_STEP, MAX_STEP = 20e-4, 2000e-4
LP_SHARE = 0.9
RNG = np.random.default_rng(7)

FEES = {
    "flat 1%": lambda h: 0.01,
    "flat 2%": lambda h: 0.02,
    "flat 3%": lambda h: 0.03,
    "1% rising to 5%": lambda h: 0.01 if h >= 6 else 0.01 + (6 - h) / 5 * 0.04,
    "1% rising to 10%": lambda h: 0.01 if h >= 3 else 0.01 + (3 - h) / 2 * 0.09,
}
RETAIL = [0.0, 1.0, 3.0, 10.0]


def load(sym):
    rows = json.load(open(f"{DATA}/{sym}.json"))
    return np.array([r[0] for r in rows], dtype=np.int64), np.array([r[1] for r in rows], dtype=float)


def price_at(t, c, T):
    i = np.searchsorted(t, T, side="left") - 1
    return None if i < 0 or T - t[i] > 4 * HOUR else c[i]


def closes(sym, t):
    out = []
    for d in range(t[0] // DAY + 1, t[-1] // DAY):
        if sym in STOCK:
            if (d + 4) % 7 in (0, 6):
                continue
            day = dt.datetime.fromtimestamp(d * DAY, dt.timezone.utc).date()
            out.append(int(dt.datetime(day.year, day.month, day.day, 16, tzinfo=zoneinfo.ZoneInfo("America/New_York")).timestamp()))
        else:
            out.append(d * DAY + 20 * HOUR)
    return out


EDGES = np.arange(1, BINS) - 32.0
MID = np.arange(BINS) - 31.5


def gauss_cdf(x):
    return 0.5 * (1 + np.vectorize(math.erf)(x / math.sqrt(2)))


def belief(mu, sd):
    cdf = gauss_cdf((EDGES - mu) / max(sd, 1e-9))
    q = np.diff(np.concatenate([[0.0], cdf, [1.0]]))
    return np.maximum(q, 1e-15)


def lse(x):
    m = x.max()
    return m + math.log(np.exp(x - m).sum())


def sharp_trade(lw, b, q, fee):
    """Buy every band priced below belief/(1+fee) up to exactly that price.
    Returns new log-weights, the cost paid (before fee), and shares per band."""
    target = q / (1 + fee)
    out = np.ones(BINS, dtype=bool)           # bands left alone
    for _ in range(BINS):
        w_out = np.exp(lse(lw[out]) - lse(lw)) if out.any() else 0.0  # share of the old sum
        qb = target[~out].sum()
        if qb >= 1:
            break
        z = w_out / (1 - qb)                   # new sum, as a multiple of the old
        p_now = np.exp(lw - lse(lw)) / z       # left-alone bands' new prices
        add = out & (target > p_now)
        if not add.any() or not (out & ~add).any():   # keep at least one band unbought
            break
        out &= ~add
    if out.all():
        return lw, 0.0, np.zeros(BINS)
    w_out = np.exp(lse(lw[out]) - lse(lw)) if out.any() else 0.0
    z = w_out / (1 - target[~out].sum())
    s0 = lse(lw)
    new = lw.copy()
    new[~out] = np.log(target[~out] * z) + s0
    shares = b * (new - lw)
    cost = b * math.log(z)
    return new, cost, shares


def retail_trade(lw, b, band, amount):
    """Spend `amount` on one band: closed form for a single-band LMSR buy."""
    p = math.exp(lw[band] - lse(lw))
    g = 1 + (math.exp(amount / b) - 1) / p
    new = lw.copy()
    new[band] += math.log(g)
    return new, b * math.log(1 + p * (g - 1))   # = amount: the LMSR cost of that move


def run(sym, fee_fn, retail):
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
        b = 1.0 / math.log(1 / p0.min())       # deposit D = 1
        k = int(min(max(math.floor(math.log(pc / po) / step) + 32, 0), 63))
        paid = owed = fees = sharp_pnl = 0.0
        for h in range(24, 0, -1):             # hours to the close: 24 … 1 (the lock)
            ph = price_at(t, c, T - h * HOUR)
            if ph is None:
                continue
            fee = fee_fn(h)
            here = math.log(ph / po) / step    # where the price is, in bands
            # retail: this hour's share of the day's volume, on one band each
            for _ in range(2):
                amt = retail / 48
                if amt <= 0:
                    break
                band = int(RNG.integers(0, BINS)) if RNG.random() < 0.2 else int(min(max(round(here + RNG.normal(0, 4)) + 32, 0), 63))
                lw2, cost = retail_trade(lw, b, band, amt)
                shares = b * (lw2[band] - lw[band])
                lw = lw2
                paid += cost; fees += fee * cost
                owed += shares if band == k else 0.0
            # sharp: moves the market to what it knows, less the fee
            q = belief(here, sd_day * math.sqrt(h * HOUR / DAY) / step)
            lw2, cost, shares = sharp_trade(lw, b, q, fee)
            if cost > 0:
                lw = lw2
                paid += cost; fees += fee * cost
                owed += shares[k]
                sharp_pnl += shares[k] - cost * (1 + fee)
        res.append((paid - owed + LP_SHARE * fees, sharp_pnl, fees))
        var = min(max(LAM * var + (1 - LAM) * math.log(pc / last[1]) ** 2 * DAY / (T - last[0]), 1e-6), 0.09)
        last = (T, pc)
    return res


if __name__ == "__main__":
    print(f"{'fee':18s} {'retail':>6s}   {'house mean':>10s} {'house p5':>9s} {'house wins':>10s} {'sharp takes':>11s} {'fees earned':>11s}")
    for retail in RETAIL:
        for name, fn in FEES.items():
            allr = []
            for sym in ASSETS:
                allr += run(sym, fn, retail)
            a = np.array(allr)
            print(f"{name:18s} {retail:5.0f}×   {a[:,0].mean()*100:9.1f}% {np.percentile(a[:,0],5)*100:8.1f}% {(a[:,0]>0).mean()*100:9.0f}% {a[:,1].mean()*100:10.1f}% {a[:,2].mean()*100*LP_SHARE:10.1f}%")
        print()
