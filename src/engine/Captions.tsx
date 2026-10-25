import React from "react";
import type { ProjectData } from "./schema";
export function Captions({
  project: p,
  frame,
}: {
  project: ProjectData;
  frame: number;
}) {
  const c = p.captions.find((c) => frame / 30 >= c.start && frame / 30 < c.end);
  if (!c) return null;
  const style = p.captionStyle || "classic";
  const timed = Boolean(
    p.captionTiming?.reliable && p.captionTiming.reviewed && c.words?.length,
  );
  return (
    <div
      data-caption="true"
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
          background: style === "minimal" ? "transparent" : "rgba(8,15,22,.85)",
          boxDecorationBreak: "clone",
          padding: "8px 16px",
          borderRadius: 10,
        }}
      >
        {timed && (style === "highlight" || style === "kinetic")
          ? c.words!.map((w, i) => {
              const active = frame / 30 >= w.start && frame / 30 < w.end;
              const age = frame - w.start * 30;
              const bounce =
                active && style === "kinetic"
                  ? 1 +
                    0.08 * Math.sin(Math.min(1, Math.max(0, age / 5)) * Math.PI)
                  : 1;
              return (
                <React.Fragment key={i}>
                  {i > 0 ? " " : ""}
                  <span
                    data-spoken={active ? "true" : undefined}
                    style={{
                      display: "inline-block",
                      marginInline: "0.08em",
                      color: active ? p.captionColor : "#F5F6F0",
                      transform: `scale(${bounce})`,
                      textDecoration:
                        active && style === "highlight"
                          ? "underline"
                          : undefined,
                      textUnderlineOffset: 6,
                    }}
                  >
                    {w.text}
                  </span>
                </React.Fragment>
              );
            })
          : c.text}
      </span>
    </div>
  );
}
