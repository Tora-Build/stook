# The VPS: systemd units for the keeper, the tape and Soo's zk-resolver

The box runs these as systemd services under the `zak` user (no cron on it).
`install.sh` copies the units into /etc/systemd/system and starts them.

- `stook-keeper`: `infra/ladder-crank --watch`, env from `~/stook.env`.
  `stook-keeper-watchdog.timer` restarts it when no clean pass has written
  `~/ladder-crank.beat` for 5 minutes (a process can stay up with every
  request failing, as on 2026-09-25).
- `stook-tape`: `infra/tape`, env from `~/stook.env`. It starts its own
  cloudflared quick tunnel; stopping the service stops the tunnel too.
  `stook-tape-watchdog.timer` restarts it when no coin has updated for 45 minutes.
- `soo-resolver`: Soo's `infra/zk-resolver --serve --port 8790` from
  `~/soo/infra/zk-resolver` (its own `.env`), and `soo-resolver-pass.timer`
  runs `--once` every 5 minutes. `resolver.sooth.market` reaches it through
  the box's named Cloudflare tunnel (managed by Daniel).

Logs: `~/ladder-crank.log`, `~/stook-tape.log`, `~/resolver.log`, `~/resolver-cron.log`.

## Daily X post

`stook-x-bell.timer` (Mon, Wed, Fri 16:10 New York) and `stook-x-morning.timer`
(Tue, Thu 9:35) run `stook-x@<kind>.service`: `infra/x-poster/src/render.mjs`
opens the poster studio in a headless Chromium (playwright's headless shell in
`~/.cache/ms-playwright`), fills it from stookstreet.xyz/prices, renders it
frame by frame with ffmpeg (`~/bin/ffmpeg`, a static build) and sends the MP4
to `stookstreet.xyz/x/video` with the tape token. The worker holds the X keys
and posts it: once a New York day, at most 23 a month, never with a link
(X charges $0.20 for a post with a link, $0.015 without). Videos land in
`~/x-posts/`, the log in `~/stook-x.log`. Try one without posting:
`cd ~/stook/infra/x-poster && set -a && . ~/stook.env && node src/render.mjs bell --dry`.
Post today's by hand: `sudo systemctl start stook-x@bell`.

## Telegram alerts

`alert.sh` sends to Telegram; `watchdog.sh` calls it, from the timers:

- keeper can't read the chain (no pass for 5 min, restarted), rounds failing
  for 15 min, keeper wallet under 0.5 SOL (checked every 30 min)
- price tape stale for 45 min (restarted)
- Soo's resolver not answering `/health` (every 5 min)
- an X post that failed (`stook-x@.service` → `OnFailure=stook-x-alert@%i`)

Each problem alerts at most once an hour, and says so again when it recovers.
Keys: `/home/zak/stook-alerts.env` with `TG_BOT_TOKEN=` and `TG_CHAT_ID=`,
`chmod 600`, written by hand. Without the file the watchdog stays silent.
Test: `bash ~/stook/infra/vps/alert.sh --test`.

## Telegram: round notes, daily report, channel

With the same keys the box also sends:

- **Round notes** (keeper, `EnvironmentFile=-~/stook-alerts.env`): each round
  that opens, settles or voids, with its page link; hourly test rounds are
  skipped. Each note is also written, time-stamped, to `~/stook-events.log`.
- **Daily report** (`stook-health.timer`, 9:00 New York, `health.sh`): services,
  keeper pass and health age, wallet SOL, the last 24 h of opens, settles and
  voids, tape prices and their age, resolver, last X post, load, memory, disk.
- **Channel**: with `TG_CHANNEL=@StookStreet` in `~/stook-alerts.env` (the bot an
  admin allowed to post there), the bell and morning videos also go to the
  channel, once a day each, with the site's link.

## Simulated users

`stook-sim` runs `infra/sim --watch`: a fleet of devnet wallets (200 by
default) that trade the daily rounds the way the app does. Callers buy lines
and ranges near the live price, long shots buy the tails, traders buy and sell
hours later, houses deposit, starters fund tomorrow's round for a coin that
has none, and everyone collects after the close (some hours or days late).
`install.sh` installs the unit but does not enable or start it.

