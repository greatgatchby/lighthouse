"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ExcitementDots } from "@/components/goals/ExcitementDots";
import { ENERGY_LABEL, ENERGY_TONE, type Energy } from "@/components/goals/types";
import { Button, Card, Pill, SectionTitle } from "@/components/ui";

// The body-double screen. The timer is the point of this page: showing up for
// 25 minutes IS the win, so the clock is the biggest thing here and stopping it
// is never framed as quitting.

const SESSION_MS = 25 * 60_000;

export interface GoalDetailData {
  id: string;
  title: string;
  why: string | null;
  area: string | null;
  excitement: number;
  nextAction: string | null;
  estimatedMinutes: number | null;
  energyRequired: Energy;
  status: "spark" | "active" | "parked" | "done";
}

const ENERGIES: Energy[] = ["low", "medium", "high"];

function clock(msLeft: number): string {
  const over = msLeft < 0;
  const seconds = Math.floor(Math.abs(msLeft) / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${over ? "+" : ""}${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function GoalDetail({
  goal,
  openSession,
  children,
}: {
  goal: GoalDetailData;
  /** A session already running when the page loaded — the clock resumes. */
  openSession: { id: string; startedAt: string } | null;
  /** Server-rendered session history, slotted between the timer and the edits. */
  children?: ReactNode;
}) {
  const router = useRouter();

  const [fields, setFields] = useState({
    title: goal.title,
    why: goal.why ?? "",
    area: goal.area ?? "",
    estimatedMinutes: goal.estimatedMinutes,
    energyRequired: goal.energyRequired,
    nextAction: goal.nextAction,
  });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [sessionId, setSessionId] = useState<string | null>(openSession?.id ?? null);
  const [startedAt, setStartedAt] = useState<number | null>(
    openSession ? Date.parse(openSession.startedAt) : null,
  );
  // Starts null so the server and the first client render agree; the real
  // reading lands on mount.
  const [tick, setTick] = useState<number | null>(null);
  const [showedUp, setShowedUp] = useState<number | null>(null);

  const running = startedAt !== null;

  useEffect(() => {
    if (startedAt === null) return;
    setTick(Date.now());
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const remaining = useMemo(() => {
    if (startedAt === null) return SESSION_MS;
    return startedAt + SESSION_MS - (tick ?? startedAt);
  }, [startedAt, tick]);

  const past25 = running && remaining <= 0;

  async function patch(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setProblem(null);
    try {
      const res = await fetch(`/api/goals/${goal.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("patch failed");
      return (await res.json()) as Partial<GoalDetailData>;
    } catch {
      setProblem("That didn’t save just now — try once more.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    setBusy("start");
    setProblem(null);
    setShowedUp(null);
    try {
      const res = await fetch(`/api/goals/${goal.id}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      if (!res.ok) throw new Error("start failed");
      const data = (await res.json()) as { id: string; session?: { startedAt?: string } };
      setSessionId(data.id);
      const began = data.session?.startedAt ? Date.parse(data.session.startedAt) : Date.now();
      setStartedAt(Number.isFinite(began) ? began : Date.now());
      setTick(Date.now());
      router.refresh();
    } catch {
      setProblem("The clock didn’t start — sitting down still counts. Try again?");
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    if (!sessionId) return;
    const elapsed = startedAt ? Math.max(1, Math.round((Date.now() - startedAt) / 60_000)) : 1;
    setBusy("stop");
    setProblem(null);
    try {
      const res = await fetch(`/api/goals/${goal.id}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "stop", sessionId }),
      });
      if (!res.ok) throw new Error("stop failed");
      const data = (await res.json()) as { minutes?: number };
      setShowedUp(data.minutes ?? elapsed);
      router.refresh();
    } catch {
      setShowedUp(elapsed);
      setProblem("The clock stopped here, but the log didn’t reach the server.");
    } finally {
      setSessionId(null);
      setStartedAt(null);
      setTick(null);
      setBusy(null);
    }
  }

  async function refine() {
    setBusy("refine");
    setProblem(null);
    try {
      const res = await fetch(`/api/goals/${goal.id}/refine`, { method: "POST" });
      if (!res.ok) throw new Error("refine failed");
      const updated = (await res.json()) as GoalDetailData;
      setFields((current) => ({
        ...current,
        nextAction: updated.nextAction,
        estimatedMinutes: updated.estimatedMinutes,
        energyRequired: updated.energyRequired,
      }));
      router.refresh();
    } catch {
      setProblem("Couldn’t shrink that one just now — try again in a moment.");
    } finally {
      setBusy(null);
    }
  }

  async function saveEdits(event: React.FormEvent) {
    event.preventDefault();
    const title = fields.title.trim();
    if (!title) return;
    const saved = await patch(
      {
        title,
        why: fields.why.trim() || null,
        area: fields.area.trim().toLowerCase() || null,
        estimatedMinutes: fields.estimatedMinutes ?? null,
        energyRequired: fields.energyRequired,
      },
      "save",
    );
    if (saved) {
      setEditing(false);
      router.refresh();
    }
  }

  async function setStatus(status: "parked" | "done" | "active") {
    const saved = await patch({ status }, status);
    if (!saved) return;
    router.push("/goals");
    router.refresh();
  }

  async function remove() {
    setBusy("delete");
    setProblem(null);
    try {
      const res = await fetch(`/api/goals/${goal.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      router.push("/goals");
      router.refresh();
    } catch {
      setProblem("Couldn’t remove that just now — try once more.");
      setBusy(null);
    }
  }

  return (
    <>
      {editing ? (
        <Card>
          <form onSubmit={saveEdits}>
            <label className="block text-xs uppercase tracking-wider text-(--color-fog)">
              Title
            </label>
            <input
              value={fields.title}
              onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-xl border border-(--color-card-edge) bg-(--color-ink-soft) px-3 py-2 text-base text-(--color-bright)"
            />

            <label className="mt-3 block text-xs uppercase tracking-wider text-(--color-fog)">
              Why it matters
            </label>
            <textarea
              value={fields.why}
              onChange={(e) => setFields((f) => ({ ...f, why: e.target.value }))}
              rows={3}
              placeholder="The felt reason, in your words."
              className="mt-1 w-full rounded-xl border border-(--color-card-edge) bg-(--color-ink-soft) px-3 py-2 text-base leading-relaxed text-(--color-bright) placeholder:text-(--color-fog)"
            />

            <div className="mt-3 flex gap-2">
              <div className="flex-1">
                <label className="block text-xs uppercase tracking-wider text-(--color-fog)">
                  Area
                </label>
                <input
                  value={fields.area}
                  onChange={(e) => setFields((f) => ({ ...f, area: e.target.value }))}
                  placeholder="home"
                  className="mt-1 min-h-11 w-full rounded-xl border border-(--color-card-edge) bg-(--color-ink-soft) px-3 py-2 text-base text-(--color-bright) placeholder:text-(--color-fog)"
                />
              </div>
              <div className="w-28">
                <label className="block text-xs uppercase tracking-wider text-(--color-fog)">
                  Minutes
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="600"
                  value={fields.estimatedMinutes ?? ""}
                  onChange={(e) =>
                    setFields((f) => ({
                      ...f,
                      estimatedMinutes: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                  className="mt-1 min-h-11 w-full rounded-xl border border-(--color-card-edge) bg-(--color-ink-soft) px-3 py-2 text-base tabular-nums text-(--color-bright)"
                />
              </div>
            </div>

            <label className="mt-3 block text-xs uppercase tracking-wider text-(--color-fog)">
              Energy it needs
            </label>
            <div className="mt-1 flex gap-2">
              {ENERGIES.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setFields((f) => ({ ...f, energyRequired: level }))}
                  className={`min-h-11 flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                    fields.energyRequired === level
                      ? "bg-(--color-beacon-soft) text-(--color-beacon)"
                      : "bg-(--color-ink-soft) text-(--color-mist)"
                  }`}
                >
                  {ENERGY_LABEL[level]}
                </button>
              ))}
            </div>

            <div className="mt-4 flex gap-2">
              <Button type="submit" disabled={busy !== null} className="flex-1">
                {busy === "save" ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setFields({
                    title: goal.title,
                    why: goal.why ?? "",
                    area: goal.area ?? "",
                    estimatedMinutes: goal.estimatedMinutes,
                    energyRequired: goal.energyRequired,
                    nextAction: goal.nextAction,
                  });
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-bold leading-tight tracking-tight text-(--color-bright)">
              {fields.title}
            </h1>
            <button
              onClick={() => setEditing(true)}
              className="mt-1 shrink-0 text-sm text-(--color-fog)"
            >
              Edit
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ExcitementDots goalId={goal.id} value={goal.excitement} size="lg" />
            <Pill tone={ENERGY_TONE[fields.energyRequired]}>
              {ENERGY_LABEL[fields.energyRequired]}
            </Pill>
            {fields.estimatedMinutes ? <Pill>{fields.estimatedMinutes} min</Pill> : null}
            {fields.area ? <Pill>{fields.area}</Pill> : null}
          </div>

          {fields.why ? (
            <p className="mt-4 text-lg italic leading-relaxed text-(--color-mist)">{fields.why}</p>
          ) : (
            <p className="mt-4 text-sm italic text-(--color-fog)">
              No why written down yet — tap Edit and say it plainly. It’s the bit that carries you.
            </p>
          )}
        </>
      )}

      <SectionTitle>Next step</SectionTitle>
      <Card accent>
        {fields.nextAction ? (
          <p className="text-lg leading-relaxed text-(--color-bright)">{fields.nextAction}</p>
        ) : (
          <p className="text-base leading-relaxed text-(--color-fog)">
            No next step yet. One small sentence is all it takes to make this startable.
          </p>
        )}
        <Button
          variant="secondary"
          onClick={refine}
          disabled={busy !== null}
          className="mt-3 w-full"
        >
          {busy === "refine" ? "Shrinking…" : fields.nextAction ? "Make it smaller" : "Make me one"}
        </Button>
      </Card>

      <SectionTitle>Body double</SectionTitle>
      <Card className="text-center">
        <div
          className={`text-6xl font-bold tabular-nums tracking-tight ${
            running ? "text-(--color-beacon)" : "text-(--color-bright)"
          }`}
          aria-live="off"
        >
          {clock(running ? remaining : SESSION_MS)}
        </div>
        <div className="mt-1 text-sm text-(--color-fog)">
          {past25
            ? "Twenty-five minutes done — carry on if you’re in it."
            : running
              ? "I’m sitting here with you. Nothing else needs doing."
              : "Twenty-five minutes, together. Starting is the whole thing."}
        </div>

        {running ? (
          <Button variant="secondary" onClick={stop} disabled={busy !== null} className="mt-4 w-full">
            {busy === "stop" ? "Logging…" : "Stop"}
          </Button>
        ) : (
          <Button onClick={start} disabled={busy !== null} className="mt-4 w-full">
            {busy === "start" ? "Starting…" : "▶ Start 25 min"}
          </Button>
        )}
      </Card>

      {showedUp !== null ? (
        <Card accent className="mt-2 text-center">
          <div className="text-base font-medium text-(--color-bright)">
            You showed up. That’s the whole game.
          </div>
          <div className="mt-1 text-sm text-(--color-fog)">
            {showedUp} minute{showedUp === 1 ? "" : "s"} logged.
          </div>
        </Card>
      ) : null}

      {problem ? (
        <p className="mt-2 px-1 text-sm text-(--color-amber-warn)">{problem}</p>
      ) : null}

      {children}

      <SectionTitle>This goal</SectionTitle>
      <Card>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void setStatus(goal.status === "parked" ? "active" : "parked")}
            disabled={busy !== null}
            className="min-h-11 flex-1 rounded-xl bg-(--color-ink-soft) px-4 py-2 text-sm font-medium text-(--color-mist) transition-colors active:bg-(--color-card) disabled:opacity-40"
          >
            {goal.status === "parked"
              ? busy === "active"
                ? "Bringing it back…"
                : "Bring it back"
              : busy === "parked"
                ? "Parking…"
                : "Park it for now"}
          </button>
          <button
            onClick={() => void setStatus("done")}
            disabled={busy !== null}
            className="min-h-11 flex-1 rounded-xl bg-(--color-ink-soft) px-4 py-2 text-sm font-medium text-(--color-mist) transition-colors active:bg-(--color-card) disabled:opacity-40"
          >
            {busy === "done" ? "Filing…" : "Mark it done"}
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={busy !== null}
            className="min-h-11 flex-1 rounded-xl bg-(--color-ink-soft) px-4 py-2 text-sm font-medium text-(--color-mist) transition-colors active:bg-(--color-card) disabled:opacity-40"
          >
            Remove it
          </button>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-(--color-fog)">
          Parking is neutral — parked goals wait quietly and get asked about now and then.
        </p>

        {confirmDelete ? (
          <div className="mt-3 rounded-xl bg-(--color-ink-soft) p-3">
            <p className="text-sm text-(--color-mist)">
              Remove this one for good? Parking keeps it around without any pull on you.
            </p>
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" onClick={remove} disabled={busy !== null} className="flex-1">
                {busy === "delete" ? "Removing…" : "Yes, remove it"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy !== null}>
                Keep it
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </>
  );
}
