import { and, eq, sql as dsql } from "drizzle-orm";
import { db, tables } from "@/db";
import { env } from "@/lib/env";

// Lunchflow — the long-term backstop behind Monzo's rolling 90 days.
//
// Its API is undocumented as far as we're concerned, so this module assumes
// nothing: every field is probed across the names it plausibly uses, amounts
// are accepted as either pence integers or pound decimals, and the FIRST
// successful response from each endpoint is dumped (truncated) into audit_log
// under "lunchflow:shape" so the real shape can be read off later and this
// file tightened up.
//
// Monzo is always canonical — anything here that pairs with a Monzo row gets
// superseded by it (see the lunchflow-sync job).

// The apex domain 308-redirects to www on every request. Custom headers do
// survive the hop, but pinning www avoids a wasted round-trip per call and any
// client that would drop x-api-key across hosts.
const BASE = "https://www.lunchflow.app/api/v1";
const SHAPE_KIND = "lunchflow:shape";
const MAX_SHAPE_BYTES = 4096;

export class LunchflowError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "LunchflowError";
    this.status = status;
  }
}

export interface LunchflowAccount {
  id: string;
  name: string;
  balancePence: number | null;
  currency: string | null;
  raw: Record<string, unknown>;
}

export interface LunchflowTransaction {
  id: string;
  accountId: string | null;
  postedAt: Date;
  amountPence: number;
  description: string;
  merchantName: string | null;
  categoryHint: string | null;
  declined: boolean;
  raw: Record<string, unknown>;
}

export function isEnabled(): boolean {
  return Boolean(env.lunchflowApiKey);
}

// ------------------------------------------------------------- shape logging

async function recordShapeOnce(endpoint: string, payload: unknown): Promise<void> {
  try {
    const [seen] = await db
      .select({ id: tables.auditLog.id })
      .from(tables.auditLog)
      .where(
        and(
          eq(tables.auditLog.kind, SHAPE_KIND),
          dsql`${tables.auditLog.detail}->>'endpoint' = ${endpoint}`,
        ),
      )
      .limit(1);
    if (seen) return;

    let body = "";
    try {
      body = JSON.stringify(payload);
    } catch {
      body = String(payload);
    }
    await db.insert(tables.auditLog).values({
      kind: SHAPE_KIND,
      detail: {
        endpoint,
        truncated: body.length > MAX_SHAPE_BYTES,
        body: body.slice(0, MAX_SHAPE_BYTES),
      },
    });
  } catch (err) {
    // shape logging is a convenience, never a reason to fail a sync
    console.error("[lunchflow] could not record shape:", err);
  }
}

// ---------------------------------------------------------------- transport

async function request(path: string): Promise<{ status: number; body: unknown }> {
  if (!env.lunchflowApiKey) throw new LunchflowError("LUNCHFLOW_API_KEY is not set", 0);
  const response = await fetch(`${BASE}${path}`, {
    headers: { "x-api-key": env.lunchflowApiKey, accept: "application/json" },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const detail = typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body ?? {}).slice(0, 200);
    throw new LunchflowError(`Lunchflow ${path} ${response.status}: ${detail}`, response.status);
  }
  return { status: response.status, body };
}

// ------------------------------------------------------------------- probing

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Find the array of records inside whatever envelope the API used. */
function listOf(body: unknown, keys: string[]): Dict[] {
  if (Array.isArray(body)) return body.filter(isDict);
  if (!isDict(body)) return [];
  for (const key of [...keys, "data", "items", "results", "records"]) {
    const value = body[key];
    if (Array.isArray(value)) return value.filter(isDict);
  }
  // single nested envelope: { data: { transactions: [...] } }
  for (const value of Object.values(body)) {
    if (Array.isArray(value)) return value.filter(isDict);
    if (isDict(value)) {
      for (const inner of Object.values(value)) {
        if (Array.isArray(inner)) return inner.filter(isDict);
      }
    }
  }
  return [];
}

function pickString(row: Dict, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    // nested objects: { merchant: { name: "..." } }
    if (isDict(value)) {
      const nested = pickString(value, ["name", "display_name", "displayName", "title"]);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Amounts arrive as either integer pence or a pounds decimal — a non-integer
 * number (or a string with a decimal point) means pounds.
 */
export function parseAmountPence(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? value : Math.round(value * 100);
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[£$€,\s]/g, "").trim();
    if (!cleaned) return null;
    const negative = /^\(.*\)$/.test(cleaned);
    const numeric = Number(cleaned.replace(/[()]/g, ""));
    if (!Number.isFinite(numeric)) return null;
    const pence = cleaned.includes(".") ? Math.round(numeric * 100) : Math.round(numeric);
    return negative ? -Math.abs(pence) : pence;
  }
  return null;
}

