"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const LEVELS = [
  { value: "low", label: "Low", icon: "🌫️" },
  { value: "medium", label: "Okay", icon: "⛅" },
  { value: "high", label: "Bright", icon: "☀️" },
] as const;

export function EnergyCheckIn({ current }: { current: "low" | "medium" | "high" }) {
  const router = useRouter();
  const [energy, setEnergy] = useState(current);
  const [saving, setSaving] = useState(false);

  async function pick(value: "low" | "medium" | "high") {
    setEnergy(value);
    setSaving(true);
    await fetch("/api/energy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ energy: value }),
    }).catch(() => {});
    setSaving(false);
    router.refresh(); // reorders the whole dashboard
  }

  return (
    <div className="flex items-center justify-between rounded-(--radius-card) border border-(--color-card-edge) bg-(--color-ink-soft) px-4 py-3">
      <span className="text-sm text-(--color-fog)">Energy right now</span>
      <div className="flex gap-1">
        {LEVELS.map((level) => (
          <button
            key={level.value}
            onClick={() => pick(level.value)}
            disabled={saving}
            className={`rounded-xl px-3 py-1.5 text-sm transition-all ${
              energy === level.value
                ? "bg-(--color-beacon-soft) text-(--color-beacon)"
                : "text-(--color-fog)"
            }`}
          >
            <span aria-hidden>{level.icon}</span> {level.label}
          </button>
        ))}
      </div>
    </div>
  );
}
