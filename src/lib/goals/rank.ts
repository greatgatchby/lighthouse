// Interest-first ranking: excitement × freshness × energy match.
// Never priority-first — the dashboard shows what's actually doable right now.

import type { goals } from "@/db/schema/goals";

type Goal = typeof goals.$inferSelect;
type Energy = "low" | "medium" | "high";

const ENERGY_ORDER: Energy[] = ["low", "medium", "high"];

/** Excitement decays with a ~3 week half-life since it was last refreshed. */
export function decayedExcitement(goal: Goal, now = new Date()): number {
  const days = Math.max(0, (now.getTime() - goal.excitementUpdatedAt.getTime()) / 86400_000);
  return goal.excitement * Math.pow(0.5, days / 21);
}

/** 1 when required energy matches current energy; falls off per step apart.
 * Low-energy goals stay decent at high energy (easy wins are always fine);
 * high-energy goals score hard-zero-ish on a low-energy day. */
export function energyMatch(required: Energy, current: Energy): number {
  const gap = ENERGY_ORDER.indexOf(required) - ENERGY_ORDER.indexOf(current);
  if (gap <= 0) return gap === 0 ? 1 : 0.85; // at or below current energy
  return gap === 1 ? 0.45 : 0.15; // above current energy
}

export function goalScore(goal: Goal, currentEnergy: Energy, now = new Date()): number {
  const excitement = decayedExcitement(goal, now);
  const match = energyMatch(goal.energyRequired as Energy, currentEnergy);
  // gentle boost for goals with a ready next action — activation energy matters
  const actionable = goal.nextAction ? 1.15 : 1;
  return excitement * match * actionable;
}

export function rankGoals<T extends Goal>(rows: T[], currentEnergy: Energy, now = new Date()): T[] {
  return [...rows].sort((a, b) => goalScore(b, currentEnergy, now) - goalScore(a, currentEnergy, now));
}
