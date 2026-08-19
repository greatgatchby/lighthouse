import { and, desc, eq, isNull, lt, notInArray, or, type SQL, sql as dsql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";

// Keyset-paginated transaction list, newest first. Live rows only.
//
// The cursor is the postedAt of the last row on the page and the next page is
// strictly older, so pages never overlap. To make that safe when several rows
// share a timestamp (CSV imports love midnight), the page is widened to include
// the whole tied group before the cursor is handed out.

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** LIKE metacharacters are literal here — searching "50%" should find "50%". */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function GET(request: Request) {
  await requireUserId();

  const url = new URL(request.url);
  const beforeParam = url.searchParams.get("before");
  const category = url.searchParams.get("category")?.trim() || null;
  const search = url.searchParams.get("search")?.trim() || null;
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : DEFAULT_LIMIT),
  );

  const before = beforeParam ? new Date(beforeParam) : null;
  if (before && Number.isNaN(before.getTime())) {
    return NextResponse.json({ error: "before must be an ISO timestamp" }, { status: 400 });
  }

  const filters: SQL[] = [isNull(tables.transactions.supersededBy)];
  if (category) {
    filters.push(
      category === "uncategorised"
        ? isNull(tables.transactions.categoryId)
        : eq(tables.categories.slug, category),
    );
  }
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    const matches = or(
      dsql`${tables.transactions.description} ilike ${pattern}`,
      dsql`${tables.merchants.displayName} ilike ${pattern}`,
    );
    if (matches) filters.push(matches);
  }

  const columns = {
    id: tables.transactions.id,
    postedAt: tables.transactions.postedAt,
    description: tables.transactions.description,
    amountPence: tables.transactions.amount,
    merchant: tables.merchants.displayName,
    categorySlug: tables.categories.slug,
    categoryName: tables.categories.name,
    declined: tables.transactions.declined,
  };

  const query = (extra: SQL[]) =>
    db
      .select(columns)
      .from(tables.transactions)
      .leftJoin(tables.merchants, eq(tables.transactions.merchantId, tables.merchants.id))
      .leftJoin(tables.categories, eq(tables.transactions.categoryId, tables.categories.id))
      .where(and(...filters, ...extra))
      .orderBy(desc(tables.transactions.postedAt), desc(tables.transactions.id));

  const page = await query(before ? [lt(tables.transactions.postedAt, before)] : []).limit(limit + 1);

  const hasMore = page.length > limit;
  const rows = hasMore ? page.slice(0, limit) : page;
  let nextBefore: string | null = null;

  if (hasMore && rows.length > 0) {
    const boundary = rows[rows.length - 1].postedAt;
    // pull in anything sharing the boundary timestamp so the cursor can be strict
    const tied = await query([
      eq(tables.transactions.postedAt, boundary),
      notInArray(
        tables.transactions.id,
        rows.map((row) => row.id),
      ),
    ]).limit(MAX_LIMIT);
    rows.push(...tied);
    nextBefore = boundary.toISOString();
  }

  return NextResponse.json({
    rows: rows.map((row) => ({
      id: row.id,
      postedAt: row.postedAt.toISOString(),
      description: row.description,
      amountPence: row.amountPence,
      merchant: row.merchant ?? null,
      categorySlug: row.categorySlug ?? null,
      categoryName: row.categoryName ?? null,
      declined: row.declined,
    })),
    nextBefore,
  });
}
