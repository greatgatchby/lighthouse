// Monzo provider — CONTRACT STUB. The finance vertical replaces this file
// entirely; these signatures are already imported elsewhere, keep them:
//
//   depositToPot        <- app/api/confirm/route.ts (guardrail executor)
//   monzoAuthUrl        <- app/api/oauth/monzo/start
//   exchangeCode        <- app/api/oauth/monzo/callback
//   getAccessToken      <- everything hitting the Monzo API (auto-refresh inside)
//
// Implementation notes for the finance vertical:
// - Confidential client; tokens AES-encrypted at rest via lib/crypto into
//   provider_connections (provider = 'monzo').
// - The OAuth callback must SYNCHRONOUSLY enqueue the monzo-backfill job —
//   full history is only available for ~5 minutes after authorization.
// - Pot deposits: PUT /pots/{id}/deposit with a dedupe_id (idempotency).

export interface PotDepositInput {
  monzoPotId: string;
  amountPence: number;
  /** idempotency key — reuse the proposal id */
  dedupeId: string;
}

export async function depositToPot(_input: PotDepositInput): Promise<void> {
  throw new Error("Monzo is not connected yet — connect it in Settings first.");
}

export function monzoAuthUrl(_state: string): string {
  throw new Error("Monzo provider not implemented");
}

export async function exchangeCode(_code: string): Promise<void> {
  throw new Error("Monzo provider not implemented");
}

export async function getAccessToken(): Promise<string> {
  throw new Error("Monzo provider not implemented");
}
