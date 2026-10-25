/** Inspect actual encoded active-word pixels for every word; geometry QC separately uses the shared component. */
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { Project } from "../src/engine/schema";
const [manifest, video] = process.argv.slice(2);
if (!manifest || !video)
  throw Error("Usage: tsx scripts/validate-kinetic.ts manifest.json video.mp4");
const p = Project.parse(JSON.parse(await readFile(manifest, "utf8")));
assert.ok(p.captionTiming?.reviewed && p.captionTiming.reliable);
assert.ok(p.captionStyle === "kinetic" || p.captionStyle === "highlight");
const samples = p.captions.flatMap((cue, i) =>
  (cue.words || []).map((w) => ({
    cue: i + 1,
    word: w.text,
    frame: Math.floor((w.start + w.end) * 15),
  })),
);
assert.ok(samples.length > 0, "Actual word timestamps are required");
const frames = [...new Set(samples.map((s) => s.frame))].sort((a, b) => a - b);
const y = Math.max(0, Math.floor(p.captionY * 19.2) - 20),
  width = 870,
  height = Math.min(200, 1920 - y);
const pixelsPerFrame = width * height * 3;
const raw = execFileSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-i",
    video,
    "-vf",
    `select='${frames.map((f) => `eq(n,${f})`).join("+")}',crop=${width}:${height}:75:${y}`,
    "-vsync",
    "0",
    "-pix_fmt",
    "rgb24",
    "-f",
    "rawvideo",
    "pipe:1",
  ],
  { maxBuffer: pixelsPerFrame * frames.length + 1024 * 1024 },
);
assert.equal(raw.length, pixelsPerFrame * frames.length);
const color = [1, 3, 5].map((i) =>
  parseInt(p.captionColor.slice(i, i + 2), 16),
);
const counts = frames.map((_, index) => {
  let count = 0;
  for (let i = index * pixelsPerFrame; i < (index + 1) * pixelsPerFrame; i += 3)
    if (
      color.every(
        (target, channel) => Math.abs(target - raw[i + channel]) <= 18,
      )
    )
      count++;
  return count;
});
const checks = samples.map((s) => ({
  ...s,
  highlightPixels: counts[frames.indexOf(s.frame)],
}));
const report = {
  status: checks.every((c) => c.highlightPixels >= 35) ? "passed" : "failed",
  method:
    "Decode MP4 once; inspect active caption-color pixels in the subtitle region at each actual word midpoint. This checks rendered presence, not semantic or acoustic accuracy.",
  color: p.captionColor,
  words: samples.length,
  uniqueFrames: frames.length,
  checks,
};
await writeFile(
  video.replace(/\.mp4$/, ".kinetic.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
assert.equal(report.status, "passed");
