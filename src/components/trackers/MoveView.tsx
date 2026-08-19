"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, Pill, SectionTitle } from "@/components/ui";
import { PresenceBar } from "./PresenceBar";
import { clockTime, dayLabel } from "./days";

interface Workout {
  id: string;
  at: string;
  kind: string;
  minutes: number | null;
  intensity: "easy" | "moderate" | "hard" | null;
  note: string | null;
}
interface DayBucket {
  day: string;
  count: number;
  minutes: number;
  sessions: Workout[];
}

const KINDS = ["walk", "run", "gym", "climb", "yoga", "other"];
const INTENSITIES = ["easy", "moderate", "hard"] as const;

export function MoveView() {
  const [days, setDays] = useState<DayBucket[]>([]);
  const [timezone, setTimezone] = useState("Europe/London");
  const [kind, setKind] = useState<string>("walk");
  const [minutes, setMinutes] = useState(30);
  const [intensity, setIntensity] = useState<(typeof INTENSITIES)[number]>("moderate");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/move?days=7");
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
    if (busy) return;
    setBusy(true);
    await fetch("/api/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, minutes, intensity }),
    }).catch(() => {});
    setBusy(false);
    void load();
  }

  async function remove(id: string) {
    await fetch(`/api/move/${id}`, { method: "DELETE" }).catch(() => {});
    void load();
  }

  const today = days.at(-1);
  const weekMinutes = days.reduce((sum, d) => sum + d.minutes, 0);

  return (
    <main>
      <header className="pt-6 pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Move</h1>
      </header>

      <Card>
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-full px-3 py-1.5 text-sm capitalize ${
                kind === k
                  ? "bg-(--color-beacon-soft) text-(--color-beacon)"
                  : "bg-(--color-ink-soft) text-(--color-fog)"
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm text-(--color-fog)">Minutes</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMinutes((m) => Math.max(5, m - 5))}
              className="h-9 w-9 rounded-lg bg-(--color-ink-soft) text-lg text-(--color-mist)"
            >
              −
            </button>
            <span className="w-10 text-center text-lg font-semibold tabular-nums">{minutes}</span>
            <button
              onClick={() => setMinutes((m) => Math.min(600, m + 5))}
              className="h-9 w-9 rounded-lg bg-(--color-ink-soft) text-lg text-(--color-mist)"
            >
              +
            </button>
          </div>
        </div>

        <div className="mt-3 flex gap-1.5">
          {INTENSITIES.map((level) => (
            <button
              key={level}
              onClick={() => setIntensity(level)}
              className={`flex-1 rounded-xl px-3 py-2 text-sm capitalize ${
                intensity === level
                  ? "bg-(--color-beacon-soft) text-(--color-beacon)"
                  : "bg-(--color-ink-soft) text-(--color-fog)"
              }`}
            >
              {level}
            </button>
          ))}
        </div>

        <Button className="mt-3 w-full" onClick={add} disabled={busy}>
          Log it
        </Button>
      </Card>

      {days.length > 0 ? (
        <div className="mt-4">
          <PresenceBar days={days} label={(n) => `You moved ${n} of the last 7 days`} />
        </div>
      ) : null}

      {weekMinutes > 0 ? (
        <p className="mt-2 px-1 text-center text-xs text-(--color-fog)">
          {weekMinutes} minutes this week
        </p>
      ) : null}

      <SectionTitle>Recent</SectionTitle>
      {days.some((d) => d.count > 0) ? (
        <div className="space-y-2">
          {[...days]
            .reverse()
            .filter((d) => d.count > 0)
            .map((bucket) => (
              <Card key={bucket.day}>
                <div className="mb-1 text-xs font-medium uppercase tracking-wider text-(--color-fog)">
                  {dayLabel(bucket.day, timezone)}
                </div>
                {bucket.sessions.map((session) => (
                  <div key={session.id} className="flex items-center justify-between gap-2 py-1.5">
                    <div className="min-w-0">
                      <span className="font-medium capitalize">{session.kind}</span>
                      {session.minutes ? (
                        <span className="text-sm text-(--color-fog)"> · {session.minutes} min</span>
                      ) : null}
                      <div className="text-xs text-(--color-fog)">
                        {clockTime(session.at, timezone)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {session.intensity ? <Pill tone="sea">{session.intensity}</Pill> : null}
                      <button
                        onClick={() => remove(session.id)}
                        className="text-xs text-(--color-fog)"
                      >
                        remove
                      </button>
                    </div>
                  </div>
                ))}
              </Card>
            ))}
        </div>
      ) : (
        <EmptyState
          icon="🏃"
          title={loaded ? "Nothing logged yet" : "…"}
          hint="A ten-minute walk counts. Showing up is the whole metric."
        />
      )}
    </main>
  );
}
