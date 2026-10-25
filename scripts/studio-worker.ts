import {
  readFileSync,
  writeFileSync,
  renameSync,
  appendFileSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { jobDir, renderLock } from "../src/studio/jobs";
import type { Job } from "../src/studio/types";
const key = process.argv[2],
  dir = jobDir(key),
  jobPath = path.join(dir, "job.json");
const job: Job = JSON.parse(readFileSync(jobPath, "utf8"));
job.pid = process.pid;
job.status = "running";
const persist = () => {
  writeFileSync(jobPath + ".tmp", JSON.stringify(job, null, 2));
  renameSync(jobPath + ".tmp", jobPath);
};
persist();
let current: ReturnType<typeof spawn> | null = null;
const cancelled = () => existsSync(path.join(dir, "cancel"));
const timer = setInterval(() => {
  if (cancelled() && current?.pid) {
    try {
      process.kill(-current.pid, "SIGTERM");
    } catch {}
  }
}, 500);
const run = (script: string, args: string[], env: Record<string, string> = {}) =>
  new Promise<void>((resolve, reject) => {
    if (cancelled()) return reject(Error("Cancelled"));
    current = spawn(process.execPath, ["--import", "tsx", script, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buffered = "";
    const consume = (chunk: Buffer) => {
      const s = chunk.toString();
      appendFileSync(path.join(dir, "render.log"), s);
      buffered += s;
      const lines = buffered.split("\n");
      buffered = lines.pop()!;
      for (const line of lines) {
        const match = line.match(/^progress=(\d+)$/);
        if (match) {
          job.progress = Math.min(99, Number(match[1]));
          persist();
        }
      }
    };
    current.stdout!.on("data", consume);
    current.stderr!.on("data", consume);
    current.once("error", reject);
    current.once("exit", (code) => {
      current = null;
      code === 0
        ? resolve()
        : reject(Error(`Render command exited with ${code}. See diagnostics.`));
    });
  });
try {
  await run("scripts/render.ts", [path.join(dir, "manifest.json")], {
    RENDER_OUTPUT: path.join(dir, "output.mp4"),
  });
  job.status = "verifying";
  persist();
  await run("scripts/validate.ts", [
    path.join(dir, "manifest.json"),
    path.join(dir, "output.mp4"),
  ]);
  if (cancelled()) throw Error("Cancelled");
  job.status = "succeeded";
  job.progress = 100;
} catch (e) {
  job.status = cancelled() ? "cancelled" : "failed";
  job.error = e instanceof Error ? e.message : String(e);
} finally {
  clearInterval(timer);
  job.finishedAt = new Date().toISOString();
  persist();
  try {
    if (JSON.parse(readFileSync(renderLock, "utf8")).id === key)
      unlinkSync(renderLock);
  } catch {}
}
