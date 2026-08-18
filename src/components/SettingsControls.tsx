"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NotificationToggles } from "@/db/schema/core";
import { Button, Card } from "@/components/ui";

const CATEGORY_LABELS: Record<keyof NotificationToggles, string> = {
  digest: "Morning digest",
  money: "Money",
  impulse: "Impulse check-ins",
  payday: "Payday ritual",
  goals: "Goals & nudges",
  documents: "Documents & expiries",
  system: "System",
};

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h % 24) * 60 + (m || 0);
}

export function SettingsControls({
  quietHoursStart,
  quietHoursEnd,
  toggles,
}: {
  quietHoursStart: number;
  quietHoursEnd: number;
  toggles: NotificationToggles;
}) {
  const [state, setState] = useState({ quietHoursStart, quietHoursEnd, toggles });

  async function save(patch: Partial<typeof state>) {
    const next = { ...state, ...patch };
    setState(next);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quietHoursStart: next.quietHoursStart,
        quietHoursEnd: next.quietHoursEnd,
        notificationToggles: next.toggles,
      }),
    }).catch(() => {});
  }

  return (
    <>
      <Card>
        <h3 className="mb-2 font-semibold">Quiet hours</h3>
        <p className="mb-3 text-xs text-(--color-fog)">
          Nothing buzzes between these times — it waits politely instead.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="time"
            value={minutesToTime(state.quietHoursStart)}
            onChange={(e) => save({ quietHoursStart: timeToMinutes(e.target.value) })}
            className="rounded-lg border border-(--color-card-edge) bg-(--color-ink-soft) px-3 py-2 text-sm"
          />
          <span className="text-(--color-fog)">until</span>
          <input
            type="time"
            value={minutesToTime(state.quietHoursEnd)}
            onChange={(e) => save({ quietHoursEnd: timeToMinutes(e.target.value) })}
            className="rounded-lg border border-(--color-card-edge) bg-(--color-ink-soft) px-3 py-2 text-sm"
          />
        </div>
      </Card>

      <Card className="mt-4">
        <h3 className="mb-2 font-semibold">Notification categories</h3>
        <div className="divide-y divide-(--color-card-edge)">
          {(Object.keys(CATEGORY_LABELS) as (keyof NotificationToggles)[]).map((key) => (
            <label key={key} className="flex items-center justify-between py-2">
              <span className="text-sm text-(--color-mist)">{CATEGORY_LABELS[key]}</span>
              <input
                type="checkbox"
                checked={state.toggles[key] !== false}
                onChange={(e) =>
                  save({ toggles: { ...state.toggles, [key]: e.target.checked } })
                }
                className="h-5 w-5 accent-(--color-beacon)"
              />
            </label>
          ))}
        </div>
      </Card>
    </>
  );
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      className="w-full"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
