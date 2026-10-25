import { Project, type ProjectData } from "../engine/schema";
export function resizeScene(
  p: ProjectData,
  index: number,
  seconds: number,
): ProjectData {
  const frames = Math.round(seconds * 30),
    old = Math.round(p.scenes[index].duration * 30);
  const donor = index === p.scenes.length - 1 ? index - 1 : index + 1;
  if (donor < 0) throw Error("A single scene must cover the entire voiceover.");
  const remaining = Math.round(p.scenes[donor].duration * 30) - (frames - old);
  if (frames < 6 || remaining < 6)
    throw Error(
      "Each scene needs at least 0.2 seconds; shorten this scene or extend its neighbour.",
    );
  const scenes = p.scenes.map((s, i) => ({
    ...s,
    duration:
      i === index ? frames / 30 : i === donor ? remaining / 30 : s.duration,
  }));
  return Project.parse({ ...p, approved: false, scenes });
}
export function preset(
  p: ProjectData,
  name: ProjectData["preset"],
): ProjectData {
  const scenes = p.scenes.map((s, i) => ({
    ...s,
    motion: (name === "Fast Viral"
      ? i % 2
        ? "pan"
        : "punch"
      : name === "Legendary Stories"
        ? i % 2
          ? "push"
          : "pull"
        : i % 2
          ? "pan"
          : "push") as ProjectData["scenes"][number]["motion"],
    strength:
      name === "Fast Viral" ? 0.18 : name === "Legendary Stories" ? 0.1 : 0.08,
    transition: (name === "Fast Viral" ? "cut" : "fade") as "cut" | "fade",
    transitionDuration: Math.min(
      s.duration,
      name === "Fast Viral" ? 0 : name === "Legendary Stories" ? 0.4 : 0.267,
    ),
  }));
  return Project.parse({ ...p, preset: name, scenes, approved: false });
}
export function evenScenes(
  assets: string[],
  duration: number,
): ProjectData["scenes"] {
  const total = Math.ceil(duration * 30);
  if (total < assets.length * 6)
    throw Error("Too many images for this voiceover (minimum 0.2s per image).");
  return assets.map((asset, i) => ({
    asset,
    duration:
      (Math.round(((i + 1) * total) / assets.length) -
        Math.round((i * total) / assets.length)) /
      30,
    motion: i % 2 ? "pan" : "push",
    focalX: 0.5,
    focalY: 0.5,
    strength: 0.12,
    transition: "fade",
  }));
}
