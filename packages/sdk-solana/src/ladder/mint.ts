// Off-chain mirror of `token_guard::classify`, so a UI can tell a creator
// whether their token can quote a market — and why not — before they pay for a
// transaction that would fail. The program is the authority; this must agree
// with it, and `tests/ladder-token2022.test.ts` checks that it does on a real
// xStock mint.

export type MintVerdict = "open" | "issuer-trusted" | "refused";

export interface TransferFee {
  bps: number;
  /** Most the fee can be on one transfer, base units. */
  maxFee: bigint;
}

export interface MintReport {
  verdict: MintVerdict;
  /** Human-readable findings, most serious first. */
  reasons: string[];
  decimals: number;
  /** Set when the mint takes a fee on every transfer (the schedule in force now). */
  transferFee?: TransferFee;
  /**
   * Set when the issuer has scheduled a different fee that is not in force
   * yet at the epoch given: it starts at `epoch`, at most two epochs away.
   * A wallet still signs at the fee in force, so a transaction that lands
   * after this one fails whole; `feeRaises` says when to warn of that.
   */
  nextTransferFee?: TransferFee & { epoch: bigint };
}

/**
 * The smallest amount to send so at least `net` arrives after the fee —
 * the program's `token_guard::gross_for`, op for op. What a wallet pays for
 * a deposit of `net`.
 */
export function grossFor(net: bigint, fee?: TransferFee): bigint {
  if (!fee || fee.bps === 0) return net;
  if (fee.bps >= 10_000) throw new Error("a 100% transfer fee cannot be paid through");
  const bps = BigInt(fee.bps);
  const feeAt = (g: bigint) => { const f = (g * bps + 9_999n) / 10_000n; return f < fee.maxFee ? f : fee.maxFee; };
  let gross = (net * 10_000n + (10_000n - bps) - 1n) / (10_000n - bps);
  const capped = net + fee.maxFee;
  if (capped < gross && feeAt(capped) === fee.maxFee) gross = capped;
  while (gross - feeAt(gross) < net) gross += 1n;
  return gross;
}

/** What arrives when `gross` is sent: what a payout is worth to its receiver. */
export function netOf(gross: bigint, fee?: TransferFee): bigint {
  if (!fee || fee.bps === 0) return gross;
  const f = (gross * BigInt(fee.bps) + 9_999n) / 10_000n;
  return gross - (f < fee.maxFee ? f : fee.maxFee);
}

/**
 * The most a wallet should sign to send so that `net` arrives: the gross
 * under whichever of `fees` costs more, `slippageBps` over. A buy's limit and
 * a deposit's `maxGross`, signed at the fee in force: the program refuses a
 * transfer that would take more, so a fee raised first fails it.
 */
export function maxGrossFor(net: bigint, fees: (TransferFee | undefined)[], slippageBps = 50n): bigint {
  const padded = (net * (10_000n + slippageBps)) / 10_000n;
  return (fees.length ? fees : [undefined]).reduce((m, f) => { const g = grossFor(padded, f); return g > m ? g : m; }, 0n);
}

/**
 * The least a wallet should accept to receive when the pool sends `gross`:
 * what lands under whichever of `fees` takes more, `slippageBps` under. A
 * sale's limit, signed at the fee in force: the program measures what the
 * wallet received against it, so a fee raised first fails the sale.
 */
export function minNetOf(gross: bigint, fees: (TransferFee | undefined)[], slippageBps = 50n): bigint {
  const padded = (gross * (10_000n - slippageBps)) / 10_000n;
  return (fees.length ? fees : [undefined]).reduce((m, f) => { const n = netOf(padded, f); return m === null || n < m ? n : m; }, null as bigint | null)!;
}

/**
 * Would the scheduled fee `next` take more than the fee in force `now`, on a
 * transfer landing `net`? Then a transaction signed at `now` fails if `next`
 * starts first, and the wallet should say so. A fee that takes everything
 * always does, and is never priced.
 */
export function feeRaises(net: bigint, now?: TransferFee, next?: TransferFee): boolean {
  if (!next) return false;
  if (next.bps >= 10_000) return true;
  if (now && now.bps >= 10_000) return false;
  return grossFor(net, next) > grossFor(net, now);
}

