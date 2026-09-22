import { useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import * as chain from "../lib/chain";
import { useToast } from "../components/Toast";

export const useLadders = () => {
  const { connection } = useConnection();
  return useQuery({ queryKey: ["ladders"], queryFn: () => chain.fetchLadders(connection), refetchInterval: 15_000 });
};

export const useLadder = (pubkey: PublicKey | null) => {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["ladder", pubkey?.toBase58()],
    queryFn: () => chain.fetchLadder(connection, pubkey!),
    enabled: !!pubkey,
    refetchInterval: 5_000,
  });
};

export const usePositions = (ladder: PublicKey | null) => {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  return useQuery({
    queryKey: ["positions", ladder?.toBase58(), publicKey?.toBase58()],
    queryFn: () => chain.fetchPositions(connection, ladder!, publicKey!),
    enabled: !!ladder && !!publicKey,
  });
};

export const useTranches = (ladder: PublicKey | null, mineOnly: boolean) => {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  return useQuery({
    queryKey: ["tranches", ladder?.toBase58(), mineOnly ? publicKey?.toBase58() : "all"],
    queryFn: () => chain.fetchTranches(connection, ladder!, mineOnly ? publicKey! : undefined),
    enabled: !!ladder && (!mineOnly || !!publicKey),
  });
};

export const useMint = (mint: PublicKey | null) => {
  const { connection } = useConnection();
  return useQuery({ queryKey: ["mint", mint?.toBase58()], queryFn: () => chain.fetchMint(connection, mint!), enabled: !!mint, staleTime: Infinity });
};

export const useBalance = (mint: PublicKey | null, tokenProgram: PublicKey | undefined) => {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  return useQuery({
    queryKey: ["balance", mint?.toBase58(), publicKey?.toBase58()],
    queryFn: () => chain.fetchTokenBalance(connection, mint!, publicKey!, tokenProgram!),
    enabled: !!mint && !!publicKey && !!tokenProgram,
    refetchInterval: 10_000,
  });
};

export const useLivePrice = (feedId: Uint8Array | null) => {
  const { connection } = useConnection();
  const key = useMemo(() => (feedId ? Array.from(feedId).join(",") : null), [feedId]);
  return useQuery({ queryKey: ["live", key], queryFn: () => chain.fetchLivePrice(connection, feedId!), enabled: !!feedId, refetchInterval: 20_000 });
};

/** A transaction, with the refetches and the toast it implies. */
export function useSend(label: string) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (ixs: TransactionInstruction[] | { ixs: TransactionInstruction[]; computeUnits: number }) =>
      Array.isArray(ixs) ? chain.send(connection, wallet, ixs) : chain.send(connection, wallet, ixs.ixs, ixs.computeUnits),
    onSuccess: (sig) => { toast.ok(`${label} confirmed`, sig); void qc.invalidateQueries(); },
    onError: (e) => toast.err(chain.explain(e)),
  });
}

export const useRefs = (ladderKey: PublicKey | null, l: stook.LadderAccount | null | undefined, tokenProgram?: PublicKey): stook.LadderRefs | null =>
  useMemo(() => (ladderKey && l && tokenProgram ? { ladder: ladderKey, quoteMint: l.quoteMint, tokenProgram } : null), [ladderKey, l, tokenProgram]);
