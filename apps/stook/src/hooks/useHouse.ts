// A coin's house, from chain: null when the coin has none. A coin with a house
// gets its rounds from it, one a day; nobody funds a day by hand.
import { useConnection } from "@solana/wallet-adapter-react";
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
