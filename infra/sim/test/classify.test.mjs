// Failures sorted into expected, transient and unexpected.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { classify, errorName, loadErrorNames, nameOfCode, renamed } from "../src/classify.mjs";

const anchor = (name) => Object.assign(new Error("Simulation failed"), { logs: ["Program log: Instruction: LadderTrade", `Program log: AnchorError occurred. Error Code: ${name}. Error Number: 6001. Error Message: x.`] });

test("the market doing its job is expected", () => {
  for (const n of ["SlippageExceeded", "LadderCurveMoved", "LadderNotOpen", "LadderNotJoinable", "LadderBadTimes"]) assert.equal(classify(anchor(n), "buy").kind, "expected");
  const token = Object.assign(new Error("Simulation failed"), { logs: ["Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb failed: custom program error: 0x1"] });
  assert.equal(errorName(token, "buy"), "InsufficientFunds");
  assert.equal(classify(anchor("AccountNotInitialized"), "collect").name, "NothingToCollect");
  assert.equal(classify(new Error("Allocate: account Address { address: X } already in use"), "start").kind, "expected");
  assert.equal(classify(new Error("Attempt to debit an account but found no record of a prior credit."), "buy").name, "InsufficientLamports");
});

test("the network is transient", () => {
  assert.equal(classify(new Error("429 Too Many Requests"), "buy").kind, "transient");
  assert.equal(classify(new Error("fetch failed"), "buy").kind, "transient");
  assert.equal(classify(new Error("the network did not include the transaction in time, twice (expired)"), "buy").kind, "transient");
});

test("anything else is unexpected, and one class per cause", () => {
  const a = classify(anchor("MathOverflow"), "join");
  assert.equal(a.kind, "unexpected");
  assert.equal(a.signature, "join:MathOverflow");
  const u1 = classify(new Error("weird thing at slot 123 for 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"), "buy");
  const u2 = classify(new Error("weird thing at slot 456 for 4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T"), "buy");
  assert.equal(u1.kind, "unexpected");
  assert.equal(u1.hash, u2.hash);
  assert.notEqual(u1.hash, classify(new Error("weird thing"), "sell").hash);
});

test("a failure that landed is named from the program's error enum", () => {
  loadErrorNames(fileURLToPath(new URL("../../../packages/programs-core/programs/sooth-core/src/error.rs", import.meta.url)));
  assert.equal(nameOfCode(6001), "SlippageExceeded");
  const landed = new Error('transaction failed: {"InstructionError":[3,{"Custom":6001}]}');
  assert.equal(classify(landed, "buy").name, "SlippageExceeded");
  assert.equal(classify(landed, "buy").kind, "expected");
});

test("running out of compute is its own unexpected class, however the node words it", () => {
  const a = Object.assign(new Error("Simulation failed. Program failed to complete"), { logs: ["Program X failed: exceeded CUs meter at BPF instruction"] });
  const b = new Error("Transaction simulation failed: Error processing Instruction 4: Computational budget exceeded");
  assert.equal(classify(a, "buy").name, "ComputeExceeded");
  assert.equal(classify(b, "buy").name, "ComputeExceeded");
  assert.equal(classify(a, "buy").kind, "unexpected");
  assert.equal(classify(a, "buy").hash, classify(b, "buy").hash);
});

test("refusals the app explains as ordinary are expected", () => {
  for (const n of ["LadderTooDeep", "LadderSeedTooSmall", "LadderDepositShort"]) assert.equal(classify(anchor(n), "join").kind, "expected", n);
});

test("a landed failure with only a code is named: a token transfer short, Anchor's own codes", () => {
  const short = Object.assign(new Error('transaction failed: {"InstructionError":[3,{"Custom":1}]}'), { programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", landed: true });
  assert.equal(classify(short, "buy").name, "InsufficientFunds");
  assert.equal(classify(new Error('transaction failed: {"InstructionError":[2,{"Custom":2006}]}'), "buy").name, "ConstraintSeeds");
  assert.equal(classify(new Error('transaction failed: {"InstructionError":[2,{"Custom":3012}]}'), "collect").name, "NothingToCollect");
  assert.equal(classify(new Error('transaction failed: {"InstructionError":[2,{"Custom":3012}]}'), "buy").name, "AccountNotInitialized");
});

test("SOL short for rent is the wallet's SOL, not its coins", () => {
  assert.equal(classify(new Error("Transaction results in an account (1) with insufficient funds for rent"), "buy").name, "InsufficientLamports");
});

test("a refusal the fleet's own check ruled out is renamed unexpected, the original kept in the message", () => {
  const e = anchor("SlippageExceeded");
  const c = classify(e, "buy");
  const r = renamed(e, "buy", c, "QuoteMismatch");
  assert.equal(r.kind, "unexpected");
  assert.equal(r.signature, "buy:QuoteMismatch");
  assert.match(r.message, /^SlippageExceeded: /);
  assert.notEqual(r.hash, c.hash);
});
