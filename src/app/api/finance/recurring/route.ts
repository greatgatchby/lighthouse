import { asc, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";

// Subscriptions + the graveyard. The graveyard is money on the table, never a
// telling-off: the UI reads graveyardMonthlyPence as "you could win back".

export const dynamic = "force-dynamic";

type Cadence = "weekly" | "monthly" | "yearly" | "unknown";

/** Per-month magnitude of a charge, whatever its cadence. */
function monthlyEquivalent(amountPence: number, cadence: Cadence): number {
  const abs = Math.abs(amountPence);
  if (cadence === "weekly") return Math.round((abs * 52) / 12);
  if (cadence === "yearly") return Math.round(abs / 12);
  return abs;
}

export async function GET() {
  await requireUserId();

  const rows = await db
    .select()
    .from(tables.recurring)
    .where(inArray(tables.recurring.status, ["active", "graveyard"]))
    .orderBy(asc(tables.recurring.name));

  const shape = (row: (typeof rows)[number]) => ({
    id: row.id,
    name: row.name,
    amountPence: row.amount,
    cadence: row.cadence,
    dayOfMonth: row.dayOfMonth ?? null,
    lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    nextExpectedAt: row.nextExpectedAt ? row.nextExpectedAt.toISOString() : null,
    status: row.status,
    kind: row.kind,
  });

  // Only outgoing money counts toward the monthly totals — a salary row is
  // recurring too, and adding it in would make the number meaningless.
  const outgoing = (row: (typeof rows)[number]) => row.amount < 0;

  const active = rows.filter((row) => row.status === "active");
  const graveyard = rows.filter((row) => row.status === "graveyard");

  const monthlyTotalPence = active
    .filter(outgoing)
    .reduce((sum, row) => sum + monthlyEquivalent(row.amount, row.cadence), 0);
  const graveyardMonthlyPence = graveyard
    .filter(outgoing)
    .reduce((sum, row) => sum + monthlyEquivalent(row.amount, row.cadence), 0);

  return NextResponse.json({
    active: active.map(shape),
    graveyard: graveyard.map(shape),
    monthlyTotalPence,
    graveyardMonthlyPence,
  });
}
