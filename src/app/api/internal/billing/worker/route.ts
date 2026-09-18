import { timingSafeEqual } from "node:crypto";
import { billingWorker } from "@/lib/billing/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET,
    a = Buffer.from(`Bearer ${secret}`),
    b = Buffer.from(request.headers.get("authorization") ?? "");
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b))
    return new Response("Unauthorized", { status: 401 });
  try {
    return Response.json(await billingWorker(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Billing worker requires attention." },
      { status: 503 },
    );
  }
}
