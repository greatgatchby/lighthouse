"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Pill } from "@/components/ui";
import { ENERGY_LABEL, ENERGY_TONE, type Energy, type SparkData } from "@/components/goals/types";

interface ShapedGoal {
  id: string;
  title: string;
  nextAction: string | null;
  estimatedMinutes: number | null;
  energyRequired: Energy;
}

/** Capture first, shape later. The input never asks a second question — a
 * spark is allowed to be three vague words at 1am. */
export function SparkInbox({
  sparks: initial,
  defaultOpen = false,
}: {
  sparks: SparkData[];
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [sparks, setSparks] = useState<SparkData[]>(initial);
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [shaped, setShaped] = useState<ShapedGoal[]>([]);
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  async function capture(event: React.FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;

    const tempId = `pending-${Date.now()}`;
    setText("");
    setOpen(true);
    setSparks((current) => [{ id: tempId, text: value }, ...current]);
    setPendingIds((current) => [...current, tempId]);

    try {
      const res = await fetch("/api/goals/sparks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: value }),
      });
      if (!res.ok) throw new Error("capture failed");
      const saved: SparkData = await res.json();
      setSparks((current) => current.map((s) => (s.id === tempId ? saved : s)));
      router.refresh();
    } catch {
      setSparks((current) => current.filter((s) => s.id !== tempId));
      setText(value);
    } finally {
      setPendingIds((current) => current.filter((id) => id !== tempId));
    }
  }

  async function convert(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/goals/sparks/${id}/convert`, { method: "POST" });
      if (!res.ok) throw new Error("convert failed");
      const goal: ShapedGoal = await res.json();
      setSparks((current) => current.filter((s) => s.id !== id));
      setShaped((current) => [goal, ...current]);
      router.refresh();
    } catch {
      // leave the spark where it is — nothing is lost
    } finally {
      setBusyId(null);
    }
  }

  async function letGo(id: string) {
    setBusyId(id);
    const previous = sparks;
    setSparks((current) => current.filter((s) => s.id !== id));
    try {
      const res = await fetch(`/api/goals/sparks/${id}/dismiss`, { method: "POST" });
      if (!res.ok) throw new Error("dismiss failed");
      router.refresh();
    } catch {
      setSparks(previous);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <Card>
        <form onSubmit={capture} className="flex items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What's sparking?"
            aria-label="Capture a spark"
            enterKeyHint="done"
            className="min-h-11 w-full bg-transparent text-base text-(--color-bright) placeholder:text-(--color-fog) focus:outline-none"
          />
          <Button type="submit" disabled={!text.trim()} className="shrink-0 px-4">
            Catch it
          </Button>
        </form>
      </Card>

      {shaped.length > 0 ? (
        <div className="mt-2 space-y-2">
          {shaped.map((goal) => (
            <Card key={goal.id} accent>
              <div className="text-xs uppercase tracking-wider text-(--color-beacon)">
                Now a goal
              </div>
              <div className="mt-1 font-medium text-(--color-bright)">{goal.title}</div>
              {goal.nextAction ? (
                <div className="mt-1 text-sm leading-relaxed text-(--color-mist)">
                  → {goal.nextAction}
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Pill tone={ENERGY_TONE[goal.energyRequired]}>
                  {ENERGY_LABEL[goal.energyRequired]}
                </Pill>
                {goal.estimatedMinutes ? <Pill>{goal.estimatedMinutes} min</Pill> : null}
              </div>
              <div className="mt-3 flex gap-2">
                <Link href={`/goals/${goal.id}`} className="flex-1">
                  <Button className="w-full">Open it</Button>
                </Link>
                <Button
                  variant="ghost"
                  onClick={() => setShaped((c) => c.filter((g) => g.id !== goal.id))}
                >
                  Later
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {sparks.length > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-2 flex w-full items-center justify-between rounded-(--radius-card) px-1 py-2 text-sm text-(--color-fog)"
            aria-expanded={open}
          >
            <span className="flex items-center gap-2">
              Sparks waiting
              <Pill tone="beacon">{sparks.length}</Pill>
            </span>
            <span aria-hidden>{open ? "▾" : "▸"}</span>
          </button>

          {open ? (
            <div className="space-y-2">
              {sparks.map((spark) => {
                const pending = pendingIds.includes(spark.id);
                const busy = busyId === spark.id;
                return (
                  <Card key={spark.id} className={pending ? "opacity-60" : ""}>
                    <p className="text-base leading-relaxed text-(--color-mist)">{spark.text}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        onClick={() => convert(spark.id)}
                        disabled={pending || busy}
                        className="flex-1"
                      >
                        {busy ? "Shaping…" : "✨ Make it a goal"}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => letGo(spark.id)}
                        disabled={pending || busy}
                      >
                        Let it go
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
