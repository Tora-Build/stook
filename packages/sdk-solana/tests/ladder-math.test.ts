// The parts of the ladder SDK that need no chain: shapes, the bin grid, fees,
// and the discriminators the builders hard-code.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import * as L from "../src/ladder/index";
import { WAD } from "../src/math/lmsr";

const disc = (ns: string, name: string) => [...createHash("sha256").update(`${ns}:${name}`).digest().subarray(0, 8)];

describe("ladder sdk", () => {
  it("hard-codes the discriminators Anchor derives", () => {
    const k = Keypair.generate().publicKey;
    const refs = { ladder: k, quoteMint: k, tokenProgram: k };
    const shape = L.band(1, 2);
    const built: [string, Uint8Array][] = [
      ["ladder_open", L.openLadderIx(refs, k, k, k).data],
      ["ladder_trade", L.tradeLadderIx(refs, { user: k, userToken: k, shape, shares: 1n, limit: 1n }).data],
      ["ladder_lp_join", L.joinLadderIx(refs, { lp: k, lpToken: k, index: 0, deposit: 1n, expectedSeq: 0n }).data],
      ["ladder_settle", L.settleLadderIx(refs, k, k, k, k).data],
      ["ladder_sweep", L.sweepPositionIx(refs, k, k, k).data],
      ["ladder_close", L.closeLadderIx(refs, k, k, k).data],
      ["series_create", L.createSeriesIx({ authority: k, feedId: new Uint8Array(32), quoteMint: k, closeSecs: 0, clock: 0 }).data],
      ["series_set", L.setSeriesIx(k, k, true).data],
      ["series_observe", L.observeSeriesIx(k, k, k, 1).data],
      ["ladder_void", L.voidLadderIx(refs, k).data],
      ["ladder_redeem", L.redeemLadderIx(refs, k, k, shape).data],
      ["ladder_claim_lp", L.claimLpIx(refs, k, k).data],
      ["ladder_collect_fees", L.collectLadderFeesIx(refs, k, k, k).data],
      ["ladder_create", L.createLadderIx({ creator: k, series: k, index: 3, quoteMint: k, creatorToken: k, tokenProgram: k, seed: 1n }).data],
    ];
    built.push(["approve_quote_mint", L.approveQuoteMintIx(k, k).data], ["revoke_quote_mint", L.revokeQuoteMintIx(k, k).data]);
    built.push(["initialize_protocol", L.initializeProtocolIx(k, k).data], ["set_paused", L.setPausedIx(k, true).data], ["set_treasury", L.setTreasuryIx(k, k).data],
      ["transfer_authority", L.transferAuthorityIx(k, k).data], ["accept_authority", L.acceptAuthorityIx(k).data]);
    for (const [name, data] of built) expect([...data.subarray(0, 8)], name).toEqual(disc("global", name));
    expect([...L.LADDER_DISCRIMINATOR]).toEqual(disc("account", "Ladder"));
    expect([...L.POSITION_DISCRIMINATOR]).toEqual(disc("account", "LadderPosition"));
    expect([...L.TRANCHE_DISCRIMINATOR]).toEqual(disc("account", "LadderTranche"));
    expect([...L.CONFIG_DISCRIMINATOR]).toEqual(disc("account", "ProtocolConfig"));
    expect([...L.SERIES_DISCRIMINATOR]).toEqual(disc("account", "Series"));
  });

  it("puts every day's close at 4 PM New York, as the timezone database does, 2024 to 2035", () => {
    const ny = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const s = { periodSecs: 0, closeSecs: 16 * 3600, clock: L.CLOCK_NEW_YORK };
    for (let day = L.daysFromCivil(2024, 1, 1); day <= L.daysFromCivil(2035, 12, 31); day++) {
      const [y, m, d] = L.civilFromDays(day);
      const at = L.closeOf(s, day);
      const want = `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}, 16:00`;
      expect(ny.format(new Date(Number(at) * 1000)), `${y}-${m}-${d}`).toBe(want);
    }
  });

  it("charges 2% most of the day and rises to 5% over the last six hours", () => {
    const close = 1_000_000n;
    expect(L.feeBpsAt(200, close - 86_400n, close)).toBe(200);
    expect(L.feeBpsAt(200, close - 21_600n, close)).toBe(200);
    expect(L.feeBpsAt(200, close - 12_600n, close)).toBe(350);
    expect(L.feeBpsAt(200, close - 3_600n, close)).toBe(500);
    expect(L.feeBpsAt(200, close - 120n, close)).toBe(500);
  });

  it("sizes a band to a quarter of an ordinary move, for any coin and window", () => {
    // BTC 2.5%/day over a day: 63 bps and a bell ~4 bands wide; SPY 1%: 25 bps
    const btc = L.bandWidth(L.varFromSigma(0.025), 86_400n);
    expect(btc.stepBps).toBe(63);
    expect(Number(btc.varBands) / 1e18).toBeCloseTo(15.75, 1);
    expect(L.bandWidth(L.varFromSigma(0.01), 86_400n).stepBps).toBe(25);
    expect(L.bandWidth(L.varFromSigma(0.025), 4n * 3600n).stepBps).toBe(26);
    expect(L.bandWidth(L.varFromSigma(0.002), 900n).stepBps).toBe(L.MIN_STEP_BPS);
    expect(L.bandWidth(L.varFromSigma(0.002), 900n).varBands).toBe(L.MIN_VAR_BANDS);
    // a calendar asks about past days too: no terms, no throw
    const daily = { feedId: new Uint8Array(32), quoteMint: Keypair.generate().publicKey, periodSecs: 0, closeSecs: 16 * 3600, clock: L.CLOCK_NEW_YORK, active: true, varWad: L.varFromSigma(0.025), lastPrice: 0n, lastExpo: 0, lastAt: 0n, observations: 20 };
    // a new series asks for its last 20-odd closes, oldest first
    const cold = L.pendingObservations({ ...daily, observations: 0, varWad: 0n }, 1_790_798_400n + 3600n);
    expect(cold.length).toBe(L.WARMUP_OBSERVATIONS + 6);                              // 5 spare, in case Hermes misses one
    expect(L.closeOf(daily, cold.at(-1)!)).toBe(1_790_798_400n);
    expect(L.roundTerms({ ...daily, observations: 3 }, cold.at(-1)! + 2, 1_790_798_400n).fundable).toBe(true);  // funding never waits for learning
    const past = L.roundTerms(daily, L.daysFromCivil(2026, 9, 1), 1_790_000_000n);
    expect(past.fundable).toBe(false);
    expect(past.stepBps).toBe(0);
    // a weekday series: Friday has a round, Saturday none
    const wk = { periodSecs: 0, clock: L.CLOCK_NEW_YORK_WEEKDAYS };
    expect(L.hasRound(wk, L.daysFromCivil(2026, 9, 25))).toBe(true);
    expect(L.hasRound(wk, L.daysFromCivil(2026, 9, 26))).toBe(false);
    for (const n of [0n, 1n, 99n, 100n, 10n ** 30n + 7n, (1n << 128n) - 1n]) {
      const r = L.isqrt(n);
      expect(r * r <= n && (r + 1n) * (r + 1n) > n).toBe(true);
    }
  });

  it("tapers a tent from its centre, even when the taper runs off the ladder", () => {
    const t = L.tent(33, 4);
    expect([29, 30, 33, 35, 36, 37].map((i) => L.level(t, i))).toEqual([0, 1, 4, 2, 1, 0]);
    const edge = L.tent(0, 4);
    expect(edge.lo).toBe(-3);
    expect(L.level(edge, 0)).toBe(4);
    expect(L.shapeBins(edge)).toEqual([0, 3]);
    expect(() => L.validateShape({ lo: 5, hi: 4, h: 1 })).toThrow();
    expect(() => L.validateShape({ lo: 0, hi: 0, h: 9 })).toThrow();
  });

  it("floors a price just under the centre into the bin below it", () => {
    const p0 = 22_019_000n;
    expect(L.binFor(p0, p0, 100)).toBe(32);
    expect(L.binFor(p0 - 1n, p0, 100)).toBe(31);
    expect(L.binFor(1n, p0, 100)).toBe(0);
    expect(L.binFor(p0 * 1000n, p0, 100)).toBe(63);
    // the bounds the UI draws agree with the bin the program picks
    for (const i of [5, 31, 32, 40, 62]) {
      const [lo, hi] = L.binBounds(i, p0, 100);
      expect(L.binFor(BigInt(Math.ceil(lo + 1)), p0, 100)).toBe(i);
      expect(L.binFor(BigInt(Math.floor(hi - 1)), p0, 100)).toBe(i);
    }
  });

  it("prices a fresh market uniformly and a round trip never in the trader's favour", () => {
    const m = { curve: L.fresh(), b: 1_200n * WAD, feeBps: 100, decimals: 6 };
    expect(L.price(m.curve, 7)).toBe(WAD / 64n);
    const buy = L.quoteTrade(m, L.tent(32, 4), 50_000_000n);
    const sell = L.quoteTrade({ ...m, curve: buy.curve }, L.tent(32, 4), -50_000_000n);
    expect(sell.total).toBeLessThan(buy.total);
    expect(sell.amount).toBeLessThan(buy.amount);
    expect(buy.maxPayout).toBe(200_000_000n);
    expect(() => L.quoteTrade(m, L.band(3, 3), 10n ** 15n)).toThrow(); // too large for this depth
  });

  it("buys less depth per token once a bin has become a long shot", () => {
    const at0 = L.liquidityForDeposit(L.fresh(), 2_500_000_000n, 6);
    const moved = L.applyTrade(L.fresh(), 1_200n * WAD, L.band(40, 40), 800n * WAD).curve;
    expect(L.liquidityForDeposit(moved, 2_500_000_000n, 6)).toBeLessThan(at0);
  });

  it("tells a keeper which instruction a market is waiting for", () => {
    const m = { opensAt: 100n, locksAt: 200n, settlesAt: 300n };
    const at = (status: L.LadderStatus, now: bigint) => L.nextStep({ ...m, status }, now);
    expect(at("seeding", 99n)).toBe(null);
    expect(at("seeding", 100n)).toBe("open");
    expect(at("seeding", 200n)).toBe("void");       // never opened before its lock
    expect(L.nextStep({ opensAt: 100n, locksAt: 10_000n, settlesAt: 20_000n, status: "seeding" }, 399n)).toBe("open");
    expect(L.nextStep({ opensAt: 100n, locksAt: 10_000n, settlesAt: 20_000n, status: "seeding" }, 400n)).toBe("void"); // its opening window passed
    expect(at("open", 299n)).toBe(null);
    expect(at("open", 300n)).toBe("settle");                    // or a void with proof: the keeper decides
    expect(at("open", 300n + 86_400n)).toBe("settle");          // no longer a race: a day late still settles
    expect(at("open", 300n + 7n * 86_400n)).toBe("void");       // no update to show at all
    expect(at("settled", 10n ** 9n)).toBe(null);
    expect(at("void", 10n ** 9n)).toBe(null);
  });

  it("accepts exactly one update as a market's settlement price", () => {
    const feedId = Uint8Array.from(Buffer.from("b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593", "hex"));
    const l = { feedId, settlesAt: 1_000n, stepBps: 100, p0Expo: -5 };
    const u = (publish: number, prev: number | undefined, conf = "5000", expo = -5, id = "0xB1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593"): L.HermesPrice =>
      ({ id, price: { price: "22460000", conf, expo, publish_time: publish }, metadata: prev === undefined ? {} : { prev_publish_time: prev } });
    expect(L.settlementProblem(u(1_000, 999), l)).toBe(null);
    expect(L.settlementProblem(u(1_001, 999), l)).toBe(null);                  // the feed skipped second T
    expect(L.settlementProblem(u(1_000, 1_000), l)).toMatch(/first update/);   // a LATER update inside second T
    expect(L.settlementProblem(u(999, 998), l)).toMatch(/first update/);       // from before T
    expect(L.settlementProblem(u(1_002, 1_001), l)).toMatch(/first update/);   // the one after the right one
    expect(L.settlementProblem(u(1_031, 999), l)).toMatch(/silent/);
    expect(L.settlementProblem(u(1_000, undefined), l)).toMatch(/prev_publish_time/);
    expect(L.settlementProblem(u(1_000, 999, "112301"), l)).toMatch(/half a bin/); // 0.5% of price, +1
    expect(L.settlementProblem(u(1_000, 999, "112300"), l)).toBe(null);
    expect(L.settlementProblem(u(1_000, 999, "5000", -8), l)).toMatch(/exponent/);
    expect(L.settlementProblem(u(1_000, 999, "5000", -5, "00".repeat(32)), l)).toBe("wrong feed");

    // Opening takes the same rule at opens_at, with a 1% confidence bar.
    const o = { feedId, opensAt: 1_000n };
    expect(L.openProblem(u(1_000, 999), o)).toBe(null);
    expect(L.openProblem(u(1_000, 1_000), o)).toMatch(/first update/);
    expect(L.openProblem(u(1_031, 999), o)).toMatch(/silent/);
    expect(L.openProblem(u(1_000, 999, "224601"), o)).toMatch(/half a bin/);      // 1% of price, +1
    expect(L.openProblem(u(1_000, 999, "224600", -8), o)).toBe(null);             // any exponent: it sets p0's

    // A void's proof: THE update for the close, and it cannot settle.
    expect(L.voidProof(u(1_031, 999), l)).toBe(true);
    expect(L.voidProof(u(1_000, 999, "112301"), l)).toBe(true);
    expect(L.voidProof(u(1_000, 999), l)).toBe(false);                            // it settles
    expect(L.voidProof(u(1_031, 1_030), l)).toBe(false);                          // not the first at or after
    expect(L.voidProof(u(1_031, undefined), l)).toBe(false);
  });

  it("filters program accounts down to ladders in one state", () => {
    const f = L.ladderFilters("open");
    expect(f).toHaveLength(3);
    expect((f[0] as any).dataSize).toBe(L.LADDER_SIZE);                        // this layout only
    expect((f[2] as any).memcmp).toEqual({ offset: 8 + 1912, bytes: "2" });    // base58 of the single byte 0x01
    expect(L.ladderFilters()).toHaveLength(2);
  });
});

