// Shared formatting: calm, no-pence money by default (design principle: one
// number, large and calm). Amounts are integer pence; negative = money out.

export function formatMoney(pence: number, opts: { showPence?: boolean; sign?: boolean } = {}) {
  const abs = Math.abs(pence);
  const pounds = opts.showPence ? (abs / 100).toFixed(2) : Math.round(abs / 100).toString();
  const withCommas = pounds.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = opts.sign && pence !== 0 ? (pence < 0 ? "−" : "+") : "";
  return `${sign}£${withCommas}`;
}

export function formatMoneyExact(pence: number) {
  return formatMoney(pence, { showPence: true });
}

/** Local calendar day string (YYYY-MM-DD) for a date in the app timezone. */
export function localDay(date: Date, timezone = "Europe/London"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatRelativeDay(date: Date, timezone = "Europe/London"): string {
  const today = localDay(new Date(), timezone);
  const day = localDay(date, timezone);
  if (day === today) return "Today";
  const yesterday = localDay(new Date(Date.now() - 86400_000), timezone);
  if (day === yesterday) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
  }).format(date);
}

/** Normalise a merchant/description for dedupe + merchant identity. */
export function normaliseMerchant(name: string): string {
  return name
    .toLowerCase()
    .replace(/\*|#|\d{4,}/g, " ") // card-terminal noise, long digit runs
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
