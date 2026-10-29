# Mainnet

| file | what |
|---|---|
| `build.sh` | the program, as small as it goes (rent is per byte): `target/mainnet/sooth_core.so` |
| `setup.mjs` | after the deploy: `init`, `series`, `seed`, `house`, `deposit <SSt.>`; with no step, status |
| `../../infra/ladder-crank/dryrun/pool-dryrun.sh` | the same setup on a local validator, the pool cloned from mainnet |

## Deploy

```sh
sh scripts/mainnet/build.sh
solana program deploy target/mainnet/sooth_core.so \
  --program-id ~/.config/solana/stook-program-keypair.json \
  --upgrade-authority ~/.config/solana/id.json -u mainnet-beta
```

Never pass `--final` and never `solana program set-upgrade-authority --final`:
the upgrade authority is what lets the rent come back (below).

Run `setup.mjs init series seed house deposit` shortly before a 4 PM New York
bell, so the house's first round opens on time. `seed` needs the pool's
observation entries to cover the latest close (they cover about a day).

## What it costs and what comes back

| | SOL | comes back |
|---|---|---|
| the program (678 KB) | about 4.72 | yes: `solana program close` |
| protocol config, the series, the house and its vault, the deployer's stake | about 0.010 | no: no instruction closes them |
| each round (0.0105, at most about 31 open) | up to 0.33, on the keeper | yes: the keeper closes each round once it is paid out |
| an epoch record (0.0014), only on a day someone queued into or out of the house | a few a month | no |
| fees | about 0.001 a month | no |

## Getting the SOL back

In this order. Closing the program first would strand every coin still in
the house's vault and every unclaimed win, for good, and a closed program's
address can never be used again.

1. Stop new rounds: `setSeriesIx(authority, series, false)` (the round
   already running finishes).
2. After its bell: the keeper settles it and collects the house. Everyone in
   the house withdraws and claims (`house_withdraw`, then `house_claim` after
   the next collect; with no round running, at once).
3. Wait until every round is closed. The keeper sweeps finished positions as
   it goes and pays out the rest 30 days after each bell, then closes the
   round and gets its 0.0105 SOL back. `node scripts/mainnet/setup.mjs`
   shows what is left; nothing may be in a round or in the vault.
4. Close the program; its rent goes to the recipient:
   ```sh
   solana program close 55kGEMHJyNbD3qcdonCD8UPTqzM85yg2kr6M5UF5P353 \
     --recipient DMUtpDCXfmumuR5kKC5h17u1SVS632KgHVZMK4zbgRre \
     --authority ~/.config/solana/id.json --bypass-warning -u mainnet-beta
   ```
5. Send the keeper wallet's SOL home:
   `solana transfer DMUtpDCXfmumuR5kKC5h17u1SVS632KgHVZMK4zbgRre ALL -k <keeper key> -u mainnet-beta`.

What stays lost: about 0.01 SOL of small accounts, the epoch records, and fees.
