import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  createProject,
  listProjects,
  readProject,
  saveProject,
  trashProject,
  ingest,
  sampleAvailable,
  importSample,
  HttpError,
} from "../../../../src/studio/storage";
import {
  jobs,
  startJob,
  activeJob,
  cancelJob,
  getJob,
  jobDir,
} from "../../../../src/studio/jobs";
import { bounded, sameOrigin, streamFile } from "../../../../src/studio/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
async function handle(req: Request, context: Context) {
  try {
    const parts = (await context.params).path;
    const [area, key, action] = parts;
    const method = req.method;
    if (method !== "GET") sameOrigin(req);
    const json = async () =>
      JSON.parse((await bounded(req, 2 * 1024 * 1024)).toString());
    let result: unknown;
    if (area === "projects" && !key && method === "GET")
      result = {
        projects: await listProjects(),
        sampleAvailable: await sampleAvailable(),
      };
    else if (area === "projects" && !key && method === "POST")
      result = await createProject((await json()).title);
    else if (area === "sample" && method === "POST")
      result = await importSample();
    else if (area === "projects" && key && !action && method === "GET")
      result = await readProject(key);
    else if (area === "projects" && key && !action && method === "PUT")
      result = await saveProject(key, await json());
    else if (area === "projects" && key && !action && method === "DELETE") {
      if ((await activeJob())?.projectId === key)
        throw new HttpError(409, "Wait for this project’s render to finish.");
      result = await trashProject(key);
    } else if (
      area === "projects" &&
      key &&
      action === "restore" &&
      method === "POST"
    )
      result = await trashProject(key, true);
    else if (
      area === "projects" &&
      key &&
      action === "upload" &&
      method === "POST"
    ) {
      const bytes = await bounded(req, 100 * 1024 * 1024);
      const data = await new Response(new Uint8Array(bytes), {
        headers: { "Content-Type": req.headers.get("content-type") || "" },
      }).formData();
      const files = data.getAll("files");
      if (files.some((f) => typeof f === "string"))
        throw new HttpError(400, "Expected media files");
      const entries = await Promise.all(
        (files as File[]).map(async (f) => ({
          name: f.name,
          bytes: Buffer.from(await f.arrayBuffer()),
        })),
      );
      result = await ingest(
        key,
        entries,
        Number(data.get("revision")),
        data.get("replace")?.toString(),
      );
    } else if (area === "jobs" && !key && method === "GET")
      result = await jobs();
    else if (area === "jobs" && !key && method === "POST") {
      const body = z
        .object({
          projectId: z.string(),
          revision: z.number().int(),
          approved: z.boolean(),
        })
        .parse(await json());
      result = await startJob(body.projectId, body.revision, body.approved);
    } else if (
      area === "jobs" &&
      key &&
      action === "cancel" &&
      method === "POST"
    )
      result = await cancelJob(key);
    else if (area === "jobs" && key && action === "log" && method === "GET") {
      await getJob(key);
      const log = await readFile(
        path.join(jobDir(key), "render.log"),
        "utf8",
      ).catch(() => "Waiting for renderer…");
      result = { log: log.slice(-16000) };
    } else if (
      area === "jobs" &&
      key &&
      action === "download" &&
      method === "GET"
    ) {
      const job = await getJob(key);
      if (job.status !== "succeeded")
        throw new HttpError(409, "Render is not complete.");
      return streamFile(
        req,
        path.join(jobDir(key), "output.mp4"),
        "video/mp4",
        `extratime-${key}.mp4`,
      );
    } else throw new HttpError(404, "Unknown endpoint");
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const status =
      e instanceof HttpError
        ? e.status
        : e instanceof z.ZodError || e instanceof SyntaxError
          ? 400
          : 500;
    const message =
      e instanceof z.ZodError
        ? e.issues.map((i) => i.message).join("; ")
        : e instanceof HttpError
          ? e.message
          : status === 400
            ? "Invalid request."
            : "Operation failed. Check the local server logs.";
    if (status === 500) console.error(e);
    return Response.json({ error: message }, { status });
  }
}
export const GET = handle,
  POST = handle,
  PUT = handle,
  DELETE = handle;
