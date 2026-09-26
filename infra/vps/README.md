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
