import { BackLink } from "@/components/money/Shared";
import { TransactionsView } from "@/components/money/TransactionsView";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const params = await searchParams;
  const category = typeof params.category === "string" && params.category ? params.category : null;

  return (
    <main>
      <header className="pt-6 pb-4">
        <BackLink />
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Transactions</h1>
      </header>

      <TransactionsView initialCategory={category} />
    </main>
  );
}
