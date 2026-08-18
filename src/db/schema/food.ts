import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { documents } from "./documents";

export const meals = pgTable(
  "meals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    name: text("name").notNull(),
    description: text("description"),
    calories: integer("calories"),
    proteinG: integer("protein_g"),
    carbsG: integer("carbs_g"),
    fatG: integer("fat_g"),
    // photo meal logging reuses the document vision pipeline
    photoDocumentId: uuid("photo_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    source: text("source", { enum: ["manual", "photo", "chat"] }).notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("meals_at_idx").on(t.at)],
);
