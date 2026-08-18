import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, asc, desc, eq, gte, ilike, isNull, lte, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/db";
import { safeToSpend } from "@/lib/finance/safeToSpend";

// Chat tool belt. Every tool returns a JSON string (raw data for Claude, not
// prose). Guardrail: move_money_to_pot NEVER executes — it parks a proposal in
// pending_confirmations for an explicit in-app confirmation tap.

export interface ToolContext {
  /** Push a structured event into the chat SSE stream (e.g. confirmation cards). */
  emit?: (event: Record<string, unknown>) => void;
}

export function buildTools(ctx: ToolContext = {}) {
  const queryTransactions = betaZodTool({
    name: "query_transactions",
    description:
      "Query transactions. Amounts are integer pence; negative = money out. Only live rows (cross-provider duplicates excluded). Returns rows plus totals.",
    inputSchema: z.object({
      from: z.string().optional().describe("ISO date (inclusive), e.g. 2026-07-01"),
      to: z.string().optional().describe("ISO date (inclusive)"),
      category: z.string().optional().describe("category slug, e.g. eating-out"),
      merchant: z.string().optional().describe("merchant name substring, case-insensitive"),
      search: z.string().optional().describe("description substring, case-insensitive"),
      direction: z.enum(["in", "out"]).optional(),
      limit: z.number().int().min(1).max(200).optional().describe("default 50"),
    }),
    run: async (input) => {
      const conditions = [
        isNull(tables.transactions.supersededBy),
        eq(tables.transactions.declined, false),
      ];
      if (input.from) conditions.push(gte(tables.transactions.postedAt, new Date(input.from)));
      if (input.to)
        conditions.push(lte(tables.transactions.postedAt, new Date(`${input.to}T23:59:59Z`)));
      if (input.direction === "in") conditions.push(gte(tables.transactions.amount, 0));
      if (input.direction === "out") conditions.push(lte(tables.transactions.amount, -1));
      if (input.search) conditions.push(ilike(tables.transactions.description, `%${input.search}%`));

      let categoryId: string | undefined;
      if (input.category) {
        const [cat] = await db
          .select()
          .from(tables.categories)
          .where(eq(tables.categories.slug, input.category))
          .limit(1);
        if (!cat) {
          const all = await db.select({ slug: tables.categories.slug }).from(tables.categories);
          return JSON.stringify({
            error: `unknown category '${input.category}'`,
            validCategories: all.map((c) => c.slug),
          });
        }
        categoryId = cat.id;
        conditions.push(eq(tables.transactions.categoryId, cat.id));
      }
      if (input.merchant) {
        conditions.push(
          dsql`${tables.transactions.merchantId} in (select id from merchants where display_name ilike ${"%" + input.merchant + "%"} or normalised_name ilike ${"%" + input.merchant.toLowerCase() + "%"})`,
        );
      }

      const rows = await db
        .select({
          postedAt: tables.transactions.postedAt,
          description: tables.transactions.description,
          amount: tables.transactions.amount,
          merchant: tables.merchants.displayName,
          category: tables.categories.slug,
        })
        .from(tables.transactions)
        .leftJoin(tables.merchants, eq(tables.transactions.merchantId, tables.merchants.id))
        .leftJoin(tables.categories, eq(tables.transactions.categoryId, tables.categories.id))
        .where(and(...conditions))
        .orderBy(desc(tables.transactions.postedAt))
        .limit(input.limit ?? 50);

      const totalOut = rows.reduce((s, r) => (r.amount < 0 ? s - r.amount : s), 0);
      const totalIn = rows.reduce((s, r) => (r.amount > 0 ? s + r.amount : s), 0);
      return JSON.stringify({
        count: rows.length,
        totalOutPence: totalOut,
        totalInPence: totalIn,
        note: categoryId ? undefined : "unfiltered by category",
        rows: rows.map((r) => ({
          date: r.postedAt.toISOString().slice(0, 10),
          description: r.description,
          merchant: r.merchant,
          category: r.category,
          amountPence: r.amount,
        })),
      });
    },
  });

  const getBalances = betaZodTool({
    name: "get_balances",
    description:
      "Current account balances, pots, and the safe-to-spend-today calculation. Pence.",
    inputSchema: z.object({}),
    run: async () => {
      const accounts = await db
        .select({
          name: tables.accounts.name,
          provider: tables.accounts.provider,
          balance: tables.accounts.balance,
          isPrimary: tables.accounts.isPrimary,
          updatedAt: tables.accounts.balanceUpdatedAt,
        })
        .from(tables.accounts)
        .where(eq(tables.accounts.closed, false));
      const pots = await db
        .select({
          name: tables.pots.name,
          balance: tables.pots.balance,
          goalAmount: tables.pots.goalAmount,
        })
        .from(tables.pots)
        .where(eq(tables.pots.deleted, false));
      const sts = await safeToSpend();
      return JSON.stringify({ accounts, pots, safeToSpend: sts });
    },
  });

  const listGoals = betaZodTool({
    name: "list_goals",
    description: "List goals, optionally filtered by status (spark/active/parked/done).",
    inputSchema: z.object({
      status: z.enum(["spark", "active", "parked", "done"]).optional(),
    }),
    run: async (input) => {
      const rows = await db
        .select()
        .from(tables.goals)
        .where(input.status ? eq(tables.goals.status, input.status) : undefined)
        .orderBy(desc(tables.goals.excitement), asc(tables.goals.createdAt));
      return JSON.stringify(
        rows.map((g) => ({
          id: g.id,
          title: g.title,
          why: g.why,
          status: g.status,
          excitement: g.excitement,
          nextAction: g.nextAction,
          estimatedMinutes: g.estimatedMinutes,
          energyRequired: g.energyRequired,
          area: g.area,
        })),
      );
    },
  });

  const createGoal = betaZodTool({
    name: "create_goal",
    description:
      "Create a goal. nextAction must be ONE sentence and genuinely doable in a sitting — rewrite it smaller if it's vague.",
    inputSchema: z.object({
      title: z.string(),
      why: z.string().optional().describe("the felt reason this matters, in their words"),
      area: z.string().optional(),
      excitement: z.number().int().min(1).max(5).optional(),
      nextAction: z.string().optional(),
      estimatedMinutes: z.number().int().optional(),
      energyRequired: z.enum(["low", "medium", "high"]).optional(),
      status: z.enum(["spark", "active"]).optional(),
    }),
    run: async (input) => {
      const [goal] = await db
        .insert(tables.goals)
        .values({
          title: input.title,
          why: input.why,
          area: input.area,
          excitement: input.excitement ?? 3,
          nextAction: input.nextAction,
          estimatedMinutes: input.estimatedMinutes,
          energyRequired: input.energyRequired ?? "medium",
          status: input.status ?? "active",
        })
        .returning();
      ctx.emit?.({ type: "goal_created", goalId: goal.id, title: goal.title });
      return JSON.stringify({ created: true, id: goal.id, title: goal.title });
    },
  });

  const logMeal = betaZodTool({
    name: "log_meal",
    description: "Log a meal. Estimates are fine — logged beats precise.",
    inputSchema: z.object({
      name: z.string(),
      description: z.string().optional(),
      calories: z.number().int().optional(),
      proteinG: z.number().int().optional(),
      carbsG: z.number().int().optional(),
      fatG: z.number().int().optional(),
      at: z.string().optional().describe("ISO datetime; defaults to now"),
    }),
    run: async (input) => {
      const [meal] = await db
        .insert(tables.meals)
        .values({
          name: input.name,
          description: input.description,
          calories: input.calories,
          proteinG: input.proteinG,
          carbsG: input.carbsG,
          fatG: input.fatG,
          at: input.at ? new Date(input.at) : new Date(),
          source: "chat",
        })
        .returning();
      return JSON.stringify({ logged: true, id: meal.id });
    },
  });

  const logWorkout = betaZodTool({
    name: "log_workout",
    description: "Log a workout / movement session.",
    inputSchema: z.object({
      kind: z.string().describe("e.g. run, gym, climb, walk"),
      minutes: z.number().int().optional(),
      intensity: z.enum(["easy", "moderate", "hard"]).optional(),
      note: z.string().optional(),
      at: z.string().optional().describe("ISO datetime; defaults to now"),
    }),
    run: async (input) => {
      const [workout] = await db
        .insert(tables.workouts)
        .values({
          kind: input.kind,
          minutes: input.minutes,
          intensity: input.intensity,
          note: input.note,
          at: input.at ? new Date(input.at) : new Date(),
          source: "chat",
        })
        .returning();
      return JSON.stringify({ logged: true, id: workout.id });
    },
  });

  const addToReadingList = betaZodTool({
    name: "add_to_reading_list",
    description: "Add a book/article/paper to the reading list.",
    inputSchema: z.object({
      title: z.string(),
      author: z.string().optional(),
      url: z.string().optional(),
      kind: z.enum(["book", "article", "paper", "other"]).optional(),
    }),
    run: async (input) => {
      const [item] = await db
        .insert(tables.readingItems)
        .values({
          title: input.title,
          author: input.author,
          url: input.url,
          kind: input.kind ?? "book",
        })
        .returning();
      return JSON.stringify({ added: true, id: item.id });
    },
  });

  const searchDocuments = betaZodTool({
    name: "search_documents",
    description: "Full-text search over filed documents (titles, summaries, extracted text).",
    inputSchema: z.object({
      query: z.string(),
      limit: z.number().int().min(1).max(25).optional(),
    }),
    run: async (input) => {
      // expression must match documents_fts_idx exactly for the index to be used
      const fts = dsql`to_tsvector('english', coalesce(${tables.documents.title}, '') || ' ' || coalesce(${tables.documents.summary}, '') || ' ' || coalesce(${tables.documents.extractedText}, ''))`;
      const rows = await db
        .select({
          id: tables.documents.id,
          title: tables.documents.title,
          docType: tables.documents.docType,
          issuer: tables.documents.issuer,
          issuedAt: tables.documents.issuedAt,
          expiresAt: tables.documents.expiresAt,
          summary: tables.documents.summary,
          folder: tables.folders.name,
        })
        .from(tables.documents)
        .leftJoin(tables.folders, eq(tables.documents.folderId, tables.folders.id))
        .where(dsql`${fts} @@ plainto_tsquery('english', ${input.query})`)
        .orderBy(dsql`ts_rank(${fts}, plainto_tsquery('english', ${input.query})) desc`)
        .limit(input.limit ?? 10);
      return JSON.stringify({ count: rows.length, results: rows });
    },
  });

  const scheduleNudge = betaZodTool({
    name: "schedule_nudge",
    description:
      "Schedule a one-off push notification for later. Write the message as a friendly note from their past self.",
    inputSchema: z.object({
      message: z.string(),
      inMinutes: z.number().int().min(1).optional(),
      at: z.string().optional().describe("ISO datetime (overrides inMinutes)"),
      url: z.string().optional().describe("in-app path to open, e.g. /goals"),
      category: z.enum(["money", "goals", "documents", "system"]).optional(),
    }),
    run: async (input) => {
      const when = input.at
        ? new Date(input.at)
        : new Date(Date.now() + (input.inMinutes ?? 60) * 60_000);
      const [nudge] = await db
        .insert(tables.nudges)
        .values({
          message: input.message,
          category: input.category ?? "system",
          url: input.url,
          scheduledFor: when,
        })
        .returning();
      return JSON.stringify({ scheduled: true, id: nudge.id, for: when.toISOString() });
    },
  });

  const moveMoneyToPot = betaZodTool({
    name: "move_money_to_pot",
    description:
      "PROPOSE moving money from the main account into a pot. This never executes — it creates a confirmation the person approves with a tap. Never claim the money has moved.",
    inputSchema: z.object({
      potName: z.string().describe("pot name, matched case-insensitively"),
      amountPence: z.number().int().min(1),
      reason: z.string().optional().describe("one short line shown on the confirm card"),
    }),
    run: async (input) => {
      const [pot] = await db
        .select()
        .from(tables.pots)
        .where(and(ilike(tables.pots.name, `%${input.potName}%`), eq(tables.pots.deleted, false)))
        .limit(1);
      if (!pot) {
        const all = await db
          .select({ name: tables.pots.name })
          .from(tables.pots)
          .where(eq(tables.pots.deleted, false));
        return JSON.stringify({
          error: `no pot matching '${input.potName}'`,
          availablePots: all.map((p) => p.name),
        });
      }
      const [proposal] = await db
        .insert(tables.pendingConfirmations)
        .values({
          kind: "pot_deposit",
          payload: {
            potId: pot.id,
            monzoPotId: pot.monzoPotId,
            potName: pot.name,
            amountPence: input.amountPence,
            reason: input.reason ?? null,
          },
        })
        .returning();
      ctx.emit?.({
        type: "confirmation",
        proposalId: proposal.id,
        kind: "pot_deposit",
        potName: pot.name,
        amountPence: input.amountPence,
        reason: input.reason ?? null,
      });
      return JSON.stringify({
        proposed: true,
        proposalId: proposal.id,
        pot: pot.name,
        amountPence: input.amountPence,
        status: "awaiting in-app confirmation tap — tell them it's ready to confirm",
      });
    },
  });

  return [
    queryTransactions,
    getBalances,
    listGoals,
    createGoal,
    logMeal,
    logWorkout,
    addToReadingList,
    searchDocuments,
    scheduleNudge,
    moveMoneyToPot,
  ];
}
