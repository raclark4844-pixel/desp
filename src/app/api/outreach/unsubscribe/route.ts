import { unsubscribe } from "@/lib/outreach/webhooks";
export const runtime = "nodejs";
const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
};
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!/^[a-f0-9-]{36}$/i.test(token))
    return new Response("Invalid link", { status: 400, headers });
  return new Response(
    '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unsubscribe</title><h1>Unsubscribe</h1><p>Stop marketing messages from this sender.</p><form method="post"><button type="submit">Unsubscribe</button></form></html>',
    { headers },
  );
}
export async function POST(request: Request) {
  try {
    const ok = await unsubscribe(
      new URL(request.url).searchParams.get("token") ?? "",
    );
    return new Response(
      ok ? "You have been unsubscribed." : "Invalid unsubscribe link.",
      { status: ok ? 200 : 400, headers },
    );
  } catch {
    return new Response("Please try again.", { status: 503, headers });
  }
}
