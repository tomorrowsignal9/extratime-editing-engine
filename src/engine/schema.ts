import { z } from "zod";
const asset = z
  .string()
  .regex(/^media\/[a-zA-Z0-9_./-]+$/)
  .refine((s) => !s.includes(".."));
export const Word = z
  .object({
    text: z.string().min(1).max(100),
    start: z.number().nonnegative(),
    end: z.number().positive(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .refine((w) => w.end > w.start);
export const Caption = z
  .object({
    text: z.string().min(1).max(300),
    words: z.array(Word).max(80).optional(),
    start: z.number().nonnegative(),
    end: z.number().positive(),
  })
  .refine((c) => c.end > c.start)
  .superRefine((c, ctx) => {
    if (c.words) {
      if (
        c.words
          .map((w) => w.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim() !== c.text.replace(/\s+/g, " ").trim()
      )
        ctx.addIssue({
          code: "custom",
          message: "Word text must match its caption",
        });
      for (let i = 0; i < c.words.length; i++) {
        const w = c.words[i];
        if (
          w.start < c.start - 0.001 ||
          w.end > c.end + 0.001 ||
          (i > 0 && w.start < c.words[i - 1].end)
        )
          ctx.addIssue({
            code: "custom",
            message: "Word timings must be ordered and inside their caption",
          });
      }
    }
  });
export const Project = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(1).max(150),
    narrationScript: z.string().max(20000).optional(),
    duration: z.number().positive().max(300),
    audio: asset,
    preset: z
      .enum(["Documentary", "Fast Viral", "Legendary Stories"])
      .default("Documentary"),
    captionStyle: z
      .enum(["classic", "highlight", "kinetic", "minimal"])
      .optional(),
    captionTiming: z
      .object({
        method: z.string(),
        reliable: z.boolean(),
        reviewed: z.boolean(),
      })
      .optional(),
    soundLayers: z
      .array(
        z.object({
          id: z.string(),
          asset,
          category: z.enum(["whoosh", "impact", "riser", "stadium", "music"]),
          start: z.number().nonnegative(),
          duration: z.number().min(0.1),
          volume: z.number().min(0).max(0.18),
          enabled: z.boolean(),
          loop: z.boolean(),
          license: z.string().min(1).max(300),
          attribution: z.string().max(500).optional(),
          sourceDuration: z.number().positive(),
          sourcePeak: z.number().positive().max(1),
          narrationRms: z.number().positive().max(1),
        }),
      )
      .max(8)
      .optional(),
    captionFontSize: z.number().min(28).max(64).optional(),
    captionY: z.number().min(30).max(85).default(72),
    captionColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#C4EC77"),
    approved: z.boolean().default(false),
    captions: z.array(Caption),
    scenes: z
      .array(
        z.object({
          asset,
          foreground: asset.optional(),
          duration: z.number().min(0.2),
          panDirection: z.enum(["left", "right"]).optional(),
          transitionDuration: z.number().min(0).max(0.8).optional(),
          motion: z.enum(["push", "pan", "pull", "punch"]),
          focalX: z.number().min(0).max(1).default(0.5),
          focalY: z.number().min(0).max(1).default(0.5),
          strength: z.number().min(0).max(0.4).default(0.12),
          transition: z.enum(["cut", "fade", "slide"]).default("fade"),
        }),
      )
      .min(1)
      .max(50),
  })
  .superRefine((p, ctx) => {
    if (
      Math.abs(p.scenes.reduce((n, s) => n + s.duration, 0) - p.duration) >
      0.034
    )
      ctx.addIssue({
        code: "custom",
        message: "Scene durations must cover the complete voiceover",
      });
    for (const layer of p.soundLayers || [])
      if (layer.start + layer.duration > p.duration + 0.001)
        ctx.addIssue({
          code: "custom",
          message: "Sound layer exceeds the timeline",
        });
    for (const c of p.captions)
      if (c.end > p.duration + 0.05)
        ctx.addIssue({
          code: "custom",
          message: "Caption exceeds video duration",
        });
    for (let i = 1; i < p.captions.length; i++)
      if (p.captions[i].start < p.captions[i - 1].end)
        ctx.addIssue({
          code: "custom",
          message: "Captions must be ordered without overlaps",
        });
  });
export type ProjectData = z.infer<typeof Project>;
export function parseSrt(s: string) {
  const t = (v: string) => {
    const [h, m, ss] = v.replace(",", ".").split(":").map(Number);
    return h * 3600 + m * 60 + ss;
  };
  return s
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const i = lines.findIndex((l) => l.includes("-->"));
      if (i < 0) throw Error("Invalid SRT block");
      const [a, b] = lines[i].split(/\s*-->\s*/);
      return Caption.parse({
        start: t(a),
        end: t(b),
        text: lines.slice(i + 1).join("\n"),
      });
    });
}
export function toSrt(p: ProjectData) {
  const t = (n: number) =>
    new Date(Math.round(n * 1000))
      .toISOString()
      .slice(11, 23)
      .replace(".", ",");
  return p.captions
    .map((c, i) => `${i + 1}\n${t(c.start)} --> ${t(c.end)}\n${c.text}\n`)
    .join("\n");
}
export function retime(p: ProjectData) {
  const boundaries = p.captions.map((c) => c.start);
  let prev = 0;
  return {
    ...p,
    approved: false,
    scenes: p.scenes.map((s, i) => {
      let end =
        i === p.scenes.length - 1
          ? p.duration
          : (p.duration * (i + 1)) / p.scenes.length;
      const near = boundaries
        .filter(
          (b) =>
            b > prev + 0.4 && b < p.duration - (p.scenes.length - i - 1) * 0.4,
        )
        .sort((a, b) => Math.abs(a - end) - Math.abs(b - end))[0];
      if (i < p.scenes.length - 1 && near !== undefined) end = near;
      const duration = end - prev;
      prev = end;
      return { ...s, duration };
    }),
  };
}