Pacing: a Poisson process that follows New York hours (quiet overnight, busier
at the open and busiest from 2 to 3 PM, the last hour before the rounds lock,
lower on weekends), at most `SIM_TX_PER_MIN` (4) transactions a minute. It
never sends from 15:50 to 16:15 New York, near any of its coins' rounds
opening or settling, or while the keeper's heartbeat is over a minute old:
those minutes are the keeper's. The pause is checked again right before every
send, so a turn that waited on the minute cap does not spill into it.

After the close the keeper sweeps each losing line with its own transaction
before its next heartbeat, so the fleet holds at most 15 lines in one round
(`SIM_MAX_POSITIONS_PER_ROUND`) and 40 across all rounds closing together
(`SIM_MAX_LINES_PER_CLOSE`): about a minute or two of sweeping.

Files in `~/sim` (the unit reads `~/stook.env`, `~/stook-alerts.env` and
`~/sim/sim.env`):

- `sim.env`, `chmod 600`, written by hand: `FAUCET_AUTHORITY=[…]` (the app's
  `VITE_FAUCET_AUTHORITY_BYTES`) and `DEVNET_MINTS='{"STOOK":"…",…}'` (the
  app's `VITE_DEVNET_MINTS`, twins only; never the mainnet mint). Optional:
  `QUOTE_MINT` (the app's `VITE_QUOTE_MINT`, so the faucet also mints test
  USDC as the app's does), `SIM_RPC_URL`, `SIM_WALLETS`, `SIM_TX_PER_MIN`,
  `SIM_DAILY_SOL`, `SIM_PERSONAS`. Every setting here wins over the
  environment, for the service and for the manual runs below alike.
- The RPC: `SIM_RPC_URL`, or the public devnet endpoint when unset. Never the
  keeper's `RPC_URL`: its key's quota keeps rounds opening and settling, and
  a run with `SIM_RPC_URL` set to it is refused. Its own key is best.
- `wallets/<n>.json`: the fleet's keys, made on first run, `0600`. `wallets.txt`
  lists their public keys, personas and sizes.
- `state.json` (the treasury's spend today, the report window),
  `journal.json` (what each wallet holds, so nothing needs an account scan),
  `actions.jsonl` (every action with its signature or error, rotated at
  20 MB), `issues.jsonl` (unexpected failures, one line per kind, counted),
  `lock` (the running `--once` or `--watch`; a second run is refused).

The treasury is `~/.config/solana/sim-treasury.json`; its public key is the
address to fund. It tops a wallet up to 0.05 SOL when it drops under 0.015,
and never sends more than `SIM_DAILY_SOL` (9) in a UTC day. Each top-up is
counted before it is sent, so a restart mid-send cannot lose track of it. Test coins come
from the faucet key, about $1,000 of each coin, at most once a day per wallet.

Telegram, through `alert.sh`: a new kind of unexpected failure (`sim-<hash>`,
at most hourly), a treasury under 1 SOL (`sim-treasury`), the service stopped
for good after five failed starts (`sim-dead`, from `stook-sim-failed`), and
the day's summary at 21:00 New York. A refusal the fleet's own check had ruled
out counts as unexpected: a slippage on a curve nobody moved (`QuoteMismatch`),
or coins short after the balance passed (`InsufficientFundsDespiteCheck`).
Those mean the app's quote or check disagrees with the program.

Before starting it, read what it would do; nothing is sent or written:

    cd ~/stook/infra/sim && set -a && . ~/stook.env && set +a && node src/index.mjs --plan 20

Then a few real turns, and the service:

    node src/index.mjs --once 3
    sudo systemctl enable --now stook-sim
    journalctl -u stook-sim -f; tail -f ~/sim/actions.jsonl

## Telegram commands

`stook-tgbot.service` runs `infra/sim/src/bot.mjs`: @stookstreet_bot answers
commands from `TG_CHAT_ID` only (everyone else is ignored): `/status` (the
health report, `health.sh --print`), `/fleet`, `/activity [n]`, `/issues`,
`/rounds`, `/wallet <n>`, `/pause` and `/resume` (stop or start `stook-sim`).
Check every answer without Telegram: `node src/bot.mjs --selftest` from
`~/stook/infra/sim` with the env files loaded.
