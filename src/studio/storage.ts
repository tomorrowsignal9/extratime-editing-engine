import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { z } from "zod";
import { Project, parseSrt, type ProjectData } from "../engine/schema";
import { evenScenes } from "./timeline";
import type { Asset, StudioProject } from "./types";
export const root = path.resolve(process.env.STUDIO_ROOT || "data/studio");
export const publicRoot = path.resolve("public");
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function id(value: string) {
  if (!/^[a-f0-9-]{36}$/.test(value))
    throw new HttpError(400, "Invalid identifier");
  return value;
}
export async function atomic(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2));
  await rename(temp, file);
}
export const projectPath = (key: string) =>
  path.join(root, "projects", id(key) + ".json");
export async function readProject(key: string) {
  try {
    return JSON.parse(
      await readFile(projectPath(key), "utf8"),
    ) as StudioProject;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw new HttpError(404, "Project not found");
    throw e;
  }
}
export async function locked<T>(key: string, fn: () => Promise<T>) {
  await mkdir(path.join(root, "locks"), { recursive: true });
  const lock = path.join(root, "locks", id(key));
  let handle;
  try {
    handle = await import("node:fs/promises").then((fs) => fs.open(lock, "wx"));
  } catch {
    throw new HttpError(409, "Project is being updated; retry shortly.");
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    await unlink(lock);
  }
}
export async function createProject(title: string) {
  title = z.string().trim().min(1).max(150).parse(title);
  const p: StudioProject = {
    id: randomUUID(),
    title,
    revision: 1,
    updatedAt: new Date().toISOString(),
    assets: [],
    captions: [],
    manifest: null,
  };
  await atomic(projectPath(p.id), p);
  return p;
}
export async function listProjects() {
  await mkdir(path.join(root, "projects"), { recursive: true });
  const files = await readdir(path.join(root, "projects"));
  return Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map((f) => readProject(f.slice(0, -5))),
  );
}
function revision(p: StudioProject, v: unknown) {
  if (p.revision !== v)
    throw new HttpError(
      409,
      "This project changed in another tab. Reopen it before saving to avoid overwriting changes.",
    );
  if (p.deletedAt)
    throw new HttpError(409, "Restore the project before editing.");
}
async function persist(p: StudioProject) {
  p.revision++;
  p.updatedAt = new Date().toISOString();
  await atomic(projectPath(p.id), p);
  return p;
}
export async function saveProject(key: string, input: unknown) {
  const body = z
    .object({
      revision: z.number().int(),
      title: z.string().trim().min(1).max(150),
      manifest: Project.nullable(),
    })
    .parse(input);
  return locked(key, async () => {
    const p = await readProject(key);
    revision(p, body.revision);
    if (p.manifest && !body.manifest)
      throw new HttpError(400, "Cannot discard an existing timeline.");
    if (body.manifest) {
      const m = body.manifest;
      const audio = p.assets.find(
        (a) => a.kind === "audio" && a.path === m.audio,
      );
      if (
        !audio ||
        Math.abs(m.duration - Math.ceil(audio.duration! * 30) / 30) > 0.001
      )
        throw new HttpError(
          400,
          "Timeline must preserve the complete voiceover duration.",
        );
      for (const s of m.scenes)
        for (const ref of [s.asset, s.foreground].filter(Boolean))
          if (!p.assets.some((a) => a.kind === "image" && a.path === ref))
            throw new HttpError(
              400,
              "Scene references an asset outside this project.",
            );
      for (const layer of m.soundLayers || []) {
        const sound = p.assets.find(
          (a) => a.kind === "sound" && a.path === layer.asset,
        );
        if (!sound || !sound.license || !sound.peak || !audio.rms)
          throw new HttpError(
            400,
            "Sound layers require project-owned licensed audio and measured voiceover levels.",
          );
        if (!layer.loop && layer.duration > sound.duration! + 0.034)
          throw new HttpError(
            400,
            "Enable looping or shorten the sound layer to its source duration.",
          );
        Object.assign(layer, {
          license: sound.license,
          attribution: sound.attribution,
          sourcePeak: sound.peak,
          sourceDuration: sound.duration,
          narrationRms: audio.rms,
        });
      }
      if (m.id !== key) throw new HttpError(400, "Project identity mismatch");
      p.manifest = { ...m, title: body.title, approved: false };
      p.captions = m.captions;
    }
    p.title = body.title;
    return persist(p);
  });
}
export async function trashProject(key: string, restore = false) {
  return locked(key, async () => {
    const p = await readProject(key);
    if (restore) delete p.deletedAt;
    else p.deletedAt = new Date().toISOString();
    return persist(p);
  });
}
export const exec = promisify(execFile);
export async function ingest(
  key: string,
  files: { name: string; bytes: Buffer }[],
  version: number,
  replace?: string,
  sound?: {
    category: "whoosh" | "impact" | "riser" | "stadium" | "music";
    license: string;
    attribution?: string;
  },
) {
  return locked(key, async () => {
    const p = await readProject(key);
    revision(p, version);
    if (files.length > 50 || !files.length)
      throw new HttpError(400, "Select between 1 and 50 files.");
    const directory = path.join(publicRoot, "media", `studio-${id(key)}`);
    await mkdir(directory, { recursive: true });
    const added: Asset[] = [];
    const created: string[] = [];
    try {
      for (const file of files) {
        const suffix = path.extname(file.name).toLowerCase();
        const token = randomUUID();
        let kind: Asset["kind"];
        if ([".jpg", ".jpeg", ".png", ".webp"].includes(suffix)) kind = "image";
        else if ([".mp3", ".wav"].includes(suffix)) kind = "audio";
        else if (suffix === ".srt") kind = "srt";
        else
          throw new HttpError(
            400,
            "Supported files: JPG, PNG, WebP, MP3, WAV and SRT.",
          );
        if (sound && kind !== "audio")
          throw new HttpError(400, "Sound layers must be MP3 or WAV audio.");
        const limit =
          kind === "image"
            ? 20 * 1024 * 1024
            : kind === "audio"
              ? 80 * 1024 * 1024
              : 1024 * 1024;
        if (!file.bytes.length || file.bytes.length > limit)
          throw new HttpError(
            400,
            `${file.name}: size limit is ${limit / 1024 / 1024} MB.`,
          );
        const relative = `media/studio-${key}/${token}${suffix}`;
        const target = path.join(publicRoot, relative);
        await writeFile(target, file.bytes);
        created.push(target);
        const a: Asset = {
          id: token,
          name: path
            .basename(file.name)
            .replace(/[\x00-\x1f]/g, "")
            .slice(0, 150),
          kind,
          path: relative,
          bytes: file.bytes.length,
        };
        if (kind === "image") {
          const decoder = sharp(file.bytes, { limitInputPixels: 40_000_000 });
          const meta = await decoder.metadata();
          if (!["jpeg", "png", "webp"].includes(meta.format || ""))
            throw new HttpError(
              400,
              "Image bytes do not match a supported image format.",
            );
          a.width = meta.width;
          a.height = meta.height;
          a.thumbnail = `media/studio-${key}/${token}-preview.jpg`;
          const thumb = path.join(publicRoot, a.thumbnail);
          await decoder
            .rotate()
            .resize({
              width: 540,
              height: 960,
              fit: "inside",
              withoutEnlargement: true,
            })
            .jpeg({ quality: 80 })
            .toFile(thumb);
          created.push(thumb);
        } else if (kind === "audio") {
          const wav =
            file.bytes.toString("ascii", 0, 4) === "RIFF" &&
            file.bytes.toString("ascii", 8, 12) === "WAVE";
          const mp3 =
            file.bytes.toString("ascii", 0, 3) === "ID3" ||
            (file.bytes[0] === 255 && (file.bytes[1] & 224) === 224);
          if (suffix === ".wav" ? !wav : !mp3)
            throw new HttpError(
              400,
              "Audio content does not match its extension.",
            );
          const { stdout } = await exec(
            "ffprobe",
            [
              "-v",
              "error",
              "-show_format",
              "-show_streams",
              "-of",
              "json",
              target,
            ],
            { timeout: 20000, maxBuffer: 1024 * 1024 },
          );
          const meta = JSON.parse(stdout);
          a.duration = Number(meta.format.duration);
          if (
            !meta.streams.some(
              (s: { codec_type: string }) => s.codec_type === "audio",
            ) ||
            !Number.isFinite(a.duration) ||
            a.duration! < 0.2 ||
            a.duration! > 300
          )
            throw new HttpError(
              400,
              "Voiceover must contain audio and last 0.2–300 seconds.",
            );
          const measured = await audioStats(target);
          a.peak = measured.peak;
          a.rms = measured.rms;
          if (sound) {
            if (
              !sound.license.trim() ||
              (sound.license.includes("CC BY") && !sound.attribution?.trim())
            )
              throw new HttpError(
                400,
                "Provide the sound license and required attribution.",
              );
            a.kind = "sound";
            a.category = sound.category;
            a.license = sound.license;
            a.attribution = sound.attribution;
            if (measured.peak < 0.0001)
              throw new HttpError(400, "Sound asset is silent.");
          }
        } else
          p.captions = parseSrt(
            file.bytes.toString("utf8").replace(/^\uFEFF/, ""),
          );
        added.push(a);
      }
      if (replace) {
        const original = p.assets.find((a) => a.id === replace);
        if (
          !original ||
          original.kind !== "image" ||
          added.length !== 1 ||
          added[0].kind !== "image"
        )
          throw new HttpError(400, "Replace an image with one image.");
        if (p.manifest)
          p.manifest.scenes = p.manifest.scenes.map((s) => ({
            ...s,
            asset: s.asset === original.path ? added[0].path : s.asset,
          }));
      }
      p.assets.push(...added);
      const audio = [...p.assets].reverse().find((a) => a.kind === "audio");
      if (sound && audio && !audio.rms) {
        const measured = await audioStats(path.join(publicRoot, audio.path));
        audio.rms = measured.rms;
        audio.peak = measured.peak;
      }
      if (added.some((a) => a.kind === "audio")) {
        p.captions = p.captions.map((c) => ({ ...c, words: undefined }));
        if (p.manifest) {
          p.manifest.captionTiming = undefined;
          p.manifest.soundLayers = (p.manifest.soundLayers || []).map((l) => ({
            ...l,
            enabled: false,
            narrationRms: Math.max(audio?.rms || 0.0001, 0.0001),
          }));
        }
      }

      let scenes = p.manifest?.scenes || [];
      const incoming = added.filter((a) => a.kind === "image");
      if (!replace && incoming.length)
        scenes = [
          ...scenes,
          ...incoming.map((a) => ({
            asset: a.path,
            duration: 1,
            motion: "push" as const,
            focalX: 0.5,
            focalY: 0.5,
            strength: 0.12,
            transition: "fade" as const,
          })),
        ];
      if (!scenes.length)
        scenes = p.assets
          .filter((a) => a.kind === "image")
          .map((a) => ({
            asset: a.path,
            duration: 1,
            motion: "push",
            focalX: 0.5,
            focalY: 0.5,
            strength: 0.12,
            transition: "fade",
          }));
      if (audio && scenes.length) {
        const duration = Math.ceil(audio.duration! * 30) / 30;
        if (
          !p.manifest ||
          (added.some((a) => a.kind === "audio") &&
            Math.abs(duration - p.manifest.duration) > 0.001) ||
          (!replace && incoming.length)
        ) {
          const timing = evenScenes(
            scenes.map((s) => s.asset),
            duration,
          );
          scenes = scenes.map((s, i) => ({
            ...s,
            duration: timing[i].duration,
          }));
        }
        p.manifest = Project.parse({
          ...p.manifest,
          id: key,
          title: p.title,
          duration,
          audio: audio.path,
          scenes,
          captions: p.captions,
          approved: false,
        });
      }
      return await persist(p);
    } catch (e) {
      await Promise.all(created.map((f) => unlink(f).catch(() => {})));
      if (e instanceof HttpError || e instanceof z.ZodError) throw e;
      throw new HttpError(
        400,
        "Unable to decode the uploaded media. Use a valid image, MP3/WAV, or SRT.",
      );
    }
  });
}
export async function sampleAvailable() {
  try {
    await stat("public/media/episode-001/VO.mp3");
    return true;
  } catch {
    return false;
  }
}
export async function importSample() {
  const original = Project.parse(
    JSON.parse(await readFile("docs/episode-001.manifest.json", "utf8")),
  );
  const p = await createProject(original.title);
  const references = [original.audio, ...original.scenes.map((s) => s.asset)];
  const files = await Promise.all(
    references.map(async (ref) => ({
      name: path.basename(ref),
      bytes: await readFile(path.join(publicRoot, ref)),
    })),
  );
  files.push({
    name: "subtitles.srt",
    bytes: await readFile("episodes/episode-001/subtitles.srt"),
  });
  const imported = await ingest(p.id, files, p.revision);
  const mapping = new Map(
    references.map((ref, i) => [ref, imported.assets[i].path]),
  );
  return saveProject(p.id, {
    revision: imported.revision,
    title: original.title,
    manifest: {
      ...original,
      id: p.id,
      audio: mapping.get(original.audio),
      scenes: original.scenes.map((s) => ({
        ...s,
        asset: mapping.get(s.asset),
      })),
    },
  });
}

export async function audioStats(file: string) {
  const { stdout } = await exec(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      file,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "8000",
      "-f",
      "f32le",
      "pipe:1",
    ],
    { encoding: "buffer", timeout: 30000, maxBuffer: 12 * 1024 * 1024 },
  );
  let peak = 0,
    sum = 0;
  for (let i = 0; i < stdout.length; i += 4) {
    const v = stdout.readFloatLE(i);
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
  }
  return { peak: Math.min(1, peak), rms: Math.sqrt(sum / (stdout.length / 4)) };
}
