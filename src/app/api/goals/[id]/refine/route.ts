import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";
import { claude, logUsage, MODEL } from "@/lib/claude/client";

// "Make it smaller" — the single most useful button in the app. A vague next
// action is rewritten until starting it costs nothing.

// Frozen prefix: no dates, no per-request values, nothing volatile.
const REFINE_SYSTEM = `You shrink the next step of a goal until starting it is trivial.

Activation energy is the enemy. The person you are helping has an ADHD brain: the gap between wanting something and starting it is where goals quietly die. Your whole job is to make the first move so small and so concrete that it takes no decision.

Rules for the next action:
- ONE sentence, starting with a verb, genuinely doable in 15 minutes or less.
- Name the exact first move ("open the boiler manual to the warranty page"), never a phase ("research boilers").
- No "and then", no lists, no projects, no preparation for preparation.
- estimatedMinutes is honest and 15 or fewer.
- energyRequired is what this really costs: low = doable tired on the sofa, medium = needs a little focus, high = needs a good brain.

Never moralise, never mention how long this has been sitting there, never imply anyone is behind. There are no failure states here.`;

const RefineSchema = z.object({
  nextAction: z
    .string()
    .describe("ONE sentence, starts with a verb, concretely doable in 15 minutes or less"),
  estimatedMinutes: z.number().int().describe("honest minutes for that one action, 15 or fewer"),
  energyRequired: z.enum(["low", "medium", "high"]).describe("what the action actually costs"),
});

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUserId();
  const { id } = await params;

  const [goal] = await db.select().from(tables.goals).where(eq(tables.goals.id, id)).limit(1);
  if (!goal) return NextResponse.json({ error: "goal not found" }, { status: 404 });

  const response = await claude().messages.parse({
    model: MODEL,
    max_tokens: 1024,
    system: REFINE_SYSTEM,
    messages: [
      {
        role: "user",
        content:
          `Goal: ${goal.title}\n` +
          `Why it matters to them: ${goal.why ?? "(not written down)"}\n` +
          `Area: ${goal.area ?? "(none)"}\n` +
          `Current next action: ${goal.nextAction ?? "(none yet)"}\n` +
          `Current estimate: ${goal.estimatedMinutes ?? "unknown"} minutes at ${goal.energyRequired} energy\n\n` +
          `Rewrite the next action smaller.`,
      },
    ],
    output_config: { format: zodOutputFormat(RefineSchema) },
  });
  await logUsage("goal-refine", response.usage);

  const refined = response.parsed_output;
  if (!refined) {
    return NextResponse.json({ error: "could not shrink that one — try again" }, { status: 502 });
  }

  const now = new Date();
  const [updated] = await db
    .update(tables.goals)
    .set({
      nextAction: refined.nextAction.trim().slice(0, 500),
      estimatedMinutes: Math.min(600, Math.max(1, Math.round(refined.estimatedMinutes))),
      energyRequired: refined.energyRequired,
      lastTouchedAt: now,
      updatedAt: now,
    })
    .where(eq(tables.goals.id, id))
    .returning();

  return NextResponse.json(updated);
}
