import type { ReactNode } from "react";

// Shared UI primitives. Design language: calm cards on a deep-navy harbour
// night, warm amber beacon accent, generous radii, large type for the numbers
// that matter. Nothing in this app is ever a red failure state.

export function Card({
  children,
  className = "",
  accent = false,
}: {
  children: ReactNode;
  className?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-(--radius-card) border bg-(--color-card) p-4 ${
        accent ? "border-(--color-beacon)/40" : "border-(--color-card-edge)"
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-baseline justify-between px-1 first:mt-0">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-(--color-fog)">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function BigNumber({ children, label, sub }: { children: ReactNode; label?: string; sub?: ReactNode }) {
  return (
    <div className="text-center">
      {label ? (
        <div className="text-xs font-medium uppercase tracking-widest text-(--color-fog)">{label}</div>
      ) : null}
      <div className="mt-1 text-5xl font-bold tabular-nums tracking-tight text-(--color-bright)">
        {children}
      </div>
      {sub ? <div className="mt-1 text-sm text-(--color-fog)">{sub}</div> : null}
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "beacon" | "sea" | "amber";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-(--color-ink-soft) text-(--color-mist)",
    beacon: "bg-(--color-beacon-soft) text-(--color-beacon)",
    sea: "bg-(--color-sea-soft) text-(--color-sea)",
    amber: "bg-(--color-beacon-soft) text-(--color-amber-warn)",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: string }) {
  return (
    <Card className="py-10 text-center">
      {icon ? <div className="mb-2 text-3xl">{icon}</div> : null}
      <div className="font-medium text-(--color-mist)">{title}</div>
      {hint ? <div className="mt-1 text-sm text-(--color-fog)">{hint}</div> : null}
    </Card>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  const variants: Record<string, string> = {
    primary:
      "bg-(--color-beacon) text-(--color-ink) font-semibold active:brightness-90 disabled:opacity-40",
    secondary:
      "bg-(--color-ink-soft) text-(--color-mist) border border-(--color-card-edge) active:bg-(--color-card) disabled:opacity-40",
    ghost: "text-(--color-fog) active:text-(--color-mist) disabled:opacity-40",
  };
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm transition-all ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
