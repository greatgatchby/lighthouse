import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Content-addressed document store: storage/ab/abcdef....<ext>
// STORAGE_DIR overridable for tests; defaults to ./storage (bind-mounted in compose).

const STORAGE_DIR = process.env.STORAGE_DIR ?? path.join(process.cwd(), "storage");

export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function pathFor(hash: string, ext: string): string {
  return path.join(STORAGE_DIR, hash.slice(0, 2), ext ? `${hash}.${ext}` : hash);
}

const extForMime: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/webp": "webp",
  "text/csv": "csv",
};

export function extensionFor(mimeType: string, filename?: string): string {
  if (extForMime[mimeType]) return extForMime[mimeType];
  const fromName = filename?.includes(".") ? filename.split(".").pop() : undefined;
  return (fromName ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
}

export async function storeFile(
  data: Buffer,
  mimeType: string,
  filename?: string,
): Promise<{ sha256: string; storedPath: string }> {
  const hash = sha256Hex(data);
  const ext = extensionFor(mimeType, filename);
  const target = pathFor(hash, ext);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data, { flag: "w" });
  return { sha256: hash, storedPath: target };
}

export async function readStoredFile(hash: string, mimeType: string, filename?: string) {
  return readFile(pathFor(hash, extensionFor(mimeType, filename)));
}
