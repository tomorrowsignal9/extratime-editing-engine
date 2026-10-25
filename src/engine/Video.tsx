import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
} from "remotion";
import type { ProjectData } from "./schema";
export function Film({ project: p }: { project: ProjectData }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = p.captions.find((c) => f / fps >= c.start && f / fps < c.end);
  return (
    <AbsoluteFill
      style={{
        background: "#151D25",
        fontFamily: "Arial, sans-serif",
        color: "#F5F6F0",
      }}
    >
      <Audio src={staticFile(p.audio)} />
      {p.scenes.map((s, i) => {
        const cursor = p.scenes.slice(0, i).reduce((n, s) => n + s.duration, 0);
        const from = Math.round(cursor * fps);
        return (
          <Sequence
            key={i}
            from={from}
            durationInFrames={
              Math.round((cursor + s.duration) * fps) -
              from +
              (i < p.scenes.length - 1
                ? p.scenes[i + 1].transitionDuration === undefined
                  ? 8
                  : Math.min(
                      Math.ceil(p.scenes[i + 1].transitionDuration! * fps),
                      Math.round(p.scenes[i + 1].duration * fps) - 1,
                    )
                : 0)
            }
          >
            <Shot scene={s} index={i} />
          </Sequence>
        );
      })}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg,rgba(0,0,0,.35),transparent 35%,transparent 50%,rgba(0,0,0,.65))",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 100,
          left: 75,
          fontSize: 28,
          letterSpacing: 7,
          fontWeight: 800,
        }}
      >
        EXTRATIME <span style={{ color: "#C4EC77" }}> / </span> STORIES
      </div>
      {f < fps * 3 && (
        <div
          style={{
            position: "absolute",
            top: 190,
            left: 75,
            right: 90,
            fontSize: 56,
            fontWeight: 900,
            lineHeight: 1.1,
            textShadow: "0 3px 15px black",
          }}
        >
          {p.title}
        </div>
      )}
      {c && (
        <div
          style={{
            position: "absolute",
            top: `${p.captionY}%`,
            left: 90,
            right: 150,
            textAlign: "center",
            fontSize: p.captionFontSize ?? 42,
            whiteSpace: "pre-line",
            fontWeight: 900,
            lineHeight: 1.18,
            textShadow: "0 3px 8px black",
            color: p.captionColor,
          }}
        >
          <span
            style={{
              background: "rgba(8,15,22,.85)",
              boxDecorationBreak: "clone",
              padding: "8px 16px",
              borderRadius: 10,
            }}
          >
            {c.text}
          </span>
        </div>
      )}
      <div
        style={{
          position: "absolute",
          bottom: 110,
          left: 75,
          fontSize: 23,
          letterSpacing: 4,
          opacity: 0.8,
        }}
      >
        FOOTBALL. BEYOND THE SCORE.
      </div>
    </AbsoluteFill>
  );
}
function Shot({
  scene: s,
  index,
}: {
  scene: ProjectData["scenes"][number];
  index: number;
}) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = interpolate(f, [0, Math.max(1, s.duration * fps - 1)], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const scale =
    s.motion === "pull"
      ? 1 + s.strength * (1 - t)
      : s.motion === "punch"
        ? 1 + s.strength * Math.min(t * 4, 1)
        : 1 + s.strength * t;
  const x =
    s.motion === "pan"
      ? (t - 0.5) *
        70 *
        (s.strength / 0.12) *
        (s.panDirection === "left" ? -1 : 1)
      : 0;
  const transitionFrames =
    s.transitionDuration === undefined
      ? undefined
      : Math.max(
          1,
          Math.min(
            Math.round(s.duration * fps) - 1,
            Math.round(s.transitionDuration * fps),
          ),
        );
  const opacity =
    index && s.transition === "fade" && s.transitionDuration !== 0
      ? Math.min(1, f / (transitionFrames ?? 7))
      : 1;
  return (
    <AbsoluteFill
      style={{
        opacity,
        transform:
          s.transition === "slide" && index && s.transitionDuration !== 0
            ? `translateX(${Math.max(0, 1 - f / (transitionFrames ?? 8)) * 100}%)`
            : undefined,
      }}
    >
      <Img
        src={staticFile(s.asset)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: `${s.focalX * 100}% ${s.focalY * 100}%`,
          transform: `scale(${s.motion === "pan" ? 1 + s.strength * 1.25 : scale}) translateX(${x}px)`,
          transformOrigin: `${s.focalX * 100}% ${s.focalY * 100}%`,
        }}
      />
      {s.foreground && (
        <Img
          src={staticFile(s.foreground)}
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${1 + s.strength * t * 1.6}) translateX(${-x * 0.5}px)`,
          }}
        />
      )}
    </AbsoluteFill>
  );
}
