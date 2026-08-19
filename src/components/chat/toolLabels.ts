// Tool events become small, past-tense chips. The person should never see a
// function name — only a calm note about what was just looked at or done.

const LABELS: Record<string, string> = {
  query_transactions: "🪙 checked transactions",
  get_balances: "🪙 checked balances",
  list_goals: "✨ looked at your goals",
  create_goal: "✨ created a goal",
  log_meal: "🍜 logged a meal",
  log_workout: "🏃 logged a session",
  add_to_reading_list: "📚 added to the reading list",
  search_documents: "📄 searched documents",
  schedule_nudge: "⏰ set a reminder",
  move_money_to_pot: "🪙 proposed a transfer",
};

export function toolLabel(name: string): string {
  return LABELS[name] ?? `· ${name.replace(/_/g, " ")}`;
}
