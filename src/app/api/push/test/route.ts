import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { deliverToAll } from "@/lib/push";

export async function POST() {
  await requireUserId();
  const result = await deliverToAll({
    title: "Lighthouse",
    body: "The beacon is lit. Push works — even off the tailnet. 🗼",
    url: "/settings",
    category: "system",
    tag: "test-push",
  });
  return NextResponse.json(result, { status: "sent" in result && result.sent > 0 ? 201 : 200 });
}
