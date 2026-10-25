import { copyFile, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Project, parseSrt } from "../src/engine/schema";
const [id, title, audio, ...images] = process.argv.slice(2);
if (!id || !title || !audio || !images.length || !/^[a-z0-9-]+$/.test(id))
  throw Error(
    'Usage: npm run import:project -- episode-id "Title" voiceover.mp3 image1.jpeg image2.jpeg ...',
  );
const probe = JSON.parse(
  execFileSync(
    "ffprobe",
    ["-v", "error", "-show_format", "-show_streams", "-of", "json", audio],
    { encoding: "utf8" },
  ),
);
if (
  !probe.streams.some((s: { codec_type: string }) => s.codec_type === "audio")
)
  throw Error("Voiceover has no audio stream");
const duration = Math.ceil(Number(probe.format.duration) * 30) / 30;
const folder = `public/media/${id}`;
await mkdir(folder, { recursive: true });
await mkdir("data/projects", { recursive: true });
try {
  await readFile(`data/projects/${id}.json`);
  throw Error("Project exists; choose a new ID");
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
const ext = path.extname(audio).toLowerCase();
if (![".mp3", ".wav", ".m4a"].includes(ext))
  throw Error("Expected MP3, WAV, or M4A");
await copyFile(audio, `${folder}/voiceover${ext}`);
const sharp = (await import("sharp")).default;
const scenes = [];
for (let i = 0; i < images.length; i++) {
  await sharp(images[i], { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({
      width: 1080,
      height: 1920,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 93 })
    .toFile(`${folder}/scene-${i + 1}.jpg`);
  scenes.push({
    asset: `media/${id}/scene-${i + 1}.jpg`,
    duration: duration / images.length,
    motion: i % 2 ? "pan" : "push",
  });
}
const captions = process.env.SRT_FILE
  ? parseSrt(await readFile(process.env.SRT_FILE, "utf8"))
  : [];
const p = Project.parse({
  id,
  title,
  duration,
  audio: `media/${id}/voiceover${ext}`,
  scenes,
  captions,
});
await writeFile(`data/projects/${id}.json`, JSON.stringify(p, null, 2));
console.log(`data/projects/${id}.json (${duration}s)`);
