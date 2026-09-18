import { dispatchNotification } from "@/lib/inbox/notifications";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { dispatchNext } from "@/lib/outreach/service";
import { isAuthorizedInternalRequest } from "@/lib/internal-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
async function run() {
  try {
    const notification = await dispatchNotification();
    return NextResponse.json(
      { ...(await dispatchNext()), notification },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "Sending worker unavailable." },
      { status: 503 },
    );
  }
}
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const a = Buffer.from(`Bearer ${expected}`),
    b = Buffer.from(request.headers.get("authorization") ?? "");
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b))
    return new Response("Unauthorized", { status: 401 });
  return run();
}
export async function POST(request: Request) {
  if (!isAuthorizedInternalRequest(request))
    return new Response("Unauthorized", { status: 401 });
  return run();
}
