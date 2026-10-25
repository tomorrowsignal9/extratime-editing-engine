import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import type { StudioProject, Job } from "../src/studio/types";
for (const aligned of [false, true]) {
  test(
    aligned
      ? "real offline Episode 001 script alignment, word preview and MP4"
      : "manual SRT fallback, reviewable suggestions, licensed sound and real MP4 QC",
    async ({ page, request }) => {
      const models = await (
        await request.get("/api/studio/speech-models")
      ).json();
      if (aligned && !models.alignment.length) {
        if (process.env.REQUIRE_ALIGNMENT === "1")
          throw Error(
            "Alignment acceptance requires explicitly installed local model weights.",
          );
        test.skip(
          true,
          "No local alignment model: explicit operator setup required. This acceptance criterion is NOT verified.",
        );
      }
      const out = `outputs/phase-2/${aligned ? "aligned" : "srt-fallback"}`;
      await mkdir(out, { recursive: true });
      const browserErrors: string[] = [];
      page.on("pageerror", (e) => browserErrors.push(e.message));
      await page.goto("/");
      await page.getByRole("button", { name: "Import Episode 001" }).click();
      await expect(page.getByLabel("Seek preview")).toBeVisible();
      const title = `Phase 2 ${aligned ? "alignment" : "SRT fallback"} ${Date.now()}`;
      await page.getByLabel("Project title", { exact: true }).fill(title);
      await page
        .getByRole("button", { name: "Save project", exact: true })
        .click();
      await expect(page.locator(".notice[role=status]")).toContainText(
        "Project saved",
      );
      const list = await (await request.get("/api/studio/projects")).json();
      const id = list.projects.find((p: StudioProject) => p.title === title).id;
      const getProject = async (): Promise<StudioProject> =>
        (await request.get(`/api/studio/projects/${id}`)).json();
      let stored = await getProject();
      expect(stored.manifest!.captions).toHaveLength(14);
      if (aligned) {
        await page
          .getByLabel("Import narration script")
          .setInputFiles("episodes/episode-001/narration.txt");
        await expect(
          page.getByLabel("Narration script", { exact: true }),
        ).toHaveValue(
          await readFile("episodes/episode-001/narration.txt", "utf8"),
        );
        await page
          .getByRole("button", { name: "Save project", exact: true })
          .click();
        await expect(page.locator(".notice[role=status]")).toContainText(
          "Project saved",
        );
        const before = await getProject();
        const response = page.waitForResponse(
          (r) =>
            r.url().endsWith(`/${id}/speech`) &&
            r.request().method() === "POST",
        );
        await page
          .getByRole("button", { name: "Generate caption suggestion" })
          .click();
        const result = await (await response).json();
        expect(result.error).toBeUndefined();
        expect(result.provenance.method).toBe("pocketsphinx-forced-alignment");
        expect(result.words.length).toBeGreaterThan(50);
        expect(await getProject()).toEqual(before);
        await writeFile(
          path.join(out, "alignment.json"),
          JSON.stringify(result, null, 2),
        );
        await page.getByLabel("Reviewed generated word timing").check();
        await page
          .getByRole("button", { name: "Apply caption suggestion" })
          .click();
        await expect(
          page.getByRole("button", { name: "Apply caption suggestion" }),
        ).toHaveCount(0);
        await page.getByLabel("Caption preset").selectOption("kinetic");
        // Word timing is editable; unreviewed changes disable word effects.
        await page
          .getByText("Edit every word and timestamp", { exact: true })
          .click();
        const firstEnd = result.captions[0].words[0].end;
        await page
          .getByLabel("Word 1-1 end", { exact: true })
          .fill(String(Number((firstEnd - 0.01).toFixed(2))));
        await expect(
          page.getByLabel("Confirm manually verified words"),
        ).not.toBeChecked();
        await page.getByLabel("Confirm manually verified words").check();
      } else {
        await page
          .getByLabel("Automatic caption method")
          .selectOption("transcribe");
        if (!models.transcription.length) {
          await expect(
            page.getByRole("button", { name: "Generate caption suggestion" }),
          ).toBeDisabled();
          await expect(page.locator(".smart-panel")).toContainText(
            "No local Whisper model",
          );
        }
        // Existing SRT remains editable and no invented word timestamps are added.
        await page
          .getByText("Edit subtitles (14 cues)", { exact: true })
          .click();
        await page
          .getByLabel("Caption 1 text", { exact: true })
          .fill(stored.manifest!.captions[0].text);
        await page.getByLabel("Caption preset").selectOption("minimal");
      }
      await page
        .getByRole("button", { name: "Save project", exact: true })
        .click();
      await expect(page.locator(".notice[role=status]")).toContainText(
        "Project saved",
      );
      stored = await getProject();
      await page
        .getByRole("button", { name: "Suggest scene timing & motion" })
        .click();
      await expect(
        page.getByRole("button", { name: "Accept suggested timing & motion" }),
      ).toBeVisible();
      expect(await getProject()).toEqual(stored);
      await page
        .getByRole("button", { name: "Accept suggested timing & motion" })
        .click();
      await expect(
        page.getByRole("button", { name: "Accept suggested timing & motion" }),
      ).toHaveCount(0);
      stored = await getProject();
      expect(stored.manifest!.duration).toBe(30.3);
      expect(
        stored.manifest!.scenes.reduce(
          (sum, s) => sum + Math.round(s.duration * 30),
          0,
        ),
      ).toBe(909);
      stored.manifest!.scenes.forEach((s, i, arr) => {
        if (i) expect(s.motion).not.toBe(arr[i - 1].motion);
      });
      execFileSync("python3", ["scripts/make-sound-fixture.py"]);
      await page
        .getByLabel("Sound license", { exact: true })
        .selectOption("CC BY 4.0");
      await page
        .getByLabel("Upload sound layer")
        .setInputFiles("outputs/phase-2/original-whoosh.wav");
      await expect(page.locator(".smart-panel [role=alert]")).toContainText(
        "attribution",
      );
      expect((await getProject()).revision).toBe(stored.revision);
      await page
        .getByLabel("Sound license", { exact: true })
        .selectOption("CC0");
      await page
        .getByLabel("Sound attribution")
        .fill(
          "Original deterministic synthetic whoosh; scripts/make-sound-fixture.py (CC0)",
        );
      await page
        .getByLabel("Upload sound layer")
        .setInputFiles("outputs/phase-2/original-whoosh.wav");
      await page
        .getByRole("button", {
          name: "Add to timeline (disabled)",
          exact: true,
        })
        .click();
      await expect(page.getByLabel("Enable sound 1")).not.toBeChecked();
      await page.getByLabel("Enable sound 1").check();
      await page.getByLabel("Sound 1 start", { exact: true }).fill("8");
      await page.getByLabel("Loop sound 1").check();
      await page.getByLabel("Sound 1 duration", { exact: true }).fill("3");
      await page
        .getByRole("button", { name: "Save project", exact: true })
        .click();
      await expect(page.locator(".notice[role=status]")).toContainText(
        "Project saved",
      );
      await page.reload();
      await page
        .locator(".project-nav button")
        .filter({ hasText: title })
        .click();
      await expect(page.getByLabel("Enable sound 1")).toBeChecked();
      await expect(
        page.getByLabel("Sound 1 duration", { exact: true }),
      ).toHaveValue("3");
      stored = await getProject();
      const frame = aligned
        ? Math.ceil(stored.manifest!.captions[5].words![1].start * 30) + 2
        : 420;
      await page.getByLabel("Seek preview").fill(String(frame));
      await page.locator(".preview-wrap").scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      if (aligned)
        await expect(
          page.locator('.preview-wrap [data-spoken="true"]'),
        ).toHaveCount(1);
      await page
        .locator(".preview-wrap > div")
        .first()
        .screenshot({ path: path.join(out, "preview.png") });
      await page.screenshot({
        path: path.join(out, "editor.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await page.screenshot({
        path: path.join(out, "mobile.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.getByLabel("Approve export").check();
      await page
        .getByRole("button", { name: "Export MP4", exact: false })
        .click();
      let job: Job | undefined;
      const progress = new Set<number>();
      await expect
        .poll(
          async () => {
            const jobs: Job[] = await (
              await request.get("/api/studio/jobs")
            ).json();
            job = jobs.find((j) => j.projectId === id);
            if (job) progress.add(job.progress);
            if (job?.status === "failed")
              throw Error(
                JSON.stringify(job) +
                  JSON.stringify(
                    await (
                      await request.get(`/api/studio/jobs/${job.id}/log`)
                    ).json(),
                  ),
              );
            return job?.status;
          },
          { timeout: 420000, intervals: [1000, 2500] },
        )
        .toBe("succeeded");
      const qc = await (
        await request.get(`/api/studio/jobs/${job!.id}/qc`)
      ).json();
      expect(qc.status).toBe("passed");
      expect(
        qc.checks.every((c: { passed: boolean }) => c.passed),
      ).toBeTruthy();
      const download = page.waitForEvent("download");
      await page
        .locator(`a[href="/api/studio/jobs/${job!.id}/download"]`)
        .click();
      await (await download).saveAs(path.join(out, "episode-001.mp4"));
      if (aligned)
        execFileSync(
          process.execPath,
          [
            "--import",
            "tsx",
            "scripts/validate-kinetic.ts",
            path.join("data/studio/jobs", job!.id, "manifest.json"),
            path.join(out, "episode-001.mp4"),
          ],
          { stdio: "pipe" },
        );
      const probe = JSON.parse(
        execFileSync(
          "ffprobe",
          [
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            path.join(out, "episode-001.mp4"),
          ],
          { encoding: "utf8" },
        ),
      );
      expect(
        probe.streams.find(
          (s: { codec_type: string }) => s.codec_type === "video",
        ).nb_frames,
      ).toBe("909");
      const jobPath = path.join("data/studio/jobs", job!.id);
      await writeFile(
        path.join(out, "manifest.json"),
        await readFile(path.join(jobPath, "manifest.json")),
      );
      await writeFile(
        path.join(out, "validation.json"),
        await readFile(path.join(jobPath, "output.validation.json")),
      );
      const size = await sharp(path.join(out, "preview.png")).metadata();
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-ss",
        String(frame / 30),
        "-i",
        path.join(out, "episode-001.mp4"),
        "-frames:v",
        "1",
        "-vf",
        `scale=${size.width}:${size.height}`,
        path.join(out, "export.png"),
      ]);
      const crop = {
        left: 0,
        top: 0,
        width: size.width!,
        height: size.height! - 85,
      };
      const a = await sharp(path.join(out, "preview.png"))
        .removeAlpha()
        .extract(crop)
        .raw()
        .toBuffer();
      const b = await sharp(path.join(out, "export.png"))
        .removeAlpha()
        .extract(crop)
        .raw()
        .toBuffer();
      expect(a.length).toBe(b.length);
      const mae =
        a.reduce((n, value, i) => n + Math.abs(value - b[i]), 0) / a.length;
      expect(mae).toBeLessThan(12);
      expect(browserErrors).toEqual([]);
      await writeFile(
        path.join(out, "evidence.json"),
        JSON.stringify(
          {
            projectId: id,
            jobId: job!.id,
            alignmentTested: aligned,
            frame,
            previewExportMAE: mae,
            progress: [...progress],
            browserErrors,
            qc,
            probe,
          },
          null,
          2,
        ),
      );
    },
  );
}

test("script persists after refresh and stale suggestions cannot overwrite another tab", async ({
  page,
  context,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Import Episode 001" }).click();
  await expect(page.getByLabel("Seek preview")).toBeVisible();
  const title = "Persistent script " + Date.now();
  await page.getByLabel("Project title", { exact: true }).fill(title);
  const script = await readFile("episodes/episode-001/narration.txt", "utf8");
  await page.getByLabel("Narration script", { exact: true }).fill(script);
  await expect(
    page.getByRole("button", { name: "Suggest scene timing & motion" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.locator(".notice[role=status]")).toContainText(
    "Project saved",
  );
  await page.reload();
  await page.locator(".project-nav button").filter({ hasText: title }).click();
  await expect(
    page.getByLabel("Narration script", { exact: true }),
  ).toHaveValue(script);
  await page
    .getByRole("button", { name: "Suggest scene timing & motion" })
    .click();
  await expect(
    page.getByRole("button", { name: "Accept suggested timing & motion" }),
  ).toBeVisible();
  const tab = await context.newPage();
  await tab.goto("/");
  await tab.locator(".project-nav button").filter({ hasText: title }).click();
  await tab.getByLabel("Project title", { exact: true }).fill(title + " newer");
  await tab.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(tab.locator(".notice[role=status]")).toContainText(
    "Project saved",
  );
  await page
    .getByRole("button", { name: "Accept suggested timing & motion" })
    .click();
  await expect(page.locator(".smart-panel [role=alert]")).toContainText(
    "stale",
  );
  const list = await (await request.get("/api/studio/projects")).json();
  const project = list.projects.find(
    (p: StudioProject) => p.title === title + " newer",
  );
  expect(project.manifest.narrationScript).toBe(script);
  await writeFile(
    "outputs/phase-2/script-persistence.json",
    JSON.stringify(
      {
        projectId: project.id,
        scriptPersisted: true,
        staleSuggestionRejected: true,
      },
      null,
      2,
    ),
  );
  await tab.close();
});
