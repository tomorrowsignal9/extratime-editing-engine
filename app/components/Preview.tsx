"use client";
import { Player, type PlayerRef } from "@remotion/player";
import { useRef, useEffect, useState, useMemo } from "react";
import { Film } from "../../src/engine/Video";
import type { ProjectData } from "../../src/engine/schema";
export default function Preview({ project }: { project: ProjectData }) {
  const player = useRef<PlayerRef>(null);
  const container = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState(0);
  const duration = Math.ceil(project.duration * 30);
  const inputProps = useMemo(() => ({ project }), [project]);
  useEffect(() => {
    const p = player.current;
    const update = ({ detail }: { detail: { frame: number } }) =>
      setFrame(detail.frame);
    p?.addEventListener("frameupdate", update);
    const visibility = () => {
      if (document.hidden) p?.pause();
    };
    document.addEventListener("visibilitychange", visibility);
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) p?.pause();
    });
    if (container.current) observer.observe(container.current);
    return () => {
      p?.removeEventListener("frameupdate", update);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return (
    <div ref={container} className="preview-wrap">
      <Player
        ref={player}
        component={Film}
        inputProps={inputProps}
        durationInFrames={duration}
        fps={30}
        compositionWidth={1080}
        compositionHeight={1920}
        controls
        style={{ width: "100%", maxWidth: 320, aspectRatio: "9/16" }}
        acknowledgeRemotionLicense
        errorFallback={({ error }) => (
          <p role="alert">Preview error: {error.message}</p>
        )}
      />
      <div className="transport">
        <button
          onClick={() => {
            player.current?.seekTo(0);
            player.current?.pause();
          }}
          aria-label="Restart preview"
        >
          ↶
        </button>
        <button onClick={() => player.current?.play()}>Play</button>
        <button onClick={() => player.current?.pause()}>Pause</button>
        <output aria-label="Playback time">
          {(frame / 30).toFixed(2)} / {project.duration.toFixed(2)}s
        </output>
      </div>
      <input
        aria-label="Seek preview"
        type="range"
        min={0}
        max={duration - 1}
        value={Math.min(frame, duration - 1)}
        onChange={(e) => player.current?.seekTo(Number(e.target.value))}
      />
    </div>
  );
}
