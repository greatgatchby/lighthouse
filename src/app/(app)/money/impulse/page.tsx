import Link from "next/link";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { Card, EmptyState } from "@/components/ui";
import { BackLink } from "@/components/money/Shared";
import { isImpulseAction, type ImpulseAction } from "@/components/money/api";
import { env } from "@/lib/env";
import { formatMoney, formatRelativeDay } from "@/lib/format";

export const dynamic = "force-dynamic";

// The gentle check-in, ~30 minutes after a bigger impulse-category spend. It
// asks once, accepts any answer without argument, and never says "you spent
// again". Every branch here ends warmly — including the one where you're happy
// with it, which is most of them.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RESPONSES: { action: ImpulseAction; label: string; hint: string; line: string }[] = [
  {
    action: "happy",
    label: "Still happy with it",
    hint: "No notes. It was worth it.",
    line: "Enjoy it. That’s what money’s for.",
  },
  {
    action: "returning",
    label: "I’ll send it back",
    hint: "Returning it, and that’s that.",
    line: "Good call — future you says thanks.",
  },
  {
    action: "reflect",
    label: "Ask me tomorrow",
    hint: "Not sure yet — park it.",
    line: "Parked. I’ll ask again tomorrow — no pressure.",
  },
];

/** Record the answer with the finance vertical. If that route isn't up yet the
 * answer still stands on screen — the reply is about you, not about the API. */
async function recordResponse(transactionId: string | null, action: ImpulseAction) {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  try {
    await fetch(`${env.appUrl}/api/finance/impulse-response`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader },
      // Both key spellings until the finance route lands — zod strips the extras.
      body: JSON.stringify({ transactionId, txId: transactionId, action, response: action }),
      cache: "no-store",
    });
  } catch {
    // never block the reply on the network
  }
}

export default async function ImpulsePage({
  searchParams,
}: {
  searchParams: Promise<{ tx?: string; action?: string }>;
}) {
  const params = await searchParams;
  // The id goes to the API as it arrived; only a real uuid is safe to look up.
  const rawTx = typeof params.tx === "string" && params.tx ? params.tx.slice(0, 100) : null;
  const txId = rawTx && UUID.test(rawTx) ? rawTx : null;
  const action = isImpulseAction(params.action) ? params.action : null;

  const [settingsRow] = await db.select().from(tables.settings).limit(1);
  const timezone = settingsRow?.timezone ?? "Europe/London";

  const [tx] = txId
    ? await db
        .select({
          id: tables.transactions.id,
          description: tables.transactions.description,
          amount: tables.transactions.amount,
          postedAt: tables.transactions.postedAt,
          merchant: tables.merchants.displayName,
        })
        .from(tables.transactions)
        .leftJoin(tables.merchants, eq(tables.transactions.merchantId, tables.merchants.id))
        .where(eq(tables.transactions.id, txId))
        .limit(1)
    : [];

  if (action) {
    await recordResponse(rawTx, action);
    const chosen = RESPONSES.find((r) => r.action === action)!;

    return (
      <main>
        <header className="pt-6 pb-4">
          <BackLink />
        </header>

        <Card accent className="py-10 text-center">
          {tx ? (
            <div className="text-sm text-(--color-fog)">
              {formatMoney(Math.abs(tx.amount))} at {tx.merchant ?? tx.description}
            </div>
          ) : null}
          <p className="mt-2 text-xl leading-relaxed font-medium text-(--color-bright)">
            {chosen.line}
          </p>
        </Card>

        <Link
          href="/money"
          className="mt-4 block text-center text-sm text-(--color-fog)"
        >
          Back to money →
        </Link>
      </main>
    );
  }

  if (!tx) {
    return (
      <main>
        <header className="pt-6 pb-4">
          <BackLink />
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Check-in</h1>
        </header>
        <EmptyState
          icon="🫧"
          title="Nothing to check in on"
          hint="These only appear a little while after a bigger spend — and only when it might help."
        />
      </main>
    );
  }

  return (
    <main>
      <header className="pt-6 pb-4">
        <BackLink />
        <h1 className="mt-1 text-2xl font-bold tracking-tight">How’s this one sitting?</h1>
      </header>

      <Card className="text-center">
        <div className="text-4xl font-bold tabular-nums tracking-tight text-(--color-bright)">
          {formatMoney(Math.abs(tx.amount), { showPence: true })}
        </div>
        <div className="mt-1 text-sm text-(--color-mist)">{tx.merchant ?? tx.description}</div>
        <div className="mt-0.5 text-xs text-(--color-fog)">
          {formatRelativeDay(tx.postedAt, timezone)}
        </div>
      </Card>

      <div className="mt-3 space-y-2">
        {RESPONSES.map((response) => (
          <Link
            key={response.action}
            href={`/money/impulse?tx=${tx.id}&action=${response.action}`}
            className="block rounded-(--radius-card) border border-(--color-card-edge) bg-(--color-card) px-4 py-4 transition-colors active:border-(--color-beacon)/40"
          >
            <div className="text-base font-medium text-(--color-bright)">{response.label}</div>
            <div className="mt-0.5 text-sm text-(--color-fog)">{response.hint}</div>
          </Link>
        ))}
      </div>

      <p className="mt-4 px-1 text-center text-xs leading-relaxed text-(--color-fog)">
        Any answer is a fine answer. This gets asked once and then leaves you alone.
      </p>
    </main>
  );
}
