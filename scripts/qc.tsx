/** Deterministic geometry + media QC. Uses the actual shared caption component, not a second layout. */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "@playwright/test";
import { ensureBrowser } from "@remotion/renderer";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { Project } from "../src/engine/schema";
import { Captions } from "../src/engine/Captions";
const [manifest, video] = process.argv.slice(2);
if (!manifest)
  throw Error("Usage: tsx scripts/qc.tsx manifest.json [video.mp4]");
const output = video
  ? video.replace(/\.mp4$/, ".qc.json")
  : manifest.replace(/\.json$/, ".qc.json");
const checks: { name: string; passed: boolean; details: unknown }[] = [];
const parsed = Project.safeParse(JSON.parse(await readFile(manifest, "utf8")));
checks.push({
  name: "manifest-and-overlap",
  passed: parsed.success,
  details: parsed.success
    ? "Ordered captions/words, valid scene and sound timing"
    : parsed.error.issues,
});
if (parsed.success) {
  const p = parsed.data;
  let browser;
  try {
    const available = await ensureBrowser({
      browserExecutable: process.env.CHROME_PATH,
    });
    if (!("path" in available))
      throw Error("Compatible Chromium unavailable for caption geometry QC");
    browser = await chromium.launch({
      executablePath: available.path,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage({
      viewport: { width: 1080, height: 1920 },
    });
    const samples = p.captions.flatMap((c, i) => {
      const frames =
        c.words?.length && p.captionTiming?.reviewed && p.captionTiming.reliable
          ? c.words.map((w) =>
              Math.max(
                Math.ceil(w.start * 30),
                Math.min(
                  Math.floor(w.end * 30) - 1,
                  Math.ceil(w.start * 30) + 2,
                ),
              ),
            )
          : [Math.ceil((c.start + c.end) * 15)];
      return frames.map((frame) => ({ cue: i + 1, frame }));
    });
    await page.setContent(
      '<html><body style="margin:0;font-family:Arial,sans-serif">' +
        samples
          .map((s, i) =>
            renderToStaticMarkup(
              <div
                data-sample={i}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: 1080,
                  height: 1920,
                }}
              >
                <Captions project={p} frame={s.frame} />
              </div>,
            ),
          )
          .join("") +
        "</body></html>",
    );
    await page.evaluate(() => document.fonts.ready);
    const measured = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-sample]")).map((wrapper) => {
        const caption = wrapper.querySelector("[data-caption]");
        if (!caption)
          return { missing: true, bounds: null, lines: 0, overlaps: 0 };
        const texts = document.createTreeWalker(caption, NodeFilter.SHOW_TEXT);
        const rects: DOMRect[] = [];
        let node;
        while ((node = texts.nextNode())) {
          if (node.textContent?.trim()) {
            const range = document.createRange();
            range.selectNodeContents(node);
            rects.push(...Array.from(range.getClientRects()));
          }
        }
        const bounds = rects.length
          ? {
              left: Math.min(...rects.map((r) => r.left)),
              right: Math.max(...rects.map((r) => r.right)),
              top: Math.min(...rects.map((r) => r.top)),
              bottom: Math.max(...rects.map((r) => r.bottom)),
            }
          : null;
        const lines: number[] = [];
        for (const top of rects.map((r) => r.top).sort((a, b) => a - b))
          if (!lines.some((line) => Math.abs(line - top) < 15)) lines.push(top);
        let overlaps = 0;
        for (let i = 1; i < rects.length; i++)
          if (
            Math.abs(rects[i].top - rects[i - 1].top) < 15 &&
            rects[i].left < rects[i - 1].right - 0.5
          )
            overlaps++;
        return {
          missing: !rects.length,
          bounds,
          lines: lines.length,
          overlaps,
        };
      }),
    );
    const failures = measured.flatMap((m, i) =>
      !m.bounds ||
      m.missing ||
      m.bounds.left < 75 ||
      m.bounds.right > 945 ||
      m.bounds.top < 480 ||
      m.bounds.bottom > 1600 ||
      m.lines > 2 ||
      m.overlaps > 0
        ? [{ ...samples[i], ...m }]
        : [],
    );
    checks.push({
      name: "caption-safe-zones",
      passed: samples.length > 0 && failures.length === 0,
      details: {
        method:
          "Browser text bounds from shared Captions component, including active-word transforms",
        samples: samples.length,
        safeArea: { left: 75, right: 945, top: 480, bottom: 1600 },
        failures,
      },
    });
  } catch (e) {
    checks.push({
      name: "caption-safe-zones",
      passed: false,
      details: String(e),
    });
  } finally {
    await browser?.close();
  }
  if (video) {
    try {
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
            video,
          ],
          { encoding: "utf8" },
        ),
      );
      const v = probe.streams.find(
        (s: { codec_type: string }) => s.codec_type === "video",
      );
      const a = probe.streams.find(
        (s: { codec_type: string }) => s.codec_type === "audio",
      );
      const original = JSON.parse(
        execFileSync(
          "ffprobe",
          ["-v", "error", "-show_format", "-of", "json", `public/${p.audio}`],
          { encoding: "utf8" },
        ),
      );
      checks.push({
        name: "streams-and-duration",
        passed: Boolean(
          v &&
          a &&
          v.width === 1080 &&
          v.height === 1920 &&
          v.codec_name === "h264" &&
          a.codec_name === "aac" &&
          Number(a.duration) + 0.05 >= Number(original.format.duration) &&
          v.r_frame_rate === "30/1" &&
          Number(v.duration) + 0.001 >= Number(original.format.duration) &&
          Math.abs(Number(probe.format.duration) - p.duration) < 0.1,
        ),
        details: {
          video: v?.duration,
          source: original.format.duration,
          container: probe.format.duration,
          codecs: [v?.codec_name, a?.codec_name],
        },
      });
      const scan = spawnSync(
        "ffmpeg",
        [
          "-hide_banner",
          "-i",
          video,
          "-vf",
          "blackdetect=d=0.02:pix_th=0.1",
          "-af",
          "astats=metadata=0:reset=0",
          "-f",
          "null",
          "-",
        ],
        { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
      );
      const black = [...scan.stderr.matchAll(/black_start:([^\n]+)/g)].map(
        (m) => m[0],
      );
      const peaks = [...scan.stderr.matchAll(/Peak level dB: ([-\d.]+)/g)].map(
        (m) => Number(m[1]),
      );
      checks.push({
        name: "black-frames",
        passed: scan.status === 0 && !black.length,
        details: { frames: Math.ceil(p.duration * 30), intervals: black },
      });
      checks.push({
        name: "audio-clipping",
        passed: peaks.length > 0 && Math.max(...peaks) < -0.05,
        details: { peakDb: peaks.length ? Math.max(...peaks) : null },
      });
    } catch (e) {
      checks.push({
        name: "media-analysis",
        passed: false,
        details: String(e),
      });
    }
  }
}
const report = {
  version: 1,
  status: checks.every((c) => c.passed) ? "passed" : "failed",
  manifest,
  video: video || null,
  checks,
};
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.status !== "passed") process.exitCode = 1;
