import { readFile, writeFile } from "node:fs/promises";
import { Project, parseSrt } from "../src/engine/schema";
const [manifest, captions] = process.argv.slice(2);
if (!manifest || !captions)
  throw Error(
    "Usage: npm run captions -- project.json transcript.json|captions.srt",
  );
const source = await readFile(captions, "utf8");
const p = Project.parse({
  ...JSON.parse(await readFile(manifest, "utf8")),
  captions: captions.endsWith(".srt")
    ? parseSrt(source)
    : JSON.parse(source).captions,
  approved: false,
});
await writeFile(manifest, JSON.stringify(p, null, 2));
console.log(
  `Saved ${p.captions.length} captions; review their text and timestamps before approval.`,
);
