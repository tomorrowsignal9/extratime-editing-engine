import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { HttpError } from "./storage";
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host") || new URL(req.url).host;
  const expected = process.env.STUDIO_ORIGIN || `http://${host}`;
  const hostname = new URL(expected).hostname;
  if (
    (!process.env.STUDIO_ORIGIN &&
      !["localhost", "127.0.0.1", "[::1]"].includes(hostname)) ||
    req.headers.get("sec-fetch-site") === "cross-site" ||
    (origin && origin !== expected)
  )
    throw new HttpError(403, "Cross-origin mutations are not allowed.");
}
export async function bounded(req: Request, limit: number) {
  if (Number(req.headers.get("content-length") || 0) > limit)
    throw new HttpError(413, "Upload too large. Maximum request size: 100 MB.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "Empty request");
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new HttpError(
        413,
        "Upload too large. Maximum request size: 100 MB.",
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function streamFile(
  req: Request,
  file: string,
  type: string,
  download?: string,
) {
  const info = await stat(file);
  let start = 0,
    end = info.size - 1,
    status = 200;
  const range = req.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${info.size}` },
      });
    if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (start > end || start >= info.size)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${info.size}` },
      });
    status = 206;
  }
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (status === 206)
    headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
  if (download)
    headers["Content-Disposition"] = `attachment; filename="${download}"`;
  if (!info.size) return new Response(null, { headers });
  const stream = createReadStream(file, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status,
    headers,
  });
}
