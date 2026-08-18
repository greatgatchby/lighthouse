import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    // the felt reason — why this matters to you, in your words
    why: text("why"),
    area: text("area"),
    status: text("status", { enum: ["spark", "active", "parked", "done"] })
      .notNull()
      .default("active"),
    // 1-5, decays over time; refreshed when you touch the goal
    excitement: integer("excitement").notNull().default(3),
    excitementUpdatedAt: timestamp("excitement_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // must be one sentence and genuinely doable; Claude rewrites it smaller if vague
    nextAction: text("next_action"),
    estimatedMinutes: integer("estimated_minutes"),
    energyRequired: text("energy_required", { enum: ["low", "medium", "high"] })
      .notNull()
      .default("medium"),
    parkedAt: timestamp("parked_at", { withTimezone: true }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    lastTouchedAt: timestamp("last_touched_at", { withTimezone: true }).notNull().defaultNow(),
    lastNudgedAt: timestamp("last_nudged_at", { withTimezone: true }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("goals_status_idx").on(t.status)],
);

export const sparks = pgTable("sparks", {
  id: uuid("id").primaryKey().defaultRandom(),
  // raw, unstructured capture — structure comes later, never at the moment of capture
  text: text("text").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  convertedGoalId: uuid("converted_goal_id").references(() => goals.id, { onDelete: "set null" }),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
});

export const goalSessions = pgTable(
  "goal_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    minutes: integer("minutes"),
    note: text("note"),
  },
  (t) => [index("goal_sessions_goal_idx").on(t.goalId)],
);

// forgiving streak: "shown up 4 of the last 7 days" — never a counter that resets
export const showups = pgTable("showups", {
  day: date("day").primaryKey(),
  count: integer("count").notNull().default(1),
});
