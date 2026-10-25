import { Project, type ProjectData } from "../engine/schema";
export function suggestEdit(p: ProjectData) {
  const count = p.scenes.length,
    total = Math.ceil(p.duration * 30);
  let previous = 0;
  const reasons: string[] = [];
  const boundaries: number[] = [0];
  for (let i = 1; i < count; i++) {
    const target = (total * i) / count;
    const candidates = p.captions
      .map((c, index) => {
        const frame = Math.round(c.start * 30);
        const sentence = index > 0 && /[.!?]$/.test(p.captions[index - 1].text);
        const pause = index > 0 ? c.start - p.captions[index - 1].end : 0;
        const beat =
          /\b(19\d\d|20\d\d|only|record|but|later|they called)\b/i.test(c.text);
        return {
          frame,
          score:
            Math.abs(frame - target) -
            (sentence ? 12 : 0) -
            (pause > 0.2 ? 9 : 0) -
            (beat ? 6 : 0),
          reason: [
            sentence ? "sentence boundary" : "phrase boundary",
            pause > 0.2 ? "narration pause" : null,
            beat ? "narrative emphasis" : null,
          ]
            .filter(Boolean)
            .join(", "),
        };
      })
      .filter(
        (c) => c.frame >= previous + 6 && c.frame <= total - (count - i) * 6,
      )
      .sort((a, b) => a.score - b.score || a.frame - b.frame);
    const chosen = candidates[0];
    const boundary =
      chosen?.frame ??
      Math.max(
        previous + 6,
        Math.min(Math.round(target), total - (count - i) * 6),
      );
    boundaries.push(boundary);
    reasons.push(
      chosen?.reason || "Even distribution: no usable narration boundary",
    );
    previous = boundary;
  }
  boundaries.push(total);
  const cycle = ["push", "pan", "pull", "punch"] as const;
  const scenes = p.scenes.map((s, i) => {
    const start = boundaries[i] / 30,
      end = boundaries[i + 1] / 30;
    const content = p.captions
      .filter((c) => c.start >= start && c.start < end)
      .map((c) => c.text)
      .join(" ");
    let motion: ProjectData["scenes"][number]["motion"] =
      /\b(reflex|fearless|changed|only)\b/i.test(content)
        ? "punch"
        : cycle[i % 4];
    if (
      i &&
      motion ===
        (i - 1 === 0 && /\bonly\b/i.test(p.captions[0]?.text || "")
          ? "punch"
          : cycle[(i - 1) % 4])
    )
      motion = cycle[(i + 1) % 4];
    return {
      ...s,
      duration: end - start,
      motion,
      strength: motion === "punch" ? 0.13 : 0.08,
      panDirection: (i % 2 ? "left" : "right") as "left" | "right",
      transition: "fade" as const,
      transitionDuration: Math.min(0.267, end - start),
    };
  });
  for (let i = 1; i < scenes.length; i++)
    if (scenes[i].motion === scenes[i - 1].motion)
      scenes[i].motion = scenes[i].motion === "pan" ? "push" : "pan";
  return {
    manifest: Project.parse({ ...p, scenes, approved: false }),
    boundaries: boundaries.map((f) => f / 30),
    reasons,
    method:
      "Deterministic sentence/pause/keyword heuristics; no image-content analysis",
    changes: scenes.map((s, i) => ({
      scene: i + 1,
      before: p.scenes[i].duration,
      after: s.duration,
      motion: s.motion,
    })),
  };
}
