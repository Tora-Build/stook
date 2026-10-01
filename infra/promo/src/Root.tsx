import { Composition } from "remotion";
import { Ad } from "./Ad";

// 15 seconds at 30 fps, for X: a square feed post and a tall one.
export function Root() {
  return (
    <>
      <Composition id="Square" component={Ad} durationInFrames={450} fps={30} width={1080} height={1080} />
      <Composition id="Vertical" component={Ad} durationInFrames={450} fps={30} width={1080} height={1920} />
    </>
  );
}
