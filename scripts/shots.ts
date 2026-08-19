import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";

// Authenticated screenshots via the Chrome DevTools Protocol.
// Headless Chrome's --screenshot flag can't set a cookie, so drive it over CDP
// instead: mint a session, Network.setCookie, navigate, capture.
//
//   pnpm shots [outDir]

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const OUT = process.argv[2] ?? "/tmp/lighthouse-shots";
const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

const PAGES: [name: string, path: string][] = [
  ["today", "/"],
  ["money", "/money"],
  ["transactions", "/money/transactions"],
  ["subscriptions", "/money/subscriptions"],
  ["payday", "/money/payday"],
  ["goals", "/goals"],
  ["documents", "/documents"],
  ["chat", "/chat"],
  ["food", "/food"],
  ["move", "/move"],
  ["reading", "/reading"],
  ["settings", "/settings"],
];

function cdp(ws: WebSocket) {
  let id = 0;
  const pending = new Map<number, (v: Record<string, unknown>) => void>();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)!(msg.result ?? {});
      pending.delete(msg.id);
    }
  });
  return (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const messageId = ++id;
      pending.set(messageId, resolve);
      ws.send(JSON.stringify({ id: messageId, method, params }));
    });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await mkdir(OUT, { recursive: true });

  let [user] = await db.select().from(tables.users).limit(1);
  if (!user) {
    [user] = await db.insert(tables.users).values({ name: "SMOKE_shots" }).returning();
    await db.insert(tables.settings).values({ userId: user.id }).onConflictDoNothing();
  }
  const token = await createSessionToken(user.id);

  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    "--disable-gpu",
    "--hide-scrollbars",
    "--window-size=430,932",
    "--user-data-dir=/tmp/lighthouse-chrome-profile",
    "about:blank",
  ]);
  chrome.on("error", (err) => console.error("chrome:", err));

  // wait for the debugging endpoint
  let target: { webSocketDebuggerUrl: string } | null = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try {
      const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as {
        type: string;
        webSocketDebuggerUrl: string;
      }[];
      target = list.find((t) => t.type === "page") ?? null;
    } catch {
      /* not up yet */
    }
  }
  if (!target) throw new Error("Chrome DevTools endpoint never came up");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  const send = cdp(ws);

  await send("Page.enable");
  await send("Network.enable");
  const url = new URL(BASE);
  await send("Network.setCookie", {
    name: SESSION_COOKIE,
    value: token,
    domain: url.hostname,
    path: "/",
    httpOnly: true,
  });

  for (const [name, path] of PAGES) {
    await send("Page.navigate", { url: `${BASE}${path}` });
    await sleep(3000); // let client components fetch and settle (settings hits Lunchflow live)
    const shot = (await send("Page.captureScreenshot", { format: "png" })) as { data?: string };
    if (shot.data) {
      await writeFile(`${OUT}/${name}.png`, Buffer.from(shot.data, "base64"));
      console.log(`  ${name.padEnd(14)} ${path}`);
    } else {
      console.error(`  ${name.padEnd(14)} FAILED`);
    }
  }

  ws.close();
  chrome.kill();
  await db.delete(tables.users).where(eq(tables.users.name, "SMOKE_shots"));
  console.log(`\nwrote ${PAGES.length} screenshots to ${OUT}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
