# Lighthouse — working notes

Private, self-hosted life-management PWA for one person. Next.js 16 (App Router) + Postgres 17 +
Drizzle + pg-boss, one image running as `app` and `worker`. See README.md for setup and ops.

## Non-negotiables

- **Money is integer pence everywhere.** Negative = money out. Format with `formatMoney` from
  `src/lib/format.ts` (whole pounds by default — the calm number).
- **Claude never moves money.** `move_money_to_pot` writes to `pending_confirmations` and returns a
  proposal. Only `POST /api/confirm` with an explicit tap executes. Don't add a tool that bypasses this.
- **No red in the UI.** Overspend, expiry, failure — all amber (`--color-amber-warn`) with a
  re-plan action. Copy is never guilt-framed: losses are "wins to reclaim", parking a goal is
  neutral, streaks never reset to zero.
- **Monzo's history window is one-shot.** The OAuth callback enqueues `monzo-backfill`
  synchronously; full history is only available for ~5 minutes after authorisation. Never make that
  path lazy or fire-and-forget.
- **Push payloads must be self-contained.** The service worker renders notifications with no
  network access — that's what makes push work off the tailnet. Never make `sw.js` fetch to build a
  notification.
- **The cached prompt prefix must be frozen.** `buildStableContext()` output feeds a
  `cache_control` block: no dates, no timestamps, no randomness, deterministic ordering. Volatile
  content goes in `buildVolatileContext()`, after the breakpoint.

## Conventions

- Path alias `@/*` → `src/*`. Import the DB as `import { db, tables } from "@/db"`.
- Next 16: `cookies()`, `params` and `searchParams` are **async** — await them. Middleware is
  `src/proxy.ts` exporting `proxy` (renamed from `middleware` in v16).
- Every `/api` route starts with `await requireUserId()`. Exceptions, by design: `/api/auth/*`
  and `/api/webhooks/*` (the latter authenticates by path secret and treats the body as untrusted).
- pg-boss v12 uses **named exports** (`import { PgBoss, type Job } from "pg-boss"`) and hands
  `work()` handlers an **array** of jobs. Queues live in `src/lib/queues.ts`; add a job by creating
  `src/worker/jobs/<name>.ts` with a default-exported `JobDefinition` and registering it in
  `jobs/index.ts`.
- Tailwind 4, CSS-first. Use the token syntax: `text-(--color-fog)`, `bg-(--color-card)`. Palette
  and radii are defined in `src/app/globals.css`.
- UI primitives live in `src/components/ui.tsx` (`Card`, `Button`, `Pill`, `BigNumber`,
  `SectionTitle`, `EmptyState`). Match the existing pages rather than inventing new patterns.
- Claude calls: model `claude-opus-5` via `claude()`; structured output via `messages.parse()` +
  `zodOutputFormat`; always `logUsage(kind, response.usage)`. No `budget_tokens`, no `temperature`
  (both rejected on this model). Batch work uses the Batches API (no `fallbacks` there).

## Verification

```bash
pnpm typecheck && pnpm build && pnpm smoke
```

`pnpm smoke` needs a live `DATABASE_URL`; it seeds `SMOKE_`-prefixed rows and cleans up after
itself. It asserts the dedupe invariants (1:1 cross-provider pairing, identical real purchases both
surviving), safe-to-spend, energy-aware goal ranking, and document FTS.
