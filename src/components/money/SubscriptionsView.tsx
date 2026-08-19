"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, Pill, SectionTitle } from "@/components/ui";
import { formatMoney, formatRelativeDay } from "@/lib/format";
import {
  apiFetch,
  cadenceLabel,
  magnitude,
  monthlyEquivalent,
  type RecurringResponse,
  type RecurringRow,
  type RecurringStatus,
} from "@/components/money/api";
import { ErrorNote, Loading } from "@/components/money/Shared";

export function SubscriptionsView() {
  const [data, setData] = useState<RecurringResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [wonBack, setWonBack] = useState<RecurringRow[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiFetch<RecurringResponse>("/api/finance/recurring"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t load your subscriptions just now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(row: RecurringRow, status: RecurringStatus) {
    if (pending) return;
    setPending(row.id);
    setActionError(null);
    try {
      await apiFetch(`/api/finance/recurring/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setData((prev) => {
        if (!prev) return prev;
        const graveyard = prev.graveyard.filter((r) => r.id !== row.id);
        const active =
          status === "active" ? [{ ...row, status }, ...prev.active] : prev.active;
        const graveyardMonthlyPence = Math.max(
          0,
          prev.graveyardMonthlyPence - monthlyEquivalent(row.amountPence, row.cadence),
        );
        const monthlyTotalPence =
          status === "active"
            ? prev.monthlyTotalPence + monthlyEquivalent(row.amountPence, row.cadence)
            : prev.monthlyTotalPence;
        return { active, graveyard, monthlyTotalPence, graveyardMonthlyPence };
      });
      if (status === "cancelled") setWonBack((prev) => [{ ...row, status }, ...prev]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That didn’t stick — try once more.");
    } finally {
      setPending(null);
    }
  }

  if (loading && !data) return <Loading lines={3} />;
  if (error && !data) return <ErrorNote message={error} onRetry={() => void load()} />;
  if (!data) return null;

  const monthlyTotal = magnitude(data.monthlyTotalPence);
  const graveyardMonthly = magnitude(data.graveyardMonthlyPence);
  const wonBackMonthly = wonBack.reduce(
    (sum, row) => sum + monthlyEquivalent(row.amountPence, row.cadence),
    0,
  );

  return (
    <>
      <Card>
        <div className="text-center">
          <div className="text-xs font-medium uppercase tracking-widest text-(--color-fog)">
            Every month
          </div>
          <div className="mt-1 text-5xl font-bold tabular-nums tracking-tight text-(--color-bright)">
            {formatMoney(monthlyTotal)}
          </div>
          <div className="mt-1 text-sm text-(--color-fog)">
            goes to {data.active.length} subscription{data.active.length === 1 ? "" : "s"}
          </div>
        </div>
      </Card>

      {graveyardMonthly > 0 || data.graveyard.length > 0 ? (
        <Card accent className="mt-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-2xl font-bold tabular-nums text-(--color-beacon)">
              {formatMoney(graveyardMonthly)}
              <span className="text-base font-medium">/month</span>
            </div>
            <div className="mt-0.5 text-sm text-(--color-mist)">you could win back</div>
            <div className="text-xs text-(--color-fog)">
              {data.graveyard.length} look{data.graveyard.length === 1 ? "s" : ""} forgotten — no
              judgement, just money on the table.
            </div>
          </div>
          <span className="shrink-0 text-3xl" aria-hidden>
            🏆
          </span>
        </Card>
      ) : null}

      {wonBackMonthly > 0 ? (
        <div className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-(--color-beacon-soft) px-3 py-2">
          <span aria-hidden>🎉</span>
          <span className="text-sm font-medium text-(--color-beacon)">
            Won back {formatMoney(wonBackMonthly)}/month
          </span>
        </div>
      ) : null}

      {actionError ? (
        <p className="mt-3 text-center text-sm text-(--color-amber-warn)">{actionError}</p>
      ) : null}

      {data.graveyard.length > 0 ? (
        <>
          <SectionTitle>Winnable</SectionTitle>
          <div className="space-y-2">
            {data.graveyard.map((row) => (
              <Card key={row.id}>
                <RowHeader row={row} />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    onClick={() => void setStatus(row, "cancelled")}
                    disabled={pending !== null}
                    className="flex-1"
                  >
                    {pending === row.id ? "…" : "Cancelled it 🎉"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void setStatus(row, "active")}
                    disabled={pending !== null}
                    className="flex-1"
                  >
                    Still want it
                  </Button>
                </div>
                <button
                  onClick={() => void setStatus(row, "dismissed")}
                  disabled={pending !== null}
                  className="mt-2 w-full text-center text-xs text-(--color-fog) disabled:opacity-40"
                >
                  Leave me alone about this one
                </button>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {wonBack.length > 0 ? (
        <>
          <SectionTitle>Won back</SectionTitle>
          <Card className="divide-y divide-(--color-card-edge)">
            {wonBack.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
              >
                <span className="truncate pr-3 text-sm text-(--color-mist)">{row.name}</span>
                <span className="shrink-0 text-sm font-medium tabular-nums text-(--color-beacon)">
                  +{formatMoney(monthlyEquivalent(row.amountPence, row.cadence))}/mo
                </span>
              </div>
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>Active</SectionTitle>
      {data.active.length > 0 ? (
        <div className="space-y-2">
          {data.active.map((row) => (
            <Card key={row.id}>
              <RowHeader row={row} />
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="🔁"
          title="Nothing recurring spotted yet"
          hint="Repeat payments surface here on their own once a pattern shows up."
        />
      )}
    </>
  );
}

function RowHeader({ row }: { row: RecurringRow }) {
  const next = row.nextExpectedAt ? new Date(row.nextExpectedAt) : null;
  const last = row.lastSeenAt ? new Date(row.lastSeenAt) : null;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-(--color-mist)">{row.name}</span>
          {row.kind !== "subscription" ? <Pill tone="neutral">{row.kind}</Pill> : null}
        </div>
        <div className="mt-0.5 text-xs text-(--color-fog)">
          {next
            ? `next ${formatRelativeDay(next)}`
            : last
              ? `last seen ${formatRelativeDay(last)}`
              : "timing unclear"}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-lg font-semibold tabular-nums text-(--color-bright)">
          {formatMoney(magnitude(row.amountPence))}
        </div>
        <div className="text-xs text-(--color-fog)">{cadenceLabel(row.cadence) || "irregular"}</div>
      </div>
    </div>
  );
}
