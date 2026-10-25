/** Independent Episode 001 phrase-anchor check, not a claim of word-level ground truth. */
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { parseSrt, Caption } from "../src/engine/schema";
const input = process.argv[2] || "outputs/phase-2/alignment.json";
const result = JSON.parse(await readFile(input, "utf8"));
assert.equal(result.provenance.method, "pocketsphinx-forced-alignment");
const cues = parseSrt(
  await readFile("episodes/episode-001/subtitles.srt", "utf8"),
);
const words: { text: string; start: number; end: number }[] = result.words;
result.captions.forEach((c: unknown) => Caption.parse(c));
const normalized = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]/g, "");
let offset = 0;
const anchors = cues.map((cue, index) => {
  const text = cue.text.split(/\s+/).filter(Boolean);
  const segment = words.slice(offset, offset + text.length);
  assert.deepEqual(
    segment.map((w) => normalized(w.text)),
    text.map(normalized),
  );
  offset += text.length;
  return {
    cue: index + 1,
    text: cue.text,
    referenceStart: cue.start,
    referenceEnd: cue.end,
    alignedStart: segment[0].start,
    alignedEnd: segment.at(-1)!.end,
    startError: Math.abs(segment[0].start - cue.start),
    endError: Math.abs(segment.at(-1)!.end - cue.end),
  };
});
assert.equal(
  offset,
  words.length,
  "Alignment must cover exactly the supplied script",
);
const sorted = anchors.map((a) => a.startError).sort((a, b) => a - b);
const maxStartError = Math.max(...sorted),
  medianStartError = sorted[Math.floor(sorted.length / 2)];
// Supplied SRT holds text beyond speech: end differences are reported, not forced to fit.
const passed =
  maxStartError <= 0.45 &&
  medianStartError <= 0.15 &&
  words.at(-1)!.end <= result.duration + 0.02;
const report = {
  status: passed ? "passed" : "needs-review",
  reference: "Supplied exact SRT phrase anchors; not input to alignment",
  limitation:
    "Phrase-level agreement does not establish word-level accuracy. Listen and review every word before production.",
  wordCount: words.length,
  cueCount: result.captions.length,
  maxStartError,
  medianStartError,
  sourceDuration: result.duration,
  lastWordEnd: words.at(-1)!.end,
  warnings: result.warnings,
  anchors,
};
await writeFile(
  input.replace(/\.json$/, ".timing-review.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (!passed) process.exitCode = 1;
