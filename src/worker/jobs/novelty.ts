import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, desc, eq, gte, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/db";
import { claude, logUsage, MODEL } from "@/lib/claude/client";
import { sendPush } from "@/lib/push";
import { QUEUES } from "@/lib/queues";
import type { JobDefinition } from "../types";

// Monday morning: one goal that's gone quiet but is still wanted gets a
// genuinely different way in. Interest is the fuel here — a stalled goal is
// almost never a discipline problem, it's a goal whose only known entrance has
// gone boring. So we don't remind, we re-angle: a new door into the same room.
//
// Exactly one goal a week, and never the same one twice in a fortnight. This
// is the difference between a nudge and a nag.

const STALE_DAYS = 14;
const NUDGE_COOLDOWN_DAYS = 14;
const MAX_BODY = 120;

// Frozen prefix: no dates, no per-request values, nothing volatile.
const NOVELTY_SYSTEM = `You find a fresh way into a goal that has gone quiet.

The person you are helping has an ADHD brain. Their goals stall for one reason: the way in stopped being interesting. Novelty is not a trick on them — it is genuinely how their attention works. Your job is to hand them a different door into the same room.

The angle must be:
- Concrete and specific enough to picture, not a reframe or a pep talk.
- Genuinely different from the obvious approach — a different medium, a different order, a smaller or stranger entry point, the fun half first, someone else involved, doing it badly on purpose.
- One sentence. Something they could act on inside fifteen minutes.

The nudge body must be:
- 120 characters or fewer, warm and curious, like a friend who just thought of something.
- About the idea, never about them. No "still", no "finally", no "you haven't", no elapsed time, no streaks, no shoulds.

Never mention how long it has been. Never imply anyone is behind, lazy, or failing. There are no failure states here — a quiet goal is just a goal waiting for a better door.`;

const NoveltySchema = z.object({
  angle: z
    .string()
    .describe("a genuinely fresh, concrete way into this goal — one sentence, actionable"),
  nudgeBody: z
    .string()
    .describe("the push body: 120 characters or fewer, warm, about the idea not the person"),
});

const novelty: JobDefinition = {
  queue: QUEUES.novelty,
  schedule: { cron: "0 10 * * 1" },
  handler: async () => {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALE_DAYS * 86400_000);
    const nudgedBefore = new Date(now.getTime() - NUDGE_COOLDOWN_DAYS * 86400_000);

    // Stale but still wanted: untouched for a fortnight, excitement still alive.
    // Least-recently-nudged first (never nudged wins), then the most alive one.
    const [goal] = await db
      .select()
      .from(tables.goals)
      .where(
        and(
          eq(tables.goals.status, "active"),
          dsql`${tables.goals.lastTouchedAt} < ${staleBefore}`,
          gte(tables.goals.excitement, 2),
          dsql`(${tables.goals.lastNudgedAt} is null or ${tables.goals.lastNudgedAt} < ${nudgedBefore})`,
        ),
      )
      .orderBy(dsql`${tables.goals.lastNudgedAt} asc nulls first`, desc(tables.goals.excitement))
      .limit(1);

    // Nothing stale enough, or nothing still wanted — say nothing at all.
    if (!goal) return;

    const response = await claude().messages.parse({
      model: MODEL,
      max_tokens: 512,
      system: NOVELTY_SYSTEM,
      messages: [
        {
          role: "user",
          content:
            `Goal: ${goal.title}\n` +
            `Why it matters to them: ${goal.why ?? "(not written down)"}\n` +
            `Area of life: ${goal.area ?? "(none)"}\n` +
            `The way in they've been assuming: ${goal.nextAction ?? "(none written down)"}\n` +
            `That step is estimated at ${goal.estimatedMinutes ?? "unknown"} minutes and ${goal.energyRequired} energy.\n\n` +
            `Find a different door into this one.`,
        },
      ],
      output_config: { format: zodOutputFormat(NoveltySchema) },
    });
    await logUsage("novelty", response.usage);

    const fresh = response.parsed_output;
    if (!fresh) throw new Error("novelty: model returned unparseable output");

    const angle = fresh.angle.trim();
    const body = fresh.nudgeBody.trim().slice(0, MAX_BODY);
    if (!angle || !body) return;

    // The angle waits on the goal itself, so opening it later still pays off.
    // lastTouchedAt is deliberately untouched — a nudge is not a touch, and
    // pretending otherwise would hide the goal from this job forever.
    await db
      .update(tables.goals)
      .set({
        meta: { ...goal.meta, noveltyAngle: angle },
        lastNudgedAt: now,
        updatedAt: now,
      })
      .where(eq(tables.goals.id, goal.id));

    await sendPush({
      title: "A fresh angle 💡",
      body,
      url: `/goals/${goal.id}`,
      tag: `novelty-${goal.id}`,
      category: "goals",
    });

    console.log(`[novelty] fresh angle for "${goal.title}"`);
  },
};

export default novelty;
