import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const STATUSES = ["want", "reading", "done", "abandoned"] as const;
type Status = (typeof STATUSES)[number];

function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value);
}

/** GET /api/reading?status=want,reading — the pile, optionally one lane of it. */
export async function GET(request: Request) {
  await requireUserId();
  const wanted = (new URL(request.url).searchParams.get("status") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isStatus);

  const rows = await db
    .select()
    .from(tables.readingItems)
    .orderBy(desc(tables.readingItems.addedAt));

  const counts: Record<Status, number> = { want: 0, reading: 0, done: 0, abandoned: 0 };
  for (const row of rows) counts[row.status] += 1;

  const items = wanted.length > 0 ? rows.filter((row) => wanted.includes(row.status)) : rows;
  return NextResponse.json({ items, counts });
}

const ReadingInput = z.object({
  title: z.string().min(1).max(300),
  author: z.string().max(200).nullish(),
  url: z.string().max(2000).nullish(),
  kind: z.enum(["book", "article", "paper", "other"]).nullish(),
  status: z.enum(STATUSES).nullish(),
});

/** POST /api/reading — add by title; everything else is optional. */
export async function POST(request: Request) {
  await requireUserId();
  const body: unknown = await request.json().catch(() => null);
  const parsed = ReadingInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid item", issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;

  const title = input.title.trim();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const status: Status = input.status ?? "want";
  const now = new Date();

  const [item] = await db
    .insert(tables.readingItems)
    .values({
      title,
      author: input.author?.trim() || null,
      url: input.url?.trim() || null,
      kind: input.kind ?? "book",
      status,
      startedAt: status === "reading" || status === "done" ? now : null,
      finishedAt: status === "done" ? now : null,
    })
    .returning();

  return NextResponse.json({ ok: true, item }, { status: 201 });
}
