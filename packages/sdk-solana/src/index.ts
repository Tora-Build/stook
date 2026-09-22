// Public surface of `@sooth/sdk-solana`, Stook's client library.
//
// `stook` is the whole of it: quote maths that matches the program to the
// base unit, account decoders, instruction builders, and the keeper's
// decision logic. `math/lmsr` is the fixed-point core the quotes run on.

export { SOOTH_CORE_PROGRAM_ID, SOOTH_CORE_HEAP_LEN } from "./program.js";
export * as stook from "./ladder/index.js";
export { WAD, LN2_WAD, expWad, lnWad, wadMul, wadDiv, LmsrMathError } from "./math/lmsr.js";
