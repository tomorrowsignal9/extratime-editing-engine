import path from "node:path";
import { realpath } from "node:fs/promises";
import { streamFile } from "../../../src/studio/http";
export const runtime = "nodejs";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const parts = (await params).path;
    if (
      parts.some(
        (p) => !p || p === "." || p === ".." || !/^[a-zA-Z0-9_.-]+$/.test(p),
      )
    )
      return new Response("Invalid asset", { status: 400 });
    const base = await realpath("public/media");
    const file = await realpath(path.join(base, ...parts));
    if (!file.startsWith(base + path.sep))
      return new Response("Forbidden", { status: 403 });
    const types: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
    };
    const type = types[path.extname(file)];
    if (!type) return new Response("Unsupported asset", { status: 400 });
    return streamFile(req, file, type);
  } catch {
    return new Response("Asset not found", { status: 404 });
  }
}
