// PLACEHOLDER — replaced by its vertical.
import { EmptyState } from "@/components/ui";

export default function FoodPage() {
  return (
    <main>
      <header className="pt-6 pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Food</h1>
      </header>
      <EmptyState title="Food is being built" hint="This page arrives with its vertical." />
    </main>
  );
}
