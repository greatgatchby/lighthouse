import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";

// Create a goal. Everything except the title is optional — capture must never
// demand structure. Claude fills the rest in later (refine / spark convert).

const CreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  why: z.string().trim().max(2000).nullish(),
  area: z.string().trim().max(80).nullish(),
  excitement: z.number().int().min(1).max(5).optional(),
  nextAction: z.string().trim().max(500).nullish(),
  estimatedMinutes: z.number().int().min(1).max(600).nullish(),
  energyRequired: z.enum(["low", "medium", "high"]).optional(),
});

export async function POST(request: Request) {
  await requireUserId();

  const parsed = CreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid goal", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;
  const now = new Date();

  const [goal] = await db
    .insert(tables.goals)
    .values({
      title: body.title,
      why: body.why ?? null,
      area: body.area ?? null,
      status: "active",
      excitement: body.excitement ?? 3,
      excitementUpdatedAt: now,
      nextAction: body.nextAction ?? null,
      estimatedMinutes: body.estimatedMinutes ?? null,
      energyRequired: body.energyRequired ?? "medium",
      lastTouchedAt: now,
    })
    .returning();

  return NextResponse.json(goal, { status: 201 });
}
