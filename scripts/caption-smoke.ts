// Synthetic caption fixture only: does not claim to transcribe Episode 001.
import { bundle } from "@remotion/bundler";
import { selectComposition, renderStill } from "@remotion/renderer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import assert from "node:assert/strict";
import { Project } from "../src/engine/schema";
const project = Project.parse(
  JSON.parse(await readFile("data/projects/episode-001.json", "utf8")),
);
const url = await bundle({
  entryPoint: path.resolve("src/engine/index.tsx"),
  publicDir: path.resolve("public"),
});
const browserExecutable = process.env.CHROME_PATH || undefined;
for (const captions of [false, true]) {
  const inputProps = {
    project: {
      ...project,
      captions: captions
        ? [{ text: "Caption rendering test", start: 1, end: 3 }]
        : [],
    },
  };
  const composition = await selectComposition({
    serveUrl: url,
    id: "EXTRATIME",
    inputProps,
    browserExecutable,
  });
  await renderStill({
    serveUrl: url,
    composition,
    browserExecutable,
    inputProps,
    frame: 60,
    output: `outputs/caption-test-${captions}.png`,
  });
}
const crop = {
  left: 90,
  top: Math.round(1920 * 0.72),
  width: 870,
  height: 220,
};
const a = await sharp("outputs/caption-test-false.png")
  .extract(crop)
  .raw()
  .toBuffer();
const b = await sharp("outputs/caption-test-true.png")
  .extract(crop)
  .raw()
  .toBuffer();
let changed = 0;
for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 20) changed++;
assert.ok(
  changed > 10000,
  `Caption layer did not change expected pixels: ${changed}`,
);
console.log(
  `Caption burn-in smoke passed (${changed} changed channel values in caption area). Synthetic text only.`,
);
