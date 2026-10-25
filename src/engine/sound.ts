import type { ProjectData } from "./schema";
export function soundVolume(
  p: ProjectData,
  layer: NonNullable<ProjectData["soundLayers"]>[number],
  frame: number,
) {
  if (!layer.enabled) return 0;
  const time = frame / 30;
  const absolute = layer.start + time;
  let duck = 0.2; // conservative fallback: protect narration throughout, even with missing captions
  if (p.captions.length) {
    duck = 1;
    for (const c of p.captions) {
      if (absolute >= c.start - 0.08 && absolute <= c.end + 0.2) {
        const attack = Math.min(
          1,
          Math.max(0, (absolute - (c.start - 0.08)) / 0.08),
        );
        const release = Math.min(
          1,
          Math.max(0, (c.end + 0.2 - absolute) / 0.2),
        );
        duck = Math.min(duck, 1 - 0.8 * Math.min(attack, release));
      }
    }
  }
  const fade = Math.min(
    1,
    Math.max(0, time / 0.08),
    Math.max(0, (layer.duration - time) / 0.15),
  );
  // Normalization cap derives from measured VO RMS and source peak, never a guessed gain.
  const budget = p.soundLayers?.filter((s) => s.enabled).length || 1;
  const safeGain = Math.min(
    layer.volume,
    (layer.narrationRms * 0.25) / Math.max(layer.sourcePeak, 0.0001) / budget,
  );
  return safeGain * duck * fade;
}
