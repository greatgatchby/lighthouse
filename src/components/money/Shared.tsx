"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui";

/** Quiet skeleton — a shape where the number will be, never a spinner. */
export function Loading({ lines = 3 }: { lines?: number }) {
  return (
    <Card className="animate-pulse">
      <div className="h-8 w-32 rounded-lg bg-(--color-ink-soft)" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="mt-3 h-3 w-full rounded bg-(--color-ink-soft)" />
      ))}
    </Card>
  );
}

/** Never a red failure state — a calm note and a way forward. */
export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="text-center">
      <p className="text-sm text-(--color-mist)">{message}</p>
      {onRetry ? (
        <button onClick={onRetry} className="mt-2 text-sm font-medium text-(--color-beacon)">
          Try again
        </button>
      ) : null}
    </Card>
  );
}

export function BackLink({ href = "/money", children }: { href?: string; children?: ReactNode }) {
  return (
    <Link href={href} className="text-sm text-(--color-fog)">
      ← {children ?? "Money"}
    </Link>
  );
}

/** Thin progress beacon. `tone` picks the fill; the track is always quiet. */
export function ProgressBar({
  value,
  tone = "sea",
  className = "",
}: {
  value: number; // 0..1
  tone?: "beacon" | "sea" | "amber";
  className?: string;
}) {
  const fills: Record<string, string> = {
    beacon: "bg-(--color-beacon)",
    sea: "bg-(--color-sea)",
    amber: "bg-(--color-amber-warn)",
  };
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full bg-(--color-ink-soft) ${className}`}
      role="presentation"
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${fills[tone]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function ConnectMonzoCard({
  title = "Connect Monzo",
  hint = "One tap, then your full history imports in the background. This page becomes one calm number.",
}: {
  title?: string;
  hint?: string;
}) {
  return (
    <Card accent className="text-center">
      <div className="text-2xl" aria-hidden>
        🪙
      </div>
      <div className="mt-1 font-semibold text-(--color-bright)">{title}</div>
      <p className="mx-auto mt-1 max-w-xs text-sm text-(--color-fog)">{hint}</p>
      <Link
        href="/api/oauth/monzo/start"
        prefetch={false}
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-(--color-beacon) px-5 py-2 text-sm font-semibold text-(--color-ink)"
      >
        Connect Monzo
      </Link>
    </Card>
  );
}
