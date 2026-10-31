// Every coin's house and this address's stake in it, in one chain read.
// Any address can be read (the page's ?account= view); only the owner acts.
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import type { PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { COINS, seriesOf, type Coin } from "../../lib/coins";

export interface Stake {
  coin: Coin;
  house: PublicKey;
  h: stook.HouseAccount;
  s: stook.HouseStakeAccount;
  /** What the stake is worth now, its queued moves and what waits to claim. */
  mine: ReturnType<typeof stook.stakeValue>;
}

export function useStakes(owner: PublicKey | null) {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["house-stakes", owner?.toBase58()],
    enabled: !!owner,
    refetchInterval: 30_000,
    queryFn: async (): Promise<Stake[]> => {
      const coins = COINS.map((c) => ({ c, series: seriesOf(c) })).filter((x) => x.series) as { c: Coin; series: PublicKey }[];
      const houses = coins.map((x) => stook.deriveHouse(x.series));
      const keys = houses.flatMap((h) => [h, stook.deriveHouseStake(h, owner!)]);
      const infos = await connection.getMultipleAccountsInfo(keys);
      const out: Stake[] = [];
      coins.forEach((x, n) => {
        const hi = infos[n * 2], si = infos[n * 2 + 1];
        if (!hi || !si) return;
        try {
          const h = stook.decodeHouse(hi.data), s = stook.decodeHouseStake(si.data), mine = stook.stakeValue(h, s);
          if (mine.shares > 0n || mine.queuedDeposit > 0n || mine.claimable > 0n || mine.queuedShares > 0n) out.push({ coin: x.c, house: houses[n]!, h, s, mine });
        } catch { /* not a house account */ }
      });
      return out;
    },
  });
}
