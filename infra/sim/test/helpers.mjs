// A small world for the tests: one coin, a warmed-up series, and an open
// round built with the SDK's own opening maths, so quotes are real.
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { stook } from "@sooth/sdk-solana";

export const key = () => Keypair.generate().publicKey;

/** 11:00 New York on Tuesday 2026-09-29 (EDT), in ms. */
export const TUE_11_NY = Date.UTC(2026, 8, 29, 15, 0, 0);

export function series(varSigma = 0.03) {
  return { feedId: new Uint8Array(32).fill(1), quoteMint: key(), periodSecs: 0, closeSecs: 57_600, clock: stook.CLOCK_NEW_YORK, active: true, varWad: stook.varFromSigma(varSigma), lastPrice: 0n, lastExpo: -8, lastAt: 0n, observations: 30 };
}

/** An open round closing at `settlesAt` (s), opened a day before, with `deposit` whole coins of depth. */
export function openRound({ s = series(), settlesAt, decimals = 6, deposit = 10_000n, p0 = 6_500_000_000_000n, p0Expo = -8 } = {}) {
  const opensAt = settlesAt - 86_400n;
  const o = stook.openingTerms(s.varWad, settlesAt, opensAt);
  const dep = deposit * 10n ** BigInt(decimals);
  const b = stook.liquidityForDeposit(o.curve, dep, decimals);
  return {
    status: "open", opensAt, locksAt: settlesAt - 3600n, settlesAt, p0, p0Expo, stepBps: o.stepBps, curve: o.curve, b,
    feeBps: stook.LADDER_FEE_BPS, decimals, depositTotal: dep, curveSeq: 0n, quoteMint: key(), varBandsE9: o.varBandsE9,
  };
}

export function worldAt(ms, { decimals = 6 } = {}) {
  const s = series();
  const t = BigInt(Math.floor(ms / 1000));
  let today = stook.indexAtOrBefore(s, t) + 1;
  const settlesAt = stook.closeOf(s, today);
  const l = openRound({ s, settlesAt, decimals });
  const mintKey = l.quoteMint;
  const todayKey = key(), tomorrowKey = key();
  return {
    at: Number(t),
    coins: [{
      symbol: "STOOK", decimals, feedId: "11".repeat(32), mint: mintKey.toBase58(), mintKey, seriesKey: key(), series: s,
      tokenProgram: TOKEN_2022_PROGRAM_ID, report: { verdict: "issuer-trusted" }, transferFee: { bps: 300, maxFee: 10n ** 15n },
      today: { index: today, key: todayKey, round: { key: todayKey, index: today, l } },
      tomorrow: { index: today + 1, key: tomorrowKey, round: null },
    }],
  };
}

export const cfgFor = (over = {}) => ({
  txPerMin: 4, activity: 0.7, weekend: 0.35, priority: 1_000, solMin: 0.015, solTarget: 0.05, dailySol: 9, seed: "test",
  maxDepthFrac: 0.03, maxPositionsPerRound: 80, faucetUsd: 1_000, keeperBeat: "", beatMaxSecs: 60, ...over,
});

/** Ladder account bytes with just a status and a close (enough for collect's reads). */
export function ladderBytes({ status = "settled", settlesAt = 0n } = {}) {
  const d = new Uint8Array(stook.LADDER_SIZE);
  d.set(stook.LADDER_DISCRIMINATOR, 0);
  const v = new DataView(d.buffer);
  v.setBigInt64(8 + 16, BigInt(settlesAt), true);
  d[stook.LADDER_SIZE - 16] = ["seeding", "open", "settled", "void"].indexOf(status);
  d[stook.LADDER_SIZE - 15] = 255;
  return d;
}
