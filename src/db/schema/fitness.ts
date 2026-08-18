import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const workouts = pgTable(
  "workouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind").notNull(),
    minutes: integer("minutes"),
    intensity: text("intensity", { enum: ["easy", "moderate", "hard"] }),
    note: text("note"),
    source: text("source", { enum: ["manual", "chat"] }).notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workouts_at_idx").on(t.at)],
);
