import { Config } from "@remotion/cli/config";

// H.264 in yuv420p plays everywhere X serves video; crf 20 keeps 15 s well under X's limits.
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");
Config.setCrf(20);
Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);
// If Remotion cannot fetch its own headless Chrome, point it at one already on the machine:
//   REMOTION_CHROME=/path/to/chrome npx remotion render ...
if (process.env.REMOTION_CHROME) Config.setBrowserExecutable(process.env.REMOTION_CHROME);
