import { asc, eq, ne } from "drizzle-orm";
import { db, tables } from "@/db";

// Cached-prefix builder. The stable block changes only when the underlying
// data changes (goals edited, folder created) — that's fine: a cache miss
// re-warms once, then every message in the conversation reads from cache.
// Rules for this block: deterministic ordering, NO timestamps, NO randomness.

export async function buildStableContext(): Promise<string> {
  const [settingsRow] = await db.select().from(tables.settings).limit(1);

  const activeGoals = await db
    .select()
    .from(tables.goals)
    .where(ne(tables.goals.status, "done"))
    .orderBy(asc(tables.goals.createdAt));

  const categoryRows = await db
    .select()
    .from(tables.categories)
    .orderBy(asc(tables.categories.sortOrder), asc(tables.categories.slug));

  const folderRows = await db.select().from(tables.folders).orderBy(asc(tables.folders.name));

  const budgetRows = await db
    .select({
      slug: tables.categories.slug,
      monthlyLimit: tables.budgets.monthlyLimit,
    })
    .from(tables.budgets)
    .innerJoin(tables.categories, eq(tables.budgets.categoryId, tables.categories.id))
    .orderBy(asc(tables.categories.slug));

  const sections: string[] = [];

  const profile = settingsRow?.profile ?? {};
  if (Object.keys(profile).length > 0) {
    sections.push(
      `## About them\n${Object.entries(profile)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
        .join("\n")}`,
    );
  }

  if (activeGoals.length > 0) {
    sections.push(
      `## Goals (non-done)\n${activeGoals
        .map(
          (g) =>
            `- [${g.status}] ${g.title}${g.why ? ` — why: ${g.why}` : ""}` +
            `${g.nextAction ? ` — next: ${g.nextAction}` : ""} (excitement ${g.excitement}/5, energy ${g.energyRequired})`,
        )
        .join("\n")}`,
    );
  }

  if (categoryRows.length > 0) {
    sections.push(
      `## Spending categories\n${categoryRows
        .map((c) => `- ${c.slug}: ${c.name}${c.isImpulseProne ? " (impulse-prone)" : ""}`)
        .join("\n")}`,
    );
  }

  if (budgetRows.length > 0) {
    sections.push(
      `## Monthly budgets (pence)\n${budgetRows
        .map((b) => `- ${b.slug}: ${b.monthlyLimit}`)
        .join("\n")}`,
    );
  }

  if (folderRows.length > 0) {
    sections.push(`## Document folders\n${folderRows.map((f) => `- ${f.name}`).join("\n")}`);
  }

  return sections.length > 0 ? sections.join("\n\n") : "(no stored context yet — fresh install)";
}

/** Volatile system block — everything time- or state-dependent goes here,
 * AFTER the cache breakpoint. */
export async function buildVolatileContext(): Promise<string> {
  const [settingsRow] = await db.select().from(tables.settings).limit(1);
  const timezone = settingsRow?.timezone ?? "Europe/London";
  const now = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());
  const energy = settingsRow?.energy ?? "medium";
  return `Now: ${now} (${timezone}). Current energy check-in: ${energy}.`;
}
