// The push-feed rule (devnet): the first push price at or after an instant,
// within PUSH_MAX_GAP_SECS, mirrors `oracle::check_settlement_instant(.., push)`.
import { describe, expect, it } from "vitest";
import { stook } from "../src/index.js";

const feedId = Uint8Array.from(Buffer.from("e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", "hex"));
const T = 1_000_000n;
const ladder = { feedId, settlesAt: T, stepBps: 50, p0Expo: -8, opensAt: T };
const at = (publish: bigint, push = true) => ({
  id: "0x" + Buffer.from(feedId).toString("hex"),
  price: { price: "8500000000000", conf: "1000000000", expo: -8, publish_time: Number(publish) },
  metadata: { prev_publish_time: Number(publish - 1n) },
  push,
});

describe("push-feed oracle rule", () => {
  it("settles on the first push price at or after the close, within the gap", () => {
    expect(stook.settlementProblem(at(T), ladder)).toBeNull();
    expect(stook.settlementProblem(at(T + 315n), ladder)).toBeNull();
    expect(stook.settlementProblem(at(T + stook.PUSH_MAX_GAP_SECS), ladder)).toBeNull();
    expect(stook.settlementProblem(at(T - 1n), ladder)).toMatch(/no push price/);
    expect(stook.settlementProblem(at(T + stook.PUSH_MAX_GAP_SECS + 1n), ladder)).toMatch(/late/);
  });
  it("keeps the exact rule for Hermes updates", () => {
    expect(stook.settlementProblem(at(T + 315n, false), ladder)).not.toBeNull();
  });
  it("opens late on a push price minutes old", () => {
    const now = T + 600n;
    expect(stook.openProblem(at(now - 315n), ladder, now)).toBeNull();
    expect(stook.openProblem(at(now - 315n, false), ladder, now)).toMatch(/old/);
  });
  it("never treats a push price as proof a round cannot settle", () => {
    expect(stook.voidProof(at(T + stook.PUSH_MAX_GAP_SECS + 100n), ladder)).toBe(false);
  });
});
