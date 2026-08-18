import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().default("You"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webauthnCredentials = pgTable(
  "webauthn_credentials",
  {
    // base64url credential id, as returned by @simplewebauthn
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publicKey: bytea("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: jsonb("transports").$type<string[]>(),
    deviceType: text("device_type"),
    backedUp: boolean("backed_up").notNull().default(false),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [index("webauthn_credentials_user_idx").on(t.userId)],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    failCount: integer("fail_count").notNull().default(0),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);

export type NotificationCategory =
  | "money"
  | "impulse"
  | "payday"
  | "goals"
  | "documents"
  | "digest"
  | "system";

export interface NotificationToggles {
  money: boolean;
  impulse: boolean;
  payday: boolean;
  goals: boolean;
  documents: boolean;
  digest: boolean;
  system: boolean;
}

export const settings = pgTable("settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // minutes from midnight, local time; quiet when start <= now < end (wraps midnight)
  quietHoursStart: integer("quiet_hours_start").notNull().default(22 * 60),
  quietHoursEnd: integer("quiet_hours_end").notNull().default(8 * 60),
  notificationToggles: jsonb("notification_toggles")
    .$type<NotificationToggles>()
    .notNull()
    .default(
      sql`'{"money":true,"impulse":true,"payday":true,"goals":true,"documents":true,"digest":true,"system":true}'::jsonb`,
    ),
  energy: text("energy", { enum: ["low", "medium", "high"] }).notNull().default("medium"),
  energyUpdatedAt: timestamp("energy_updated_at", { withTimezone: true }),
  // free-form profile facts fed into Claude's cached prefix
  profile: jsonb("profile").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  timezone: text("timezone").notNull().default("Europe/London"),
  // day of month salary usually lands (detected or set); null = not yet known
  paydayDayOfMonth: integer("payday_day_of_month"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
  },
  (t) => [index("audit_log_kind_at_idx").on(t.kind, t.at)],
);
