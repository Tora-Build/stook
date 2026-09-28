// What a failure means. Expected ones are the market doing its job (the
// price moved, the round locked, the wallet ran short, someone collected
// first); transient ones are the network; anything else is unexpected and
// goes to the issue book, deduplicated by its signature.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Refusals the app itself explains to a person as ordinary (`explain()` in
// apps/stook/src/lib/chain.ts), plus the races a fleet adds. The fleet acts
// one turn at a time on what it just read, so some of these mean a bug when
// its own check passed first; `sim.mjs` renames those (see `renamed`).
const EXPECTED = new Set([
  "SlippageExceeded", "LadderCurveMoved", "LadderNotOpen", "LadderNotJoinable", "LadderInsufficientShares",
  "LadderBadTimes", "SeriesInactive", "ProtocolPaused", "InsufficientFunds", "InsufficientLamports",
  "AlreadyInUse", "NothingToCollect", "LadderNotFinal", "Skipped", "Paused",
  // A deposit or seed too big or too small for the round, or short of the
  // coin's transfer fee after the issuer changed it.
  "LadderTooDeep", "LadderSeedTooSmall", "LadderDepositShort",
]);
const TRANSIENT = new Set(["RateLimited", "Network", "Expired", "BlockhashNotFound"]);

const TOKEN_PROGRAMS = new Set(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);

// Anchor's own refusals (below 6000), for a failure that landed with only its code.
const ANCHOR_CODES = {
  100: "InstructionMissing", 101: "InstructionFallbackNotFound", 102: "InstructionDidNotDeserialize",
  2000: "ConstraintMut", 2001: "ConstraintHasOne", 2002: "ConstraintSigner", 2003: "ConstraintRaw", 2004: "ConstraintOwner",
  2006: "ConstraintSeeds", 2012: "ConstraintAddress", 2014: "ConstraintTokenMint", 2015: "ConstraintTokenOwner",
  3001: "AccountDiscriminatorNotFound", 3002: "AccountDiscriminatorMismatch", 3003: "AccountDidNotDeserialize",
  3007: "AccountOwnedByWrongProgram", 3010: "AccountNotSigner", 3012: "AccountNotInitialized", 4100: "DeclaredProgramIdMismatch",
};

let errorNames = null;
/** The program's error names by code, read from its source (6000 upward, in declaration order). */
export function loadErrorNames(path) {
  try {
    const src = readFileSync(path, "utf8");
    const body = src.slice(src.indexOf("pub enum"));
    errorNames = [...body.matchAll(/^\s{4}([A-Z][A-Za-z0-9]*),\s*$/gm)].map((m) => m[1]);
  } catch { errorNames = []; }
  return errorNames;
}
export const nameOfCode = (code) => (errorNames && errorNames[code - 6000]) || null;

/** The logs a web3.js error carries, wherever it keeps them. */
export function logsOf(e) {
  const l = e?.logs ?? e?.transactionLogs ?? e?.simulationLogs;
  return Array.isArray(l) ? l : [];
}

/**
 * A short name for why `e` failed during `action`: an Anchor error name,
 * a token or system refusal, or a network condition.
 */
export function errorName(e, action = "") {
  const text = `${e?.message ?? e ?? ""}`;
  const logs = logsOf(e).join("\n");
  const all = `${text}\n${logs}`;
  if (e?.simulated === "skipped" || /^skip:/.test(text)) return "Skipped";
  if (e?.name === "Paused") return "Paused";
  const named = all.match(/Error Code: (\w+)/);
  if (named) {
    if (named[1] === "AccountNotInitialized" && /redeem|claim|collect|sell/.test(action)) return "NothingToCollect";
    return named[1];
  }
  const custom = all.match(/"Custom":\s*(\d+)/) ?? all.match(/custom program error: 0x([0-9a-f]+)/i);
  if (custom) {
    const code = custom[0].includes("0x") ? parseInt(custom[1], 16) : Number(custom[1]);
    if (code >= 6000) return nameOfCode(code) ?? `Custom${code}`;
    const anchor = ANCHOR_CODES[code];
    if (anchor) return anchor === "AccountNotInitialized" && /redeem|claim|collect|sell/.test(action) ? "NothingToCollect" : anchor;
    if (code === 1 && (TOKEN_PROGRAMS.has(e?.programId) || /Token|insufficient/i.test(all))) return "InsufficientFunds";
    if (code === 0 && /already in use/i.test(all)) return "AlreadyInUse";
    if (code === 1 && /already in use/i.test(all)) return "AlreadyInUse";
  }
  if (/already in use/i.test(all)) return "AlreadyInUse";
  // SOL first: "insufficient funds for rent" is the wallet's SOL, not its coins.
  if (/insufficient lamports|insufficient funds for (rent|fee)|InsufficientFundsForRent|Attempt to debit an account but found no record of a prior credit/i.test(all)) return "InsufficientLamports";
  if (/insufficient funds/i.test(all)) return "InsufficientFunds";
  if (/AccountNotFound|could not find account|account does not exist/i.test(all)) return /redeem|claim|collect/.test(action) ? "NothingToCollect" : "AccountNotFound";
  // Out of compute: the units requested were too few for this trade (unexpected: the app asks for the same).
  if (/exceeded CUs meter|Computational budget exceeded|ComputationalBudgetExceeded/i.test(all)) return "ComputeExceeded";
  if (/\b429\b|Too Many Requests|rate limit/i.test(all)) return "RateLimited";
  if (/Blockhash not found/i.test(all)) return "BlockhashNotFound";
  if (/did not land|block height exceeded|expired/i.test(all)) return "Expired";
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|timed? ?out|50[234]\b/i.test(all)) return "Network";
  return "Unknown";
}

export function kindOf(name) {
  if (EXPECTED.has(name)) return "expected";
  if (TRANSIENT.has(name)) return "transient";
  return "unexpected";
}

/** The last few program log lines worth reading, short. */
export function logExcerpt(e, max = 4) {
  const lines = logsOf(e).filter((l) => /Error|failed|panicked|insufficient|Program log/i.test(l));
  return lines.slice(-max).map((l) => l.slice(0, 160));
}

/** Everything the action log and the issue book need about a failure. */
export function classify(e, action) {
  return describe(e, action, errorName(e, action));
}

/**
 * `c` under another name, unexpected: an ordinary refusal that the fleet's
 * own check had ruled out (a slippage with the curve unmoved, funds short
 * after the balance passed), so the app's quote or check disagrees with the
 * program. The original name stays in the message.
 */
export function renamed(e, action, c, name) {
  const r = describe(e, action, name, "unexpected");
  r.message = `${c.name}: ${r.message}`.slice(0, 300);
  return r;
}

function describe(e, action, name, kind = kindOf(name)) {
  // An unknown error's message, numbers and keys stripped, tells classes apart.
  const shape = name === "Unknown" ? `${e?.message ?? e}`.replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, "<key>").replace(/\d+/g, "#").slice(0, 120) : "";
  const signature = `${action}:${name}${shape ? `:${shape}` : ""}`;
  const hash = createHash("sha256").update(signature).digest("hex").slice(0, 8);
  return { name, kind, signature, hash, message: `${e?.message ?? e}`.slice(0, 300), logs: logExcerpt(e) };
}
