import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export type Provider = "monzo" | "lunchflow" | "csv";

export const providerConnections = pgTable("provider_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").$type<Provider>().notNull().unique(),
  // AES-256-GCM encrypted, via src/lib/crypto.ts
  accessTokenEnc: text("access_token_enc"),
  refreshTokenEnc: text("refresh_token_enc"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  authorizedAt: timestamp("authorized_at", { withTimezone: true }),
  status: text("status", { enum: ["active", "expired", "revoked", "error"] })
    .notNull()
    .default("active"),
  // provider-specific extras (e.g. Monzo user id, backfill bookkeeping)
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").$type<Provider>().notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    name: text("name").notNull(),
    type: text("type"),
    currency: text("currency").notNull().default("GBP"),
    // pence; refreshed by sync jobs
    balance: integer("balance").notNull().default(0),
    balanceUpdatedAt: timestamp("balance_updated_at", { withTimezone: true }),
    isPrimary: boolean("is_primary").notNull().default(false),
    closed: boolean("closed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("accounts_provider_unique").on(t.provider, t.providerAccountId)],
);

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["spending", "income", "transfer"] })
    .notNull()
    .default("spending"),
  // categories where a big spend triggers the gentle impulse check-in
  isImpulseProne: boolean("is_impulse_prone").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const merchants = pgTable(
  "merchants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    normalisedName: text("normalised_name").notNull().unique(),
    displayName: text("display_name").notNull(),
    monzoMerchantId: text("monzo_merchant_id"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    // how the category was decided: claude | manual | rule
    categorySource: text("category_source"),
    logoUrl: text("logo_url"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("merchants_monzo_id_idx").on(t.monzoMerchantId)],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    providerTxId: text("provider_tx_id").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    // pence; negative = money out, positive = money in
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("GBP"),
    description: text("description").notNull().default(""),
    merchantId: uuid("merchant_id").references(() => merchants.id, { onDelete: "set null" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    categorySource: text("category_source", {
      enum: ["merchant", "rule", "claude", "manual", "provider"],
    }),
    notes: text("notes"),
    // sha256(provider-agnostic scope | local day | amount | normalised merchant) — diagnostic +
    // candidate index for cross-provider pairing; NOT unique (two identical coffees are real)
    dedupeKey: text("dedupe_key").notNull(),
    // cross-provider twin: this row is a duplicate of the canonical row it points at.
    // Unique below => each canonical row absorbs at most one twin (one-to-one pairing).
    supersededBy: uuid("superseded_by"),
    declined: boolean("declined").notNull().default(false),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("transactions_provider_tx_unique").on(t.accountId, t.providerTxId),
    uniqueIndex("transactions_superseded_by_unique")
      .on(t.supersededBy)
      .where(sql`${t.supersededBy} is not null`),
    index("transactions_posted_idx").on(t.accountId, t.postedAt),
    index("transactions_dedupe_idx").on(t.dedupeKey),
    index("transactions_category_idx").on(t.categoryId),
    index("transactions_merchant_idx").on(t.merchantId),
  ],
);

export const pots = pgTable("pots", {
  id: uuid("id").primaryKey().defaultRandom(),
  monzoPotId: text("monzo_pot_id").notNull().unique(),
  name: text("name").notNull(),
  balance: integer("balance").notNull().default(0),
  goalAmount: integer("goal_amount"),
  style: text("style"),
  deleted: boolean("deleted").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const budgets = pgTable("budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  categoryId: uuid("category_id")
    .notNull()
    .unique()
    .references(() => categories.id, { onDelete: "cascade" }),
  // pence per calendar month
  monthlyLimit: integer("monthly_limit").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recurring = pgTable(
  "recurring",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id").references(() => merchants.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    // typical charge, pence (negative = outgoing)
    amount: integer("amount").notNull(),
    cadence: text("cadence", { enum: ["weekly", "monthly", "yearly", "unknown"] })
      .notNull()
      .default("monthly"),
    dayOfMonth: integer("day_of_month"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    nextExpectedAt: timestamp("next_expected_at", { withTimezone: true }),
    txCount: integer("tx_count").notNull().default(0),
    // graveyard = looks dead/forgotten; surfaced as "£X to win back", never as blame
    status: text("status", { enum: ["active", "graveyard", "dismissed", "cancelled"] })
      .notNull()
      .default("active"),
    kind: text("kind", { enum: ["subscription", "bill", "income", "other"] })
      .notNull()
      .default("subscription"),
  },
  (t) => [index("recurring_status_idx").on(t.status)],
);

export const rules = pgTable("rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  // case-insensitive substring matched against description / merchant name
  pattern: text("pattern").notNull(),
  field: text("field", { enum: ["description", "merchant"] })
    .notNull()
    .default("merchant"),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "cascade" }),
  hits: integer("hits").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pendingConfirmations = pgTable(
  "pending_confirmations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["pot_deposit", "pot_withdraw"] }).notNull(),
    // e.g. { potId, monzoPotId, amount, sourceAccountId, reason }
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status", {
      enum: ["pending", "executed", "declined", "expired", "failed"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [index("pending_confirmations_status_idx").on(t.status)],
);

export const csvImports = pgTable("csv_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  rowCount: integer("row_count").notNull().default(0),
  importedCount: integer("imported_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
