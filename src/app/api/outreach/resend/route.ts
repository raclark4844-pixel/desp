import { resendWebhook } from "@/lib/outreach/webhooks";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    return await resendWebhook(request);
  } catch {
    return new Response("Webhook unavailable", { status: 503 });
  }
}
