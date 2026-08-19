"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { formatMoney } from "@/lib/format";

// The human half of the money guardrail. Claude can only ever propose; nothing
// moves until this card is tapped. Failures are amber and factual, never red.

export function ConfirmationCard({
  proposalId,
  potName,
  amountPence,
  reason,
}: {
  proposalId: string;
  potName: string;
  amountPence: number;
  reason: string | null;
}) {
  const [state, setState] = useState<"pending" | "working" | "confirmed" | "declined">("pending");
  const [error, setError] = useState<string | null>(null);

  const amount = formatMoney(amountPence, { showPence: amountPence % 100 !== 0 });

  async function decide(decision: "confirm" | "decline") {
    setState("working");
    setError(null);
    try {
      const res = await fetch("/api/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposalId, decision }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "that didn't go through";
        throw new Error(message);
      }
      setState(decision === "confirm" ? "confirmed" : "declined");
    } catch (err) {
      setError(err instanceof Error ? err.message : "that didn't go through");
      setState("pending");
    }
  }

  if (state === "confirmed") {
    return (
      <p className="text-sm text-(--color-sea)">
        ✓ Moved {amount} to {potName}
      </p>
    );
  }

  if (state === "declined") {
    return <p className="text-sm text-(--color-fog)">Left where it was. Nothing moved.</p>;
  }

  return (
    <Card accent>
      <div className="text-base font-semibold text-(--color-bright)">
        Move {amount} to {potName}?
      </div>
      {reason ? <p className="mt-1 text-sm text-(--color-fog)">{reason}</p> : null}
      {error ? <p className="mt-2 text-sm text-(--color-amber-warn)">Didn&apos;t go through: {error}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button onClick={() => decide("confirm")} disabled={state === "working"}>
          {state === "working" ? "Moving…" : "Confirm"}
        </Button>
        <Button variant="secondary" onClick={() => decide("decline")} disabled={state === "working"}>
          Not now
        </Button>
      </div>
    </Card>
  );
}
