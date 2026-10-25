import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";
import { Project, toSrt } from "../src/engine/schema";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const file = process.argv[2] || "data/projects/episode-001.json";
const p = Project.parse(JSON.parse(await readFile(file, "utf8")));
if (!p.approved && !process.argv.includes("--proof"))
  throw Error("Editorial approval required; --proof produces a review copy");
if (!process.argv.includes("--proof") && !p.captions.length)
  throw Error("Final export requires reviewed captions");
await mkdir("outputs", { recursive: true });
const url = await bundle({
  entryPoint: path.resolve("src/engine/index.tsx"),
  publicDir: path.resolve("public"),
});
const browserExecutable = process.env.CHROME_PATH || undefined;
const inputProps = { project: p };
const composition = await selectComposition({
  serveUrl: url,
  id: "EXTRATIME",
  inputProps,
  browserExecutable,
});
const output = process.env.RENDER_OUTPUT || `outputs/${p.id}.mp4`;
let last = -1;
await renderMedia({
  serveUrl: url,
  composition,
  inputProps,
  outputLocation: output,
  codec: "h264",
  audioCodec: "aac",
  sampleRate: 48000,
  pixelFormat: "yuv420p",
  colorSpace: "bt709",
  crf: 20,
  x264Preset: "veryfast",
  concurrency: 1,
  browserExecutable,
  onProgress: ({ progress }) => {
    const v = Math.floor(progress * 100);
    if (v !== last) {
      last = v;
      console.log(`progress=${v}`);
    }
  },
});
await writeFile(output.replace(/\.mp4$/, ".srt"), toSrt(p));
await writeFile(output.replace(/\.mp4$/, ".json"), JSON.stringify(p, null, 2));
console.log(output);
