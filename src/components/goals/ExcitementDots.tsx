"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Tap-to-set excitement, 1-5. Excitement decays over time; touching it here
 * is a fresh honest reading, so the API restarts the decay clock. */
export function ExcitementDots({
  goalId,
  value,
  size = "sm",
}: {
  goalId: string;
  value: number;
  size?: "sm" | "lg";
}) {
  const router = useRouter();
  const [level, setLevel] = useState(value);
  const [saving, setSaving] = useState(false);

  async function set(next: number) {
    const previous = level;
    setLevel(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/goals/${goalId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ excitement: next }),
      });
      if (!res.ok) throw new Error("patch failed");
      router.refresh();
    } catch {
      setLevel(previous);
    } finally {
      setSaving(false);
    }
  }

  const dot = size === "lg" ? "h-3.5 w-3.5" : "h-2.5 w-2.5";
  const pad = size === "lg" ? "p-1.5" : "p-1";

  return (
    <div className="flex items-center" role="group" aria-label="Excitement">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={saving}
          aria-label={`Excitement ${n} of 5`}
          aria-pressed={n === level}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void set(n);
          }}
          className={pad}
        >
          <span
            className={`block rounded-full transition-all ${dot} ${
              n <= level ? "bg-(--color-beacon)" : "bg-(--color-card-edge)"
            }`}
          />
        </button>
      ))}
    </div>
  );
}
