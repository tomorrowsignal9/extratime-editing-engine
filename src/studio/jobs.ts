import {
  mkdir,
  readFile,
  writeFile,
  unlink,
  readdir,
  open,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { root, id, atomic, readProject, HttpError, locked } from "./storage";
import { Project } from "../engine/schema";
import type { Job } from "./types";
export const jobDir = (key: string) => path.join(root, "jobs", id(key));
export const renderLock = path.join(root, "render.lock");
export async function getJob(key: string): Promise<Job> {
  try {
    return JSON.parse(
      await readFile(path.join(jobDir(key), "job.json"), "utf8"),
    );
  } catch {
    throw new HttpError(404, "Render job not found");
  }
}
export async function activeJob() {
  try {
    const entry = JSON.parse(await readFile(renderLock, "utf8"));
    const j = await getJob(entry.id);
    if (j.pid) {
      try {
        process.kill(j.pid, 0);
        return j;
      } catch {}
    } else if (Date.now() - Date.parse(j.createdAt) < 30000) return j;
    if (!["succeeded", "failed", "cancelled"].includes(j.status))
      await atomic(path.join(jobDir(j.id), "job.json"), {
        ...j,
        status: "failed",
        error: "Render process stopped unexpectedly. Retry the export.",
      });
    await unlink(renderLock);
    return null;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
export async function jobs() {
  await activeJob();
  await mkdir(path.join(root, "jobs"), { recursive: true });
  return (
    await Promise.all(
      (await readdir(path.join(root, "jobs")))
        .filter((v) => /^[a-f0-9-]{36}$/.test(v))
        .map(getJob),
    )
  ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function startJob(
  key: string,
  revision: number,
  approved: boolean,
) {
  if (!approved)
    throw new HttpError(
      400,
      "Review the preview, captions and media rights before export.",
    );
  return locked(key, async () => {
    const p = await readProject(key);
    if (p.deletedAt || p.revision !== revision)
      throw new HttpError(
        409,
        "Project changed. Reopen and review the latest version.",
      );
    if (!p.manifest)
      throw new HttpError(400, "Upload images and a voiceover first.");
    const manifest = Project.parse({ ...p.manifest, approved: true });
    if (!manifest.captions.length)
      throw new HttpError(400, "Import or add captions before exporting.");
    if (await activeJob())
      throw new HttpError(
        409,
        "A render is already active. Wait for it to finish or cancel it.",
      );
    const j: Job = {
      id: randomUUID(),
      projectId: key,
      title: p.title,
      revision,
      status: "queued",
      progress: 0,
      createdAt: new Date().toISOString(),
    };
    await mkdir(jobDir(j.id), { recursive: true });
    await atomic(path.join(jobDir(j.id), "job.json"), j);
    await atomic(path.join(jobDir(j.id), "manifest.json"), manifest);
    let handle;
    try {
      handle = await open(renderLock, "wx");
      await handle.writeFile(JSON.stringify({ id: j.id }));
      await handle.close();
    } catch {
      await atomic(path.join(jobDir(j.id), "job.json"), {
        ...j,
        status: "failed",
        error: "Another render acquired the worker.",
      });
      throw new HttpError(409, "Another render is already active.");
    }
    try {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "scripts/studio-worker.ts", j.id],
        {
          cwd: process.cwd(),
          env: { ...process.env, STUDIO_ROOT: root },
          detached: true,
          stdio: "ignore",
        },
      );
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.unref();
      return j;
    } catch (e) {
      await unlink(renderLock);
      await atomic(path.join(jobDir(j.id), "job.json"), {
        ...j,
        status: "failed",
        error: String(e),
      });
      throw e;
    }
  });
}
export async function cancelJob(key: string) {
  const j = await getJob(key);
  if (!["queued", "running", "verifying"].includes(j.status))
    throw new HttpError(409, "This job has already finished.");
  await writeFile(path.join(jobDir(key), "cancel"), "cancel");
  return j;
}