describe("NYSE holidays", () => {
  it("match the program's rule and the exchange's published 2026 and 2027 calendar", () => {
    const d = (y: number, m: number, dd: number) => L.daysFromCivil(y, m, dd);
    const listed = new Set([
      d(2026, 1, 1), d(2026, 1, 19), d(2026, 2, 16), d(2026, 4, 3), d(2026, 5, 25), d(2026, 6, 19), d(2026, 7, 3), d(2026, 9, 7), d(2026, 11, 26), d(2026, 12, 25),
      d(2027, 1, 1), d(2027, 1, 18), d(2027, 2, 15), d(2027, 3, 26), d(2027, 5, 31), d(2027, 6, 18), d(2027, 7, 5), d(2027, 9, 6), d(2027, 11, 25), d(2027, 12, 24),
    ]);
    const s = { periodSecs: 0, clock: L.CLOCK_NEW_YORK_WEEKDAYS };
    for (let day = d(2026, 1, 1); day < d(2028, 1, 1); day++) {
      const weekend = [0, 6].includes(((day + 4) % 7 + 7) % 7);
      expect(L.hasRound(s, day), String(L.civilFromDays(day))).toBe(!weekend && !listed.has(day));
    }
    expect(L.nyseHoliday(d(2027, 12, 31))).toBe(false);
    expect(L.hasRound({ periodSecs: 0, clock: L.CLOCK_NEW_YORK }, d(2026, 12, 25))).toBe(true); // only the weekday clock skips them
  });
});
