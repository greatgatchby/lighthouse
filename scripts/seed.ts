import { db, tables } from "@/db";

// Seed the category taxonomy (idempotent). Impulse-prone flags drive the
// gentle impulse check-in window.

const CATEGORIES: Array<{
  slug: string;
  name: string;
  kind?: "spending" | "income" | "transfer";
  impulse?: boolean;
}> = [
  { slug: "groceries", name: "Groceries" },
  { slug: "eating-out", name: "Eating out", impulse: true },
  { slug: "coffee", name: "Coffee", impulse: true },
  { slug: "transport", name: "Transport" },
  { slug: "bills", name: "Bills & utilities" },
  { slug: "rent-mortgage", name: "Rent / mortgage" },
  { slug: "subscriptions", name: "Subscriptions" },
  { slug: "shopping", name: "Shopping", impulse: true },
  { slug: "tech", name: "Tech & gadgets", impulse: true },
  { slug: "hobbies", name: "Hobbies", impulse: true },
  { slug: "health", name: "Health & fitness" },
  { slug: "personal-care", name: "Personal care" },
  { slug: "entertainment", name: "Entertainment", impulse: true },
  { slug: "travel", name: "Travel" },
  { slug: "gifts", name: "Gifts & giving" },
  { slug: "education", name: "Learning" },
  { slug: "home", name: "Home" },
  { slug: "pets", name: "Pets" },
  { slug: "fees", name: "Fees & charges" },
  { slug: "cash", name: "Cash withdrawals" },
  { slug: "salary", name: "Salary", kind: "income" },
  { slug: "other-income", name: "Other income", kind: "income" },
  { slug: "transfers", name: "Transfers", kind: "transfer" },
  { slug: "savings", name: "Savings & pots", kind: "transfer" },
  { slug: "other", name: "Other" },
];

async function main() {
  for (const [i, cat] of CATEGORIES.entries()) {
    await db
      .insert(tables.categories)
      .values({
        slug: cat.slug,
        name: cat.name,
        kind: cat.kind ?? "spending",
        isImpulseProne: cat.impulse ?? false,
        sortOrder: i,
      })
      .onConflictDoNothing({ target: tables.categories.slug });
  }
  console.log(`seeded ${CATEGORIES.length} categories`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
