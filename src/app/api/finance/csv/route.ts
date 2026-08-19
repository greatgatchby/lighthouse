import { NextResponse } from "next/server";
import { db, tables } from "@/db";
import { requireUserId } from "@/lib/auth/session";
import { ingestTransactions, upsertAccount } from "@/lib/finance/ingest";
import { CsvFormatError, csvAccountKey, parseStatement } from "@/lib/providers/csv";

// Import a statement nobody's API will give us — an old account, a closed bank,
// a spreadsheet. Rows are content-addressed, so re-importing the same file
// updates rather than duplicates.

export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  await requireUserId();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  const accountName = (form.get("accountName") ?? "").toString().trim();

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Pick a CSV file to import." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That file is larger than 10MB." }, { status: 413 });
  }
  if (!accountName) {
    return NextResponse.json({ error: "Give the account a name." }, { status: 400 });
  }

  const text = await file.text();

  const parsed = (() => {
    try {
      return parseStatement(text);
    } catch (err) {
      if (err instanceof CsvFormatError) return err;
      throw err;
    }
  })();

  if (parsed instanceof CsvFormatError) {
    return NextResponse.json({ error: parsed.message }, { status: 400 });
  }

  const accountId = await upsertAccount({
    provider: "csv",
    providerAccountId: csvAccountKey(accountName),
    name: accountName,
    type: "csv",
  });

  const result = await ingestTransactions(
    accountId,
    parsed.rows.map((row) => ({
      providerTxId: row.providerTxId,
      postedAt: row.postedAt,
      amount: row.amount,
      description: row.description,
      merchantName: row.merchantName ?? row.description,
      providerCategory: row.categoryHint,
    })),
  );

  const imported = result.inserted + result.updated;
  const skipped = parsed.skipped + result.skipped;

  await db.insert(tables.csvImports).values({
    filename: file.name || "statement.csv",
    accountId,
    rowCount: parsed.total,
    importedCount: imported,
  });

  await db.insert(tables.auditLog).values({
    kind: "finance:csv_import",
    detail: {
      accountId,
      accountName,
      filename: file.name,
      imported,
      inserted: result.inserted,
      skipped,
    },
  });

  return NextResponse.json({ imported, skipped, accountId });
}
