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
      ["ladder_open", L.openLadderIx(refs, k, k).data],
      ["ladder_trade", L.tradeLadderIx(refs, { user: k, userToken: k, shape, shares: 1n, limit: 1n }).data],
      ["ladder_lp_join", L.joinLadderIx(refs, { lp: k, lpToken: k, index: 0, deposit: 1n, expectedSeq: 0n }).data],
      ["ladder_settle", L.settleLadderIx(refs, k, k).data],
      ["ladder_void", L.voidLadderIx(refs, k).data],
      ["ladder_redeem", L.redeemLadderIx(refs, k, k, shape).data],
      ["ladder_claim_lp", L.claimLpIx(refs, k, k).data],
      ["ladder_collect_fees", L.collectLadderFeesIx(refs, k, k, k).data],
      ["ladder_create", L.createLadderIx({ feedId: new Uint8Array(32), settlesAt: 3n, quoteMint: k, tier: 0, creator: k, creatorToken: k, tokenProgram: k, opensAt: 1n, locksAt: 2n, seed: 1n, feeBps: 100 }).data],
    ];
    built.push(["approve_quote_mint", L.approveQuoteMintIx(k, k).data], ["revoke_quote_mint", L.revokeQuoteMintIx(k, k).data]);
    for (const [name, data] of built) expect([...data.subarray(0, 8)], name).toEqual(disc("global", name));
    expect([...L.LADDER_DISCRIMINATOR]).toEqual(disc("account", "Ladder"));
    expect([...L.POSITION_DISCRIMINATOR]).toEqual(disc("account", "LadderPosition"));
    expect([...L.TRANCHE_DISCRIMINATOR]).toEqual(disc("account", "LadderTranche"));
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
});
