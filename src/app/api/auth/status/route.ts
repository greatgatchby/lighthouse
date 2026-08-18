import { NextResponse } from "next/server";
import { db, tables } from "@/db";

/** Used by the login page to decide whether to offer first-run registration. */
export async function GET() {
  const creds = await db
    .select({ id: tables.webauthnCredentials.id })
    .from(tables.webauthnCredentials);
  return NextResponse.json({ hasCredentials: creds.length > 0 });
}
