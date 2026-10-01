// Base58 (Bitcoin alphabet), for public keys in event bytes and for
// instruction data, which jsonParsed transactions carry base58-encoded.

const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const IDX = new Map([...A].map((c, i) => [c, i]));

export function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = "";
  while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; s = "1" + s; }
  return s;
}

export function b58decode(s) {
  let n = 0n;
  for (const c of s) {
    const v = IDX.get(c);
    if (v === undefined) throw new Error("not base58");
    n = n * 58n + BigInt(v);
  }
  const out = [];
  while (n > 0n) { out.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const c of s) { if (c !== "1") break; out.unshift(0); }
  return Uint8Array.from(out);
}

/** A wallet or account address: base58 that decodes to exactly 32 bytes. */
export function isPubkey(s) {
  if (typeof s !== "string" || s.length < 32 || s.length > 44) return false;
  try { return b58decode(s).length === 32; } catch { return false; }
}
