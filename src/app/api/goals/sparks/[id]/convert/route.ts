import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";
import { claude, logUsage, MODEL } from "@/lib/claude/client";

// Spark -> goal. The captured thought stays exactly as written; Claude only
// gives it a shape (and, crucially, a first move small enough to start).

// Frozen prefix: no dates, no per-request values, nothing volatile.
const CONVERT_SYSTEM = `You turn a raw captured thought into a goal someone with an ADHD brain can actually start.

The thought was captured in a hurry, on purpose — do not judge it, do not expand it into a project, do not add ambition it never had. Keep it recognisably theirs.

- title: short and concrete, in their own words where possible. No corporate verbs.
- why: the felt reason, one sentence, written back to them in second person ("because the flat stops feeling like yours when..."). Guess warmly if it isn't stated.
- area: one lowercase word for the part of life it belongs to (home, health, money, creative, learning, work, people, admin, fun).
- excitement: 1-5, honest read of how alive this sounds. Most freshly captured sparks are a 3 or 4.
- nextAction: ONE sentence, starts with a verb, genuinely doable in 15 minutes or less. Name the exact first move, never a phase.
- estimatedMinutes: honest minutes for that one action, 15 or fewer.
- energyRequired: low = doable tired on the sofa, medium = needs a little focus, high = needs a good brain.

Never moralise, never add a deadline, never imply anyone is behind. There are no failure states here.`;

const ConvertSchema = z.object({
  title: z.string().describe("short, concrete, in their words"),
  why: z.string().describe("the felt reason, one warm sentence in second person"),
  area: z.string().describe("one lowercase word for the area of life"),
  excitement: z.number().int().describe("1 to 5, how alive this sounds"),
  nextAction: z
    .string()
    .describe("ONE sentence, starts with a verb, doable in 15 minutes or less"),
  estimatedMinutes: z.number().int().describe("honest minutes for that one action, 15 or fewer"),
  energyRequired: z.enum(["low", "medium", "high"]),
});

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUserId();
  const { id } = await params;

  const [spark] = await db
    .select()
    .from(tables.sparks)
    .where(and(eq(tables.sparks.id, id), isNull(tables.sparks.convertedGoalId)))
    .limit(1);
  if (!spark) return NextResponse.json({ error: "spark not found" }, { status: 404 });

  const response = await claude().messages.parse({
    model: MODEL,
    max_tokens: 1024,
    system: CONVERT_SYSTEM,
    messages: [{ role: "user", content: `Captured thought:\n"""\n${spark.text}\n"""` }],
    output_config: { format: zodOutputFormat(ConvertSchema) },
  });
  await logUsage("spark-convert", response.usage);

  const shaped = response.parsed_output;
  if (!shaped) {
    return NextResponse.json({ error: "could not shape that one — try again" }, { status: 502 });
  }

  const now = new Date();
  const [goal] = await db
    .insert(tables.goals)
    .values({
      title: shaped.title.trim().slice(0, 200) || spark.text.slice(0, 200),
      why: shaped.why.trim().slice(0, 2000),
      area: shaped.area.trim().toLowerCase().slice(0, 80),
      status: "active",
      excitement: Math.min(5, Math.max(1, Math.round(shaped.excitement))),
      excitementUpdatedAt: now,
      nextAction: shaped.nextAction.trim().slice(0, 500),
      estimatedMinutes: Math.min(600, Math.max(1, Math.round(shaped.estimatedMinutes))),
      energyRequired: shaped.energyRequired,
      lastTouchedAt: now,
      meta: { fromSparkId: spark.id },
    })
    .returning();

  await db
    .update(tables.sparks)
    .set({ convertedGoalId: goal.id })
    .where(eq(tables.sparks.id, spark.id));

  return NextResponse.json(goal, { status: 201 });
}
