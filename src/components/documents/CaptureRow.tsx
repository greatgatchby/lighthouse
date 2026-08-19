"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

// Capture is one tap and never asks a question. Point the camera at the paper,
// or hand over a PDF — everything after that (reading, naming, filing) happens
// without you. The share sheet posts to the same endpoint.

interface IngestResponse {
  documents?: { id: string; duplicate: boolean }[];
  skipped?: { filename: string; reason: string }[];
}

export function CaptureRow({ onCaptured }: { onCaptured?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function send(input: HTMLInputElement) {
    const files = input.files;
    if (!files || files.length === 0) return;

    const form = new FormData();
    for (const file of Array.from(files)) form.append("file", file);
    const count = files.length;
    input.value = ""; // so the same photo can be picked twice

    setBusy(true);
    setNote(count > 1 ? `Reading ${count} things…` : "Reading it now…");
    try {
      const res = await fetch("/api/documents/ingest", { method: "POST", body: form });
      if (!res.ok) throw new Error("ingest failed");
      const body = (await res.json()) as IngestResponse;
      const captured = body.documents ?? [];
      const fresh = captured.filter((doc) => !doc.duplicate).length;
      const skipped = body.skipped?.[0]?.reason;

      if (fresh > 0) {
        setNote(fresh > 1 ? `${fresh} in — reading them now` : "Got it — reading it now");
      } else if (captured.length > 0) {
        setNote("Already in the drawer");
      } else {
        setNote(skipped ?? "Nothing landed — try again");
      }
      router.refresh();
      onCaptured?.();
    } catch {
      setNote("That didn’t go through — try again in a moment");
    } finally {
      setBusy(false);
    }
  }

  const tile =
    "flex min-h-14 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-(--color-card-edge) bg-(--color-ink-soft) px-4 text-sm font-medium text-(--color-mist) active:bg-(--color-card)";

  return (
    <Card>
      <div className="flex gap-2">
        <label className={`${tile} ${busy ? "opacity-50" : ""}`}>
          <span aria-hidden>📷</span>
          Camera
          <input
            type="file"
            accept="application/pdf,image/*"
            capture="environment"
            className="sr-only"
            disabled={busy}
            onChange={(event) => void send(event.currentTarget)}
          />
        </label>
        <label className={`${tile} ${busy ? "opacity-50" : ""}`}>
          <span aria-hidden>📄</span>
          Upload
          <input
            type="file"
            accept="application/pdf,image/*"
            multiple
            className="sr-only"
            disabled={busy}
            onChange={(event) => void send(event.currentTarget)}
          />
        </label>
      </div>
      <p className="mt-2 text-center text-xs text-(--color-fog)" aria-live="polite">
        {note ?? "Any paper — it gets read, named and filed for you."}
      </p>
    </Card>
  );
}
