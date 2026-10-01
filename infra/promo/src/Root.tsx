import { Composition } from "remotion";
import { Ad, Ad6, Full, type AdProps } from "./Ad";
import { FPS, FULL, LONG, SHORT } from "./config";

// For X: the full-length ad (the track's length), a 15 s and a 6 s cut, each
// square and tall. Music: public/music.mp3 if present; { track: "none" } is silent.
const props: AdProps = { track: null };
export function Root() {
  return (
    <>
      <Composition id="Full" component={Full} durationInFrames={FULL.total} fps={FPS} width={1080} height={1080} defaultProps={props} />
      <Composition id="FullVertical" component={Full} durationInFrames={FULL.total} fps={FPS} width={1080} height={1920} defaultProps={props} />
      <Composition id="Square" component={Ad} durationInFrames={LONG.total} fps={FPS} width={1080} height={1080} defaultProps={props} />
      <Composition id="Vertical" component={Ad} durationInFrames={LONG.total} fps={FPS} width={1080} height={1920} defaultProps={props} />
      <Composition id="Square6" component={Ad6} durationInFrames={SHORT.total} fps={FPS} width={1080} height={1080} defaultProps={props} />
      <Composition id="Vertical6" component={Ad6} durationInFrames={SHORT.total} fps={FPS} width={1080} height={1920} defaultProps={props} />
    </>
  );
}
