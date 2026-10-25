import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import {
  root,
  exec,
  readProject,
  atomic,
  HttpError,
  id,
  publicRoot,
  saveProject,
} from "../studio/storage";
import { claimCompute, releaseCompute } from "../studio/compute";
import { Project } from "../engine/schema";
import { suggestEdit } from "./suggestions";
const python = () =>
  process.env.EXTRATIME_PYTHON || path.resolve(".venv/bin/python");
export async function speechStatus() {
  try {
    const { stdout } = await exec(python(), ["scripts/speech.py", "--status"], {
      timeout: 15000,
    });
    return JSON.parse(stdout);
  } catch {
    return {
      alignment: [],
      transcription: [],
      downloadsDuringProcessing: false,
      reason:
        "Local speech dependencies or weights are not installed. Manual SRT remains available.",
    };
  }
}
export async function speechSuggestion(key: string, input: unknown) {
  const body = z
    .object({
      revision: z.number().int(),
      mode: z.enum(["align", "transcribe"]),
      script: z.string().max(20000).optional(),
      model: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    })
    .parse(input);
  const p = await readProject(key);
  if (p.deletedAt || p.revision !== body.revision)
    throw new HttpError(409, "Project changed. Save/reopen before analysis.");
  if (!p.manifest)
    throw new HttpError(400, "Add a voiceover and images first.");
  if (body.mode === "align" && !body.script?.trim())
    throw new HttpError(400, "Paste the exact English narration script.");
  const token = randomUUID();
  claimCompute({ id: token, kind: "speech", pid: process.pid });
  try {
    const dir = path.join(root, "assists", token);
    await mkdir(dir, { recursive: true });
    const scriptFile = path.join(dir, "script.txt");
    if (body.script)
      await import("node:fs/promises").then((fs) =>
        fs.writeFile(scriptFile, body.script!),
      );
    const output = path.join(dir, "speech.json");
    try {
      await exec(
        python(),
        [
          "scripts/speech.py",
          "--mode",
          body.mode,
          "--audio",
          path.join(publicRoot, p.manifest.audio),
          "--model",
          body.model,
          "--output",
          output,
          ...(body.mode === "align" ? ["--script", scriptFile] : []),
        ],
        {
          timeout: 240000,
          maxBuffer: 2 * 1024 * 1024,
          env: {
            ...process.env,
            HF_HUB_OFFLINE: "1",
            TRANSFORMERS_OFFLINE: "1",
            OMP_NUM_THREADS: "2",
          },
        },
      );
    } catch (e) {
      const detail = (e as { stderr?: string }).stderr;
      let message =
        "Local speech processing unavailable. Install/import a local model or use manual SRT.";
      try {
        message =
          JSON.parse(detail!.trim().split("\n").at(-1)!).error || message;
      } catch {}
      throw new HttpError(422, message);
    }
    const result = JSON.parse(await readFile(output, "utf8"));
    const captions = result.captions.map(
      (c: { start: number; end: number }) => c,
    );
    if (captions.length && p.manifest.duration - captions.at(-1)!.end < 0.5)
      captions[captions.length - 1].end = p.manifest.duration;
    Project.parse({ ...p.manifest, captions });
    const suggestion = {
      id: token,
      projectId: key,
      revision: p.revision,
      audio: p.manifest.audio,
      ...result,
      captions,
    };
    await atomic(path.join(dir, "suggestion.json"), suggestion);
    return suggestion;
  } finally {
    releaseCompute(token);
  }
}
export async function acceptSpeech(key: string, input: unknown) {
  const body = z
    .object({
      revision: z.number().int(),
      suggestionId: z.string(),
      reviewed: z.boolean(),
    })
    .parse(input);
  const result = JSON.parse(
    await readFile(
      path.join(root, "assists", id(body.suggestionId), "suggestion.json"),
      "utf8",
    ),
  );
  const p = await readProject(key);
  if (
    result.projectId !== key ||
    result.revision !== body.revision ||
    p.revision !== body.revision ||
    result.audio !== p.manifest?.audio
  )
    throw new HttpError(
      409,
      "This suggestion is stale or belongs to another project. Generate it again.",
    );
  return saveProject(key, {
    revision: body.revision,
    title: p.title,
    manifest: {
      ...p.manifest,
      captions: result.captions,
      captionTiming: {
        method: result.provenance.method,
        reliable: result.reliable,
        reviewed: body.reviewed,
      },
      approved: false,
    },
  });
}
export async function editingSuggestion(key: string, input: unknown) {
  const body = z.object({ revision: z.number().int() }).parse(input);
  const p = await readProject(key);
  if (!p.manifest || p.revision !== body.revision)
    throw new HttpError(
      409,
      "Save a valid timeline before requesting suggestions.",
    );
  return { ...suggestEdit(p.manifest), revision: p.revision };
}
export async function acceptEdit(key: string, input: unknown) {
  const body = z.object({ revision: z.number().int() }).parse(input);
  const p = await readProject(key);
  if (!p.manifest || p.revision !== body.revision)
    throw new HttpError(409, "Suggestions are stale. Request them again.");
  return saveProject(key, {
    revision: body.revision,
    title: p.title,
    manifest: suggestEdit(p.manifest).manifest,
  });
}
