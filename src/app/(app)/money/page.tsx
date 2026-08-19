import { MoneyOverview } from "@/components/money/MoneyOverview";

export const dynamic = "force-dynamic";

export default async function MoneyPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string }>;
}) {
  const params = await searchParams;

  return (
    <main>
      <header className="pt-6 pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Money</h1>
      </header>

      <MoneyOverview justConnected={params.connected === "1"} />
    </main>
  );
}
