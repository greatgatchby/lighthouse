import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, tables } from "@/db";
import { rpID } from "@/lib/env";

/** Used by the login page to decide whether to offer first-run registration.
 * Scoped to this origin's relying-party ID — a passkey enrolled against
 * localhost says nothing about whether the tailnet hostname has one. */
export async function GET() {
  const creds = await db
    .select({ id: tables.webauthnCredentials.id })
    .from(tables.webauthnCredentials)
    .where(eq(tables.webauthnCredentials.rpId, rpID()));
  return NextResponse.json({ hasCredentials: creds.length > 0 });
}
