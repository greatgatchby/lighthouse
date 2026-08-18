import { and, eq, gte, lte } from "drizzle-orm";
import { db, tables } from "@/db";
import { localDay } from "@/lib/format";

// "Safe to spend today" — the one number. Large, calm, no pence:
//   (primary balance − recurring committed before payday) / days to payday

export interface SafeToSpend {
  perDay: number; // pence
  balance: number; // pence, primary account
  committed: number; // pence, upcoming recurring before payday (positive number)
  daysToPayday: number;
  paydayDate: string; // YYYY-MM-DD
  hasData: boolean;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function nextPayday(
  paydayDay: number | null,
  timezone: string,
  from = new Date(),
): { date: Date; days: number } {
  const [y, m, d] = localDay(from, timezone).split("-").map(Number);
  const desired = paydayDay ?? 1;
  const todayUtc = new Date(Date.UTC(y, m - 1, d));

  // This month's payday, clamped to the month's length — a payday of the 31st
  // lands on the 28th in February, not in March.
  let year = y;
  let monthIndex = m - 1;
  let day = Math.min(desired, daysInMonth(year, monthIndex));

  if (d >= day) {
    monthIndex += 1;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
    day = Math.min(desired, daysInMonth(year, monthIndex));
  }

  const target = new Date(Date.UTC(year, monthIndex, day));
  const days = Math.max(1, Math.round((target.getTime() - todayUtc.getTime()) / 86400_000));
  return { date: target, days };
}

export async function safeToSpend(): Promise<SafeToSpend> {
  const [settingsRow] = await db.select().from(tables.settings).limit(1);
  const timezone = settingsRow?.timezone ?? "Europe/London";

  const [primary] = await db
    .select()
    .from(tables.accounts)
    .where(eq(tables.accounts.isPrimary, true))
    .limit(1);

  const account =
    primary ??
    (await db.select().from(tables.accounts).where(eq(tables.accounts.closed, false)).limit(1))[0];

  const { date, days } = nextPayday(settingsRow?.paydayDayOfMonth ?? null, timezone);

  if (!account) {
    return {
      perDay: 0,
      balance: 0,
      committed: 0,
      daysToPayday: days,
      paydayDate: localDay(date, "UTC"),
      hasData: false,
    };
  }

  const upcoming = await db
    .select()
    .from(tables.recurring)
    .where(
      and(
        eq(tables.recurring.status, "active"),
        gte(tables.recurring.nextExpectedAt, new Date()),
        lte(tables.recurring.nextExpectedAt, date),
      ),
    );

  // outgoing recurring amounts are negative; committed is the positive sum of money leaving
  const committed = upcoming.reduce((sum, r) => (r.amount < 0 ? sum - r.amount : sum), 0);
  const available = account.balance - committed;
  const perDay = Math.max(0, Math.floor(available / days));

  return {
    perDay,
    balance: account.balance,
    committed,
    daysToPayday: days,
    paydayDate: localDay(date, "UTC"),
    hasData: true,
  };
}
