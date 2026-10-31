// A coin's house, from chain: null when the coin has none. A coin with a house
// gets its rounds from it, one a day; nobody funds a day by hand.
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import type { PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";

export function useHouse(series: PublicKey | null) {
  const { connection } = useConnection();
  const house = series ? stook.deriveHouse(series) : null;
  return useQuery({
    queryKey: ["house-account", house?.toBase58()],
    queryFn: async () => { const a = await connection.getAccountInfo(house!); return a ? stook.decodeHouse(a.data) : null; },
    enabled: !!house,
    refetchInterval: 60_000,
  });
}

/** The house and the connected wallet's stake in it, in one read every 15 s.
 *  One query key for every place that shows the house, so they share it. */
export function useHouseRead(series: PublicKey | null) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const house = series ? stook.deriveHouse(series) : null;
  const q = useQuery({
    queryKey: ["house", house?.toBase58(), publicKey?.toBase58()],
    queryFn: async () => {
      const [h, s] = await connection.getMultipleAccountsInfo([house!, ...(publicKey ? [stook.deriveHouseStake(house!, publicKey)] : [])]);
      return { h: h ? stook.decodeHouse(h.data) : null, s: s ? stook.decodeHouseStake(s.data) : null };
    },
    enabled: !!house,
    refetchInterval: 15_000,
    // A wallet connect or switch changes the key; keep the house (not the old
    // wallet's stake) while the new read is out, so nothing flashes.
    placeholderData: (prev, prevQuery) => (prev && prevQuery?.queryKey[1] === house?.toBase58() ? { h: prev.h, s: null } : undefined),
  });
  return { ...q, house };
}
