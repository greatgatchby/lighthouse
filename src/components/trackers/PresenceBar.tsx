import { weekdayInitial } from "./days";

/** Forgiving streak: "shown up N of the last 7 days" as filling dots.
 * Never a counter that resets to zero — a gap costs you nothing. */
export function PresenceBar({
  days,
  label,
}: {
  days: { day: string; count: number }[];
  label: (n: number) => string;
}) {
  const shown = days.filter((d) => d.count > 0).length;
  return (
    <div className="rounded-(--radius-card) border border-(--color-card-edge) bg-(--color-ink-soft) px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-(--color-mist)">{label(shown)}</span>
        <div className="flex gap-1.5">
          {days.map((d) => (
            <div key={d.day} className="flex flex-col items-center gap-1">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  d.count > 0 ? "bg-(--color-beacon)" : "bg-(--color-card-edge)"
                }`}
                aria-hidden
              />
              <span className="text-[9px] text-(--color-fog)">{weekdayInitial(d.day)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
