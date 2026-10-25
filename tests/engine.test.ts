import { test } from "node:test";
import assert from "node:assert/strict";
import { Project, parseSrt, toSrt, retime } from "../src/engine/schema";
const fixture = {
  id: "test",
  title: "Test",
  duration: 10,
  audio: "media/vo.mp3",
  captions: [
    { text: "Hello world", start: 0, end: 2 },
    { text: "Football", start: 5, end: 7 },
  ],
  scenes: [
    { asset: "media/a.jpg", duration: 5, motion: "push" },
    { asset: "media/b.jpg", duration: 5, motion: "pan" },
  ],
};
test("manifest validates and supplies safe defaults", () => {
  const p = Project.parse(fixture);
  assert.equal(p.approved, false);
  assert.equal(p.scenes[0].strength, 0.12);
});
test("rejects asset path traversal", () =>
  assert.throws(() =>
    Project.parse({ ...fixture, audio: "media/../../etc/passwd" }),
  ));
test("rejects unsupported asset URLs", () =>
  assert.throws(() =>
    Project.parse({ ...fixture, audio: "https://example.com/vo.mp3" }),
  ));
test("rejects negative scene timing", () =>
  assert.throws(() =>
    Project.parse({
      ...fixture,
      scenes: [{ ...fixture.scenes[0], duration: -1 }],
    }),
  ));
test("rejects timeline truncating narration", () =>
  assert.throws(() => Project.parse({ ...fixture, duration: 11 })));
test("rejects out of bounds captions", () =>
  assert.throws(() =>
    Project.parse({
      ...fixture,
      captions: [{ text: "bad", start: 9, end: 11 }],
    }),
  ));
test("rejects overlapping captions", () =>
  assert.throws(() =>
    Project.parse({
      ...fixture,
      captions: [
        { text: "one", start: 1, end: 5 },
        { text: "two", start: 4, end: 7 },
      ],
    }),
  ));
test("SRT round trips milliseconds and multiline phrases", () => {
  const p = Project.parse(fixture);
  p.captions = parseSrt("1\n00:00:01,125 --> 00:00:02,500\nHello\nworld");
  assert.equal(p.captions[0].text, "Hello\nworld");
  assert.deepEqual(parseSrt(toSrt(p)), p.captions);
});
test("malformed SRT produces an error", () =>
  assert.throws(() => parseSrt("nonsense")));
test("automatic timing preserves the complete narration and clears approval", () => {
  const p = retime({ ...Project.parse(fixture), approved: true });
  assert.equal(
    p.scenes.reduce((n, s) => n + s.duration, 0),
    10,
  );
  assert.equal(p.approved, false);
  Project.parse(p);
});

test("Episode 001 supplied SRT retains all 14 cues and the final narration cue", async () => {
  const { readFile } = await import("node:fs/promises");
  const captions = parseSrt(
    await readFile("episodes/episode-001/subtitles.srt", "utf8"),
  );
  const p = Project.parse(
    JSON.parse(await readFile("docs/episode-001.manifest.json", "utf8")),
  );
  assert.deepEqual(p.captions, captions);
  assert.equal(captions.length, 14);
  assert.equal(
    captions[7].text,
    "SOMETHING NO OTHER GOALKEEPER\nHAS EVER MATCHED.",
  );
  assert.deepEqual(captions.at(-1), {
    start: 29.32,
    end: 30.27,
    text: "WHO'S NEXT?",
  });
  assert.deepEqual(parseSrt(toSrt(p)), captions);
  const lastFrame = (Math.ceil(p.duration * 30) - 1) / 30;
  assert.ok(
    lastFrame >= captions.at(-1)!.start && lastFrame < captions.at(-1)!.end,
  );
});
