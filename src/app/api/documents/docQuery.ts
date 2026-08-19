import { asc, desc, eq, ilike, sql as dsql, type SQL } from "drizzle-orm";
import { db, tables } from "@/db";
import type { DocRow, DocStatus, FolderRow } from "@/components/documents/types";

// One shared read shape for the documents vertical: the page, the list API and
// the search API all return exactly the same DocRow, so the UI never has to
// care which one it came from. (Not a route file — App Router only treats
// route.ts as a handler, so this colocated module is just a module.)

export async function queryDocuments(
  opts: { where?: SQL; orderBy?: SQL; limit?: number } = {},
): Promise<DocRow[]> {
  const rows = await db
    .select({
      id: tables.documents.id,
      filename: tables.documents.filename,
      mimeType: tables.documents.mimeType,
      status: tables.documents.status,
      title: tables.documents.title,
      docType: tables.documents.docType,
      issuer: tables.documents.issuer,
      issuedAt: tables.documents.issuedAt,
      expiresAt: tables.documents.expiresAt,
      amount: tables.documents.amount,
      reference: tables.documents.reference,
      summary: tables.documents.summary,
      tags: tables.documents.tags,
      folderId: tables.documents.folderId,
      folderName: tables.folders.name,
      proposedFolderName: tables.documents.proposedFolderName,
      filedAt: tables.documents.filedAt,
      createdAt: tables.documents.createdAt,
      error: tables.documents.error,
      txId: tables.transactions.id,
      txDescription: tables.transactions.description,
      txAmount: tables.transactions.amount,
      txPostedAt: tables.transactions.postedAt,
    })
    .from(tables.documents)
    .leftJoin(tables.folders, eq(tables.documents.folderId, tables.folders.id))
    .leftJoin(tables.transactions, eq(tables.documents.transactionId, tables.transactions.id))
    .where(opts.where)
    .orderBy(opts.orderBy ?? desc(tables.documents.createdAt))
    .limit(opts.limit ?? 50);

  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    status: row.status as DocStatus,
    title: row.title,
    docType: row.docType,
    issuer: row.issuer,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    amountPence: row.amount,
    reference: row.reference,
    summary: row.summary,
    tags: row.tags ?? [],
    folderId: row.folderId,
    folderName: row.folderName,
    proposedFolderName: row.proposedFolderName,
    filedAt: row.filedAt ? row.filedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    error: row.error,
    transaction:
      row.txId && row.txPostedAt
        ? {
            id: row.txId,
            description: row.txDescription ?? "",
            amountPence: row.txAmount ?? 0,
            postedAt: row.txPostedAt.toISOString(),
          }
        : null,
  }));
}

export async function loadFolders(): Promise<FolderRow[]> {
  const rows = await db
    .select({
      id: tables.folders.id,
      name: tables.folders.name,
      count: dsql<number>`count(${tables.documents.id})::int`,
    })
    .from(tables.folders)
    .leftJoin(tables.documents, eq(tables.documents.folderId, tables.folders.id))
    .groupBy(tables.folders.id, tables.folders.name)
    .orderBy(asc(tables.folders.name));

  return rows.map((row) => ({ id: row.id, name: row.name, count: Number(row.count ?? 0) }));
}

/** Folder names are short and reusable — matching is case-insensitive so
 *  "utilities" never becomes a second Utilities. */
export async function ensureFolder(
  rawName: string,
  isAuto: boolean,
): Promise<{ id: string; name: string }> {
  const name = rawName.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!name) throw new Error("folder name is empty");

  const [existing] = await db
    .select({ id: tables.folders.id, name: tables.folders.name })
    .from(tables.folders)
    .where(ilike(tables.folders.name, name))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(tables.folders)
    .values({ name, isAuto })
    .onConflictDoNothing({ target: tables.folders.name })
    .returning({ id: tables.folders.id, name: tables.folders.name });
  if (created) return created;

  // raced with another writer creating the same name
  const [raced] = await db
    .select({ id: tables.folders.id, name: tables.folders.name })
    .from(tables.folders)
    .where(ilike(tables.folders.name, name))
    .limit(1);
  if (!raced) throw new Error(`could not create folder '${name}'`);
  return raced;
}
