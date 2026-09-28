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
