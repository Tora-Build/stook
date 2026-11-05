# The VPS: systemd units for the keeper, the ledger and the tape

The box runs these as systemd services under the `zak` user (no cron on it).
`install.sh` copies the units into /etc/systemd/system and starts them.

- `stook-keeper-mainnet`: `infra/ladder-crank --watch`, env from `~/stook-mainnet.env`.
  `stook-keeper-mainnet-watchdog.timer` restarts it when no clean pass has written
  `~/ladder-crank.beat` for 5 minutes (a process can stay up with every
  request failing, as on 2026-09-25).
- `stook-tape`: `infra/tape`, env from `~/stook.env`. It starts its own
  cloudflared quick tunnel; stopping the service stops the tunnel too.
  `stook-tape-watchdog.timer` restarts it when no coin has updated for 45 minutes.
- `stook-ledger`: `infra/ledger`, the history behind the History tab on Yours
  (see "Ledger" below). `stook-ledger-watchdog.timer` restarts it when it has
  not read the chain for 10 minutes.

Logs: `~/ladder-crank.log`, `~/stook-tape.log`, `~/ledger.log`, `~/stook-bot.log`.

## Daily Telegram video

`stook-x-bell.timer` (Mon, Wed, Fri 16:10 New York) and `stook-x-morning.timer`
(Tue, Thu 9:35) run `stook-x@<kind>.service`: `infra/x-poster/src/render.mjs`
opens the poster studio in a headless Chromium (playwright's headless shell in
`~/.cache/ms-playwright`), fills it from stookstreet.xyz/prices, renders it
frame by frame with ffmpeg (`~/bin/ffmpeg`, a static build) and sends the MP4
to the Telegram channel. Nothing posts to X through the API; X posts are made
by hand. Videos land in `~/x-posts/`, the log in `~/stook-x.log`. Try one
without posting:
`cd ~/stook/infra/x-poster && set -a && . ~/stook.env && node src/render.mjs bell --dry`.
Post today's by hand: `sudo systemctl start stook-x@bell`.

The video is the street cut's design (`infra/promo/src/Daily.tsx`, compositions
`DailyBell`, `DailyMorning`). `~/stook-daily` holds the bundle, `cuts.json` and
prebuilt clips (`clips/<kind>-head.mp4`, `-tail.mp4`, `<kind>.m4a`). Each post
renders only the part with the numbers, about 3 minutes, then `src/daily.mjs`
joins it and checks it. Any failure falls back to the old studio video. After a
change to `Daily.tsx`: rebuild the bundle, then `~/stook-daily/daily-clips-box.sh`.

## Telegram alerts

`alert.sh` sends to Telegram; `watchdog.sh` calls it, from the timers:

- keeper can't read the chain (no pass for 5 min, restarted), rounds failing
  for 15 min, keeper wallet under 0.15 SOL (checked every 30 min)
- price tape stale for 45 min (restarted)
- a Telegram video post that failed (`stook-x@.service` → `OnFailure=stook-x-alert@%i`)

Each problem alerts at most once an hour, and says so again when it recovers.
Keys: `/home/zak/stook-alerts.env` with `TG_BOT_TOKEN=` and `TG_CHAT_ID=`,
`chmod 600`, written by hand. Without the file the watchdog stays silent.
Test: `bash ~/stook/infra/vps/alert.sh --test`.

## Telegram: round notes, daily report, channel

With the same keys the box also sends:

- **Round notes** (keeper, `EnvironmentFile=-~/stook-alerts.env`): each round
  that opens, settles or voids, with its page link; hourly test rounds are
  skipped. Each note is also written, time-stamped, to `~/stook-events-mainnet.log`.
- **Mainnet report** (`stook-health.timer`, 9:00 and 16:30 New York, `monitor.mjs report`):
  calls, wallets, volume and fees, the rounds, the house and wallet balances, the
  market, and the systems. By hand, without sending:
  `set -a; . ~/stook-mainnet.env; set +a; node --experimental-sqlite monitor.mjs report --print`
- **Mainnet commands** (`stook-bot`, `monitor.mjs bot`): `/status`, `/trades [n]`,
  `/wallets`, `/rounds`, `/balances`, `/market`, `/systems`, `/help`. It reads only and
  answers `TG_CHAT_ID` only. Try one on the box, without Telegram:
  `set -a; . ~/stook-mainnet.env; set +a; node --experimental-sqlite monitor.mjs ask /rounds`
- **Mainnet watch** (`stook-monitor.timer`, every 5 minutes, `monitor.mjs watch`): each
  new trade, and an alert for a service down, rounds failing, a late settle, no round
  open, a void, the house down 10%, the site or RPC proxy not answering, a stale
  price, or a daily video that fell back to the old one.
- **Channel**: with `TG_CHANNEL=@StookStreet` in `~/stook-alerts.env` (the bot an
  admin allowed to post there), the bell and morning videos also go to the
  channel, once a day each, with the site's link.

## Ledger

`stook-ledger-mainnet` runs `infra/ledger`: it reads every sooth_core transaction once
(`getSignaturesForAddress` on the program, then `getTransaction`), turns each
into rows per wallet (calls, adds, sells, collects, refunds, house deposits and
payouts, round starts, the starter's fees, keeper sweeps), and serves a
wallet's rounds on `127.0.0.1:8793`: `/history?wallet=&limit=&before=&coin=&result=`
and `/health`. Read only: no key, nothing sent.

- First start: a backfill from the newest transaction back to the program's
  first (about 3,250 on 2026-10-01; about an hour and a half on the public
  endpoint, whose 429s hold `getTransaction` near 1 a second), then a poll
  every 15 s for what is newer. Both cursors are saved; a restart resumes.
- Store: `~/ledger/ledger.db` (node:sqlite; the unit passes
  `--experimental-sqlite`, which Node 22.5 to 22.12 need and later versions
  ignore). On a Node without node:sqlite it keeps `~/ledger/ledger.jsonl`
  instead and rebuilds its index on start. Delete `~/ledger` to rebuild from
  the chain.
- RPC: `LEDGER_RPC_URL` (the public mainnet endpoint), `LEDGER_RPS` (3), with
  back-off on 429 and 5xx. Never the keeper's `RPC_URL`. A day costs about
  5,800 signature polls plus one `getTransaction` per program transaction
  (about 1,300 a day now); `/health` shows the running rate.
- Older transactions: the program is upgraded in place, and an instruction or
  event of an earlier layout (account count or event size not today's) is
  not read, so rounds from before 2026-09-23 may show without their terms.
  A few settles and opens can be missing from the signature index; such a
  round still shows as finished once it has paid out, without its floor.
- Coins: rounds are named by their quote mint, from `DEVNET_MINTS` in
  `~/sim/sim.env` (only that key is read) or `LEDGER_MINTS`, else by feed.
- The world reaches it through the tape's tunnel: `stook-tape` passes
  `/history` and `/ledger/health` to it, and the Worker's `/history` (15 s
  cache) reads the tape's registered address. No tunnel of its own.
- Watchdog: no successful poll for 10 minutes (or no answer on `/health`):
  restart and a Telegram alert (`ledger`), and an all-clear when it is back.

Check it: `curl -s localhost:8792/health`, and from outside
`curl -s 'https://stookstreet.xyz/history?wallet=<address>'`.
