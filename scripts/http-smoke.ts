import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";

// Authenticated end-to-end HTTP checks against a running server.
//
//   pnpm dev                 # in one terminal
//   pnpm http-smoke          # in another
//
// WebAuthn can't be driven from a script, so this mints a session token with
// SESSION_SECRET directly — the same token the passkey flow would issue. It
// exercises the real routes, proxy gating included.

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function record(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function hit(
  path: string,
  opts: { method?: string; body?: unknown; cookie?: string; redirect?: RequestRedirect } = {},
) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    redirect: opts.redirect ?? "manual",
    headers: {
      ...(opts.body ? { "content-type": "application/json" } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json: unknown = null;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {
    json = text.slice(0, 200);
  }
  return { status: res.status, json, text };
}

/** Endpoints that must exist once a vertical has landed. Missing = 404. */
const VERTICAL_ROUTES: Array<{ vertical: string; method: string; path: string; okStatuses: number[] }> = [
  { vertical: "finance", method: "GET", path: "/api/finance/summary", okStatuses: [200] },
  { vertical: "finance", method: "GET", path: "/api/finance/transactions?limit=5", okStatuses: [200] },
  { vertical: "finance", method: "GET", path: "/api/finance/recurring", okStatuses: [200] },
  { vertical: "documents", method: "GET", path: "/api/documents/search?q=test", okStatuses: [200] },
  { vertical: "goals", method: "GET", path: "/api/goals/showups", okStatuses: [200] },
  { vertical: "trackers", method: "GET", path: "/api/food?days=7", okStatuses: [200] },
  { vertical: "trackers", method: "GET", path: "/api/move?days=7", okStatuses: [200] },
  { vertical: "trackers", method: "GET", path: "/api/reading", okStatuses: [200] },
];

const PAGES = [
  "/",
  "/money",
  "/money/transactions",
  "/money/subscriptions",
  "/goals",
  "/documents",
  "/chat",
  "/food",
  "/move",
  "/reading",
  "/settings",
  "/more",
];

async function main() {
  console.log(`\nLighthouse HTTP smoke — ${BASE}\n`);

  // reachable?
  try {
    await fetch(`${BASE}/login`);
  } catch {
    console.error(`Server not reachable at ${BASE}. Start it with \`pnpm dev\`.`);
    process.exit(1);
  }

  // ---------------------------------------------------------------- unauthed
  console.log("auth gating (no session)");
  const rootAnon = await hit("/");
  record("/ redirects to /login", rootAnon.status === 307 || rootAnon.status === 302, `got ${rootAnon.status}`);
  const chatAnon = await hit("/api/chat", { method: "POST", body: { message: "hi" } });
  record("/api/chat is 401", chatAnon.status === 401, `got ${chatAnon.status}`);
  const loginPage = await hit("/login");
  record("/login is public", loginPage.status === 200, `got ${loginPage.status}`);
  const manifest = await hit("/manifest.webmanifest");
  record("manifest is public", manifest.status === 200, `got ${manifest.status}`);

  // ------------------------------------------------------------ mint session
  let [user] = await db.select().from(tables.users).limit(1);
  if (!user) {
    [user] = await db.insert(tables.users).values({ name: "SMOKE_http" }).returning();
    await db.insert(tables.settings).values({ userId: user.id }).onConflictDoNothing();
  }
  const cookie = `${SESSION_COOKIE}=${await createSessionToken(user.id)}`;

  console.log("\nauthenticated pages");
  for (const path of PAGES) {
    const res = await hit(path, { cookie });
    // 200 = rendered. A redirect means the proxy rejected our session.
    record(`GET ${path}`, res.status === 200, `got ${res.status}`);
  }

  console.log("\nfoundation endpoints");
  const settings = await hit("/api/settings", { cookie });
  record("GET /api/settings", settings.status === 200, `got ${settings.status}`);
  const energy = await hit("/api/energy", { method: "POST", body: { energy: "high" }, cookie });
  record("POST /api/energy", energy.status === 200, `got ${energy.status}`);
  const energyBad = await hit("/api/energy", { method: "POST", body: { energy: "nope" }, cookie });
  record("POST /api/energy rejects bad value", energyBad.status === 400, `got ${energyBad.status}`);
  const syncAccounts = await hit("/api/settings/accounts", { cookie });
  record(
    "GET /api/settings/accounts",
    syncAccounts.status === 200 && Array.isArray((syncAccounts.json as { accounts?: unknown[] })?.accounts),
    `got ${syncAccounts.status}`,
  );
  const toggleBad = await hit("/api/settings/accounts", {
    method: "PATCH",
    body: { providerAccountId: "x" },
    cookie,
  });
  record("PATCH /api/settings/accounts rejects bad input", toggleBad.status === 400, `got ${toggleBad.status}`);

  const vapid = await hit("/api/push/subscribe", { cookie });
  record(
    "GET /api/push/subscribe returns VAPID key",
    vapid.status === 200 && Boolean((vapid.json as { vapidPublicKey?: string })?.vapidPublicKey),
  );
  const confirmBad = await hit("/api/confirm", { method: "POST", body: { proposalId: "x" }, cookie });
  record("POST /api/confirm rejects bad input", confirmBad.status === 400, `got ${confirmBad.status}`);

  console.log("\nvertical endpoints");
  const missing: Record<string, number> = {};
  for (const route of VERTICAL_ROUTES) {
    const res = await hit(route.path, { method: route.method, cookie });
    const ok = route.okStatuses.includes(res.status);
    if (!ok && res.status === 404) missing[route.vertical] = (missing[route.vertical] ?? 0) + 1;
    record(`${route.method} ${route.path}`, ok, `got ${res.status}`);
  }

  // ------------------------------------------------------------------ report
  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (Object.keys(missing).length > 0) {
    console.log(
      `not yet built: ${Object.entries(missing)
        .map(([v, n]) => `${v} (${n} routes 404)`)
        .join(", ")}`,
    );
  }
  if (failures.length > 0) console.log(`failing: ${failures.join(", ")}`);
  await db.delete(tables.users).where(eq(tables.users.name, "SMOKE_http"));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nhttp smoke crashed:", err);
  process.exit(1);
});
