import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";

// Raw capture. No structure is demanded at the moment of capture — that's the
// whole point of a spark. Shaping happens later, on purpose, via /convert.

const SparkSchema = z.object({ text: z.string().trim().min(1).max(2000) });

export async function POST(request: Request) {
  await requireUserId();

  const parsed = SparkSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "a spark needs some text" }, { status: 400 });
  }

  const [spark] = await db
    .insert(tables.sparks)
    .values({ text: parsed.data.text })
    .returning();

  return NextResponse.json(spark, { status: 201 });
}
