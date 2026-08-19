import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";
import { ensureFolder, queryDocuments } from "../../docQuery";

// Moving a document is also the only teaching signal the filing has. When a
// person overrules a folder Claude chose on its own, that pair is written to
// filing_corrections and comes back as a few-shot example on the next ingest.
// Confirming a proposed folder is agreement, not a correction — nothing to learn.

export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    folderId: z.string().trim().min(1).optional(),
    newFolderName: z.string().trim().min(1).max(60).optional(),
    confirmProposed: z.literal(true).optional(),
  })
  .refine(
    (body) => Boolean(body.folderId || body.newFolderName || body.confirmProposed),
    "expected folderId, newFolderName or confirmProposed",
  );

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUserId();
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "tell me where it should go", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const [doc] = await db
    .select()
    .from(tables.documents)
    .where(eq(tables.documents.id, id))
    .limit(1);
  if (!doc) return NextResponse.json({ error: "document not found" }, { status: 404 });

  let target: { id: string; name: string };
  if (body.confirmProposed) {
    const proposed = doc.proposedFolderName?.trim();
    if (!proposed) {
      return NextResponse.json({ error: "there's no proposed folder to confirm" }, { status: 400 });
    }
    // Claude's own idea, confirmed with a tap — still marked auto so the
    // taxonomy remembers who suggested it
    target = await ensureFolder(proposed, true);
  } else if (body.newFolderName) {
    target = await ensureFolder(body.newFolderName, false);
  } else {
    const [folder] = await db
      .select({ id: tables.folders.id, name: tables.folders.name })
      .from(tables.folders)
      .where(eq(tables.folders.id, body.folderId!))
      .limit(1);
    if (!folder) return NextResponse.json({ error: "folder not found" }, { status: 404 });
    target = folder;
  }

  const now = new Date();
  const wasAutoFiled = doc.filedAt !== null && doc.folderId !== null;
  const isCorrection = wasAutoFiled && doc.folderId !== target.id;

  await db
    .update(tables.documents)
    .set({
      folderId: target.id,
      proposedFolderName: null,
      filedAt: doc.filedAt ?? now,
      ...(isCorrection ? { correctedAt: now } : {}),
    })
    .where(eq(tables.documents.id, id));

  if (isCorrection) {
    await db.insert(tables.filingCorrections).values({
      documentId: id,
      fromFolderId: doc.folderId,
      toFolderId: target.id,
    });
  }

  const [document] = await queryDocuments({ where: eq(tables.documents.id, id), limit: 1 });

  return NextResponse.json({ document, folder: target, learned: isCorrection });
}
