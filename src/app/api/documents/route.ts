import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";
import { loadFolders, queryDocuments } from "./docQuery";

// The paper drawer, as JSON: what came in recently plus the shelves it can go
// on. The page renders from the server directly; this exists for the client to
// re-read after a change and for anything else that wants the same shapes.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await requireUserId();

  const params = new URL(request.url).searchParams;
  const folderId = params.get("folderId");
  const limitRaw = Number(params.get("limit"));
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 60;

  const [documents, folders] = await Promise.all([
    queryDocuments({
      where: folderId ? eq(tables.documents.folderId, folderId) : undefined,
      limit,
    }),
    loadFolders(),
  ]);

  return NextResponse.json({
    documents,
    folders,
    counts: {
      total: documents.length,
      pending: documents.filter((doc) => doc.status === "pending").length,
      awaitingConfirm: documents.filter((doc) => doc.proposedFolderName !== null).length,
    },
  });
}
