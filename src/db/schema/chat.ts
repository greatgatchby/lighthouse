import { date, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const chats = pgTable("chats", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    // full API content blocks (text / tool_use / tool_result / thinking), replayed verbatim
    content: jsonb("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_messages_chat_idx").on(t.chatId, t.createdAt)],
);

export interface DigestContent {
  headline: string;
  whatMatters: string[];
  excitingGoal: { goalId: string | null; text: string } | null;
  moneyNote: string;
  nudge: string;
}

export const digests = pgTable("digests", {
  id: uuid("id").primaryKey().defaultRandom(),
  forDate: date("for_date").notNull().unique(),
  content: jsonb("content").$type<DigestContent>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// one-off scheduled nudges, created from chat ("remind me to...") or by jobs
export const nudges = pgTable(
  "nudges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    message: text("message").notNull(),
    category: text("category").notNull().default("system"),
    url: text("url"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("nudges_due_idx").on(t.scheduledFor)],
);
