// Renders one daily video on the box from the prebuilt bundle (bundle-daily):
//   node daily-render.mjs <DailyBell|DailyMorning> <props.json> <out.mp4> [from to]
// With a frame range the audio is left out: the box joins that part to the prebuilt clips.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMedia, selectComposition } from "@remotion/renderer";

const [, , id, propsFile, out, from, to] = process.argv;
const frameRange = from ? [Number(from), Number(to)] : null;
const here = dirname(fileURLToPath(import.meta.url)), serveUrl = join(here, "bundle-daily"), inputProps = JSON.parse(readFileSync(propsFile, "utf8"));
const browserExecutable = process.env.DAILY_CHROME, chromiumOptions = {};
const composition = await selectComposition({ serveUrl, id, inputProps, browserExecutable, chromiumOptions });
await renderMedia({ composition, serveUrl, codec: "h264", crf: 17, pixelFormat: "yuv420p", imageFormat: "png", audioCodec: "aac", outputLocation: out, inputProps, browserExecutable, chromiumOptions, concurrency: 1, offthreadVideoCacheSizeInBytes: 256 * 1024 * 1024, timeoutInMilliseconds: 120000, overwrite: true, frameRange, muted: !!frameRange });
