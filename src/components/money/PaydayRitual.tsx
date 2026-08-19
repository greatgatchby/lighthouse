"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, EmptyState } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import {
  apiFetch,
  type FinanceSummary,
  type PotDepositResponse,
  type PotRow,
} from "@/components/money/api";
import { ConnectMonzoCard, ErrorNote, Loading, ProgressBar } from "@/components/money/Shared";

const CHIPS = [2500, 5000, 10000];

export function PaydayRitual() {
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [pendingAmount, setPendingAmount] = useState<number | null>(null);
  const [ticks, setTicks] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [customFor, setCustomFor] = useState<string | null>(null);
  const [customValue, setCustomValue] = useState("");

  const timers = useRef<number[]>([]);
  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((t) => clearTimeout(t));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await apiFetch<FinanceSummary>("/api/finance/summary"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t load your pots just now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function deposit(pot: PotRow, amountPence: number) {
    if (pending || amountPence <= 0) return;
    setPending(pot.id);
    setPendingAmount(amountPence);
    setProblems((prev) => ({ ...prev, [pot.id]: "" }));
    try {
      const result = await apiFetch<PotDepositResponse>("/api/finance/pots/deposit", {
        method: "POST",
        body: JSON.stringify({ potId: pot.id, amountPence }),
      });
      setSummary((prev) => {
        if (!prev) return prev;
        const primaryId = prev.accounts.find((a) => a.isPrimary)?.id ?? prev.accounts[0]?.id;
        return {
          ...prev,
          accounts: prev.accounts.map((a) =>
            a.id === primaryId
              ? { ...a, balance: result.accountBalance ?? a.balance - amountPence }
              : a,
          ),
          pots: prev.pots.map((p) =>
            p.id === pot.id
              ? { ...p, balance: result.potBalance ?? p.balance + amountPence }
              : p,
          ),
          safeToSpend: {
            ...prev.safeToSpend,
            balance: result.accountBalance ?? prev.safeToSpend.balance - amountPence,
          },
        };
      });
      setTicks((prev) => ({
        ...prev,
        [pot.id]: `${formatMoney(amountPence)} tucked into ${pot.name} ✓`,
      }));
      const timer = window.setTimeout(() => {
        setTicks((prev) => {
          const next = { ...prev };
          delete next[pot.id];
          return next;
        });
      }, 3500);
      timers.current.push(timer);
      setCustomFor(null);
      setCustomValue("");
    } catch (err) {
      setProblems((prev) => ({
        ...prev,
        [pot.id]:
          err instanceof Error ? err.message : "Monzo didn’t take that one — try again shortly.",
      }));
    } finally {
      setPending(null);
      setPendingAmount(null);
    }
  }

  if (loading && !summary) return <Loading lines={3} />;
  if (error && !summary) return <ErrorNote message={error} onRetry={() => void load()} />;
  if (!summary) return null;

  const sts = summary.safeToSpend;
  const primary = summary.accounts.find((a) => a.isPrimary) ?? summary.accounts[0];

  if (summary.accounts.length === 0) return <ConnectMonzoCard />;

  return (
    <>
      <Card>
        <div className="text-center">
          <div className="text-xs font-medium uppercase tracking-widest text-(--color-fog)">
            {primary ? primary.name : "Balance"}
          </div>
          <div className="mt-1 text-5xl font-bold tabular-nums tracking-tight text-(--color-bright)">
            {formatMoney(primary?.balance ?? sts.balance)}
          </div>
          <div className="mt-1 text-sm text-(--color-fog)">
            {formatMoney(sts.perDay)} a day · {sts.daysToPayday} day
            {sts.daysToPayday === 1 ? "" : "s"} to payday
          </div>
        </div>
      </Card>

      {summary.pots.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon="🫙"
            title="No pots yet"
            hint="Make a pot in Monzo and it shows up here, ready for a tap."
          />
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {summary.pots.map((pot) => {
            const goal = pot.goalAmount ?? 0;
            const busy = pending === pot.id;
            return (
              <Card key={pot.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium text-(--color-mist)">{pot.name}</span>
                  <span className="shrink-0 text-lg font-semibold tabular-nums text-(--color-bright)">
                    {formatMoney(pot.balance)}
                  </span>
                </div>

                {goal > 0 ? (
                  <>
                    <ProgressBar value={pot.balance / goal} tone="beacon" className="mt-2" />
                    <div className="mt-1 text-xs text-(--color-fog)">
                      {formatMoney(Math.max(0, goal - pot.balance))} to go
                    </div>
                  </>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  {CHIPS.map((amount) => (
                    <button
                      key={amount}
                      onClick={() => void deposit(pot, amount)}
                      disabled={pending !== null}
                      className="min-h-11 flex-1 rounded-xl bg-(--color-ink-soft) px-3 py-2 text-sm font-semibold text-(--color-mist) transition-colors active:bg-(--color-beacon-soft) active:text-(--color-beacon) disabled:opacity-40"
                    >
                      {busy ? "…" : formatMoney(amount)}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setCustomFor(customFor === pot.id ? null : pot.id);
                      setCustomValue("");
                    }}
                    disabled={pending !== null}
                    className={`min-h-11 flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-40 ${
                      customFor === pot.id
                        ? "bg-(--color-beacon-soft) text-(--color-beacon)"
                        : "bg-(--color-ink-soft) text-(--color-mist)"
                    }`}
                  >
                    Custom
                  </button>
                </div>

                {customFor === pot.id ? (
                  <form
                    className="mt-2 flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const pounds = Number.parseFloat(customValue);
                      if (!Number.isFinite(pounds) || pounds <= 0) return;
                      void deposit(pot, Math.round(pounds * 100));
                    }}
                  >
                    <input
                      autoFocus
                      type="number"
                      inputMode="decimal"
                      min="1"
                      step="1"
                      value={customValue}
                      onChange={(e) => setCustomValue(e.target.value)}
                      placeholder="£ amount"
                      className="min-h-11 w-full rounded-xl border border-(--color-card-edge) bg-(--color-ink-soft) px-3 py-2 text-sm text-(--color-bright) placeholder:text-(--color-fog)"
                    />
                    <Button type="submit" disabled={pending !== null} className="shrink-0">
                      Tuck it in
                    </Button>
                  </form>
                ) : null}

                {ticks[pot.id] ? (
                  <div className="mt-2 text-sm font-medium text-(--color-beacon)">
                    {ticks[pot.id]}
                  </div>
                ) : null}
                {problems[pot.id] ? (
                  <div className="mt-2 text-sm text-(--color-amber-warn)">{problems[pot.id]}</div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      <Link href="/money" className="mt-4 block text-center text-sm text-(--color-fog)">
        Done for now →
      </Link>
    </>
  );
}
