// web3.js and wallet-adapter-base touch Buffer at module init; set it first.
import { Buffer } from "buffer";
const w = window as unknown as Record<string, unknown>;
if (!w.Buffer) w.Buffer = Buffer;
if (!w.process) w.process = { env: {} };
if (!w.global) w.global = window;
