import { Card } from "@/components/ui";

/** The forgiving streak. Seven dots, one per local day — a gap is just a gap,
 * nothing counts down and nothing ever resets. */
export function ShowupBar({ days }: { days: { day: string; shownUp: boolean }[] }) {
  const count = days.filter((d) => d.shownUp).length;

  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-(--color-mist)">
            Shown up {count} of the last 7 days
          </div>
          <div className="mt-0.5 text-xs text-(--color-fog)">
            {count === 0
              ? "Today's dot is right there whenever you want it."
              : "Gaps are just gaps — nothing here resets."}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5" aria-hidden>
          {days.map((d) => (
            <span
              key={d.day}
              className={`h-2.5 w-2.5 rounded-full ${
                d.shownUp ? "bg-(--color-beacon)" : "bg-(--color-card-edge)"
              }`}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}
