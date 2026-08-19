import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { db, tables } from "@/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";

// Monzo — confidential OAuth client.
//
// Tokens live AES-encrypted in provider_connections (provider = 'monzo').
// Two facts shape everything here:
//   1. Full transaction history is only readable for ~5 minutes after auth;
//      after that Monzo serves a rolling 90 days. The OAuth callback enqueues
//      monzo-backfill synchronously — never lazily.
//   2. After the OAuth dance the user must still approve access *inside the
//      Monzo app* (SCA). Until they do, every call 403s with
//      `forbidden.insufficient_permissions`, which we surface as
//      MonzoForbiddenError so the backfill can wait it out.

const API = "https://api.monzo.com";
const AUTH = "https://auth.monzo.com/";

/** Refresh when the access token has less than this left. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export const MONZO_STATE_COOKIE = "lh_monzo_state";

export class MonzoError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "MonzoError";
    this.status = status;
    this.code = code;
  }
}

/** 403 forbidden.insufficient_permissions — waiting on in-app approval. */
export class MonzoForbiddenError extends MonzoError {
  constructor(message = "Monzo access not approved in the app yet", code?: string) {
    super(message, 403, code);
    this.name = "MonzoForbiddenError";
  }
}

export class MonzoNotConnectedError extends Error {
  constructor() {
    // surfaced verbatim to the user by /api/confirm
    super("Monzo is not connected yet — connect it in Settings first.");
    this.name = "MonzoNotConnectedError";
  }
}

// ---------------------------------------------------------------- API shapes

export interface MonzoAccountRaw {
  id: string;
  closed?: boolean;
  created?: string;
  description?: string;
  type?: string;
  currency?: string;
  account_number?: string;
  sort_code?: string;
  owner_type?: string;
}

export interface MonzoMerchantRaw {
  id?: string;
  name?: string;
  logo?: string;
  category?: string;
  emoji?: string;
}

export interface MonzoTransactionRaw {
  id: string;
  account_id?: string;
  created: string;
  settled?: string | null;
  amount: number;
  currency?: string;
  description?: string;
  notes?: string;
  category?: string;
  decline_reason?: string | null;
  merchant?: MonzoMerchantRaw | string | null;
  metadata?: Record<string, unknown>;
  scheme?: string;
  [key: string]: unknown;
}

export interface MonzoPotRaw {
  id: string;
  name: string;
  style?: string;
  balance: number;
  currency?: string;
  goal_amount?: number | null;
  deleted?: boolean;
}

export interface PotDepositInput {
  monzoPotId: string;
  amountPence: number;
  /** idempotency key — reuse the proposal id */
  dedupeId: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  user_id?: string;
  client_id?: string;
}

// ------------------------------------------------------------ oauth (state)

function stateSecret(): Uint8Array {
  return new TextEncoder().encode(env.sessionSecret);
}

/**
 * Short-lived signed CSRF state for the Monzo redirect. Deliberately its own
 * helper (and its own cookie) — the WebAuthn challenge cookie has a different
 * lifetime and purpose and must not be reused here.
 */
export async function createOauthState(): Promise<{ state: string; token: string }> {
  const state = randomBytes(24).toString("base64url");
  const token = await new SignJWT({ state, purpose: "monzo-oauth" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(stateSecret());
  return { state, token };
}

export async function verifyOauthState(
  token: string | undefined,
  state: string | null,
): Promise<boolean> {
  if (!token || !state) return false;
  try {
    const { payload } = await jwtVerify(token, stateSecret());
    return payload.purpose === "monzo-oauth" && payload.state === state;
  } catch {
    return false;
  }
}

export function monzoAuthUrl(state: string): string {
  if (!env.monzoClientId) throw new Error("MONZO_CLIENT_ID is not set");
  const params = new URLSearchParams({
    client_id: env.monzoClientId,
    redirect_uri: env.monzoRedirectUri,
    response_type: "code",
    state,
  });
  return `${AUTH}?${params.toString()}`;
}

// ---------------------------------------------------------------- token store

type ConnectionRow = typeof tables.providerConnections.$inferSelect;

export async function getConnection(): Promise<ConnectionRow | null> {
  const [row] = await db
    .select()
    .from(tables.providerConnections)
    .where(eq(tables.providerConnections.provider, "monzo"))
    .limit(1);
  return row ?? null;
}

export async function isConnected(): Promise<boolean> {
  const row = await getConnection();
  return Boolean(row?.accessTokenEnc) && row?.status !== "revoked";
}

async function storeTokens(token: TokenResponse, meta: Record<string, unknown> = {}) {
  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000)
    : null;
  const existing = await getConnection();
  const nextMeta = { ...(existing?.meta ?? {}), ...meta };
  if (token.user_id) nextMeta.userId = token.user_id;

  const values = {
    provider: "monzo" as const,
    accessTokenEnc: encrypt(token.access_token),
    // Monzo rotates refresh tokens on every refresh — always keep the newest
    refreshTokenEnc: token.refresh_token ? encrypt(token.refresh_token) : existing?.refreshTokenEnc,
    expiresAt,
    status: "active" as const,
    meta: nextMeta,
    updatedAt: new Date(),
  };

  await db
    .insert(tables.providerConnections)
    .values({ ...values, authorizedAt: existing?.authorizedAt ?? new Date() })
    .onConflictDoUpdate({ target: tables.providerConnections.provider, set: values });
}

async function markStatus(status: "expired" | "revoked" | "error") {
  await db
    .update(tables.providerConnections)
    .set({ status, updatedAt: new Date() })
    .where(eq(tables.providerConnections.provider, "monzo"));
}

async function postForm(path: string, body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new MonzoError(`Monzo token endpoint ${response.status}: ${text.slice(0, 300)}`, response.status);
  }
  return JSON.parse(text) as TokenResponse;
}

