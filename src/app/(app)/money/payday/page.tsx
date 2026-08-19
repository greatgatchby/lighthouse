import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { PaydayRitual } from "@/components/money/PaydayRitual";
import { BackLink, ConnectMonzoCard } from "@/components/money/Shared";

export const dynamic = "force-dynamic";

// Payday, as a three-tap ritual: see the number, tuck a bit into each pot,
// done. It has to be fast and a little bit joyful — money that gets a job on
// the day it lands is money that survives the month.

export default async function PaydayPage() {
  // Checked server-side so the page never flashes a broken ritual: with no
  // account connected there is nothing to move, and the calm ask comes first.
  const [account] = await db
    .select({ id: tables.accounts.id })
    .from(tables.accounts)
    .where(eq(tables.accounts.closed, false))
    .limit(1);

  return (
    <main>
      <header className="pt-6 pb-4">
        <BackLink />
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Payday</h1>
        <p className="mt-1 text-sm text-(--color-fog)">
          {account
            ? "Give some of it a job while it’s still here. Three taps and you’re done."
            : "This is the good bit — it needs an account first."}
        </p>
      </header>

      {account ? (
        <PaydayRitual />
      ) : (
        <ConnectMonzoCard
          title="Connect Monzo first"
          hint="Once your account and pots are here, payday becomes three taps: see the balance, tuck a bit into each pot, done."
        />
      )}
    </main>
  );
}
