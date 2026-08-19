import { createHash } from "node:crypto";
import { normaliseMerchant } from "@/lib/format";

// CSV import — the escape hatch for anything neither Monzo nor Lunchflow can
// reach (an old bank export, a spreadsheet, a statement from a closed account).
//
// Column detection is case-insensitive and forgiving: Date / Description /
// Amount are required, Merchant and Category are used when present. Amounts
// may be signed, parenthesised, or split across Money In / Money Out columns.
//
// Row ids are content-derived, so re-importing the same file updates the same
// rows instead of duplicating them.

export interface CsvTransaction {
  providerTxId: string;
  postedAt: Date;
  amount: number; // signed pence
  description: string;
  merchantName: string | null;
  categoryHint: string | null;
}

export interface CsvParseResult {
  rows: CsvTransaction[];
  skipped: number;
  total: number;
  columns: DetectedColumns;
}

export interface DetectedColumns {
  date: number;
  description: number;
  amount: number;
  /** separate credit / debit columns, when the file has no single amount column */
  moneyIn: number;
  moneyOut: number;
  merchant: number;
  category: number;
}

export class CsvFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvFormatError";
  }
}

// ------------------------------------------------------------------ parsing

/** RFC4180-ish: quoted fields, doubled quotes, CRLF or LF, no trailing blank rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

function indexOfHeader(header: string[], candidates: RegExp[]): number {
  for (const candidate of candidates) {
    const index = header.findIndex((cell) => candidate.test(cell));
    if (index >= 0) return index;
  }
  return -1;
}

export function detectColumns(headerRow: string[]): DetectedColumns {
  const header = headerRow.map((cell) => cell.trim().toLowerCase());
  return {
    date: indexOfHeader(header, [/^date$/, /date.*time/, /^transaction date$/, /\bdate\b/]),
    description: indexOfHeader(header, [
      /^description$/,
      /^details?$/,
      /^narrative$/,
      /^reference$/,
      /\bdescription\b/,
      /\bmemo\b/,
    ]),
    amount: indexOfHeader(header, [/^amount$/, /^value$/, /amount.*gbp/, /\bamount\b/]),
    moneyIn: indexOfHeader(header, [/money in/, /^credit$/, /paid in/, /\bin\b.*amount/]),
    moneyOut: indexOfHeader(header, [/money out/, /^debit$/, /paid out/, /\bout\b.*amount/]),
    merchant: indexOfHeader(header, [/^merchant$/, /^payee$/, /^name$/, /counterparty/]),
    category: indexOfHeader(header, [/^category$/, /^type$/, /categor/]),
  };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse a statement date. UK order wins ties (17/03 and 03/17 both work; 03/04
 * is the 3rd of April), because these files come from UK banks.
 */
export function parseCsvDate(value: string): Date | null {
  const raw = value.trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return utcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slash = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (slash) {
    let day = Number(slash[1]);
    let month = Number(slash[2]);
    if (month > 12 && day <= 12) [day, month] = [month, day];
    const year = normaliseYear(Number(slash[3]));
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return utcDate(year, month, day);
    return null;
  }

  const named = raw.match(/^(\d{1,2})[\s-]*([A-Za-z]{3,})[\s-]*(\d{2,4})/);
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month) return utcDate(normaliseYear(Number(named[3])), month, Number(named[1]));
  }

  const namedFirst = raw.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{2,4})/);
  if (namedFirst) {
    const month = MONTHS[namedFirst[1].slice(0, 3).toLowerCase()];
    if (month) return utcDate(normaliseYear(Number(namedFirst[3])), month, Number(namedFirst[2]));
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function normaliseYear(year: number): number {
  if (year >= 1000) return year;
  return year < 70 ? 2000 + year : 1900 + year;
}

function utcDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Signed pence from a statement cell: "£1,234.56", "(12.30)", "-4.50", "450". */
export function parseCsvAmount(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw) || raw.includes("-");
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) return null;
  // a decimal point means pounds; a bare integer in a statement is pounds too,
  // so only treat it as pence when the header said so (never here)
  const pence = Math.round(numeric * 100);
  return negative ? -pence : pence;
}

function stableId(date: Date, amount: number, description: string, occurrence: number): string {
  const day = date.toISOString().slice(0, 10);
  const digest = createHash("sha256")
    .update(`${day}|${amount}|${normaliseMerchant(description)}|${occurrence}`)
    .digest("hex");
  return `csv-${digest.slice(0, 32)}`;
}

/**
 * Parse a whole statement. Throws CsvFormatError when the required columns
 * aren't there — everything else degrades to a skipped row.
 */
export function parseStatement(text: string): CsvParseResult {
  const grid = parseCsv(text);
  if (grid.length === 0) throw new CsvFormatError("That file looked empty.");

  const columns = detectColumns(grid[0]);
  if (columns.date < 0) {
    throw new CsvFormatError("Couldn’t find a Date column — add one and try again.");
  }
  if (columns.amount < 0 && columns.moneyIn < 0 && columns.moneyOut < 0) {
    throw new CsvFormatError("Couldn’t find an Amount column — add one and try again.");
  }

  const rows: CsvTransaction[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;

  for (let i = 1; i < grid.length; i += 1) {
    const cells = grid[i];
    const cell = (index: number) => (index >= 0 ? (cells[index] ?? "").trim() : "");

    const postedAt = parseCsvDate(cell(columns.date));
    if (!postedAt) {
      skipped += 1;
      continue;
    }

    let amount: number | null = null;
    if (columns.amount >= 0) amount = parseCsvAmount(cell(columns.amount));
    if (amount === null && columns.moneyOut >= 0) {
      const out = parseCsvAmount(cell(columns.moneyOut));
      if (out !== null && out !== 0) amount = -Math.abs(out);
    }
    if (amount === null && columns.moneyIn >= 0) {
      const inbound = parseCsvAmount(cell(columns.moneyIn));
      if (inbound !== null && inbound !== 0) amount = Math.abs(inbound);
    }
    if (amount === null || amount === 0) {
      skipped += 1;
      continue;
    }

    const merchantName = cell(columns.merchant) || null;
    const description = cell(columns.description) || merchantName || "Transaction";

    const fingerprint = `${postedAt.toISOString().slice(0, 10)}|${amount}|${normaliseMerchant(description)}`;
    const occurrence = seen.get(fingerprint) ?? 0;
    seen.set(fingerprint, occurrence + 1);

    rows.push({
      providerTxId: stableId(postedAt, amount, description, occurrence),
      postedAt,
      amount,
      description,
      merchantName,
      categoryHint: cell(columns.category) || null,
    });
  }

  return { rows, skipped, total: Math.max(0, grid.length - 1), columns };
}

/** Stable provider account id for a named CSV account ("Old Barclays" → "old-barclays"). */
export function csvAccountKey(accountName: string): string {
  const slug = accountName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || `csv-${createHash("sha256").update(accountName).digest("hex").slice(0, 12)}`;
}
