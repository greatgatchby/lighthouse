"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Pill } from "@/components/ui";
import { ExcitementDots } from "@/components/goals/ExcitementDots";
import { ENERGY_LABEL, ENERGY_TONE, type GoalCardData } from "@/components/goals/types";

/** One ranked goal. The start button is the biggest thing on the card on
 * purpose: the session is the point, the goal is just the excuse. */
export function GoalCard({ goal }: { goal: GoalCardData }) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    try {
      await fetch(`/api/goals/${goal.id}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
    } catch {
      // the timer page picks up whatever actually landed
    }
    router.push(`/goals/${goal.id}`);
  }

  return (
    <Card>
      <Link href={`/goals/${goal.id}`} className="block">
        <div className="font-medium text-(--color-bright)">{goal.title}</div>
        {goal.nextAction ? (
          <div className="mt-1 text-sm leading-relaxed text-(--color-mist)">
            → {goal.nextAction}
          </div>
        ) : (
          <div className="mt-1 text-sm text-(--color-fog)">
            No next step yet — open it and make one smaller.
          </div>
        )}
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ExcitementDots goalId={goal.id} value={goal.excitement} />
        <Pill tone={ENERGY_TONE[goal.energyRequired]}>{ENERGY_LABEL[goal.energyRequired]}</Pill>
        {goal.estimatedMinutes ? <Pill>{goal.estimatedMinutes} min</Pill> : null}
      </div>

      <Button className="mt-3 w-full" onClick={start} disabled={starting}>
        {starting ? "Starting…" : "▶ Start 25 min"}
      </Button>
    </Card>
  );
}
