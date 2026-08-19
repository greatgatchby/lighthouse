"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Pill } from "@/components/ui";
import { formatMoney } from "@/lib/format";

interface SyncableAccount {
  provider: string;
  providerAccountId: string;
  name: string;
  balancePence: number | null;
  syncEnabled: boolean;
  localId: string | null;
  transactionCount: number;
  missingUpstream: boolean;
}

export function LunchflowAccounts() {
  const [accounts, setAccounts] = useState<SyncableAccount[]>([]);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [purging, setPurging] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/accounts");
      const data = await res.json();
      setAccounts(data.accounts ?? []);
      setConfigured(Boolean(data.configured));
      setError(data.error ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(account: SyncableAccount, syncEnabled: boolean) {
    setPending(account.providerAccountId);
    // optimistic — the toggle should feel instant
    setAccounts((prev) =>
      prev.map((a) =>
        a.providerAccountId === account.providerAccountId ? { ...a, syncEnabled } : a,
      ),
    );
    try {
      await fetch("/api/settings/accounts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerAccountId: account.providerAccountId,
          syncEnabled,
          name: account.name,
        }),
      });
    } finally {
      setPending(null);
      void load();
    }
  }

  async function purge(account: SyncableAccount) {
    setPurging(account.providerAccountId);
    try {
      await fetch("/api/settings/accounts", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerAccountId: account.providerAccountId }),
      });
    } finally {
      setPurging(null);
      void load();
    }
  }

  if (!configured) {
    return (
      <Card>
        <h3 className="font-semibold">Lunchflow accounts</h3>
        <p className="mt-1 text-sm text-(--color-fog)">
          Set <code className="text-(--color-mist)">LUNCHFLOW_API_KEY</code> in your .env and
          restart to choose which accounts sync.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Lunchflow accounts</h3>
          <p className="mt-0.5 text-xs text-(--color-fog)">
            Only the accounts you switch on are synced.
          </p>
        </div>
        <Button variant="ghost" onClick={load} disabled={loading}>
          {loading ? "…" : "Refresh"}
        </Button>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-(--color-amber-warn)">
          Couldn&apos;t reach Lunchflow: {error}
        </p>
      ) : null}

      {!loading && accounts.length === 0 && !error ? (
        <p className="mt-3 text-sm text-(--color-fog)">
          No accounts found on your Lunchflow plan yet.
        </p>
      ) : null}

      <div className="mt-2 divide-y divide-(--color-card-edge)">
        {accounts.map((account) => (
          <div key={account.providerAccountId} className="py-3">
            <label className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate font-medium text-(--color-mist)">
                  {account.name}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-(--color-fog)">
                  {account.balancePence !== null ? (
                    <span className="tabular-nums">{formatMoney(account.balancePence)}</span>
                  ) : null}
                  {account.transactionCount > 0 ? (
                    <span>· {account.transactionCount} imported</span>
                  ) : null}
                  {account.missingUpstream ? <Pill tone="amber">not on Lunchflow</Pill> : null}
                </span>
              </span>
              <input
                type="checkbox"
                checked={account.syncEnabled}
                disabled={pending === account.providerAccountId}
                onChange={(e) => toggle(account, e.target.checked)}
                className="h-5 w-5 shrink-0 accent-(--color-beacon)"
              />
            </label>

            {!account.syncEnabled && account.transactionCount > 0 ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-(--color-ink-soft) px-3 py-2">
                <span className="text-xs text-(--color-fog)">
                  {account.transactionCount} already imported. Switching off stops new ones.
                </span>
                <button
                  onClick={() => purge(account)}
                  disabled={purging === account.providerAccountId}
                  className="shrink-0 text-xs font-medium text-(--color-amber-warn)"
                >
                  {purging === account.providerAccountId ? "…" : "Remove them"}
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
