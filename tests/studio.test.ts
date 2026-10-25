import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Project } from "../src/engine/schema";
import { resizeScene, preset, evenScenes } from "../src/studio/timeline";
const dir = await mkdtemp(path.join(tmpdir(), "extratime-storage-"));
process.env.STUDIO_ROOT = dir;
const {
  createProject,
  ingest,
  saveProject,
  readProject,
  trashProject,
  id,
  HttpError,
} = await import("../src/studio/storage");
const { sameOrigin, bounded } = await import("../src/studio/http");
const cleanup: string[] = [];
after(async () => {
  await rm(dir, { recursive: true, force: true });
  for (const id of cleanup)
    await rm(path.join("public/media", "studio-" + id), {
      recursive: true,
      force: true,
    });
});
const sample = Project.parse(
  JSON.parse(await readFile("docs/episode-001.manifest.json", "utf8")),
);
test("duration editor redistributes frames and retains full VO", () => {
  const p = resizeScene(sample, 0, 4);
  assert.equal(p.scenes[0].duration, 4);
  assert.equal(p.scenes[1].duration, 4.1);
  assert.ok(
    Math.abs(p.scenes.reduce((s, x) => s + x.duration, 0) - p.duration) < 1e-8,
  );
  assert.throws(() => resizeScene(p, 0, 30));
  assert.equal(p.approved, false);
});
test("all three presets change actual supported scene parameters", () => {
  for (const name of [
    "Documentary",
    "Fast Viral",
    "Legendary Stories",
  ] as const) {
    const result = preset(sample, name);
    Project.parse(result);
    assert.equal(result.preset, name);
    assert.ok(
      result.scenes.every((s) => typeof s.transitionDuration === "number"),
    );
    assert.notEqual(result.scenes[0].strength, sample.scenes[0].strength);
  }
});
test("even allocation uses exact frames and rejects excessive clips", () => {
  const scenes = evenScenes(
    ["media/a.jpg", "media/b.jpg", "media/c.jpg"],
    30.3,
  );
  assert.equal(
    scenes.reduce((n, s) => n + Math.round(s.duration * 30), 0),
    909,
  );
  assert.throws(() => evenScenes(Array(10).fill("media/a.jpg"), 1));
});
test("identifiers reject traversal and arbitrary paths", () => {
  for (const input of ["../../etc/passwd", "/tmp/a", "episode-001"])
    assert.throws(() => id(input));
});
test("same origin checks actual request Host and rejects rebinding", () => {
  sameOrigin(
    new Request("http://localhost:3000/api", {
      headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
    }),
  );
  assert.throws(() =>
    sameOrigin(
      new Request("http://localhost:3000/api", {
        headers: { host: "127.0.0.1:3000", origin: "https://evil.example" },
      }),
    ),
  );
  assert.throws(() =>
    sameOrigin(
      new Request("http://evil.example/api", {
        headers: { host: "evil.example", origin: "http://evil.example" },
      }),
    ),
  );
});
test("stream body cap rejects missing Content-Length bypass", async () => {
  await assert.rejects(
    bounded(
      new Request("http://localhost", { method: "POST", body: "1234567" }),
      5,
    ),
    (e) => e instanceof HttpError && e.status === 413,
  );
});
test("real storage/upload persistence, rollback, revisions, ownership and trash", async () => {
  const initial = await createProject("Storage test");
  cleanup.push(initial.id);
  assert.equal((await readProject(initial.id)).title, "Storage test");
  const sharp = (await import("sharp")).default;
  const image = await sharp({
    create: { width: 108, height: 192, channels: 3, background: "#335544" },
  })
    .jpeg()
    .toBuffer();
  const wav = Buffer.alloc(44 + 16000 * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(32000, 40);
  for (let i = 0; i < 16000; i++)
    wav.writeInt16LE(
      Math.round(Math.sin((i * 440 * 2 * Math.PI) / 16000) * 6000),
      44 + i * 2,
    );
  const files = [
    { name: "image.jpg", bytes: image },
    { name: "voice.wav", bytes: wav },
    {
      name: "captions.srt",
      bytes: Buffer.from("1\n00:00:00,000 --> 00:00:00,950\nFixture caption"),
    },
  ];
  const imported = await ingest(initial.id, files, initial.revision);
  assert.ok(imported.manifest);
  assert.equal(imported.manifest!.duration, 1);
  assert.equal(imported.manifest!.captions.length, 1);
  await assert.rejects(
    ingest(
      initial.id,
      [{ name: "broken.jpg", bytes: Buffer.from("no image") }],
      imported.revision,
    ),
  );
  assert.equal((await readProject(initial.id)).assets.length, 3);
  await assert.rejects(
    ingest(
      initial.id,
      [{ name: "huge.jpg", bytes: Buffer.alloc(20 * 1024 * 1024 + 1) }],
      imported.revision,
    ),
  );
  await assert.rejects(
    saveProject(initial.id, {
      revision: imported.revision,
      title: "Bad",
      manifest: { ...imported.manifest, audio: "media/episode-001/VO.mp3" },
    }),
  );
  await assert.rejects(
    saveProject(initial.id, {
      revision: imported.revision,
      title: "Bad",
      manifest: {
        ...imported.manifest,
        duration: 0.5,
        scenes: [{ ...imported.manifest!.scenes[0], duration: 0.5 }],
        captions: [],
      },
    }),
  );
  const saved = await saveProject(initial.id, {
    revision: imported.revision,
    title: "Updated",
    manifest: imported.manifest,
  });
  assert.equal(saved.title, "Updated");
  await assert.rejects(
    saveProject(initial.id, {
      revision: imported.revision,
      title: "Stale",
      manifest: imported.manifest,
    }),
    (e) => e instanceof HttpError && e.status === 409,
  );
  const concurrent = await Promise.allSettled([
    saveProject(initial.id, {
      revision: saved.revision,
      title: "A",
      manifest: saved.manifest,
    }),
    saveProject(initial.id, {
      revision: saved.revision,
      title: "B",
      manifest: saved.manifest,
    }),
  ]);
  assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
  await trashProject(initial.id);
  assert.ok((await readProject(initial.id)).deletedAt);
  await trashProject(initial.id, true);
  assert.equal((await readProject(initial.id)).deletedAt, undefined);
});
