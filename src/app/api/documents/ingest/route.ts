import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";
import { enqueue } from "@/lib/boss";
import { QUEUES } from "@/lib/queues";
import { extensionFor, sha256Hex, storeFile } from "@/lib/storage";

// Capture endpoint. Two callers, one shape:
//   1. the app's camera / file picker  → fetch(FormData), wants JSON back
//   2. the PWA manifest share_target   → a browser navigation, wants a page back
// Storage is content-addressed, so re-sharing the same photo is a no-op that
// resolves to the document already filed.

export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

const EXTENSION_MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

function isAccepted(mimeType: string): boolean {
  return mimeType === "application/pdf" || mimeType.startsWith("image/");
}

/** Share sheets and some cameras hand over application/octet-stream — fall back to the name. */
function resolveMime(file: File): string {
  const declared = (file.type || "").toLowerCase().split(";")[0].trim();
  if (isAccepted(declared)) return declared;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return EXTENSION_MIME[ext] ?? declared;
}

export async function POST(request: Request) {
  await requireUserId();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const wantsHtml = (request.headers.get("accept") ?? "").includes("text/html");

  // 'files' is what the manifest share_target posts; 'file' is the friendlier singular
  const files = [...form.getAll("files"), ...form.getAll("file")].filter(
    (entry): entry is File => entry instanceof File && entry.size > 0,
  );

  if (files.length === 0) {
    if (wantsHtml) {
      return NextResponse.redirect(new URL("/documents?ingested=0", request.url), 303);
    }
    return NextResponse.json({ error: "no files in the request" }, { status: 400 });
  }

  const documents: { id: string; sha256: string; duplicate: boolean; filename: string }[] = [];
  const skipped: { filename: string; reason: string }[] = [];

  for (const file of files) {
    const mimeType = resolveMime(file);
    if (!isAccepted(mimeType)) {
      skipped.push({ filename: file.name, reason: "only PDFs and images for now" });
      continue;
    }
    if (file.size > MAX_BYTES) {
      skipped.push({ filename: file.name, reason: "larger than 25MB" });
      continue;
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      skipped.push({ filename: file.name, reason: "larger than 25MB" });
      continue;
    }

    const sha256 = sha256Hex(bytes);
    const filename = file.name?.trim() || `capture-${sha256.slice(0, 8)}.${extensionFor(mimeType)}`;

    const [already] = await db
      .select({ id: tables.documents.id })
      .from(tables.documents)
      .where(eq(tables.documents.sha256, sha256))
      .limit(1);
    if (already) {
      documents.push({ id: already.id, sha256, duplicate: true, filename });
      continue;
    }

    await storeFile(bytes, mimeType, filename);

    const [row] = await db
      .insert(tables.documents)
      .values({ sha256, filename, mimeType, sizeBytes: bytes.byteLength })
      .onConflictDoNothing({ target: tables.documents.sha256 })
      .returning({ id: tables.documents.id });

    if (!row) {
      // raced with another upload of the same bytes — the first one owns it
      const [existing] = await db
        .select({ id: tables.documents.id })
        .from(tables.documents)
        .where(eq(tables.documents.sha256, sha256))
        .limit(1);
      if (existing) documents.push({ id: existing.id, sha256, duplicate: true, filename });
      continue;
    }

    await enqueue(QUEUES.docIngest, { documentId: row.id }, { retryLimit: 2 });
    documents.push({ id: row.id, sha256, duplicate: false, filename });
  }

  if (wantsHtml) {
    const fresh = documents.filter((doc) => !doc.duplicate).length;
    return NextResponse.redirect(new URL(`/documents?ingested=${fresh}`, request.url), 303);
  }

  return NextResponse.json({ documents, skipped });
}
