"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, EmptyState, Pill, SectionTitle } from "@/components/ui";
import { CaptureRow } from "@/components/documents/CaptureRow";
import { FolderSheet, type FolderChoice } from "@/components/documents/FolderSheet";
import {
  daysUntil,
  docLabel,
  expiryLabel,
  formatDay,
  type DocRow,
  type FolderRow,
} from "@/components/documents/types";
import { formatMoney } from "@/lib/format";

// The paper drawer. Everything here is one tap deep: capture, confirm a folder,
// fix a folder, find a thing. Nothing asks you to organise anything.

const AMBER_WITHIN_DAYS = 30;

function ExpiryPill({ expiresAt, today }: { expiresAt: string; today: string }) {
  const days = daysUntil(expiresAt, today);
  if (days === null) return null;
  return <Pill tone={days < AMBER_WITHIN_DAYS ? "amber" : "neutral"}>{expiryLabel(days)}</Pill>;
}

function StatusPill({ doc }: { doc: DocRow }) {
  if (doc.status === "pending") return <Pill tone="sea">reading…</Pill>;
  if (doc.status === "failed") return <Pill tone="amber">needs a hand</Pill>;
  return null;
}

export function DocumentsView({
  documents,
  folders,
  filedTodayIds,
  today,
}: {
  documents: DocRow[];
  folders: FolderRow[];
  filedTodayIds: string[];
  today: string;
}) {
  const router = useRouter();

  // Optimistic patches from a folder move, dropped as soon as the server sends
  // a fresh list.
  const [patched, setPatched] = useState<Record<string, DocRow>>({});
  useEffect(() => setPatched({}), [documents]);

  const [sheetForId, setSheetForId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DocRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  const docs = useMemo(
    () => documents.map((doc) => patched[doc.id] ?? doc),
    [documents, patched],
  );

  const filedToday = useMemo(
    () => docs.filter((doc) => filedTodayIds.includes(doc.id) && doc.folderName),
    [docs, filedTodayIds],
  );
  const awaitingConfirm = useMemo(
    () => docs.filter((doc) => doc.proposedFolderName),
    [docs],
  );
  const stillReading = docs.some((doc) => doc.status === "pending");

  // A capture is read in the background — keep the page honest while it happens.
  useEffect(() => {
    if (!stillReading) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [stillReading, router]);

  // Debounced search — the FTS index does the work, we just stop typing first.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/documents/search?q=${encodeURIComponent(trimmed)}`);
        if (!res.ok) throw new Error("search failed");
        const body = (await res.json()) as { results: DocRow[] };
        if (seq === searchSeq.current) setResults(body.results ?? []);
      } catch {
        if (seq === searchSeq.current) setResults([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const move = useCallback(
    async (docId: string, choice: FolderChoice | { confirmProposed: true }) => {
      setBusyId(docId);
      try {
        const res = await fetch(`/api/documents/${docId}/folder`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(choice),
        });
        if (!res.ok) throw new Error("move failed");
        const body = (await res.json()) as { document?: DocRow };
        if (body.document) {
          const moved = body.document;
          setPatched((current) => ({ ...current, [moved.id]: moved }));
          setResults((current) =>
            current ? current.map((row) => (row.id === moved.id ? moved : row)) : current,
          );
        }
        setSheetForId(null);
        router.refresh();
      } catch {
        // nothing moved — the card stays exactly where it was
      } finally {
        setBusyId(null);
      }
    },
    [router],
  );

  const listed = useMemo(() => {
    if (results) return results;
    if (activeFolderId) return docs.filter((doc) => doc.folderId === activeFolderId);
    return docs;
  }, [results, activeFolderId, docs]);

  // a search result may not be in the recent list — look in both
  const sheetDoc = sheetForId
    ? [...docs, ...(results ?? [])].find((doc) => doc.id === sheetForId) ?? null
    : null;
  const activeFolder = folders.find((folder) => folder.id === activeFolderId) ?? null;

  return (
    <main>
      <header className="pt-6 pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
        <p className="mt-1 text-sm text-(--color-fog)">
          {docs.length > 0
            ? `${docs.length} in the drawer · ${folders.length} folder${
                folders.length === 1 ? "" : "s"
              }`
            : "Nothing in the drawer yet"}
        </p>
      </header>

      <CaptureRow />

      <div className="mt-3">
        <Card>
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-(--color-fog)">
              🔍
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search everything on every page"
              aria-label="Search documents"
              type="search"
              enterKeyHint="search"
              className="min-h-11 w-full bg-transparent text-base text-(--color-bright) placeholder:text-(--color-fog) focus:outline-none"
            />
            {query ? (
              <Button variant="ghost" onClick={() => setQuery("")} className="shrink-0 px-2">
                Clear
              </Button>
            ) : null}
          </div>
        </Card>
      </div>

      {results ? (
        <>
          <SectionTitle>
            {searching ? "Looking…" : `${results.length} match${results.length === 1 ? "" : "es"}`}
          </SectionTitle>
          {results.length === 0 && !searching ? (
            <EmptyState
              icon="🔎"
              title="Nothing matched that"
              hint="Try a word that would actually be printed on the page — a company, an amount, a reference."
            />
          ) : null}
        </>
      ) : (
        <>
          {awaitingConfirm.length > 0 ? (
            <>
              <SectionTitle>One tap to file</SectionTitle>
              <div className="space-y-2">
                {awaitingConfirm.map((doc) => (
                  <Card key={doc.id} accent>
                    <div className="font-medium text-(--color-bright)">{docLabel(doc)}</div>
                    {doc.issuer ? (
                      <div className="mt-0.5 text-sm text-(--color-fog)">{doc.issuer}</div>
                    ) : null}
                    <p className="mt-2 text-sm text-(--color-mist)">
                      New folder “{doc.proposedFolderName}”?
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        className="flex-1"
                        disabled={busyId === doc.id}
                        onClick={() => void move(doc.id, { confirmProposed: true })}
                      >
                        {busyId === doc.id ? "Filing…" : "Create & file"}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busyId === doc.id}
                        onClick={() => setSheetForId(doc.id)}
                      >
                        Pick another
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          ) : null}

          {filedToday.length > 0 ? (
            <>
              <SectionTitle>Filed today</SectionTitle>
              <Card className="divide-y divide-(--color-card-edge)">
                {filedToday.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm text-(--color-mist)">{docLabel(doc)}</div>
                      <button
                        type="button"
                        disabled={busyId === doc.id}
                        onClick={() => setSheetForId(doc.id)}
                        className="mt-0.5 text-xs text-(--color-beacon) disabled:opacity-40"
                      >
                        wrong folder?
                      </button>
                    </div>
                    <Pill tone="sea" className="shrink-0">
                      {doc.folderName}
                    </Pill>
                  </div>
                ))}
              </Card>
            </>
          ) : null}

          {folders.length > 0 ? (
            <>
              <SectionTitle
                action={
                  activeFolder ? (
                    <button
                      type="button"
                      onClick={() => setActiveFolderId(null)}
                      className="text-xs text-(--color-beacon)"
                    >
                      Show all →
                    </button>
                  ) : undefined
                }
              >
                Folders
              </SectionTitle>
              <div className="grid grid-cols-2 gap-2">
                {folders.map((folder) => {
                  const active = folder.id === activeFolderId;
                  return (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => setActiveFolderId(active ? null : folder.id)}
                      className={`flex min-h-16 flex-col justify-center rounded-(--radius-card) border p-3 text-left ${
                        active
                          ? "border-(--color-beacon)/40 bg-(--color-beacon-soft)"
                          : "border-(--color-card-edge) bg-(--color-card)"
                      }`}
                    >
                      <span className="truncate text-sm font-medium text-(--color-bright)">
                        {folder.name}
                      </span>
                      <span className="mt-0.5 text-xs text-(--color-fog)">
                        {folder.count} {folder.count === 1 ? "thing" : "things"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          <SectionTitle>{activeFolder ? activeFolder.name : "Recent"}</SectionTitle>
        </>
      )}

      {listed.length > 0 ? (
        <div className="space-y-2">
          {listed.map((doc) => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              today={today}
              open={openId === doc.id}
              busy={busyId === doc.id}
              onToggle={() => setOpenId((current) => (current === doc.id ? null : doc.id))}
              onRefile={() => setSheetForId(doc.id)}
            />
          ))}
        </div>
      ) : results ? null : (
        <EmptyState
          icon="📷"
          title="Point the camera at any paper"
          hint="A bill, a letter, the thing that's been on the side for a week. It gets read, named, filed and remembered — you never have to think about where it went."
        />
      )}

      {sheetDoc ? (
        <FolderSheet
          title={`Where does “${docLabel(sheetDoc)}” live?`}
          folders={folders}
          currentFolderId={sheetDoc.folderId}
          busy={busyId === sheetDoc.id}
          onPick={(choice) => void move(sheetDoc.id, choice)}
          onClose={() => setSheetForId(null)}
        />
      ) : null}
    </main>
  );
}

function DocumentCard({
  doc,
  today,
  open,
  busy,
  onToggle,
  onRefile,
}: {
  doc: DocRow;
  today: string;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onRefile: () => void;
}) {
  const meta = [doc.issuer, doc.issuedAt ? formatDay(doc.issuedAt) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <div className="truncate font-medium text-(--color-bright)">{docLabel(doc)}</div>
          <div className="mt-0.5 truncate text-sm text-(--color-fog)">
            {meta || "Just landed"}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusPill doc={doc} />
          {doc.folderName ? <Pill tone="sea">{doc.folderName}</Pill> : null}
          {doc.expiresAt ? <ExpiryPill expiresAt={doc.expiresAt} today={today} /> : null}
        </div>
      </button>

      {open ? (
        <div className="mt-3 border-t border-(--color-card-edge) pt-3">
          {doc.summary ? (
            <p className="text-sm leading-relaxed text-(--color-mist)">{doc.summary}</p>
          ) : null}

          {doc.status === "failed" ? (
            <p className="text-sm leading-relaxed text-(--color-amber-warn)">
              {doc.error ?? "That one didn’t read cleanly."} The original is safe — open it below,
              and file it by hand if you like.
            </p>
          ) : null}

          <dl className="mt-2 space-y-1 text-sm">
            {doc.docType ? (
              <div className="flex justify-between gap-3">
                <dt className="text-(--color-fog)">Kind</dt>
                <dd className="text-(--color-mist)">{doc.docType}</dd>
              </div>
            ) : null}
            {doc.amountPence !== null ? (
              <div className="flex justify-between gap-3">
                <dt className="text-(--color-fog)">Amount</dt>
                <dd className="tabular-nums text-(--color-mist)">
                  {formatMoney(doc.amountPence, { showPence: true })}
                </dd>
              </div>
            ) : null}
            {doc.expiresAt ? (
              <div className="flex justify-between gap-3">
                <dt className="text-(--color-fog)">Expires</dt>
                <dd className="text-(--color-mist)">{formatDay(doc.expiresAt)}</dd>
              </div>
            ) : null}
            {doc.reference ? (
              <div className="flex justify-between gap-3">
                <dt className="text-(--color-fog)">Reference</dt>
                <dd className="truncate text-(--color-mist)">{doc.reference}</dd>
              </div>
            ) : null}
          </dl>

          {doc.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {doc.tags.map((tag) => (
                <Pill key={tag}>{tag}</Pill>
              ))}
            </div>
          ) : null}

          {doc.transaction ? (
            <Link href="/money/transactions" className="mt-3 block">
              <div className="rounded-xl border border-(--color-card-edge) bg-(--color-ink-soft) p-3">
                <div className="text-xs uppercase tracking-wider text-(--color-fog)">
                  Matched to a payment
                </div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <span className="truncate text-sm text-(--color-mist)">
                    {doc.transaction.description}
                  </span>
                  <span className="shrink-0 text-sm font-medium tabular-nums text-(--color-bright)">
                    {formatMoney(doc.transaction.amountPence, { sign: true, showPence: true })}
                  </span>
                </div>
              </div>
            </Link>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={`/api/documents/${doc.id}/file`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-(--color-card-edge) bg-(--color-ink-soft) px-4 text-sm text-(--color-mist)"
            >
              Open the original
            </a>
            <Button variant="ghost" disabled={busy} onClick={onRefile}>
              {doc.folderName ? "wrong folder?" : "File it"}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
