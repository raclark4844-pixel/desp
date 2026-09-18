import { NextResponse } from "next/server";
import { z } from "zod";
import { employeeFromRequest } from "@/lib/employee/auth";
import { sameOrigin } from "@/lib/operations/session";
import { boundedJson } from "@/lib/lead-sources/http";
import { billingAction } from "@/lib/billing/service";
export async function POST(request: Request) {
  const employee = await employeeFromRequest(request);
  if (!employee)
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!employee.isAdmin || !sameOrigin(request))
    return NextResponse.json(
      { error: "Administrator access and matching origin required." },
      { status: 403 },
    );
  try {
    await billingAction(await boundedJson(request), employee.id);
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof z.ZodError
            ? "Check the entered information."
            : "Unable to save. Please refresh and try again.",
      },
      { status: 400 },
    );
  }
}
