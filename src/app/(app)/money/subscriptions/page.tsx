import { BackLink } from "@/components/money/Shared";
import { SubscriptionsView } from "@/components/money/SubscriptionsView";

export const dynamic = "force-dynamic";

export default function SubscriptionsPage() {
  return (
    <main>
      <header className="pt-6 pb-4">
        <BackLink />
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Subscriptions</h1>
        <p className="mt-1 text-sm text-(--color-fog)">
          Quiet money leaving on a schedule. Every one you close is a win.
        </p>
      </header>

      <SubscriptionsView />
    </main>
  );
}
