import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const readingItems = pgTable(
  "reading_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    author: text("author"),
    url: text("url"),
    kind: text("kind", { enum: ["book", "article", "paper", "other"] })
      .notNull()
      .default("book"),
    status: text("status", { enum: ["want", "reading", "done", "abandoned"] })
      .notNull()
      .default("want"),
    rating: integer("rating"),
    notes: text("notes"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("reading_items_status_idx").on(t.status)],
);
