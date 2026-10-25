import { test, expect } from "@playwright/test";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
test("real browser: create, upload, edit, persist, resolve conflicts, render, download and compare preview", async ({
  page,
  context,
  request,
}) => {
  await mkdir("outputs/phase-1", { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your editing room." }),
  ).toBeVisible();
  await page.screenshot({
    path: "outputs/phase-1/projects-empty.png",
    fullPage: true,
  });
  const title = "Lev Yashin · Studio acceptance " + Date.now();
  await page.getByLabel("New project title").fill(title);
  await page.getByRole("button", { name: "New project" }).click();
  await expect(page.getByLabel("Project title", { exact: true })).toHaveValue(
    title,
  );
  const list = await (await request.get("/api/studio/projects")).json();
  const id = list.projects.find((p: { title: string }) => p.title === title).id;
  await page.getByLabel("Upload media", { exact: true }).setInputFiles({
    name: "corrupt.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.locator(".alert[role=alert]")).toContainText(
    "Unable to decode",
  );
  expect(
    (await (await request.get("/api/studio/projects/" + id)).json()).assets,
  ).toHaveLength(0);
  await page.getByRole("button", { name: "Dismiss" }).click();
  const files = [
    ...Array.from(
      { length: 5 },
      (_, i) => `public/media/episode-001/scene-0${i + 1}.jpeg`,
    ),
    "public/media/episode-001/VO.mp3",
    "episodes/episode-001/subtitles.srt",
  ].map((f) => path.resolve(f));
  await page.getByLabel("Upload media", { exact: true }).setInputFiles(files);
  await expect(page.locator(".notice[role=status]")).toContainText(
    "Assets imported",
    { timeout: 60000 },
  );
  await expect(page.getByLabel("Seek preview")).toBeVisible();
  for (const [i, d] of [3.6, 4.5, 6.9, 10.8].entries())
    await page
      .getByLabel(`Scene ${i + 1} duration`, { exact: true })
      .fill(String(d));
  await page.getByLabel("Editing preset").selectOption("Legendary Stories");
  await page.getByLabel("Caption position").fill("64");
  await page.getByLabel("Caption font size").fill("42");
  await page.getByRole("button", { name: "Move scene 2 earlier" }).click();
  await page.getByRole("button", { name: "Move scene 1 later" }).click();
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.locator(".notice[role=status]")).toContainText(
    "Project saved",
  );
  let stored = await (await request.get("/api/studio/projects/" + id)).json();
  expect(stored.manifest.captions).toHaveLength(14);
  expect(
    stored.manifest.scenes.map((s: { duration: number }) => s.duration),
  ).toEqual([3.6, 4.5, 6.9, 10.8, 4.5]);
  await page.reload();
  await page.locator(".project-nav button").filter({ hasText: title }).click();
  await expect(
    page.getByLabel("Scene 1 duration", { exact: true }),
  ).toHaveValue("3.6");
  const tab = await context.newPage();
  await tab.goto("/");
  await tab.locator(".project-nav button").filter({ hasText: title }).click();
  const finalTitle = "Lev Yashin | The only goalkeeper";
  await page.getByLabel("Project title", { exact: true }).fill(finalTitle);
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.locator(".notice[role=status]")).toContainText(
    "Project saved",
  );
  await tab.getByLabel("Project title", { exact: true }).fill("Stale tab edit");
  await tab.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(tab.locator(".alert[role=alert]")).toContainText("another tab");
  await tab.close();
  stored = await (await request.get("/api/studio/projects/" + id)).json();
  expect(stored.title).toBe(finalTitle);
  const cross = await request.post("/api/studio/projects", {
    headers: { origin: "https://untrusted.example" },
    data: { title: "Forbidden" },
  });
  expect(cross.status()).toBe(403);
  const traversal = await request.put("/api/studio/projects/" + id, {
    data: {
      revision: stored.revision,
      title: finalTitle,
      manifest: { ...stored.manifest, audio: "media/../escape.mp3" },
    },
  });
  expect(traversal.status()).toBe(400);
  const other = await (
    await request.post("/api/studio/projects", {
      data: { title: "Trash test" },
    })
  ).json();
  expect(
    (await request.delete("/api/studio/projects/" + other.id)).ok(),
  ).toBeTruthy();
  expect(
    (await (await request.get("/api/studio/projects/" + other.id)).json())
      .deletedAt,
  ).toBeTruthy();
  await request.post(`/api/studio/projects/${other.id}/restore`, { data: {} });
  expect(
    (await (await request.get("/api/studio/projects/" + other.id)).json())
      .deletedAt,
  ).toBeUndefined();
  await request.delete("/api/studio/projects/" + other.id);
  // Verify actual playback and deterministic seek before taking the preview snapshot.
  await page.getByRole("button", { name: "Play", exact: true }).last().click();
  await expect
    .poll(async () => page.getByLabel("Playback time").textContent())
    .not.toContain("0.00 /");
  await page.getByRole("button", { name: "Pause", exact: true }).last().click();
  await page.getByLabel("Seek preview").fill("420");
  await expect(page.getByLabel("Playback time")).toContainText("14.00 /");
  await page.waitForTimeout(700);
  await page
    .locator(".preview-wrap > div")
    .first()
    .screenshot({ path: "outputs/phase-1/preview-frame-420.png" });
  await page.screenshot({
    path: "outputs/phase-1/editor-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "outputs/phase-1/editor-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 1100 });
  // A real renderer failure: remove this isolated project's image, then restore it and retry.
  const asset = path.join("public", stored.manifest.scenes[0].asset);
  await rename(asset, asset + ".test-backup");
  let failedJob;
  try {
    await page.getByLabel("Approve export").check();
    await page
      .getByRole("button", { name: "Export MP4", exact: false })
      .click();
    await expect
      .poll(
        async () => {
          const jobs = await (await request.get("/api/studio/jobs")).json();
          failedJob = jobs.find(
            (j: { projectId: string }) => j.projectId === id,
          );
          return failedJob?.status;
        },
        { timeout: 120000, intervals: [1000, 3000] },
      )
      .toBe("failed");
  } finally {
    await rename(asset + ".test-backup", asset);
  }
  await expect(
    page.locator(".job").filter({ hasText: finalTitle }).first(),
  ).toContainText("failed");
  await page.getByLabel("Approve export").check();
  await page.getByRole("button", { name: "Export MP4", exact: false }).click();
  await expect
    .poll(
      async () => {
        const j = await (await request.get("/api/studio/jobs")).json();
        return j.find((j: { projectId: string }) => j.projectId === id)?.status;
      },
      { timeout: 30000 },
    )
    .toMatch(/queued|running/);
  const duplicate = await request.post("/api/studio/jobs", {
    data: { projectId: id, revision: stored.revision, approved: true },
  });
  expect(duplicate.status()).toBe(409);
  let finalJob;
  const seenProgress = new Set<number>();
  await expect
    .poll(
      async () => {
        const all = await (await request.get("/api/studio/jobs")).json();
        finalJob = all.find((j: { projectId: string }) => j.projectId === id);
        seenProgress.add(finalJob.progress);
        if (finalJob.status === "failed") throw Error(JSON.stringify(finalJob));
        return finalJob.status;
      },
      { timeout: 420000, intervals: [1500, 3000] },
    )
    .toBe("succeeded");
  expect(seenProgress.size).toBeGreaterThan(2);
  const job = finalJob as unknown as { id: string };
  await expect(
    page.locator(`a[href="/api/studio/jobs/${job.id}/download"]`),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.locator(`a[href="/api/studio/jobs/${job.id}/download"]`).click();
  const download = await downloadPromise;
  await download.saveAs("outputs/phase-1/episode-001-dashboard.mp4");
  const dir = path.resolve("data/studio/jobs", job.id);
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/validate.ts",
      path.join(dir, "manifest.json"),
      "outputs/phase-1/episode-001-dashboard.mp4",
    ],
    { stdio: "pipe" },
  );
  await writeFile(
    "outputs/phase-1/episode-001-dashboard.json",
    await readFile(path.join(dir, "manifest.json")),
  );
  const shot = await sharp("outputs/phase-1/preview-frame-420.png").metadata();
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-ss",
    "14",
    "-i",
    "outputs/phase-1/episode-001-dashboard.mp4",
    "-frames:v",
    "1",
    "-vf",
    `scale=${shot.width}:${shot.height}`,
    "outputs/phase-1/export-frame-420.png",
  ]);
  const crop = {
    left: 0,
    top: 0,
    width: shot.width!,
    height: shot.height! - 85,
  };
  const preview = await sharp("outputs/phase-1/preview-frame-420.png")
    .removeAlpha()
    .extract(crop)
    .raw()
    .toBuffer();
  const exported = await sharp("outputs/phase-1/export-frame-420.png")
    .removeAlpha()
    .extract(crop)
    .raw()
    .toBuffer();
  expect(preview.length).toBe(exported.length);
  let error = 0;
  for (let i = 0; i < preview.length; i++)
    error += Math.abs(preview[i] - exported[i]);
  const mae = error / preview.length;
  expect(mae).toBeLessThan(12);
  await page.screenshot({
    path: "outputs/phase-1/export-complete.png",
    fullPage: true,
  });
  await writeFile(
    "outputs/phase-1/browser-evidence.json",
    JSON.stringify(
      {
        projectId: id,
        jobId: job.id,
        previewFrame: 420,
        previewExportMeanAbsolutePixelError: mae,
        observedProgress: [...seenProgress],
        browserErrors: errors,
        checks: [
          "create",
          "real uploads",
          "invalid upload rollback",
          "timeline persistence",
          "refresh",
          "multiple tab conflict",
          "cross-origin rejection",
          "path traversal rejection",
          "trash restore",
          "preview playback",
          "mobile overflow",
          "real render failure recovery",
          "duplicate render rejection",
          "MP4 download",
          "ffprobe/audio validation",
          "preview-export pixel comparison",
        ],
      },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
});

