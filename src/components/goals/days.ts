import { localDay } from "@/lib/format";

/**
 * The last `n` local calendar days as YYYY-MM-DD strings, oldest first.
 * Walks back in UTC from *today's local day* rather than subtracting 24h from
 * `now`, so the 23- and 25-hour days around a BST switch never duplicate or
 * skip a day in the streak.
 */
export function lastLocalDays(n: number, timezone = "Europe/London"): string[] {
  const today = localDay(new Date(), timezone);
  const [year, month, day] = today.split("-").map(Number);
  const base = Date.UTC(year, month - 1, day);
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    days.push(new Date(base - i * 86400_000).toISOString().slice(0, 10));
  }
  return days;
}
