# Lighthouse 🗼

A private, self-hosted life-management PWA. Money first (Monzo + Lunchflow), then documents,
goals, food, movement and reading — with Claude as the intelligence layer throughout.

Built for an ADHD brain: **interest- and excitement-driven, never discipline-driven**. Nothing in
this app is a failure state. There is no red anywhere — overspend is amber with a re-plan.

---

## Quick start

```bash
cp .env.example .env          # then fill it in (see below)
pnpm install
pnpm vapid                    # prints VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY → paste into .env
docker compose up -d --build  # postgres + migrate + app + worker
pnpm seed                     # 25 spending categories (DATABASE_URL must point at the DB)
```

Then expose it over your tailnet with TLS (no Caddy, no certs to manage):

```bash
tailscale serve --bg 3000
# → https://<machine>.<tailnet>.ts.net
```

Set `APP_URL` in `.env` to that exact HTTPS hostname **before first use** — passkeys are bound to
the hostname, so changing it later invalidates them.

### Local development

```bash
docker compose up -d postgres  # exposes 127.0.0.1:5433 (5432 is often taken)
export DATABASE_URL=postgres://lighthouse:lighthouse@127.0.0.1:5433/lighthouse
pnpm db:migrate && pnpm seed
pnpm dev            # app
pnpm worker         # jobs, in a second terminal
```

Passkeys require a secure context. `http://localhost:3000` counts as one, so local dev works.

---

## Environment

| Variable | What it's for |
|---|---|
| `APP_URL` | Public HTTPS origin. **Passkeys are bound to this hostname.** |
| `DATABASE_URL` | Postgres 17 connection string |
| `SESSION_SECRET` | Signs session + WebAuthn challenge cookies (`openssl rand -hex 32`) |
| `TOKEN_ENC_KEY` | AES-256-GCM key for provider tokens at rest — **exactly 32 bytes of hex** |
| `ANTHROPIC_API_KEY` | Chat, digest, categorisation, document extraction |
| `VAPID_*` | Web push (`pnpm vapid`); `VAPID_SUBJECT` is a `mailto:` |
| `MONZO_CLIENT_ID` / `_SECRET` | **Confidential** client from developers.monzo.com — a non-confidential client gets no refresh token and you re-auth constantly |
| `MONZO_REDIRECT_URI` | Must exactly match Monzo's registered value: `${APP_URL}/api/oauth/monzo/callback` |
| `MONZO_WEBHOOK_SECRET` | Path secret for the optional real-time webhook (`openssl rand -hex 32`) |
| `LUNCHFLOW_API_KEY` | Nightly Lunchflow sync (long-term history backstop) |
| `APP_TZ` | Day boundaries and cron timezone (default `Europe/London`) |

Losing `TOKEN_ENC_KEY` means re-authorising Monzo. Back it up with your password manager, not in git.

---

## Architecture

```
docker compose
├─ postgres   Postgres 17 (pgdata volume)
├─ migrate    one-shot: applies drizzle migrations, then exits
├─ app        Next.js standalone (node server.js)
└─ worker     same image, node worker.js — every scheduled + queued job
```

One TypeScript codebase, one image, three commands. `pg-boss` runs the job queue *inside* Postgres,
so there's no Redis and no second datastore to back up.

- `src/app/(app)/` — the PWA shell (Today, Money, Goals, Chat, More)
- `src/app/api/` — route handlers; everything is gated by `src/proxy.ts` except login, auth,
  the Monzo webhook, and PWA plumbing
- `src/db/schema/` — Drizzle tables. **All money is integer pence; negative = money out.**
- `src/lib/claude/` — client, cached-context builder, frozen system prompt, the chat tool belt
- `src/lib/providers/` — Monzo, Lunchflow, CSV
- `src/worker/jobs/` — one file per queue, registered from `jobs/index.ts`
- `storage/` — original document files, content-addressed by sha256

### Scheduled jobs

| Queue | Cadence | Does |
|---|---|---|
| `monzo-poll` | every 3 min | transactions, balances, pots |
| `monzo-backfill` | one-shot | full history, enqueued by the OAuth callback |
| `lunchflow-sync` | 02:30 | long-term history + cross-provider dedupe pairing |
| `categorise` | 03:00 | one Message Batches call for unknown merchants only (50% cost) |
| `detect-recurring` | 03:15 | subscriptions, bills, salary; builds the graveyard |
| `payday-detect` | hourly | salary credit → payday ritual push |
| `impulse-check` | on demand | gentle check-in ~30 min after a large impulse-category spend |
| `doc-ingest` | on upload | Claude-native extraction + learned filing |
| `expiry-check` | 08:00 | passport / insurance / MOT reminders at 90/30/7/1 days |
| `digest` | 06:45 | composes the Today card, pushes the headline |
| `nudge-dispatch` | every min | delivers due nudges + anything parked by quiet hours |
| `novelty` | Mon 10:00 | a fresh angle on a stale-but-still-wanted goal |
| `token-watch` | 09:00 | "Monzo needs reconnecting" 7 days before expiry |
| `backup` | 01:30 | `pg_dump` + storage sync into `./backups` |

