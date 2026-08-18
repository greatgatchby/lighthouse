import { and, eq, isNull, sql as dsql } from "drizzle-orm";
import { db, tables } from "@/db";
import { dedupeCandidateKeys, dedupeKeyForDate } from "@/lib/dedupe";
import { formatMoney, normaliseMerchant } from "@/lib/format";
import { decayedExcitement, energyMatch, rankGoals } from "@/lib/goals/rank";
import { inQuietHours } from "@/lib/push";
import { nextPayday, safeToSpend } from "@/lib/finance/safeToSpend";

// End-to-end smoke test against a live database. Seeds synthetic data, asserts
// the invariants the plan calls out, then cleans up after itself.
//
//   pnpm smoke
//
// Everything it creates is tagged SMOKE_ so cleanup is exact.

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

async function cleanup() {
  await db.delete(tables.users).where(eq(tables.users.name, "SMOKE_user"));
  await db.delete(tables.transactions).where(dsql`${tables.transactions.providerTxId} like 'SMOKE_%'`);
  await db.delete(tables.recurring).where(dsql`${tables.recurring.name} like 'SMOKE_%'`);
  await db.delete(tables.accounts).where(dsql`${tables.accounts.providerAccountId} like 'SMOKE_%'`);
  await db.delete(tables.merchants).where(dsql`${tables.merchants.normalisedName} like 'smoke %'`);
  await db.delete(tables.goals).where(dsql`${tables.goals.title} like 'SMOKE_%'`);
  await db.delete(tables.documents).where(dsql`${tables.documents.filename} like 'SMOKE_%'`);
  await db.delete(tables.folders).where(dsql`${tables.folders.name} like 'SMOKE_%'`);
}

