import { NextResponse } from "next/server";
import { sql as dsql } from "drizzle-orm";
import { tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";
import { queryDocuments } from "../docQuery";

// Full-text search over everything Claude read off the page. The tsvector
// expression below must stay character-identical to the one in
// documents_fts_idx (and in lib/claude/tools.ts search_documents) — any drift
// and Postgres quietly stops using the GIN index.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await requireUserId();

  const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (!query) return NextResponse.json({ query: "", count: 0, results: [] });

  const fts = dsql`to_tsvector('english', coalesce(${tables.documents.title}, '') || ' ' || coalesce(${tables.documents.summary}, '') || ' ' || coalesce(${tables.documents.extractedText}, ''))`;

  const results = await queryDocuments({
    where: dsql`${fts} @@ plainto_tsquery('english', ${query})`,
    orderBy: dsql`ts_rank(${fts}, plainto_tsquery('english', ${query})) desc`,
    limit: 25,
  });

  return NextResponse.json({ query, count: results.length, results });
}
