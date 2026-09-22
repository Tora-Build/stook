import { Clock, type SvmContext } from "./svm.js";

/** Move the sysvar clock to an absolute unix timestamp, keeping slot and epoch. */
export function warpClockTo(ctx: SvmContext, unixTimestamp: bigint): void {
  const clock = ctx.svm.getClock();
  ctx.setClock(new Clock(clock.slot, clock.epochStartTimestamp, clock.epoch, clock.leaderScheduleEpoch, unixTimestamp));
}
