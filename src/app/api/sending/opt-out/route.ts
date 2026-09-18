import { NextResponse } from "next/server";
import { z } from "zod";
import { employeeFromRequest } from "@/lib/employee/auth";
import { sameOrigin } from "@/lib/operations/session";
import { boundedJson } from "@/lib/lead-sources/http";
import { suppressRecipient } from "@/lib/outreach/webhooks";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "Request origin rejected." },
      { status: 403, headers },
    );
  const employee = await employeeFromRequest(request);
  if (!employee)
    return NextResponse.json(
      { error: "Sign in required." },
      { status: 401, headers },
    );
  try {
    const { id } = z
      .object({ id: z.string().uuid() })
      .strict()
      .parse(await boundedJson(request));
    await suppressRecipient(id, employee.id);
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json(
      { error: "Unable to record opt-out." },
      { status: 400, headers },
    );
  }
}