const NAMES: Record<number, string> = {
  1: "TransferFeeConfig", 3: "MintCloseAuthority", 4: "ConfidentialTransferMint", 6: "DefaultAccountState",
  9: "NonTransferable", 10: "InterestBearingConfig", 12: "PermanentDelegate", 14: "TransferHook",
  16: "ConfidentialTransferFeeConfig", 18: "MetadataPointer", 19: "TokenMetadata", 20: "GroupPointer",
  21: "TokenGroup", 22: "GroupMemberPointer", 23: "TokenGroupMember", 25: "ScaledUiAmount", 26: "Pausable",
};
const DESCRIPTIVE = new Set([3, 4, 18, 19, 20, 21, 22, 23, 25]);
const isSet = (b: Uint8Array) => b.some((v) => v !== 0);

export function classifyMint(data: Uint8Array, epoch?: bigint): MintReport {
  const decimals = data.length >= 45 ? data[44]! : 0;
  const refused = (why: string): MintReport => ({ verdict: "refused", reasons: [why], decimals });
  if (data.length === 82) return { verdict: "open", reasons: [], decimals };
  if (data.length < 166 || data[165] !== 1) return refused("not a mint account");

  const trust: string[] = [];
  let transferFee: TransferFee | undefined;
  let nextTransferFee: MintReport["nextTransferFee"];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let at = 166; at + 4 <= data.length; ) {
    const ty = view.getUint16(at, true), len = view.getUint16(at + 2, true);
    if (ty === 0) break;
    if (at + 4 + len > data.length) return refused("malformed extension data");
    const v = data.subarray(at + 4, at + 4 + len);
    const name = NAMES[ty] ?? `extension ${ty}`;
    at += 4 + len;

    if (DESCRIPTIVE.has(ty)) continue;
    if (ty === 16) return refused(`${name}: fees the vault cannot see`);
    if (ty === 1) {
      if (len !== 108) return refused("malformed extension data");
      // authority 32 · withdraw 32 · withheld 8 · older {epoch, max, bps} · newer {epoch, max, bps}
      const dv = new DataView(v.buffer, v.byteOffset, v.byteLength);
      const sched = (o: number) => ({ epoch: dv.getBigUint64(o, true), maxFee: dv.getBigUint64(o + 8, true), bps: dv.getUint16(o + 16, true) });
      const older = sched(72), newer = sched(90);
      // Without the cluster epoch, take the newer schedule: it is the one in
      // force unless it starts in the future, and StonkFun sets both alike.
      const inForce = epoch !== undefined && epoch < newer.epoch ? older : newer;
      if (inForce.bps > 0) transferFee = { bps: inForce.bps, maxFee: inForce.maxFee };
      if (inForce === older && (newer.bps !== older.bps || newer.maxFee !== older.maxFee)) nextTransferFee = { bps: newer.bps, maxFee: newer.maxFee, epoch: newer.epoch };
      if (isSet(v.subarray(0, 32))) trust.push(`${name}: ${(inForce.bps / 100).toFixed(2)}% is taken on every transfer, and the issuer can change the rate`);
      continue;
    }
    if (ty === 9) return refused(`${name}: a vault could never pay out`);
    if (ty === 10) return refused(`${name}: not supported`);
    if (ty === 6) {
      if (len !== 1 || v[0] === 2) return refused(`${name}: new accounts open frozen`);
    } else if (ty === 14) {
      if (len !== 64 || isSet(v.subarray(32))) return refused(`${name}: every transfer would run a third-party program`);
      if (isSet(v.subarray(0, 32))) trust.push(`${name}: the issuer can attach a transfer program later`);
    } else if (ty === 12) {
      if (len !== 32) return refused("malformed extension data");
      if (isSet(v)) trust.push(`${name}: the issuer can move tokens out of any account, a vault included`);
    } else if (ty === 26) {
      if (len !== 33) return refused("malformed extension data");
      if (isSet(v.subarray(0, 32))) trust.push(`${name}: the issuer can pause every transfer`);
    } else {
      return refused(`${name}: not recognised`);
    }
  }
  return { verdict: trust.length ? "issuer-trusted" : "open", reasons: trust, decimals, ...(transferFee ? { transferFee } : {}), ...(nextTransferFee ? { nextTransferFee } : {}) };
}
