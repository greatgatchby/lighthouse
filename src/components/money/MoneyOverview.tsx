"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BigNumber, Card, Pill, SectionTitle } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { apiFetch, magnitude, type FinanceSummary } from "@/components/money/api";
import { ConnectMonzoCard, ErrorNote, Loading, ProgressBar } from "@/components/money/Shared";

export function MoneyOverview({ justConnected }: { justConnected: boolean }) {
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await apiFetch<FinanceSummary>("/api/finance/summary"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t load your money just now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      {justConnected ? (
        <Card accent className="mb-4 flex items-start gap-3">
          <span className="text-xl" aria-hidden>
            ⏳
          </span>
          <div>
            <div className="font-medium text-(--color-bright)">Importing your history</div>
            <p className="mt-0.5 text-sm text-(--color-fog)">
              This takes a minute. Nothing to do — it fills in behind you.
            </p>
          </div>
        </Card>
      ) : null}

      {loading && !summary ? <Loading lines={2} /> : null}
      {error && !summary ? <ErrorNote message={error} onRetry={() => void load()} /> : null}

      {summary ? <Overview summary={summary} /> : null}
    </>
  );
}

function Overview({ summary }: { summary: FinanceSummary }) {
  const { safeToSpend: sts, accounts, pots, month } = summary;
  const hasAccounts = accounts.length > 0;
  const maxSpend = month.spentByCategory.reduce(
    (max, c) => Math.max(max, magnitude(c.spentPence)),
    1,
  );

  return (
    <>
      <Card>
        {sts.hasData ? (
          <BigNumber
            label="Safe to spend today"
            sub={
              <>
                {sts.daysToPayday} day{sts.daysToPayday === 1 ? "" : "s"} to payday ·{" "}
                {formatMoney(sts.committed)} committed
              </>
            }
          >
            {formatMoney(sts.perDay)}
          </BigNumber>
        ) : (
          <p className="py-2 text-center text-sm text-(--color-fog)">
            Once an account is connected, this becomes one calm number.
          </p>
        )}
      </Card>

      {!hasAccounts ? (
        <div className="mt-4">
          <ConnectMonzoCard />
        </div>
      ) : null}

      {hasAccounts ? (
        <>
          <SectionTitle
            action={
              <Link href="/money/payday" className="text-xs text-(--color-beacon)">
                Payday ritual →
              </Link>
            }
          >
            Accounts
          </SectionTitle>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {accounts.map((account) => (
              <Card key={account.id} className="min-w-40 shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm text-(--color-fog)">{account.name}</span>
                  {account.isPrimary ? <Pill tone="sea">main</Pill> : null}
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-(--color-bright)">
                  {formatMoney(account.balance)}
                </div>
                <div className="mt-0.5 text-xs text-(--color-fog)">{account.provider}</div>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {pots.length > 0 ? (
        <>
          <SectionTitle>Pots</SectionTitle>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {pots.map((pot) => {
              const goal = pot.goalAmount ?? 0;
              return (
                <Card key={pot.id} className="min-w-40 shrink-0">
                  <div className="truncate text-sm text-(--color-fog)">{pot.name}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-(--color-bright)">
                    {formatMoney(pot.balance)}
                  </div>
                  {goal > 0 ? (
                    <>
                      <ProgressBar value={pot.balance / goal} tone="beacon" className="mt-2" />
                      <div className="mt-1 text-xs text-(--color-fog)">
                        {Math.min(100, Math.round((pot.balance / goal) * 100))}% of{" "}
                        {formatMoney(goal)}
                      </div>
                    </>
                  ) : (
                    <div className="mt-2 text-xs text-(--color-fog)">no goal set</div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      ) : null}

      <SectionTitle
        action={
          <span className="text-xs text-(--color-fog)">
            {formatMoney(magnitude(month.totalSpentPence))} out ·{" "}
            {formatMoney(magnitude(month.totalInPence))} in
          </span>
        }
      >
        This month
      </SectionTitle>
      {month.spentByCategory.length > 0 ? (
        <Card className="divide-y divide-(--color-card-edge)">
          {month.spentByCategory.map((cat) => {
            const spent = magnitude(cat.spentPence);
            const budget = cat.budgetPence ?? null;
            const over = budget !== null && spent > budget ? spent - budget : 0;
            const ratio = budget && budget > 0 ? spent / budget : spent / maxSpend;
            return (
              <div key={cat.slug} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-(--color-mist)">
                      {cat.name}
                    </span>
                    {cat.impulse ? (
                      <span
                        aria-hidden
                        title="I check in gently on big spends here"
                        className="text-xs text-(--color-beacon)"
                      >
                        ✦
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-(--color-fog)">
                    {formatMoney(spent)}
                    {budget !== null ? ` of ${formatMoney(budget)}` : ""}
                  </span>
                </div>
                <ProgressBar
                  value={ratio}
                  tone={over > 0 ? "amber" : budget !== null ? "sea" : "beacon"}
                  className="mt-2"
                />
                {over > 0 ? (
                  <Link
                    href={`/money/transactions?category=${encodeURIComponent(cat.slug)}`}
                    className="mt-1.5 inline-block text-xs font-medium text-(--color-amber-warn)"
                  >
                    {formatMoney(over)} over — want to re-plan?
                  </Link>
                ) : null}
              </div>
            );
          })}
        </Card>
      ) : (
        <Card>
          <p className="py-2 text-center text-sm text-(--color-fog)">
            Nothing spent yet this month. A clean page.
          </p>
        </Card>
      )}

      <SectionTitle>Go deeper</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <QuickLink href="/money/transactions" icon="🧾" label="Transactions" hint="search & tidy" />
        <QuickLink href="/money/subscriptions" icon="🔁" label="Subscriptions" hint="win money back" />
        <QuickLink href="/money/payday" icon="🌅" label="Payday ritual" hint="three taps" />
        <QuickLink href="/settings" icon="⚙️" label="Connections" hint="Monzo & CSV" />
      </div>
    </>
  );
}

function QuickLink({
  href,
  icon,
  label,
  hint,
}: {
  href: string;
  icon: string;
  label: string;
  hint: string;
}) {
  return (
    <Link href={href} className="block">
      <Card className="h-full">
        <div className="text-xl" aria-hidden>
          {icon}
        </div>
        <div className="mt-1 text-sm font-medium text-(--color-mist)">{label}</div>
        <div className="text-xs text-(--color-fog)">{hint}</div>
      </Card>
    </Link>
  );
}
