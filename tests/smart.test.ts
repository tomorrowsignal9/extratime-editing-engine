import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Project, Caption } from "../src/engine/schema";
import { suggestEdit } from "../src/smart/suggestions";
import { soundVolume } from "../src/engine/sound";
const root = await mkdtemp(path.join(tmpdir(), "extratime-smart-"));
process.env.STUDIO_ROOT = root;
const storage = await import("../src/studio/storage");
const { claimCompute, releaseCompute } = await import("../src/studio/compute");
const { startJob, jobs } = await import("../src/studio/jobs");
const { speechSuggestion, acceptSpeech, editingSuggestion, acceptEdit } =
  await import("../src/smart/service");
const cleanup: string[] = [];
after(async () => {
  await rm(root, { recursive: true, force: true });
  for (const id of cleanup)
    await rm(path.join("public/media", "studio-" + id), {
      recursive: true,
      force: true,
    });
});
const baseline = Project.parse(
  JSON.parse(await readFile("docs/episode-001.manifest.json", "utf8")),
);
test("word timings reject overlap, changed text, out-of-cue and nonpositive values", () => {
  const c = {
    text: "Lev Yashin",
    start: 0,
    end: 1,
    words: [
      { text: "Lev", start: 0, end: 0.4 },
      { text: "Yashin", start: 0.4, end: 1 },
    ],
  };
  Caption.parse(c);
  assert.throws(() => Caption.parse({ ...c, text: "Someone else" }));
  assert.throws(() =>
    Caption.parse({ ...c, words: [c.words[0], { ...c.words[1], start: 0.3 }] }),
  );
  assert.throws(() => Caption.parse({ ...c, end: 0.9 }));
  assert.throws(() =>
    Caption.parse({ ...c, words: [{ text: c.text, start: 1, end: 0 }] }),
  );
});
test("smart suggestions are deterministic, non-mutating, frame-exact and preserve narration", () => {
  const original = structuredClone(baseline);
  const result = suggestEdit(baseline);
  assert.deepEqual(baseline, original);
  assert.deepEqual(result, suggestEdit(baseline));
  assert.equal(result.manifest.approved, false);
  assert.equal(result.manifest.duration, baseline.duration);
  assert.equal(
    result.manifest.scenes.reduce(
      (sum, s) => sum + Math.round(s.duration * 30),
      0,
    ),
    909,
  );
  assert.deepEqual(result.manifest.captions, baseline.captions);
  result.manifest.scenes.forEach((s, i, scenes) => {
    if (i) assert.notEqual(s.motion, scenes[i - 1].motion);
    assert.ok(s.duration >= 0.2 - 1e-9);
  });
  Project.parse(suggestEdit({ ...baseline, captions: [] }).manifest);
});
const layer = {
  id: "sound-1",
  asset: "media/sound.wav",
  category: "whoosh" as const,
  start: 0,
  duration: 3,
  volume: 0.18,
  enabled: true,
  loop: true,
  license: "CC0",
  sourceDuration: 0.8,
  sourcePeak: 0.5,
  narrationRms: 0.1,
};
test("sound ducking uses measured peak budget, protects narration and disables layers", () => {
  const p = {
    ...baseline,
    captions: [{ text: "Speech", start: 1, end: 2 }],
    soundLayers: [layer],
  };
  const pause = soundVolume(p, layer, 15),
    speech = soundVolume(p, layer, 45);
  assert.ok(Math.abs(pause - 0.05) < 1e-8);
  assert.ok(Math.abs(speech / pause - 0.2) < 1e-8);
  assert.equal(soundVolume(p, { ...layer, enabled: false }, 45), 0);
  assert.equal(soundVolume(p, layer, 0), 0);
  assert.equal(soundVolume(p, layer, 90), 0);
  assert.ok(
    soundVolume(
      { ...p, soundLayers: [layer, { ...layer, id: "sound-2" }] },
      layer,
      15,
    ) <=
      pause / 2,
  );
  assert.ok(soundVolume({ ...p, captions: [] }, layer, 15) < pause);
  assert.throws(() =>
    Project.parse({ ...p, soundLayers: [{ ...layer, start: 30 }] }),
  );
});
test("compute lock rejects simultaneous speech/render and only owner can release", () => {
  claimCompute({ id: "speech", kind: "speech", pid: process.pid });
  assert.throws(() =>
    claimCompute({ id: "render", kind: "render", pid: process.pid }),
  );
  releaseCompute("someone-else");
  assert.throws(() =>
    claimCompute({ id: "render", kind: "render", pid: process.pid }),
  );
  releaseCompute("speech");
  claimCompute({ id: "render", kind: "render", pid: process.pid });
  releaseCompute("render");
});
test("local speech fallback, suggestion revisions and licensed sound ownership persist", async () => {
  const p = await storage.createProject("Smart integration");
  cleanup.push(p.id);
  const sharp = (await import("sharp")).default;
  const image = await sharp({
    create: { width: 108, height: 192, channels: 3, background: "#375544" },
  })
    .jpeg()
    .toBuffer();
  const wav = path.join(root, "voice.wav");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=3",
    wav,
  ]);
  const bytes = await readFile(wav);
  let doc = await storage.ingest(
    p.id,
    [
      { name: "image.jpg", bytes: image },
      { name: "voice.wav", bytes },
      {
        name: "captions.srt",
        bytes: Buffer.from("1\n00:00:00,000 --> 00:00:02,950\nFixture caption"),
      },
    ],
    p.revision,
  );
  const snapshot = JSON.parse(JSON.stringify(doc));
  const suggestion = await editingSuggestion(p.id, { revision: doc.revision });
  assert.deepEqual(await storage.readProject(p.id), snapshot);
  doc = await acceptEdit(p.id, { revision: doc.revision });
  assert.deepEqual(doc.manifest, suggestion.manifest);
  await assert.rejects(
    acceptEdit(p.id, { revision: snapshot.revision }),
    /stale/,
  );
  await assert.rejects(
    speechSuggestion(p.id, {
      revision: doc.revision,
      mode: "align",
      model: "missing-test-model",
      script: "Fixture caption",
    }),
    /local model|speech|Local/i,
  );
  assert.equal((await storage.readProject(p.id)).revision, doc.revision);
  claimCompute({ id: "busy", kind: "speech", pid: process.pid });
  await assert.rejects(startJob(p.id, doc.revision, true), /active/);
  assert.equal((await jobs()).length, 0);
  releaseCompute("busy");
  // Real storage failure after acquiring the compute lock must not poison retries.
  await rm(path.join(root, "jobs"), { recursive: true });
  await writeFile(path.join(root, "jobs"), "block job directory");
  await assert.rejects(
    startJob(p.id, doc.revision, true),
    (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOTDIR",
  );
  await rm(path.join(root, "jobs"));
  await mkdir(path.join(root, "jobs"));
  claimCompute({ id: "recovered", kind: "speech", pid: process.pid });
  releaseCompute("recovered");
  const token = randomUUID();
  await mkdir(path.join(root, "assists", token), { recursive: true });
  await writeFile(
    path.join(root, "assists", token, "suggestion.json"),
    JSON.stringify({
      projectId: p.id,
      revision: snapshot.revision,
      audio: doc.manifest!.audio,
    }),
  );
  await assert.rejects(
    acceptSpeech(p.id, {
      revision: doc.revision,
      suggestionId: token,
      reviewed: false,
    }),
    /stale/,
  );
  await assert.rejects(
    storage.ingest(
      p.id,
      [{ name: "effect.wav", bytes }],
      doc.revision,
      undefined,
      { category: "whoosh", license: "CC BY 4.0" },
    ),
    /attribution/,
  );
  doc = await storage.ingest(
    p.id,
    [{ name: "effect.wav", bytes }],
    doc.revision,
    undefined,
    { category: "whoosh", license: "CC0", attribution: "Synthetic fixture" },
  );
  const sound = doc.assets.find((a) => a.kind === "sound")!;
  assert.ok(sound.peak! > 0 && sound.rms! > 0);
  doc = await storage.saveProject(p.id, {
    revision: doc.revision,
    title: doc.title,
    manifest: {
      ...doc.manifest,
      soundLayers: [
        { ...layer, asset: sound.path, license: "FORGED", sourcePeak: 0.0001 },
      ],
    },
  });
  assert.equal(doc.manifest!.soundLayers![0].sourcePeak, sound.peak);
  assert.equal(doc.manifest!.soundLayers![0].license, "CC0");
  await assert.rejects(
    storage.saveProject(p.id, {
      revision: doc.revision,
      title: doc.title,
      manifest: {
        ...doc.manifest,
        soundLayers: [{ ...layer, asset: "media/other-project/effect.wav" }],
      },
    }),
    /project|licensed/,
  );
});
