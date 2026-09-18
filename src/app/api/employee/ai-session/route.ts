import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { employeeFromRequest } from "@/lib/employee/auth";
import { sameOrigin } from "@/lib/operations/session";
import { boundedJson } from "@/lib/lead-sources/http";
import {
  sessionHash,
  aiSessionView,
  setAiSession,
} from "@/lib/inbox/ai-session";
import { monitorSession } from "@/lib/inbox/monitor";
import { SourceError } from "@/lib/lead-sources/contract";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
async function route(request: Request) {
  const employee = await employeeFromRequest(request);
  if (!employee)
    return NextResponse.json(
      { error: "Sign in required." },
      { status: 401, headers },
    );
  if (request.method !== "GET" && !sameOrigin(request))
    return NextResponse.json(
      { error: "Request origin rejected." },
      { status: 403, headers },
    );
  try {
    const hash = sessionHash(request);
    if (request.method === "POST") {
      const input = z
        .discriminatedUnion("action", [
          z
            .object({
              action: z.literal("CONSENT"),
              enabled: z.boolean(),
              confirm: z.literal(true),
            })
            .strict(),
          z.object({ action: z.literal("MONITOR") }).strict(),
        ])
        .parse(await boundedJson(request));
      if (input.action === "CONSENT")
        await setAiSession(hash, employee.id, input.enabled);
      else
        return NextResponse.json(
          { result: await monitorSession(hash, employee.id) },
          { headers },
        );
    }
    return NextResponse.json(
      { result: await aiSessionView(hash, employee.id) },
      { headers },
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof SourceError
            ? e.code
            : e instanceof ZodError
              ? "Check your selection."
              : "AI session service is unavailable.",
      },
      {
        status:
          e instanceof SourceError ? 409 : e instanceof ZodError ? 400 : 503,
        headers,
      },
    );
  }
}
export const GET = route;
export const POST = route;
