import { join, resolve } from "path";
import { mkdir, rm, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { config } from "../config";

const root = config.uploadsDir;

export async function saveTaskUpload(taskId: number, bytes: Uint8Array, ext: string): Promise<string> {
  const dir = join(root, String(taskId));
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  await writeFile(join(dir, name), bytes);
  return `/uploads/${taskId}/${name}`;
}

export async function removeTaskUploads(taskId: number): Promise<void> {
  await rm(join(root, String(taskId)), { recursive: true, force: true }).catch(() => {});
}

export function resolveUploadPath(rel: string): string | null {
  const full = resolve(root, rel.replace(/^\/+/, ""));
  if (full !== root && !full.startsWith(root + "/")) return null;
  return full;
}
