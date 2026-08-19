"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, Pill } from "@/components/ui";

type Status = "want" | "reading" | "done" | "abandoned";

interface Item {
  id: string;
  title: string;
  author: string | null;
  url: string | null;
  kind: string;
  status: Status;
  rating: number | null;
}

const LANES: { value: Status; label: string }[] = [
  { value: "want", label: "Want" },
  { value: "reading", label: "Reading" },
  { value: "done", label: "Done" },
];

export function ReadingView() {
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<Status, number>>({
    want: 0,
    reading: 0,
    done: 0,
    abandoned: 0,
  });
  const [lane, setLane] = useState<Status>("want");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/reading");
    if (res.ok) {
      const data = await res.json();
      setItems(data.items ?? []);
      setCounts(data.counts ?? counts);
    }
    setLoaded(true);
    // counts is only a fallback here; refetching on every change would loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    await fetch("/api/reading", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: trimmed, author: author.trim() || null }),
    }).catch(() => {});
    setTitle("");
    setAuthor("");
    setBusy(false);
    void load();
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/reading/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
    void load();
  }

  const visible = items.filter((i) => i.status === lane);

  return (
    <main>
      <header className="pt-6 pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Reading</h1>
      </header>

      <Card>
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
            placeholder="Title"
            className="min-h-11 flex-1 rounded-xl border border-(--color-card-edge) bg-(--color-ink-soft) px-3 text-sm outline-none placeholder:text-(--color-fog) focus:border-(--color-beacon)/50"
          />
          <Button onClick={add} disabled={busy || !title.trim()}>
            Add
          </Button>
        </div>
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="Author (optional)"
          className="mt-2 min-h-11 w-full rounded-xl border border-(--color-card-edge) bg-(--color-ink-soft) px-3 text-sm outline-none placeholder:text-(--color-fog)"
        />
      </Card>

      <div className="mt-4 flex gap-1 rounded-xl bg-(--color-ink-soft) p-1">
        {LANES.map((l) => (
          <button
            key={l.value}
            onClick={() => setLane(l.value)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm ${
              lane === l.value
                ? "bg-(--color-card) text-(--color-bright)"
                : "text-(--color-fog)"
            }`}
          >
            {l.label}
            {counts[l.value] > 0 ? (
              <span className="ml-1 text-xs text-(--color-fog)">{counts[l.value]}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {visible.map((item) => (
          <Card key={item.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{item.title}</div>
                {item.author ? (
                  <div className="text-sm text-(--color-fog)">{item.author}</div>
                ) : null}
                {item.status === "done" ? (
                  <div className="mt-1 flex gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => patch(item.id, { rating: star })}
                        className={
                          (item.rating ?? 0) >= star
                            ? "text-(--color-beacon)"
                            : "text-(--color-card-edge)"
                        }
                        aria-label={`${star} stars`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <Pill tone="neutral">{item.kind}</Pill>
            </div>

            <div className="mt-3 flex gap-2">
              {item.status === "want" ? (
                <Button variant="secondary" onClick={() => patch(item.id, { status: "reading" })}>
                  Start
                </Button>
              ) : null}
              {item.status === "reading" ? (
                <Button variant="secondary" onClick={() => patch(item.id, { status: "done" })}>
                  Finished ✓
                </Button>
              ) : null}
              {item.status !== "done" ? (
                <Button variant="ghost" onClick={() => patch(item.id, { status: "abandoned" })}>
                  Let it go
                </Button>
              ) : null}
            </div>
          </Card>
        ))}

        {visible.length === 0 ? (
          <EmptyState
            icon="📚"
            title={
              !loaded
                ? "…"
                : lane === "want"
                  ? "Nothing on the pile"
                  : lane === "reading"
                    ? "Nothing open right now"
                    : "Nothing finished yet"
            }
            hint={
              lane === "want"
                ? "Add anything that sparks — sorting it out is future you's job."
                : undefined
            }
          />
        ) : null}
      </div>

      {counts.abandoned > 0 ? (
        <p className="mt-4 px-1 text-center text-xs text-(--color-fog)">
          {counts.abandoned} let go. Not every book earns you.
        </p>
      ) : null}
    </main>
  );
}
