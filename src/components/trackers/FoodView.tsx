"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, SectionTitle } from "@/components/ui";
import { PresenceBar } from "./PresenceBar";
import { clockTime, dayLabel } from "./days";

interface Meal {
  id: string;
  at: string;
  name: string;
  description: string | null;
  calories: number | null;
}
interface DayBucket {
  day: string;
  count: number;
  meals: Meal[];
}

export function FoodView() {
  const [days, setDays] = useState<DayBucket[]>([]);
  const [timezone, setTimezone] = useState("Europe/London");
  const [name, setName] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [calories, setCalories] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/food?days=7");
    if (res.ok) {
      const data = await res.json();
      setDays(data.days ?? []);
      setTimezone(data.timezone ?? "Europe/London");
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    await fetch("/api/food", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: trimmed,
        description: description.trim() || null,
        calories: calories ? Number(calories) : null,
      }),
    }).catch(() => {});
    setName("");
    setDescription("");
    setCalories("");
    setDetailsOpen(false);
    setBusy(false);
    void load();
  }

  async function remove(id: string) {
    await fetch(`/api/food/${id}`, { method: "DELETE" }).catch(() => {});
    void load();
  }

  // days come newest-last from the API grouping; presence bar reads left→right
  const today = days.at(-1);

  return (
    <main>
      <header className="pt-6 pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Food</h1>
      </header>

      <Card>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
            placeholder="What did you eat?"
            className="min-h-11 flex-1 rounded-xl border border-(--color-card-edge) bg-(--color-ink-soft) px-3 text-sm outline-none placeholder:text-(--color-fog) focus:border-(--color-beacon)/50"
          />
          <Button onClick={add} disabled={busy || !name.trim()}>
            Log
          </Button>
        </div>
        <button
          onClick={() => setDetailsOpen((v) => !v)}
          className="mt-2 text-xs text-(--color-fog)"
        >
          {detailsOpen ? "Hide details" : "Add details (optional)"}
        </button>
        {detailsOpen ? (
          <div className="mt-2 space-y-2">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes"
              className="min-h-11 w-full rounded-xl border border-(--color-card-edge) bg-(--color-ink-soft) px-3 text-sm outline-none placeholder:text-(--color-fog)"
            />
            <input
              value={calories}
              onChange={(e) => setCalories(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              placeholder="Calories, if you know them"
              className="min-h-11 w-full rounded-xl border border-(--color-card-edge) bg-(--color-ink-soft) px-3 text-sm outline-none placeholder:text-(--color-fog)"
            />
          </div>
        ) : null}
      </Card>

      {days.length > 0 ? (
        <div className="mt-4">
          <PresenceBar
            days={days}
            label={(n) => `Logged something ${n} of the last 7 days`}
          />
        </div>
      ) : null}

      <SectionTitle>Today</SectionTitle>
      {today && today.meals.length > 0 ? (
        <Card className="divide-y divide-(--color-card-edge)">
          {today.meals.map((meal) => (
            <div key={meal.id} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div className="truncate font-medium">{meal.name}</div>
                <div className="text-xs text-(--color-fog)">
                  {clockTime(meal.at, timezone)}
                  {meal.calories ? ` · ${meal.calories} kcal` : ""}
                </div>
              </div>
              <button
                onClick={() => remove(meal.id)}
                className="shrink-0 text-xs text-(--color-fog)"
              >
                remove
              </button>
            </div>
          ))}
        </Card>
      ) : (
        <EmptyState
          icon="🍜"
          title={loaded ? "Nothing logged today" : "…"}
          hint="A name is enough. Logged beats precise."
        />
      )}

      {days.filter((d) => d.count > 0 && d.day !== today?.day).length > 0 ? (
        <>
          <SectionTitle>Earlier this week</SectionTitle>
          <div className="space-y-2">
            {[...days]
              .reverse()
              .filter((d) => d.count > 0 && d.day !== today?.day)
              .map((bucket) => (
                <Card key={bucket.day}>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wider text-(--color-fog)">
                    {dayLabel(bucket.day, timezone)}
                  </div>
                  {bucket.meals.map((meal) => (
                    <div key={meal.id} className="flex justify-between py-1 text-sm">
                      <span className="truncate pr-3 text-(--color-mist)">{meal.name}</span>
                      <span className="shrink-0 text-xs text-(--color-fog)">
                        {clockTime(meal.at, timezone)}
                      </span>
                    </div>
                  ))}
                </Card>
              ))}
          </div>
        </>
      ) : null}
    </main>
  );
}
