// Calendar helpers shared by the tracker pages and their APIs.
// Lives under components/trackers because that's this vertical's owned tree;
// it is a pure module (no React, no server-only imports) so both sides can use it.

import { localDay } from "@/lib/format";

/** Shift a YYYY-MM-DD day string by whole calendar days (DST-proof: pure date maths). */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + delta * 86_400_000);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

/** The last `n` local calendar days, oldest → newest, ending today. */
export function lastLocalDays(n: number, timezone: string, now: Date = new Date()): string[] {
  const today = localDay(now, timezone);
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) days.push(shiftDay(today, -i));
  return days;
}

/** "Today" / "Yesterday" / "Tue 12 Aug" for a YYYY-MM-DD day string. */
export function dayLabel(day: string, timezone: string, now: Date = new Date()): string {
  const today = localDay(now, timezone);
  if (day === today) return "Today";
  if (day === shiftDay(today, -1)) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Single narrow weekday letter for the 7-day strip. */
export function weekdayInitial(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "narrow" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** Clock time for a timestamp, rendered in the app timezone (SSR-stable). */
export function clockTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Group rows carrying an `at` timestamp into the last `n` local days, oldest → newest. */
export function groupByLocalDay<T extends { at: Date }>(
  rows: T[],
  n: number,
  timezone: string,
): { day: string; rows: T[] }[] {
  const keys = lastLocalDays(n, timezone);
  const buckets = new Map<string, T[]>(keys.map((k) => [k, []]));
  for (const row of rows) {
    buckets.get(localDay(row.at, timezone))?.push(row);
  }
  return keys.map((day) => ({ day, rows: buckets.get(day) ?? [] }));
}
