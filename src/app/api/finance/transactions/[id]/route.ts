import { and, eq, isNull, ne, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";

// Recategorise one transaction. "Remember this merchant" teaches the merchant
// row, which is what every future ingest reads first — so the correction sticks
// without ever asking again.

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  categorySlug: z.string().min(1),
  rememberMerchant: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUserId();
  const { id } = await params;

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "categorySlug is required" }, { status: 400 });
  }
  const { categorySlug, rememberMerchant } = parsed.data;

  const [category] = await db
    .select()
    .from(tables.categories)
    .where(eq(tables.categories.slug, categorySlug))
    .limit(1);
  if (!category) {
    return NextResponse.json({ error: `Unknown category "${categorySlug}"` }, { status: 400 });
  }

  const [transaction] = await db
    .select()
    .from(tables.transactions)
    .where(eq(tables.transactions.id, id))
    .limit(1);
  if (!transaction) {
    return NextResponse.json({ error: "That transaction isn’t here." }, { status: 404 });
  }

  await db
    .update(tables.transactions)
    .set({ categoryId: category.id, categorySource: "manual" })
    .where(eq(tables.transactions.id, id));

  let merchantUpdated = false;
  let alsoUpdated = 0;

  if (rememberMerchant && transaction.merchantId) {
    await db
      .update(tables.merchants)
      .set({ categoryId: category.id, categorySource: "manual" })
      .where(eq(tables.merchants.id, transaction.merchantId));
    merchantUpdated = true;

    // Bring the merchant's other rows along — except ones already categorised
    // by hand, which are somebody's deliberate choice.
    const touched = await db
      .update(tables.transactions)
      .set({ categoryId: category.id, categorySource: "merchant" })
      .where(
        and(
          eq(tables.transactions.merchantId, transaction.merchantId),
          ne(tables.transactions.id, id),
          isNull(tables.transactions.supersededBy),
          or(
            isNull(tables.transactions.categorySource),
            ne(tables.transactions.categorySource, "manual"),
          ),
        ),
      )
      .returning({ id: tables.transactions.id });
    alsoUpdated = touched.length;
  }

  await db.insert(tables.auditLog).values({
    kind: "finance:recategorise",
    detail: { transactionId: id, categorySlug, merchantUpdated, alsoUpdated },
  });

  return NextResponse.json({
    ok: true,
    id,
    categorySlug: category.slug,
    categoryName: category.name,
    merchantUpdated,
    alsoUpdated,
  });
}