/** OAuth callback: authorization_code -> tokens, stored encrypted. */
export async function exchangeCode(code: string): Promise<void> {
  if (!env.monzoClientId || !env.monzoClientSecret) {
    throw new Error("MONZO_CLIENT_ID / MONZO_CLIENT_SECRET are not set");
  }
  const token = await postForm("/oauth2/token", {
    grant_type: "authorization_code",
    client_id: env.monzoClientId,
    client_secret: env.monzoClientSecret,
    redirect_uri: env.monzoRedirectUri,
    code,
  });
  await storeTokens(token, { authorizedAt: new Date().toISOString() });
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  if (!env.monzoClientId || !env.monzoClientSecret) {
    throw new Error("MONZO_CLIENT_ID / MONZO_CLIENT_SECRET are not set");
  }
  try {
    const token = await postForm("/oauth2/token", {
      grant_type: "refresh_token",
      client_id: env.monzoClientId,
      client_secret: env.monzoClientSecret,
      refresh_token: refreshToken,
    });
    await storeTokens(token);
    return token.access_token;
  } catch (err) {
    await markStatus("expired");
    throw err;
  }
}

/** Current access token, refreshed in place when it is close to expiring. */
export async function getAccessToken(): Promise<string> {
  const row = await getConnection();
  if (!row?.accessTokenEnc) throw new MonzoNotConnectedError();

  const expiresAt = row.expiresAt?.getTime() ?? 0;
  const stale = expiresAt > 0 && expiresAt - Date.now() < REFRESH_MARGIN_MS;
  if (stale && row.refreshTokenEnc) {
    return refreshAccessToken(decrypt(row.refreshTokenEnc));
  }
  return decrypt(row.accessTokenEnc);
}

// ------------------------------------------------------------------- fetching

interface MonzoFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH";
  query?: Record<string, string | number | undefined>;
  /** repeated params, e.g. expand[]=merchant */
  repeated?: Array<[string, string]>;
  form?: Record<string, string>;
}

async function monzoFetch<T>(path: string, options: MonzoFetchOptions = {}): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  for (const [key, value] of options.repeated ?? []) url.searchParams.append(key, value);

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: options.form ? new URLSearchParams(options.form).toString() : undefined,
  });

  const text = await response.text();
  if (!response.ok) {
    let code: string | undefined;
    let message = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { code?: string; message?: string };
      code = parsed.code;
      if (parsed.message) message = parsed.message;
    } catch {
      // non-JSON error body — keep the raw snippet
    }
    if (response.status === 403) throw new MonzoForbiddenError(message, code);
    if (response.status === 401) {
      await markStatus("expired");
      throw new MonzoError(`Monzo unauthorised: ${message}`, 401, code);
    }
    throw new MonzoError(`Monzo ${path} ${response.status}: ${message}`, response.status, code);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export async function listAccounts(): Promise<MonzoAccountRaw[]> {
  const data = await monzoFetch<{ accounts?: MonzoAccountRaw[] }>("/accounts");
  return (data.accounts ?? []).filter((a) => !a.closed);
}

export async function getBalance(accountId: string): Promise<{ balance: number; currency?: string }> {
  return monzoFetch<{ balance: number; currency?: string }>("/balance", {
    query: { account_id: accountId },
  });
}

export async function listPots(currentAccountId: string): Promise<MonzoPotRaw[]> {
  const data = await monzoFetch<{ pots?: MonzoPotRaw[] }>("/pots", {
    query: { current_account_id: currentAccountId },
  });
  return data.pots ?? [];
}