---

## The parts that are easy to get wrong

**Monzo's 5-minute window.** Monzo returns your *entire* history only for about five minutes after
you authorise, then it's a rolling 90 days forever. The OAuth callback enqueues the backfill
synchronously at top priority for exactly this reason. Connect Monzo when you can immediately
approve the request in the Monzo app — the API returns 403 until you do, and the backfill job
retries for six minutes waiting for you. Afterwards, verify:

```sql
select count(*), min(posted_at) from transactions;
```

If `min(posted_at)` is only ~90 days back, the window was missed. Disconnect, reconnect, and be
ready to tap approve.

**Choosing which accounts sync.** Lunchflow exposes every account it can see, which is rarely what
you want in here. Settings → *Which accounts sync* lists them with a toggle; only enabled accounts
have their transactions pulled. Newly discovered accounts default to on, so a fresh connection
works without setup. Switching one off never deletes anything — if it has already imported
transactions, a separate, explicitly-labelled action removes them.

**Cross-provider duplicates.** The same coffee arrives from Monzo *and* Lunchflow. Every row gets
`dedupe_key = sha256(local day | amount | normalised merchant)`. Monzo is canonical; the Lunchflow
twin is marked `superseded_by` rather than deleted, and a partial unique index makes the pairing
strictly one-to-one. The key is deliberately *not* unique — two identical coffees on one day are two
real transactions.

**iOS push.** Three things must all be true, and the Settings page reports each one:
1. The app was added to the Home Screen (iOS refuses push to a Safari tab).
2. Permission was requested **inside a click handler** — iOS silently swallows it otherwise.
3. The device is subscribed.

Push payloads are self-contained JSON: the service worker renders the notification without any
network access, which is what makes push work when your phone is off wifi and off the tailnet.
**That's the test that matters** — the on-tailnet test proves much less.

**Money never moves on its own.** Claude's `move_money_to_pot` tool cannot execute. It writes a row
to `pending_confirmations` and returns a proposal; the chat renders a confirm card; only
`POST /api/confirm` with an explicit tap performs the deposit.

**Prompt caching pays for this app.** The stable prefix (profile, goals, categories, filing
taxonomy, budgets) is cached for an hour; the date and your question go after the breakpoint. The
stable block must contain no timestamps or randomness or the cache silently never hits. Verify:

```sql
select detail from audit_log where kind like 'claude:%' order by at desc limit 5;
```

`cacheRead` should be non-zero from the second message of a conversation onward.

---

## Optional: real-time Monzo

Everything stays on the tailnet by default, so Monzo's webhooks can't reach you and sync is
poll-based. If you want real-time, publish *only* the webhook path:

```bash
tailscale funnel --bg --set-path=/api/webhooks/monzo/$MONZO_WEBHOOK_SECRET 3000
```

The path carries a 32-byte secret and the handler treats the body as untrusted — it is a "sync now"
trigger, never a data source. Nothing else is exposed.

---

## Backups

The nightly job writes `backups/db/lighthouse-<date>.dump` (30 kept) and syncs `storage/`. This is
your financial and document archive — copy `./backups` somewhere else on a schedule.

`backups/` and `storage/` are bind-mounted and the worker runs as an unprivileged user, so both
directories ship with the repo. On a Linux host, if the worker can't write to them, match the
ownership once: `sudo chown -R 1000:1000 backups storage`.

```bash
DATABASE_URL=... ./scripts/restore.sh backups/db/lighthouse-2026-08-18.dump
```

Test the restore before you need it.

---

## Verification

```bash
pnpm typecheck          # types
pnpm build              # Next.js production build
pnpm smoke              # 32 checks: dedupe invariants, payday maths, ranking, FTS
pnpm http-smoke         # 31 checks: auth gating + every page and API route (needs the app running)
pnpm shots [dir]        # authenticated screenshots of every page, via Chrome DevTools Protocol
```

`http-smoke` and `shots` mint a session token directly with `SESSION_SECRET`, because WebAuthn
can't be driven from a script. They exercise the real routes, proxy gating included.

Then, on your phone:

1. Open the `ts.net` URL, register your passkey, **Add to Home Screen**.
2. Open from the Home Screen → Settings → Enable notifications → Send test push.
3. Turn off wifi, leave the tailnet, send another test push. This is the one that matters.
4. Connect Monzo (be ready to approve in the Monzo app), then check the row count above.
5. Ask the chat "what did I spend on coffee last month" — it should call `query_transactions`.
6. File a real utility bill and a real receipt; check the folder and the linked transaction.
