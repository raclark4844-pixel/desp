import { after } from "next/server";
import { dispatchNotification } from "@/lib/inbox/notifications";
import { resendWebhook } from "@/lib/outreach/webhooks";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const response = await resendWebhook(request);
    if (response.ok)
      after(async () => {
        await Promise.allSettled([
          dispatchNotification(),
          dispatchNotification(),
          dispatchNotification(),
        ]);
      });
    return response;
  } catch {
    return new Response("Webhook unavailable", { status: 503 });
  }
}
