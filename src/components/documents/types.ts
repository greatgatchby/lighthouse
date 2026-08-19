// Client-side contract for the documents vertical. Plain JSON only — the page
// hands these down from the server, the API routes hand the same shapes back,
// so a folder move can patch the list in place without a round trip to the DB.

export type DocStatus = "pending" | "extracted" | "failed";

export interface DocTransaction {
  id: string;
  description: string;
  amountPence: number;
  postedAt: string;
}

export interface DocRow {
  id: string;
  filename: string;
  mimeType: string;
  status: DocStatus;
  title: string | null;
  docType: string | null;
  issuer: string | null;
  /** YYYY-MM-DD */
  issuedAt: string | null;
  /** YYYY-MM-DD */
  expiresAt: string | null;
  amountPence: number | null;
  reference: string | null;
  summary: string | null;
  tags: string[];
  folderId: string | null;
  folderName: string | null;
  proposedFolderName: string | null;
  filedAt: string | null;
  createdAt: string;
  error: string | null;
  transaction: DocTransaction | null;
}

export interface FolderRow {
  id: string;
  name: string;
  count: number;
}

/** Whole days from `today` (YYYY-MM-DD) to `day`; negative once it's past. */
export function daysUntil(day: string, today: string): number | null {
  const target = Date.parse(`${day}T00:00:00Z`);
  const from = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(target) || Number.isNaN(from)) return null;
  return Math.round((target - from) / 86_400_000);
}

/** "12 Mar 2026" from a YYYY-MM-DD string — no timezone surprises. */
export function formatDay(day: string): string {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed)) return day;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(parsed));
}

/** Calm expiry wording — a heads-up, never an alarm. */
export function expiryLabel(days: number): string {
  if (days < 0) return `expired ${Math.abs(days)}d ago`;
  if (days === 0) return "expires today";
  if (days === 1) return "expires tomorrow";
  if (days < 45) return `${days}d left`;
  const months = Math.round(days / 30);
  return `${months}mo left`;
}

export function docLabel(doc: DocRow): string {
  return doc.title?.trim() || doc.filename;
}