/**
 * One page of transactions. `since` is either an RFC3339 timestamp or a
 * transaction id — paginating by the previous page's last id avoids the
 * duplicate/skip problems that same-millisecond timestamps cause.
 */
export async function listTransactions(input: {
  accountId: string;
  since?: string;
  before?: string;
  limit?: number;
}): Promise<MonzoTransactionRaw[]> {
  const data = await monzoFetch<{ transactions?: MonzoTransactionRaw[] }>("/transactions", {
    query: {
      account_id: input.accountId,
      since: input.since,
      before: input.before,
      limit: input.limit ?? 100,
    },
    repeated: [["expand[]", "merchant"]],
  });
  return data.transactions ?? [];
}

/** RFC3339 without milliseconds — what Monzo's `since` expects. */
export function rfc3339(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ------------------------------------------------------------- local mirrors

/** The account money actually moves from: the primary uk_retail current account. */
export async function primaryMonzoAccount() {
  const [primary] = await db
    .select()
    .from(tables.accounts)
    .where(
      and(
        eq(tables.accounts.provider, "monzo"),
        eq(tables.accounts.isPrimary, true),
        eq(tables.accounts.closed, false),
      ),
    )
    .limit(1);
  if (primary) return primary;
  const [fallback] = await db
    .select()
    .from(tables.accounts)
    .where(and(eq(tables.accounts.provider, "monzo"), eq(tables.accounts.closed, false)))
    .limit(1);
  return fallback ?? null;
}

/** Refresh balances for every stored Monzo account. */
export async function refreshBalances(): Promise<void> {
  const rows = await db
    .select()
    .from(tables.accounts)
    .where(and(eq(tables.accounts.provider, "monzo"), eq(tables.accounts.closed, false)));

  for (const row of rows) {
    try {
      const balance = await getBalance(row.providerAccountId);
      await db
        .update(tables.accounts)
        .set({ balance: balance.balance, balanceUpdatedAt: new Date() })
        .where(eq(tables.accounts.id, row.id));
    } catch (err) {
      if (err instanceof MonzoForbiddenError) throw err;
      console.error(`[monzo] balance refresh failed for ${row.name}:`, err);
    }
  }
}

/** Refresh pots for the primary current account. */
export async function refreshPots(): Promise<void> {
  const account = await primaryMonzoAccount();
  if (!account) return;
  const pots = await listPots(account.providerAccountId);
  for (const pot of pots) {
    await upsertPotRow(pot);
  }
}

async function upsertPotRow(pot: MonzoPotRaw): Promise<void> {
  const values = {
    monzoPotId: pot.id,
    name: pot.name,
    balance: pot.balance ?? 0,
    goalAmount: pot.goal_amount ?? null,
    style: pot.style ?? null,
    deleted: pot.deleted ?? false,
    updatedAt: new Date(),
  };
  await db
    .insert(tables.pots)
    .values(values)
    .onConflictDoUpdate({
      target: tables.pots.monzoPotId,
      set: {
        name: values.name,
        balance: values.balance,
        goalAmount: values.goalAmount,
        style: values.style,
        deleted: values.deleted,
        updatedAt: values.updatedAt,
      },
    });
}

export async function refreshBalancesAndPots(): Promise<void> {
  await refreshBalances();
  await refreshPots();
}

/**
 * Move money into a pot. Only ever called after an explicit human tap
 * (/api/confirm) or a direct user action (/api/finance/pots/deposit) —
 * Claude never reaches this function on its own.
 */
export async function depositToPot(input: PotDepositInput): Promise<void> {
  if (!Number.isInteger(input.amountPence) || input.amountPence <= 0) {
    throw new Error("Deposit amount must be a positive whole number of pence");
  }
  const account = await primaryMonzoAccount();
  if (!account) throw new MonzoNotConnectedError();

  const pot = await monzoFetch<MonzoPotRaw>(`/pots/${encodeURIComponent(input.monzoPotId)}/deposit`, {
    method: "PUT",
    form: {
      source_account_id: account.providerAccountId,
      amount: String(input.amountPence),
      dedupe_id: input.dedupeId,
    },
  });

  await upsertPotRow(pot);

  // the money left the current account — reflect that immediately
  try {
    const balance = await getBalance(account.providerAccountId);
    await db
      .update(tables.accounts)
      .set({ balance: balance.balance, balanceUpdatedAt: new Date() })
      .where(eq(tables.accounts.id, account.id));
  } catch {
    await db
      .update(tables.accounts)
      .set({ balance: account.balance - input.amountPence, balanceUpdatedAt: new Date() })
      .where(eq(tables.accounts.id, account.id));
  }
}
