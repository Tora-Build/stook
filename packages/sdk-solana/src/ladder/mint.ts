// Off-chain mirror of `token_guard::classify`, so a UI can tell a creator
// whether their token can quote a market — and why not — before they pay for a
// transaction that would fail. The program is the authority; this must agree
// with it, and `tests/ladder-token2022.test.ts` checks that it does on a real
// xStock mint.

export type MintVerdict = "open" | "issuer-trusted" | "refused";

export interface MintReport {
  verdict: MintVerdict;
  /** Human-readable findings, most serious first. */
  reasons: string[];
  decimals: number;
}

const NAMES: Record<number, string> = {
  1: "TransferFeeConfig", 3: "MintCloseAuthority", 4: "ConfidentialTransferMint", 6: "DefaultAccountState",
  9: "NonTransferable", 10: "InterestBearingConfig", 12: "PermanentDelegate", 14: "TransferHook",
  16: "ConfidentialTransferFeeConfig", 18: "MetadataPointer", 19: "TokenMetadata", 20: "GroupPointer",
  21: "TokenGroup", 22: "GroupMemberPointer", 23: "TokenGroupMember", 25: "ScaledUiAmount", 26: "Pausable",
};
const DESCRIPTIVE = new Set([3, 4, 18, 19, 20, 21, 22, 23, 25]);
const isSet = (b: Uint8Array) => b.some((v) => v !== 0);

export function classifyMint(data: Uint8Array): MintReport {
  const decimals = data.length >= 45 ? data[44]! : 0;
  const refused = (why: string): MintReport => ({ verdict: "refused", reasons: [why], decimals });
  if (data.length === 82) return { verdict: "open", reasons: [], decimals };
  if (data.length < 166 || data[165] !== 1) return refused("not a mint account");

  const trust: string[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let at = 166; at + 4 <= data.length; ) {
    const ty = view.getUint16(at, true), len = view.getUint16(at + 2, true);
    if (ty === 0) break;
    if (at + 4 + len > data.length) return refused("malformed extension data");
    const v = data.subarray(at + 4, at + 4 + len);
    const name = NAMES[ty] ?? `extension ${ty}`;
    at += 4 + len;

    if (DESCRIPTIVE.has(ty)) continue;
    if (ty === 1 || ty === 16) return refused(`${name}: a deposit would arrive short of what the curve credits`);
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
  return { verdict: trust.length ? "issuer-trusted" : "open", reasons: trust, decimals };
}
