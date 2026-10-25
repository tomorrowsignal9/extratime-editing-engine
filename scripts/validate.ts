import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { Project } from "../src/engine/schema";
const [
  manifest = "data/projects/episode-001.json",
  video = "outputs/episode-001.mp4",
] = process.argv.slice(2);
const p = Project.parse(JSON.parse(await readFile(manifest, "utf8")));
const probe = JSON.parse(
  execFileSync(
    "ffprobe",
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", video],
    { encoding: "utf8" },
  ),
);
const v = probe.streams.find(
  (s: { codec_type: string }) => s.codec_type === "video",
);
const a = probe.streams.find(
  (s: { codec_type: string }) => s.codec_type === "audio",
);
assert.equal(v.codec_name, "h264");
assert.equal(v.width, 1080);
assert.equal(v.height, 1920);
assert.equal(v.r_frame_rate, "30/1");
assert.equal(v.pix_fmt, "yuv420p");
assert.equal(a.codec_name, "aac");
assert.equal(a.sample_rate, "48000");
assert.ok(Math.abs(Number(probe.format.duration) - p.duration) < 0.1);
const frames = [];
for (const t of [0.5, 5, 10, 20, p.duration - 0.25]) {
  const raw = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-ss",
    String(t),
    "-i",
    video,
    "-frames:v",
    "1",
    "-vf",
    "scale=108:192,format=gray",
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
  assert.equal(raw.length, 108 * 192);
  const mean = raw.reduce((n, x) => n + x, 0) / raw.length;
  const variance = raw.reduce((n, x) => n + (x - mean) ** 2, 0) / raw.length;
  assert.ok(mean > 5 && variance > 100, `Blank frame at ${t}s`);
  frames.push({ time: t, mean, variance });
}
function pcm(file: string) {
  const raw = execFileSync(
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
    { maxBuffer: 20 * 1024 * 1024 },
  );
  return new Float32Array(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
  );
}
const source = pcm(`public/${p.audio}`),
  output = pcm(video);
assert.ok(output.length >= source.length - 800, "Narration was cut off");
let dot = 0,
  xx = 0,
  yy = 0;
for (let i = 0; i < Math.min(source.length, output.length); i++) {
  dot += source[i] * output[i];
  xx += source[i] ** 2;
  yy += output[i] ** 2;
}
const correlation = dot / Math.sqrt(xx * yy);
assert.ok(
  correlation > 0.95,
  `Audio synchronization correlation ${correlation}`,
);
const rms = (x: Float32Array) =>
  Math.sqrt(x.reduce((n, v) => n + v * v, 0) / x.length);
const tail = {
  source: rms(source.slice(-4000)),
  output: rms(output.slice(source.length - 4000, source.length)),
};
assert.ok(
  tail.source < 0.001 || tail.output > tail.source * 0.5,
  "Final narration became silent",
);
const report = {
  video,
  duration: probe.format.duration,
  dimensions: [v.width, v.height],
  fps: v.r_frame_rate,
  codecs: [v.codec_name, a.codec_name],
  frames,
  audioCorrelation: correlation,
  tailRms: tail,
  captions: p.captions.length,
  captionStatus: p.captions.length
    ? "Requires human text/timing review"
    : "MISSING — Phase 0 incomplete",
};
await writeFile(
  video.replace(/\.mp4$/, ".validation.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (!p.captions.length && !process.argv.includes("--allow-missing-captions"))
  throw Error(
    "Caption validation blocked: no captions. Media checks passed only.",
  );
