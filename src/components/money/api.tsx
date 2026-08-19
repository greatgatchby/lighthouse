// Client-side mirror of the finance HTTP API contract. Nothing here touches
// the database — the money UI talks to /api/finance/* only, so the backend can
// evolve behind the contract without the pages caring.

export type Cadence = "weekly" | "monthly" | "yearly" | "unknown";
export type RecurringStatus = "active" | "graveyard" | "dismissed" | "cancelled";
export type RecurringKind = "subscription" | "bill" | "income" | "other";
export type ImpulseAction = "happy" | "returning" | "reflect";

export interface SafeToSpendDto {
  perDay: number;
  balance: number;
  committed: number;
  daysToPayday: number;
  paydayDate: string;
  hasData: boolean;
}

export interface AccountRow {
  id: string;
  name: string;
  provider: string;
  balance: number;
  isPrimary: boolean;
}

export interface PotRow {
  id: string;
  name: string;
  balance: number;
  goalAmount: number | null;
}

export interface CategorySpend {
  slug: string;
  name: string;
  spentPence: number;
  budgetPence: number | null;
  impulse: boolean;
}

export interface FinanceSummary {
  safeToSpend: SafeToSpendDto;
  accounts: AccountRow[];
  pots: PotRow[];
  month: {
    spentByCategory: CategorySpend[];
    totalSpentPence: number;
    totalInPence: number;
  };
}

export interface TransactionRow {
  id: string;
  postedAt: string;
  description: string;
  amountPence: number;
  merchant: string | null;
  categorySlug: string | null;
  categoryName: string | null;
  declined: boolean;
}

export interface TransactionsPage {
  rows: TransactionRow[];
  nextBefore: string | null;
}

export interface RecurringRow {
  id: string;
  name: string;
  amountPence: number;
  cadence: Cadence;
  dayOfMonth: number | null;
  lastSeenAt: string | null;
  nextExpectedAt: string | null;
  status: RecurringStatus;
  kind: RecurringKind;
}

export interface RecurringResponse {
  active: RecurringRow[];
  graveyard: RecurringRow[];
  monthlyTotalPence: number;
  graveyardMonthlyPence: number;
}

export interface PotDepositResponse {
  potId?: string;
  potBalance?: number;
  accountBalance?: number;
}

/** Fetch JSON, surfacing the API's own { error } string when it fails. */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && typeof init.body === "string" && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let message = "That didn’t go through — try again in a moment.";
    try {
      const body: unknown = await res.json();
      if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
        message = (body as { error: string }).error;
      }
    } catch {
      // non-JSON error body; keep the calm default
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/** Amounts arrive as signed pence (negative = money out); display magnitudes. */
export function magnitude(pence: number): number {
  return Math.abs(pence);
}

export function cadenceLabel(cadence: Cadence): string {
  if (cadence === "weekly") return "/week";
  if (cadence === "yearly") return "/year";
  if (cadence === "monthly") return "/month";
  return "";
}

/** Normalise any cadence to a per-month magnitude, for "won back" tallies. */
export function monthlyEquivalent(amountPence: number, cadence: Cadence): number {
  const abs = Math.abs(amountPence);
  if (cadence === "weekly") return Math.round((abs * 52) / 12);
  if (cadence === "yearly") return Math.round(abs / 12);
  return abs;
}

export function isImpulseAction(value: string | undefined): value is ImpulseAction {
  return value === "happy" || value === "returning" || value === "reflect";
}
