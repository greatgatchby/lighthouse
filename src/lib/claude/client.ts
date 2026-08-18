import Anthropic from "@anthropic-ai/sdk";
import { db, tables } from "@/db";
import { env } from "@/lib/env";

export const MODEL = "claude-opus-5";

// Server-side refusal fallbacks (on by default for interactive calls; the
// Batches API rejects the parameter, so batch jobs don't use it).
export const FALLBACK_BETAS = ["server-side-fallback-2026-07-01"];
export const FALLBACKS = "default" as const;

const globalForClaude = globalThis as unknown as { __anthropic?: Anthropic };

export function claude(): Anthropic {
  if (!globalForClaude.__anthropic) {
    globalForClaude.__anthropic = new Anthropic({ apiKey: env.anthropicApiKey });
  }
  return globalForClaude.__anthropic;
}

/** Record token usage (and cache behaviour) to the audit log — the plan's
 * "verify cache_read_input_tokens > 0" check reads from here. */
export async function logUsage(
  kind: string,
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  } | null | undefined,
) {
  if (!usage) return;
  try {
    await db.insert(tables.auditLog).values({
      kind: `claude:${kind}`,
      detail: {
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        cacheWrite: usage.cache_creation_input_tokens ?? 0,
      },
    });
  } catch {
    // usage logging must never break the request
  }
}
