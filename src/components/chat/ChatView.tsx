"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmationCard } from "@/components/chat/ConfirmationCard";
import { Markdown } from "@/components/chat/Markdown";
import { toolLabel } from "@/components/chat/toolLabels";

// The chat surface. /api/chat streams SSE; everything here is a thin reader over
// that stream. Nothing is persisted client-side — the server owns the history,
// and chatId lives in state only so the current conversation keeps its thread.

type StreamEvent =
  | { type: "chat"; chatId: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string }
  | {
      type: "confirmation";
      proposalId: string;
      kind: string;
      potName: string;
      amountPence: number;
      reason: string | null;
    }
  | { type: "goal_created"; goalId: string; title: string }
  | { type: "done" }
  | { type: "error"; message: string };

/** Omit<> collapses a union to its shared keys, which would erase every
 * variant-specific field below. This distributes over the union instead. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type Entry =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "tool"; name: string }
  | { id: string; kind: "goal"; goalId: string; title: string }
  | {
      id: string;
      kind: "confirmation";
      proposalId: string;
      potName: string;
      amountPence: number;
      reason: string | null;
    }
  | { id: string; kind: "note"; text: string };

const STARTERS = [
  "What did I spend on coffee last month?",
  "I have 20 minutes and medium energy — what should I do?",
  "File this thought: ",
];

function parseEvent(raw: string): StreamEvent | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    if (typeof (value as { type?: unknown }).type !== "string") return null;
    return value as StreamEvent;
  } catch {
    return null;
  }
}

export function ChatView() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  const counter = useRef(0);
  const openAssistant = useRef<string | null>(null);
  const stickToBottom = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const nextId = useCallback(() => `e${counter.current++}`, []);

  const push = useCallback(
    (entry: DistributiveOmit<Entry, "id"> & { id?: string }) => {
      const id = entry.id ?? `e${counter.current++}`;
      setEntries((prev) => [...prev, { ...entry, id } as Entry]);
    },
    [],
  );

  // --- scrolling -----------------------------------------------------------
  useEffect(() => {
    function onScroll() {
      const gap =
        document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      stickToBottom.current = gap < 180;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!stickToBottom.current) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [entries, streaming]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // --- streaming -----------------------------------------------------------
  const appendDelta = useCallback((delta: string) => {
    const openId = openAssistant.current;
    if (openId) {
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === openId && entry.kind === "assistant"
            ? { ...entry, text: entry.text + delta }
            : entry,
        ),
      );
      return;
    }
    const id = `e${counter.current++}`;
    openAssistant.current = id;
    setEntries((prev) => [...prev, { id, kind: "assistant", text: delta }]);
  }, []);

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      switch (event.type) {
        case "chat":
          setChatId(event.chatId);
          break;
        case "text":
          if (typeof event.delta === "string" && event.delta) appendDelta(event.delta);
          break;
        case "tool":
          openAssistant.current = null;
          push({ kind: "tool", name: event.name });
          break;
        case "confirmation":
          openAssistant.current = null;
          push({
            kind: "confirmation",
            proposalId: event.proposalId,
            potName: event.potName,
            amountPence: event.amountPence,
            reason: event.reason ?? null,
          });
          break;
        case "goal_created":
          openAssistant.current = null;
          push({ kind: "goal", goalId: event.goalId, title: event.title });
          break;
        case "error":
          openAssistant.current = null;
          push({ kind: "note", text: event.message || "something wobbled" });
          break;
        case "done":
          openAssistant.current = null;
          break;
      }
    },
    [appendDelta, push],
  );

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || streaming) return;

      push({ kind: "user", text: message });
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      stickToBottom.current = true;
      openAssistant.current = null;
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chatId: chatId ?? undefined, message }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(
            res.status === 401 ? "signed out — reload and sign back in" : "the line dropped",
          );
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let split = buffer.indexOf("\n\n");
          while (split !== -1) {
            const chunk = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            for (const line of chunk.split("\n")) {
              const trimmed = line.replace(/\r$/, "");
              if (!trimmed.startsWith("data: ")) continue;
              const event = parseEvent(trimmed.slice(6));
              if (event) handleEvent(event);
            }
            split = buffer.indexOf("\n\n");
          }
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          openAssistant.current = null;
          push({
            kind: "note",
            text: err instanceof Error ? err.message : "something wobbled",
          });
        }
      } finally {
        openAssistant.current = null;
        abortRef.current = null;
        setStreaming(false);
      }
    },
    [chatId, handleEvent, push, streaming],
  );

  function newChat() {
    if (streaming) return;
    setEntries([]);
    setChatId(null);
    openAssistant.current = null;
    stickToBottom.current = true;
    window.scrollTo({ top: 0 });
  }

  function autogrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }

  const last = entries[entries.length - 1];
  const thinking = streaming && !(last && last.kind === "assistant" && last.text.length > 0);

  return (
    <main>
      <header className="sticky top-0 z-20 -mx-4 flex items-baseline justify-between border-b border-(--color-card-edge)/50 bg-(--color-ink)/90 px-4 pb-3 pt-6 backdrop-blur-lg">
        <h1 className="text-2xl font-bold tracking-tight">Chat</h1>
        {entries.length > 0 ? (
          <button
            onClick={newChat}
            disabled={streaming}
            className="text-sm text-(--color-beacon) disabled:opacity-40"
          >
            New chat
          </button>
        ) : null}
      </header>

      <div className="space-y-3 pb-16 pt-4">
        {entries.length === 0 ? (
          <div className="pt-6">
            <p className="text-lg text-(--color-mist)">What&apos;s on your mind?</p>
            <p className="mt-1 text-sm text-(--color-fog)">
              I can see your money, goals, documents and the rest. Ask, log, or just think out loud.
            </p>
            <div className="mt-5 flex flex-col items-start gap-2">
              {STARTERS.map((starter) => {
                const fillOnly = starter.trimEnd().endsWith(":");
                return (
                  <button
                    key={starter}
                    onClick={() => {
                      if (fillOnly) {
                        setInput(starter);
                        const el = textareaRef.current;
                        if (el) {
                          el.focus();
                          requestAnimationFrame(() => autogrow(el));
                        }
                      } else {
                        void send(starter);
                      }
                    }}
                    className="rounded-2xl border border-(--color-card-edge) bg-(--color-ink-soft) px-3.5 py-2.5 text-left text-sm text-(--color-mist) active:bg-(--color-card)"
                  >
                    {starter}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {entries.map((entry) => {
          if (entry.kind === "user") {
            return (
              <div key={entry.id} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-(--color-ink-soft) px-4 py-2.5 text-[15px] leading-relaxed text-(--color-bright)">
                  {entry.text}
                </div>
              </div>
            );
          }

          if (entry.kind === "assistant") {
            if (!entry.text) return null;
            return (
              <div key={entry.id} className="pr-2">
                <Markdown text={entry.text} />
              </div>
            );
          }

          if (entry.kind === "tool") {
            return (
              <div key={entry.id}>
                <span className="inline-flex items-center rounded-full bg-(--color-ink-soft) px-2.5 py-1 text-xs text-(--color-fog)">
                  {toolLabel(entry.name)}
                </span>
              </div>
            );
          }

          if (entry.kind === "goal") {
            return (
              <div key={entry.id}>
                <Link
                  href={`/goals/${entry.goalId}`}
                  className="inline-flex items-center rounded-full bg-(--color-beacon-soft) px-2.5 py-1 text-xs font-medium text-(--color-beacon)"
                >
                  ✨ {entry.title}
                </Link>
              </div>
            );
          }

          if (entry.kind === "confirmation") {
            return (
              <ConfirmationCard
                key={entry.id}
                proposalId={entry.proposalId}
                potName={entry.potName}
                amountPence={entry.amountPence}
                reason={entry.reason}
              />
            );
          }

          return (
            <p key={entry.id} className="text-sm text-(--color-amber-warn)">
              {entry.text} — try again when you&apos;re ready.
            </p>
          );
        })}

        {thinking ? (
          <div className="flex items-center gap-1.5 py-1" aria-label="thinking">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-(--color-fog)" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-(--color-fog) [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-(--color-fog) [animation-delay:300ms]" />
          </div>
        ) : null}

        <div ref={endRef} />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 bg-(--color-ink)/95 pb-24 pt-3 backdrop-blur-lg">
        <form
          className="mx-auto max-w-lg px-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <div className="flex items-end gap-2 rounded-3xl border border-(--color-card-edge) bg-(--color-card) py-1 pl-4 pr-1">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              placeholder="Ask, log, or think out loud…"
              disabled={streaming}
              onChange={(e) => {
                setInput(e.target.value);
                autogrow(e.target);
              }}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  typeof window !== "undefined" &&
                  window.matchMedia("(pointer: fine)").matches
                ) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              className="max-h-28 flex-1 resize-none bg-transparent py-2.5 text-[15px] leading-6 text-(--color-bright) outline-none placeholder:text-(--color-fog) disabled:opacity-50"
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={streaming || input.trim().length === 0}
              className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--color-beacon) text-lg font-bold text-(--color-ink) transition-opacity disabled:opacity-25"
            >
              ↑
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