async function main() {
  console.log("\nLighthouse smoke test\n");
  await cleanup();

  // ---------------------------------------------------------------- pure fns
  console.log("pure helpers");
  check("formatMoney rounds to whole pounds", formatMoney(123456) === "£1,235", formatMoney(123456));
  check("formatMoney exact keeps pence", formatMoney(-450, { showPence: true }) === "£4.50");
  check("formatMoney signs outgoing", formatMoney(-450, { sign: true }) === "−£5");
  check(
    "normaliseMerchant strips terminal noise",
    normaliseMerchant("TESCO STORES 3421*LONDON") === "tesco stores london",
    normaliseMerchant("TESCO STORES 3421*LONDON"),
  );
  check("quiet hours wrap midnight", inQuietHours(22 * 60, 8 * 60, 23 * 60) === true);
  check("quiet hours exclude daytime", inQuietHours(22 * 60, 8 * 60, 12 * 60) === false);
  check("quiet hours same start/end disables", inQuietHours(60, 60, 60) === false);

  const now = new Date();
  check("energy match is 1 when equal", energyMatch("low", "low") === 1);
  check("high goal on low day is heavily damped", energyMatch("high", "low") < 0.2);
  check("low goal on high day still viable", energyMatch("low", "high") > 0.8);

  const fresh = {
    excitement: 5,
    excitementUpdatedAt: now,
    energyRequired: "low",
    nextAction: null,
  } as never;
  const stale = {
    excitement: 5,
    excitementUpdatedAt: new Date(now.getTime() - 42 * 86400_000),
    energyRequired: "low",
    nextAction: null,
  } as never;
  check("excitement decays over time", decayedExcitement(stale, now) < decayedExcitement(fresh, now));
  check("~2 half-lives ≈ quarter", Math.abs(decayedExcitement(stale, now) - 1.25) < 0.05);

  // ------------------------------------------------------------------ dedupe
  console.log("\ndedupe");
  const txDate = new Date("2026-07-15T14:30:00Z");
  const monzoKey = dedupeKeyForDate(txDate, -1250, "TESCO STORES 3421*LONDON");
  const lunchflowKey = dedupeKeyForDate(
    new Date("2026-07-15T00:00:00Z"),
    -1250,
    "Tesco Stores (London)",
  );
  check("same purchase from two providers hashes equal", monzoKey === lunchflowKey);
  const candidates = dedupeCandidateKeys(txDate, -1250, "TESCO STORES 3421*LONDON");
  check("candidate keys cover ±1 day", candidates.length === 3 && candidates.includes(monzoKey));
  check(
    "different amount is a different key",
    dedupeKeyForDate(txDate, -1300, "TESCO STORES 3421*LONDON") !== monzoKey,
  );

  // -------------------------------------------------------------- db: dedupe
  console.log("\ndatabase invariants");
  const [account] = await db
    .insert(tables.accounts)
    .values({
      provider: "monzo",
      providerAccountId: "SMOKE_acc_monzo",
      name: "SMOKE current account",
      balance: 120_000,
      isPrimary: true,
      balanceUpdatedAt: now,
    })
    .returning();

  const [lfAccount] = await db
    .insert(tables.accounts)
    .values({
      provider: "lunchflow",
      providerAccountId: "SMOKE_acc_lf",
      name: "SMOKE lunchflow mirror",
      balance: 120_000,
    })
    .returning();

  const [canonical] = await db
    .insert(tables.transactions)
    .values({
      accountId: account.id,
      providerTxId: "SMOKE_tx_monzo_1",
      postedAt: txDate,
      amount: -1250,
      description: "TESCO STORES 3421*LONDON",
      dedupeKey: monzoKey,
    })
    .returning();

  const [twin] = await db
    .insert(tables.transactions)
    .values({
      accountId: lfAccount.id,
      providerTxId: "SMOKE_tx_lf_1",
      postedAt: new Date("2026-07-15T00:00:00Z"),
      amount: -1250,
      description: "Tesco Stores (London)",
      dedupeKey: lunchflowKey,
      supersededBy: canonical.id,
    })
    .returning();

  const live = await db
    .select({ id: tables.transactions.id })
    .from(tables.transactions)
    .where(and(eq(tables.transactions.dedupeKey, monzoKey), isNull(tables.transactions.supersededBy)));
  check("exactly one live row survives dedupe", live.length === 1, live.length);
  check("the survivor is the Monzo row (canonical)", live[0]?.id === canonical.id);

  // the partial unique index must forbid a second twin pointing at the same canonical row
  let secondTwinRejected = false;
  try {
    await db.insert(tables.transactions).values({
      accountId: lfAccount.id,
      providerTxId: "SMOKE_tx_lf_2",
      postedAt: txDate,
      amount: -1250,
      description: "Tesco again",
      dedupeKey: lunchflowKey,
      supersededBy: canonical.id,
    });
  } catch {
    secondTwinRejected = true;
  }
  check("1:1 pairing enforced by partial unique index", secondTwinRejected);

  // two genuinely identical coffees on one day must BOTH survive
  const coffeeKey = dedupeKeyForDate(txDate, -320, "PRET A MANGER");
  await db.insert(tables.transactions).values([
    {
      accountId: account.id,
      providerTxId: "SMOKE_tx_coffee_1",
      postedAt: txDate,
      amount: -320,
      description: "PRET A MANGER",
      dedupeKey: coffeeKey,
    },
    {
      accountId: account.id,
      providerTxId: "SMOKE_tx_coffee_2",
      postedAt: new Date(txDate.getTime() + 3 * 3600_000),
      amount: -320,
      description: "PRET A MANGER",
      dedupeKey: coffeeKey,
    },
  ]);
  const coffees = await db
    .select({ id: tables.transactions.id })
    .from(tables.transactions)
    .where(and(eq(tables.transactions.dedupeKey, coffeeKey), isNull(tables.transactions.supersededBy)));
  check("two real identical purchases both survive", coffees.length === 2, coffees.length);

  // ------------------------------------------------------------ safe-to-spend
  console.log("\npayday dates");
  const utc = "UTC";
  const feb = nextPayday(31, utc, new Date("2026-02-05T12:00:00Z"));
  check("payday 31st clamps to end of February", feb.date.toISOString().startsWith("2026-02-28"), feb.date.toISOString());
  const marchRoll = nextPayday(31, utc, new Date("2026-02-28T12:00:00Z"));
  check(
    "on payday itself it rolls to next month",
    marchRoll.date.toISOString().startsWith("2026-03-31"),
    marchRoll.date.toISOString(),
  );
  const yearRoll = nextPayday(28, utc, new Date("2026-12-30T12:00:00Z"));
  check(
    "December rolls into next year",
    yearRoll.date.toISOString().startsWith("2027-01-28"),
    yearRoll.date.toISOString(),
  );
  const midMonth = nextPayday(28, utc, new Date("2026-08-18T12:00:00Z"));
  check("mid-month payday counts forward", midMonth.days === 10, midMonth.days);

  console.log("\nsafe to spend");
  // stand up a throwaway user+settings when the install has no passkey yet
  const [existingSettings] = await db.select().from(tables.settings).limit(1);
  if (!existingSettings) {
    const [smokeUser] = await db
      .insert(tables.users)
      .values({ name: "SMOKE_user" })
      .returning({ id: tables.users.id });
    await db.insert(tables.settings).values({ userId: smokeUser.id, paydayDayOfMonth: 28 });
  }

  await db.insert(tables.recurring).values({
    name: "SMOKE_rent",
    amount: -80_000,
    cadence: "monthly",
    nextExpectedAt: new Date(now.getTime() + 3 * 86400_000),
    status: "active",
    kind: "bill",
  });
  const sts = await safeToSpend();
  check("safe-to-spend has data", sts.hasData);
  check("committed recurring is subtracted", sts.committed >= 80_000, sts.committed);
  check("per-day is never negative", sts.perDay >= 0, sts.perDay);
  check("per-day ≤ balance/days", sts.perDay <= Math.ceil(sts.balance / sts.daysToPayday), {
    perDay: sts.perDay,
    balance: sts.balance,
    days: sts.daysToPayday,
  });
  check("days to payday is at least 1", sts.daysToPayday >= 1, sts.daysToPayday);

  // ------------------------------------------------------------------- goals
  console.log("\nranking");
  const goalRows = await db
    .insert(tables.goals)
    .values([
      { title: "SMOKE_high_energy", excitement: 5, energyRequired: "high", status: "active" },
      { title: "SMOKE_low_energy", excitement: 4, energyRequired: "low", status: "active" },
    ])
    .returning();
  const rankedLow = rankGoals(goalRows, "low");
  check(
    "low-energy day surfaces the doable goal first",
    rankedLow[0]?.title === "SMOKE_low_energy",
    rankedLow.map((g) => g.title),
  );
  const rankedHigh = rankGoals(goalRows, "high");
  check(
    "high-energy day surfaces the exciting hard goal first",
    rankedHigh[0]?.title === "SMOKE_high_energy",
    rankedHigh.map((g) => g.title),
  );

  // --------------------------------------------------------------------- FTS
  console.log("\nfull-text search");
  const [folder] = await db
    .insert(tables.folders)
    .values({ name: "SMOKE_Utilities" })
    .returning();
  await db.insert(tables.documents).values({
    sha256: `smoke${Date.now().toString(16).padStart(59, "0")}`.slice(0, 64),
    filename: "SMOKE_bill.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    status: "extracted",
    folderId: folder.id,
    title: "Octopus Energy bill",
    issuer: "Octopus Energy",
    summary: "Electricity statement for the flat",
    extractedText: "Octopus Energy electricity statement kilowatt hours standing charge",
  });
  const fts = dsql`to_tsvector('english', coalesce(${tables.documents.title}, '') || ' ' || coalesce(${tables.documents.summary}, '') || ' ' || coalesce(${tables.documents.extractedText}, ''))`;
  const hits = await db
    .select({ id: tables.documents.id })
    .from(tables.documents)
    .where(dsql`${fts} @@ plainto_tsquery('english', 'electricity statement')`);
  check("FTS finds the seeded document", hits.length >= 1, hits.length);
  const misses = await db
    .select({ id: tables.documents.id })
    .from(tables.documents)
    .where(dsql`${fts} @@ plainto_tsquery('english', 'passport renewal')`);
  check("FTS does not match unrelated terms", misses.length === 0, misses.length);

  // -------------------------------------------------------------------- done
  await cleanup();
  console.log(`\n${checks - failures}/${checks} checks passed\n`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nsmoke test crashed:", err);
  await cleanup().catch(() => {});
  process.exit(1);
});
