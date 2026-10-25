/** Compare legacy manifest frames with the accepted Phase 0 MP4 without changing either. */
import { bundle } from "@remotion/bundler";
import { selectComposition, renderStill } from "@remotion/renderer";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import sharp from "sharp";
import assert from "node:assert/strict";
import { Project } from "../src/engine/schema";
const project = Project.parse(
  JSON.parse(await readFile("docs/episode-001.manifest.json", "utf8")),
);
const serveUrl = await bundle({
  entryPoint: path.resolve("src/engine/index.tsx"),
  publicDir: path.resolve("public"),
});
const browserExecutable = process.env.CHROME_PATH || undefined;
const inputProps = { project };
const composition = await selectComposition({
  serveUrl,
  id: "EXTRATIME",
  inputProps,
  browserExecutable,
});
await mkdir("outputs/phase-1/legacy", { recursive: true });
const results = [];
for (const frame of [15, 111, 420, 908]) {
  const output = `outputs/phase-1/legacy/frame-${frame}.png`;
  await renderStill({
    serveUrl,
    composition,
    inputProps,
    browserExecutable,
    frame,
    output,
  });
  const reference = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-ss",
      String(frame / 30),
      "-i",
      "outputs/episode-001-subtitled.mp4",
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
  const current = await sharp(output).removeAlpha().raw().toBuffer();
  assert.equal(current.length, reference.length);
  let error = 0;
  for (let i = 0; i < current.length; i++)
    error += Math.abs(current[i] - reference[i]);
  const mae = error / current.length;
  assert.ok(mae < 5, `Legacy frame ${frame} changed: ${mae}`);
  results.push({ frame, meanAbsolutePixelError: mae });
}
await writeFile(
  "outputs/phase-1/legacy-compatibility.json",
  JSON.stringify(
    { reference: "outputs/episode-001-subtitled.mp4", results },
    null,
    2,
  ),
);
console.log(results);
