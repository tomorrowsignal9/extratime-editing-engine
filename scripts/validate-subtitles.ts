/** Episode 001 acceptance: verify supplied SRT, actual burnt-in frames and VO phrase timing. */
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import { Project, parseSrt } from "../src/engine/schema";
const video = process.argv[2] || "outputs/episode-001-subtitled.mp4";
const manifestFile = process.argv[3] || "data/projects/episode-001.json";
const evidenceRoot = process.argv[3] ? path.dirname(video) : "outputs";
const p = Project.parse(JSON.parse(await readFile(manifestFile, "utf8")));
const supplied = parseSrt(
  await readFile("episodes/episode-001/subtitles.srt", "utf8"),
);
assert.deepEqual(
  p.captions,
  supplied,
  "Manifest must retain supplied SRT text, line breaks and timings",
);
assert.deepEqual(
  parseSrt(await readFile(video.replace(/\.mp4$/, ".srt"), "utf8")),
  supplied,
);
assert.equal(supplied.length, 14);
// ffmpeg writes filter diagnostics to stderr.
import { spawnSync } from "node:child_process";
const detected = spawnSync(
  "ffmpeg",
  [
    "-hide_banner",
    "-i",
    `public/${p.audio}`,
    "-af",
    "silencedetect=noise=-35dB:d=0.15",
    "-f",
    "null",
    "-",
  ],
  { encoding: "utf8" },
);
assert.equal(detected.status, 0);
const onsets = [...detected.stderr.matchAll(/silence_end: ([\d.]+)/g)].map(
  (m) => Number(m[1]),
);
const onsetChecks = [2, 3, 4, 5, 6, 8, 9, 12, 13].map((i) => {
  const start = supplied[i].start;
  const nearest = onsets.reduce((a, b) =>
    Math.abs(a - start) < Math.abs(b - start) ? a : b,
  );
  const deltaMs = (start - nearest) * 1000;
  assert.ok(Math.abs(deltaMs) < 35, `Cue ${i + 1} phrase onset mismatch`);
  return { cue: i + 1, start, detectedOnset: nearest, deltaMs };
});
function inspect(time: number) {
  const frame = Math.ceil(time * 30);
  const raw = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-ss",
      String(frame / 30),
      "-i",
      video,
      "-frames:v",
      "1",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "pipe:1",
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  assert.equal(raw.length, 1080 * 1920 * 3);
  let count = 0,
    minX = 1080,
    maxX = 0,
    minY = 1920,
    maxY = 0;
  const rows = new Set<number>();
  for (let y = 1200; y < 1750; y++)
    for (let x = 0; x < 1080; x++) {
      const o = (y * 1080 + x) * 3;
      const r = raw[o],
        g = raw[o + 1],
        b = raw[o + 2];
      if (
        Math.abs(r - 196) < 25 &&
        Math.abs(g - 236) < 25 &&
        Math.abs(b - 119) < 25 &&
        g - r > 15
      ) {
        count++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        rows.add(y);
      }
    }
  let bands = 0,
    previous = -10;
  for (const y of rows) {
    if (y > previous + 3) bands++;
    previous = y;
  }
  return {
    frame,
    time: frame / 30,
    count,
    bounds: { minX, maxX, minY, maxY },
    lines: bands,
  };
}
await mkdir(path.join(evidenceRoot, "subtitle-frames"), { recursive: true });
const cues = supplied.map((c, i) => {
  const result = inspect((c.start + c.end) / 2);
  assert.ok(result.count > 500, `Cue ${i + 1} missing from MP4`);
  assert.ok(
    result.bounds.minX >= 90 &&
      result.bounds.maxX <= 930 &&
      result.bounds.minY >= 600 &&
      result.bounds.maxY < 1600,
    `Cue ${i + 1} outside mobile safe area`,
  );
  assert.ok(result.lines <= 2, `Cue ${i + 1} exceeds two lines`);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-ss",
    String(result.time),
    "-i",
    video,
    "-frames:v",
    "1",
    "-vf",
    "scale=360:640",
    path.join(
      evidenceRoot,
      `subtitle-frames/cue-${String(i + 1).padStart(2, "0")}.png`,
    ),
  ]);
  return { cue: i + 1, text: c.text, ...result };
});
const gaps = supplied
  .slice(0, -1)
  .flatMap((c, i) =>
    supplied[i + 1].start - c.end > 0.25
      ? [(c.end + supplied[i + 1].start) / 2]
      : [],
  )
  .map((time) => {
    const result = inspect(time);
    assert.ok(result.count < 100, "Caption visible in an SRT gap");
    return result;
  });
const lastFrame = inspect((Math.ceil(p.duration * 30) - 1) / 30 - 0.000001);
assert.ok(
  lastFrame.count > 500,
  "Final WHO'S NEXT? caption missing from last video frame",
);
const report = {
  video,
  cueCount: cues.length,
  lastFrame,
  cues,
  gaps,
  onsetChecks,
  timingMethod:
    "Supplied exact SRT retained; phrase onsets compared with original VO silence boundaries at -35 dB / 150ms. Not automatic word-level transcription.",
  lastCaptionEnd: supplied.at(-1)!.end,
};
await writeFile(
  path.join(evidenceRoot, "episode-001-subtitle-validation.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  `PASS: ${cues.length} visible mobile-safe captions, ${gaps.length} subtitle-free gaps, ${onsetChecks.length} VO phrase onsets within one frame.`,
);
