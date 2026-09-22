// The protocol's own account and the five instructions that administer it.

import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import { SOOTH_CORE_PROGRAM_ID } from "../program.js";

const DISC = {
  initialize: [188, 233, 252, 106, 134, 146, 202, 91],
  setPaused: [91, 60, 125, 192, 176, 225, 166, 218],
  setTreasury: [57, 97, 196, 95, 195, 206, 106, 136],
  transferAuthority: [48, 169, 76, 72, 229, 180, 55, 161],
  acceptAuthority: [107, 86, 198, 91, 33, 12, 107, 160],
} as const;
export const CONFIG_DISCRIMINATOR = Uint8Array.from([207, 91, 250, 28, 152, 179, 215, 209]);

export const deriveProtocolConfig = (programId = SOOTH_CORE_PROGRAM_ID) =>
  PublicKey.findProgramAddressSync([new TextEncoder().encode("protocol_config")], programId)[0];

export interface ProtocolConfigAccount { authority: PublicKey; pendingAuthority: PublicKey; treasury: PublicKey; paused: boolean }

export function decodeProtocolConfig(data: Uint8Array): ProtocolConfigAccount {
  for (let i = 0; i < 8; i++) if (data[i] !== CONFIG_DISCRIMINATOR[i]) throw new Error("not a ProtocolConfig account");
  return {
    authority: new PublicKey(data.slice(8, 40)),
    pendingAuthority: new PublicKey(data.slice(40, 72)),
    treasury: new PublicKey(data.slice(72, 104)),
    paused: data[104] === 1,
  };
}

const signer = (pubkey: PublicKey, isWritable = false): AccountMeta => ({ pubkey, isSigner: true, isWritable });
const rw = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
const ro = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
const data = (disc: readonly number[], ...parts: Uint8Array[]) => Buffer.concat([Uint8Array.from(disc), ...parts]);

export const initializeProtocolIx = (authority: PublicKey, treasury: PublicKey, programId = SOOTH_CORE_PROGRAM_ID) =>
  new TransactionInstruction({ programId, data: data(DISC.initialize, treasury.toBytes()), keys: [signer(authority, true), rw(deriveProtocolConfig(programId)), ro(SystemProgram.programId)] });

const administer = (disc: readonly number[], authority: PublicKey, programId: PublicKey, ...parts: Uint8Array[]) =>
  new TransactionInstruction({ programId, data: data(disc, ...parts), keys: [rw(deriveProtocolConfig(programId)), signer(authority)] });

export const setPausedIx = (authority: PublicKey, paused: boolean, programId = SOOTH_CORE_PROGRAM_ID) =>
  administer(DISC.setPaused, authority, programId, Uint8Array.of(paused ? 1 : 0));
export const setTreasuryIx = (authority: PublicKey, treasury: PublicKey, programId = SOOTH_CORE_PROGRAM_ID) =>
  administer(DISC.setTreasury, authority, programId, treasury.toBytes());
export const transferAuthorityIx = (authority: PublicKey, nominee: PublicKey, programId = SOOTH_CORE_PROGRAM_ID) =>
  administer(DISC.transferAuthority, authority, programId, nominee.toBytes());
export const acceptAuthorityIx = (nominee: PublicKey, programId = SOOTH_CORE_PROGRAM_ID) =>
  new TransactionInstruction({ programId, data: data(DISC.acceptAuthority), keys: [rw(deriveProtocolConfig(programId)), signer(nominee)] });
