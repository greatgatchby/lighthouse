import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";
import { readStoredFile } from "@/lib/storage";

// The original, exactly as it was captured — served inline so a tap opens the
// photo or PDF in the browser's own viewer rather than downloading it.

export const dynamic = "force-dynamic";

/** Content-Disposition is a header: no quotes, no newlines, no non-ASCII. */
function safeFilename(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\\r\n]/g, "_");
  return ascii.trim().slice(0, 120) || "document";
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUserId();
  const { id } = await params;

  const [doc] = await db
    .select({
      sha256: tables.documents.sha256,
      mimeType: tables.documents.mimeType,
      filename: tables.documents.filename,
    })
    .from(tables.documents)
    .where(eq(tables.documents.id, id))
    .limit(1);
  if (!doc) return NextResponse.json({ error: "document not found" }, { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readStoredFile(doc.sha256, doc.mimeType, doc.filename);
  } catch {
    return NextResponse.json({ error: "the original file is missing from storage" }, { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": doc.mimeType,
      "content-length": String(bytes.byteLength),
      "content-disposition": `inline; filename="${safeFilename(doc.filename)}"`,
      // content-addressed storage: the bytes behind an id never change
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