export function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) {
    // seconds vs milliseconds epoch
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value.trim());
    if (!Number.isNaN(date.getTime())) return date;
    // bare YYYY-MM-DD already parses; anything else we leave alone
  }
  return null;
}

const AMOUNT_KEYS = ["amount", "amount_pence", "amountPence", "value", "amount_cents", "pence"];
const DATE_KEYS = [
  "date",
  "posted_at",
  "postedAt",
  "created",
  "created_at",
  "createdAt",
  "booked_at",
  "bookedAt",
  "timestamp",
  "transaction_date",
];
const DESCRIPTION_KEYS = ["description", "merchant", "name", "payee", "title", "counterparty"];

function firstValue(row: Dict, keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return undefined;
}

function parseAccount(row: Dict): LunchflowAccount | null {
  const id = pickString(row, ["id", "accountId", "account_id", "uuid", "external_id"]);
  if (!id) return null;
  const balanceRaw = firstValue(row, ["balance", "balance_pence", "current_balance", "amount"]);
  return {
    id,
    name:
      pickString(row, ["name", "display_name", "displayName", "nickname", "description", "title"]) ??
      `Lunchflow ${id.slice(0, 6)}`,
    balancePence: parseAmountPence(balanceRaw),
    currency: pickString(row, ["currency", "iso_currency_code"]),
    raw: row,
  };
}

/** Some APIs signal direction separately from the sign of the amount. */
function directionSign(row: Dict): -1 | 1 | 0 {
  const direction = pickString(row, ["direction", "type", "transaction_type", "flow"])?.toLowerCase();
  if (!direction) return 0;
  if (/debit|out|outgoing|withdraw|spend|payment/.test(direction)) return -1;
  if (/credit|in\b|incoming|deposit|refund|income/.test(direction)) return 1;
  return 0;
}

function parseTransaction(row: Dict, fallbackAccountId: string | null): LunchflowTransaction | null {
  const id = pickString(row, ["id", "transaction_id", "transactionId", "uuid", "external_id"]);
  const postedAt = parseDate(firstValue(row, DATE_KEYS));
  const amountRaw = firstValue(row, AMOUNT_KEYS);
  let amountPence = parseAmountPence(amountRaw);
  if (!id || !postedAt || amountPence === null) return null;

  const sign = directionSign(row);
  if (sign !== 0) amountPence = sign * Math.abs(amountPence);

  const merchantName = pickString(row, ["merchant", "merchant_name", "payee", "counterparty"]);
  const description = pickString(row, DESCRIPTION_KEYS) ?? merchantName ?? "Transaction";
  const declinedRaw = firstValue(row, ["declined", "is_declined", "decline_reason", "status"]);
  const declined =
    declinedRaw === true ||
    (typeof declinedRaw === "string" && /declin|fail|revers/i.test(declinedRaw));

  return {
    id,
    accountId:
      pickString(row, ["account_id", "accountId", "account"]) ?? fallbackAccountId ?? null,
    postedAt,
    amountPence,
    description,
    merchantName,
    categoryHint: pickString(row, ["category", "category_name", "categoryName"]),
    declined,
    raw: row,
  };
}

// -------------------------------------------------------------------- calls

export async function listAccounts(): Promise<LunchflowAccount[]> {
  const { body } = await request("/accounts");
  await recordShapeOnce("/accounts", body);
  return listOf(body, ["accounts"])
    .map(parseAccount)
    .filter((a): a is LunchflowAccount => a !== null);
}

/**
 * Transactions for one account. The documented-ish query form is tried first;
 * a 404 falls back to the nested collection path.
 */
export async function listTransactions(accountId: string): Promise<LunchflowTransaction[]> {
  const query = `/transactions?account_id=${encodeURIComponent(accountId)}`;
  let body: unknown;
  let endpoint = query;
  try {
    ({ body } = await request(query));
  } catch (err) {
    if (err instanceof LunchflowError && err.status === 404) {
      endpoint = `/accounts/{id}/transactions`;
      ({ body } = await request(`/accounts/${encodeURIComponent(accountId)}/transactions`));
    } else {
      throw err;
    }
  }
  await recordShapeOnce(endpoint === query ? "/transactions" : endpoint, body);
  return listOf(body, ["transactions"])
    .map((row) => parseTransaction(row, accountId))
    .filter((t): t is LunchflowTransaction => t !== null);
}

/** Mirror connection state so Settings can show Lunchflow as active. */
export async function markConnectionState(status: "active" | "error"): Promise<void> {
  const values = {
    provider: "lunchflow" as const,
    status,
    updatedAt: new Date(),
  };
  await db
    .insert(tables.providerConnections)
    .values({ ...values, authorizedAt: new Date() })
    .onConflictDoUpdate({
      target: tables.providerConnections.provider,
      set: { status: values.status, updatedAt: values.updatedAt },
    });
}
