import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { transactions } from "./finance";

export const folders = pgTable("folders", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  parentId: uuid("parent_id"),
  // created by Claude's filing (vs created by hand)
  isAuto: boolean("is_auto").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // content-addressed original in storage/: first two hex chars / full hash
    sha256: text("sha256").notNull().unique(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    status: text("status", { enum: ["pending", "extracted", "failed"] })
      .notNull()
      .default("pending"),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    docType: text("doc_type"),
    issuer: text("issuer"),
    title: text("title"),
    issuedAt: date("issued_at"),
    expiresAt: date("expires_at"),
    // pence, if the document carries an amount (bill, receipt, invoice)
    amount: integer("amount"),
    reference: text("reference"),
    summary: text("summary"),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    extractedText: text("extracted_text"),
    // receipt auto-match (amount + date ±3d + merchant)
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    // when Claude proposed a folder that doesn't exist yet, it waits here for a confirm tap
    proposedFolderName: text("proposed_folder_name"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    filedAt: timestamp("filed_at", { withTimezone: true }),
    correctedAt: timestamp("corrected_at", { withTimezone: true }),
  },
  (t) => [
    index("documents_folder_idx").on(t.folderId),
    index("documents_expires_idx").on(t.expiresAt),
    index("documents_status_idx").on(t.status),
    // expression GIN index; search queries must use the identical expression
    index("documents_fts_idx").using(
      "gin",
      sql`to_tsvector('english', coalesce(${t.title}, '') || ' ' || coalesce(${t.summary}, '') || ' ' || coalesce(${t.extractedText}, ''))`,
    ),
  ],
);

// corrections become few-shot examples in the cached filing prompt — it learns your style
export const filingCorrections = pgTable("filing_corrections", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  fromFolderId: uuid("from_folder_id").references(() => folders.id, { onDelete: "set null" }),
  toFolderId: uuid("to_folder_id")
    .notNull()
    .references(() => folders.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