test("browser draft recovery, replacement formats, caption persistence, drag reorder and cancellation", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Import Episode 001" }).click();
  await expect(page.getByLabel("Project title", { exact: true })).toBeVisible();
  const list = await (await request.get("/api/studio/projects")).json();
  const originalTitle = "The Only Goalkeeper to Win the Ballon d’Or";
  const doc = list.projects
    .filter((p: { title: string }) => p.title === originalTitle)
    .sort((a: { updatedAt: string }, b: { updatedAt: string }) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )[0];
  const title = "Recovered editing draft " + Date.now();
  await page.getByLabel("Project title", { exact: true }).fill(title);
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await page
    .locator(".project-nav button")
    .filter({ hasText: originalTitle })
    .last()
    .click();
  await expect(page.getByLabel("Project title", { exact: true })).toHaveValue(
    title,
  );
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.locator(".notice")).toContainText("Project saved");
  await page
    .locator("[data-testid=scene-0]")
    .dragTo(page.locator("[data-testid=scene-1]"));
  await expect(
    page.getByLabel("Scene 1 duration", { exact: true }),
  ).toHaveValue("4.5");
  const original = await readFile("public/media/episode-001/scene-02.jpeg");
  const png = await sharp(original).png().toBuffer();
  await page
    .getByLabel("Replace scene-02.jpeg", { exact: true })
    .setInputFiles({
      name: "replacement.png",
      mimeType: "image/png",
      buffer: png,
    });
  await expect(page.locator(".notice")).toContainText("Assets imported");
  const webp = await sharp(original).webp().toBuffer();
  await page
    .getByLabel("Replace replacement.png", { exact: true })
    .setInputFiles({
      name: "replacement.webp",
      mimeType: "image/webp",
      buffer: webp,
    });
  await expect(page.locator(".notice")).toContainText("Assets imported");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    "public/media/episode-001/VO.mp3",
    "-c:a",
    "pcm_s16le",
    "outputs/phase-1/voiceover.wav",
  ]);
  await page
    .getByLabel("Upload media", { exact: true })
    .setInputFiles(path.resolve("outputs/phase-1/voiceover.wav"));
  await expect(page.locator(".notice")).toContainText("Assets imported");
  await expect(
    page.getByLabel("Scene 1 duration", { exact: true }),
  ).toHaveValue("4.5");
  await page.getByText("Edit subtitles (14 cues)", { exact: true }).click();
  await page
    .getByLabel("Caption 1 text", { exact: true })
    .fill("ONLY ONE GOALKEEPER!");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.locator(".notice")).toContainText("Project saved");
  const stored = await (
    await request.get("/api/studio/projects/" + doc.id)
  ).json();
  expect(stored.manifest.captions[0].text).toBe("ONLY ONE GOALKEEPER!");
  expect(stored.manifest.scenes[0].asset).toMatch(/\.webp$/);
  expect(stored.manifest.audio).toMatch(/\.wav$/);
  const response = await request.post("/api/studio/jobs", {
    data: { projectId: doc.id, revision: stored.revision, approved: true },
  });
  expect(response.status()).toBe(200);
  const job = await response.json();
  await request.post(`/api/studio/jobs/${job.id}/cancel`, { data: {} });
  await expect
    .poll(
      async () => {
        const jobs = await (await request.get("/api/studio/jobs")).json();
        return jobs.find((j: { id: string }) => j.id === job.id).status;
      },
      { timeout: 30000 },
    )
    .toBe("cancelled");
  await writeFile(
    "outputs/phase-1/interaction-evidence.json",
    JSON.stringify(
      {
        projectId: doc.id,
        cancelledJobId: job.id,
        checks: [
          "unsaved draft survives refresh",
          "native drag and drop",
          "PNG replacement",
          "WebP replacement",
          "WAV voiceover replacement preserving timing",
          "caption editing persists",
          "cancel releases renderer",
        ],
      },
      null,
      2,
    ),
  );
});
