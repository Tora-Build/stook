// The Pyth receiver as CommonJS: its ESM build imports
// `jito-ts/dist/sdk/block-engine/types` without an extension, which Node
// refuses. A static require, so a bundler can follow it too.
module.exports = require("@pythnetwork/pyth-solana-receiver");
