import {
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { root, HttpError } from "./storage";
const file = () => path.join(root, "compute.lock");
export function claimCompute(owner: {
  id: string;
  kind: "render" | "speech";
  pid: number;
}) {
  mkdirSync(root, { recursive: true });
  try {
    const previous = JSON.parse(readFileSync(file(), "utf8"));
    try {
      process.kill(previous.pid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") unlinkSync(file());
      else throw e;
    }
  } catch (e) {
    if (
      (e as NodeJS.ErrnoException).code !== "ENOENT" &&
      !(e instanceof SyntaxError)
    )
      throw e;
  }
  let fd;
  try {
    fd = openSync(file(), "wx");
  } catch {
    throw new HttpError(
      409,
      "Another render or speech analysis is active. Wait for it to finish.",
    );
  }
  try {
    writeFileSync(fd, JSON.stringify(owner));
  } finally {
    closeSync(fd);
  }
}
export function assignCompute(id: string, pid: number) {
  try {
    const owner = JSON.parse(readFileSync(file(), "utf8"));
    if (owner.id === id)
      writeFileSync(file(), JSON.stringify({ ...owner, pid }));
  } catch {}
}
export function releaseCompute(id: string) {
  try {
    if (JSON.parse(readFileSync(file(), "utf8")).id === id) unlinkSync(file());
  } catch {}
}
