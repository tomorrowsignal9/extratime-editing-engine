import React from "react";
import { registerRoot, Composition } from "remotion";
import { Film } from "./Video";
import type { ProjectData } from "./schema";
const empty: ProjectData = {
  id: "empty",
  title: "EXTRATIME",
  duration: 1,
  audio: "media/empty.mp3",
  preset: "Documentary",
  captionY: 72,
  captionColor: "#C4EC77",
  approved: false,
  captions: [],
  scenes: [],
};
registerRoot(() => (
  <Composition
    id="EXTRATIME"
    component={Film}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={30}
    defaultProps={{ project: empty }}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.ceil(props.project.duration * 30),
    })}
  />
));
