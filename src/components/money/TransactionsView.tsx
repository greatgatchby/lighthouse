"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, EmptyState, Pill } from "@/components/ui";
import { formatMoney, formatRelativeDay } from "@/lib/format";
import {
  apiFetch,
  type FinanceSummary,
  type TransactionRow,
  type TransactionsPage,
} from "@/components/money/api";
import { ErrorNote, Loading } from "@/components/money/Shared";

interface CategoryOption {
  slug: string;
  name: string;
}

export function TransactionsView({ initialCategory }: { initialCategory: string | null }) {
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(initialCategory);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetRow, setSheetRow] = useState<TransactionRow | null>(null);
  const [summaryCategories, setSummaryCategories] = useState<CategoryOption[]>([]);

  const requestId = useRef(0);

  // Debounce typing so the list settles rather than flickering.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // The contract has no categories endpoint; the summary carries the names we
  // need, and anything else surfaces from the rows themselves.
  useEffect(() => {
    let live = true;
    apiFetch<FinanceSummary>("/api/finance/summary")
      .then((summary) => {
        if (!live) return;
        setSummaryCategories(
          summary.month.spentByCategory.map((c) => ({ slug: c.slug, name: c.name })),
        );
      })
      .catch(() => {
        /* chips degrade to whatever the rows know about */
      });
    return () => {
      live = false;
    };
  }, []);

  const fetchPage = useCallback(
    async (before: string | null): Promise<TransactionsPage> => {
      const params = new URLSearchParams({ limit: "50" });
      if (before) params.set("before", before);
      if (category) params.set("category", category);
      if (query) params.set("search", query);
      return apiFetch<TransactionsPage>(`/api/finance/transactions?${params.toString()}`);
    },
    [category, query],
  );

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage(null);
      if (id !== requestId.current) return;
      setRows(page.rows);
      setNextBefore(page.nextBefore);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : "Couldn’t load transactions just now.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function loadMore() {
    if (!nextBefore || loadingMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextBefore);
      if (id !== requestId.current) return;
      setRows((prev) => [...prev, ...page.rows]);
      setNextBefore(page.nextBefore);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : "Couldn’t load more just now.");
    } finally {
      setLoadingMore(false);
    }
  }

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of summaryCategories) map.set(c.slug, c.name);
    for (const row of rows) {
      if (row.categorySlug && !map.has(row.categorySlug)) {
        map.set(row.categorySlug, row.categoryName ?? row.categorySlug);
      }
    }
    if (category && !map.has(category)) map.set(category, category);
    return [...map.entries()]
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [summaryCategories, rows, category]);

  const groups = useMemo(() => {
    const out: { day: string; rows: TransactionRow[] }[] = [];
    for (const row of rows) {
      const day = formatRelativeDay(new Date(row.postedAt));
      const last = out[out.length - 1];
      if (last && last.day === day) last.rows.push(row);
      else out.push({ day, rows: [row] });
    }
    return out;
  }, [rows]);

  /** Apply a recategorisation locally so the list settles without a round trip. */
  function applyCategory(row: TransactionRow, slug: string, remember: boolean) {
    const name = categories.find((c) => c.slug === slug)?.name ?? slug;
    setRows((prev) =>
      prev.map((r) => {
        const isSame = r.id === row.id;
        const isSameMerchant =
          remember && !!row.merchant && !!r.merchant && r.merchant === row.merchant;
        if (!isSame && !isSameMerchant) return r;
        return { ...r, categorySlug: slug, categoryName: name };
      }),
    );
    setSheetRow(null);
  }

  return (
    <>
      <div className="sticky top-0 z-30 -mx-4 bg-(--color-ink)/95 px-4 pb-2 backdrop-blur-lg">
        <div className="relative">
          <input
            type="search"
            inputMode="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search a shop or a word…"
            className="w-full rounded-xl border border-(--color-card-edge) bg-(--color-ink-soft) px-4 py-3 text-sm text-(--color-bright) placeholder:text-(--color-fog)"
          />
        </div>

        {categories.length > 0 ? (
          <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
            <Chip active={category === null} onClick={() => setCategory(null)}>
              All
            </Chip>
            {categories.map((c) => (
              <Chip
                key={c.slug}
                active={category === c.slug}
                onClick={() => setCategory(category === c.slug ? null : c.slug)}
              >
                {c.name}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-3 space-y-2">
          <Loading lines={4} />
        </div>
      ) : error && rows.length === 0 ? (
        <div className="mt-3">
          <ErrorNote message={error} onRetry={() => void reload()} />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            icon="🧾"
            title={query || category ? "Nothing matches that" : "No transactions yet"}
            hint={
              query || category
                ? "Try a shorter word, or clear the filter."
                : "Connect Monzo or drop in a CSV and they land here."
            }
          />
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          {groups.map((group) => (
            <div key={group.day}>
              <div className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-(--color-fog)">
                {group.day}
              </div>
              <div className="divide-y divide-(--color-card-edge) overflow-hidden rounded-(--radius-card) border border-(--color-card-edge) bg-(--color-card)">
                {group.rows.map((row) => (
                  <button
                    key={row.id}
                    onClick={() => setSheetRow(row)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-(--color-ink-soft)"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={`truncate font-medium ${
                            row.declined ? "text-(--color-fog) line-through" : "text-(--color-mist)"
                          }`}
                        >
                          {row.merchant ?? row.description ?? "Payment"}
                        </span>
                        {row.declined ? <Pill tone="amber">declined</Pill> : null}
                      </span>
                      {row.description ? (
                        <span className="mt-0.5 truncate text-xs text-(--color-fog)">
                          {row.description}
                        </span>
                      ) : null}
                      <span
                        className={`mt-1 truncate text-[11px] ${
                          row.categoryName ? "text-(--color-fog)" : "text-(--color-beacon)"
                        }`}
                      >
                        {row.categoryName ?? "tap to file"}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-sm font-medium tabular-nums ${
                        row.declined
                          ? "text-(--color-fog)"
                          : row.amountPence > 0
                            ? "text-(--color-sea)"
                            : "text-(--color-mist)"
                      }`}
                    >
                      {formatMoney(row.amountPence, { showPence: true, sign: true })}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}

          {nextBefore ? (
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </Button>
          ) : (
            <p className="py-2 text-center text-xs text-(--color-fog)">That’s everything.</p>
          )}
        </div>
      )}

      {sheetRow ? (
        <RecategoriseSheet
          row={sheetRow}
          categories={categories}
          onClose={() => setSheetRow(null)}
          onApplied={applyCategory}
        />
      ) : null}
    </>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-(--color-beacon-soft) text-(--color-beacon)"
          : "bg-(--color-ink-soft) text-(--color-fog)"
      }`}
    >
      {children}
    </button>
  );
}

function RecategoriseSheet({
  row,
  categories,
  onClose,
  onApplied,
}: {
  row: TransactionRow;
  categories: CategoryOption[];
  onClose: () => void;
  onApplied: (row: TransactionRow, slug: string, remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function pick(slug: string) {
    if (saving) return;
    setSaving(slug);
    setError(null);
    try {
      await apiFetch(`/api/finance/transactions/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ categorySlug: slug, rememberMerchant: remember }),
      });
      onApplied(row, slug, remember);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn’t save — try once more.");
      setSaving(null);
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-(--color-ink)/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="pb-safe fixed inset-x-0 bottom-0 z-50 mx-auto max-w-lg px-3 pb-3">
        <Card className="max-h-[75dvh] overflow-y-auto">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-(--color-card-edge)" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-semibold text-(--color-bright)">
                {row.merchant ?? row.description ?? "Payment"}
              </div>
              <div className="mt-0.5 truncate text-xs text-(--color-fog)">
                {formatRelativeDay(new Date(row.postedAt))} ·{" "}
                {formatMoney(row.amountPence, { showPence: true, sign: true })}
              </div>
            </div>
            <button onClick={onClose} className="shrink-0 text-sm text-(--color-fog)">
              Close
            </button>
          </div>

          <label className="mt-3 flex items-center justify-between rounded-xl bg-(--color-ink-soft) px-3 py-2.5">
            <span className="text-sm text-(--color-mist)">Remember for this merchant</span>
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-5 w-5 accent-(--color-beacon)"
            />
          </label>

          {categories.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {categories.map((c) => (
                <button
                  key={c.slug}
                  onClick={() => void pick(c.slug)}
                  disabled={saving !== null}
                  className={`min-h-12 rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                    row.categorySlug === c.slug || saving === c.slug
                      ? "bg-(--color-beacon-soft) text-(--color-beacon)"
                      : "bg-(--color-ink-soft) text-(--color-mist)"
                  }`}
                >
                  {saving === c.slug ? "Filing…" : c.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-center text-sm text-(--color-fog)">
              No categories yet — they appear once a little spending is filed.
            </p>
          )}

          {error ? (
            <p className="mt-3 text-center text-sm text-(--color-amber-warn)">{error}</p>
          ) : null}
        </Card>
      </div>
    </>
  );
}
