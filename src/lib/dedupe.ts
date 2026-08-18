import { createHash } from "node:crypto";
import { localDay, normaliseMerchant } from "./format";

// Cross-provider dedupe. The key is a *candidate* index, not a uniqueness
// guarantee — two identical coffees on the same day are two real transactions.
// Pairing is one-to-one: a canonical (Monzo) row absorbs at most one twin,
// enforced by the partial unique index on transactions.superseded_by.

export function dedupeKey(input: {
  day: string; // local YYYY-MM-DD
  amount: number; // pence, signed
  merchant: string; // raw merchant or description
}): string {
  const normalised = normaliseMerchant(input.merchant);
  return createHash("sha256")
    .update(`${input.day}|${input.amount}|${normalised}`)
    .digest("hex");
}

export function dedupeKeyForDate(postedAt: Date, amount: number, merchant: string, timezone?: string) {
  return dedupeKey({ day: localDay(postedAt, timezone), amount, merchant });
}

/** Candidate keys for pairing: same day plus the two adjacent days. */
export function dedupeCandidateKeys(
  postedAt: Date,
  amount: number,
  merchant: string,
  timezone?: string,
): string[] {
  const days = [-1, 0, 1].map((offset) =>
    localDay(new Date(postedAt.getTime() + offset * 86400_000), timezone),
  );
  return [...new Set(days)].map((day) => dedupeKey({ day, amount, merchant }));
}
