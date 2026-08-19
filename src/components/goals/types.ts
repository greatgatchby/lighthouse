export type Energy = "low" | "medium" | "high";

export const ENERGY_LABEL: Record<Energy, string> = {
  low: "low energy",
  medium: "some focus",
  high: "good brain",
};

export const ENERGY_TONE: Record<Energy, "sea" | "neutral" | "beacon"> = {
  low: "sea",
  medium: "neutral",
  high: "beacon",
};

export interface GoalCardData {
  id: string;
  title: string;
  nextAction: string | null;
  excitement: number;
  energyRequired: Energy;
  estimatedMinutes: number | null;
}

export interface SparkData {
  id: string;
  text: string;
}

export interface ParkedGoalData {
  id: string;
  title: string;
  parkedLabel: string | null;
}
