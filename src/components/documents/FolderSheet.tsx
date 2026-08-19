"use client";

import { useEffect, useState } from "react";
import { Button, Pill } from "@/components/ui";
import type { FolderRow } from "@/components/documents/types";

// The correction, made cheap: a sheet of shelves, one tap to move. No "are you
// sure", no warning about retraining anything — it just goes where you say,
// and the filing quietly learns from it.

export type FolderChoice = { folderId: string } | { newFolderName: string };

export function FolderSheet({
  title,
  folders,
  currentFolderId,
  busy = false,
  onPick,
  onClose,
}: {
  title: string;
  folders: FolderRow[];
  currentFolderId?: string | null;
  busy?: boolean;
  onPick: (choice: FolderChoice) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-(--color-ink)/70 backdrop-blur-sm"
      />
      <div className="pb-safe relative max-h-[80dvh] w-full max-w-lg overflow-y-auto rounded-t-(--radius-card) border-t border-(--color-card-edge) bg-(--color-card) p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="truncate text-base font-semibold text-(--color-bright)">{title}</h2>
          <Button variant="ghost" onClick={onClose} className="shrink-0 px-2">
            Close
          </Button>
        </div>

        {folders.length > 0 ? (
          <ul className="space-y-1.5">
            {folders.map((folder) => (
              <li key={folder.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPick({ folderId: folder.id })}
                  className={`flex min-h-12 w-full items-center justify-between rounded-xl border px-3 text-left text-sm disabled:opacity-40 ${
                    folder.id === currentFolderId
                      ? "border-(--color-beacon)/40 bg-(--color-beacon-soft) text-(--color-bright)"
                      : "border-(--color-card-edge) bg-(--color-ink-soft) text-(--color-mist)"
                  }`}
                >
                  <span className="truncate">{folder.name}</span>
                  <Pill>{folder.count}</Pill>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-(--color-fog)">No folders yet — name the first one.</p>
        )}

        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = newName.trim();
            if (!value) return;
            setNewName("");
            onPick({ newFolderName: value });
          }}
        >
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="New folder…"
            aria-label="New folder name"
            maxLength={60}
            enterKeyHint="done"
            className="min-h-12 w-full rounded-xl border border-(--color-card-edge) bg-(--color-ink-soft) px-3 text-base text-(--color-bright) placeholder:text-(--color-fog) focus:outline-none"
          />
          <Button type="submit" disabled={busy || !newName.trim()} className="shrink-0">
            Create
          </Button>
        </form>
      </div>
    </div>
  );
}
