import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { employeeFromRequest } from "@/lib/employee/auth";
import { sameOrigin } from "@/lib/operations/session";
import { boundedJson } from "@/lib/lead-sources/http";
import { SourceError } from "@/lib/lead-sources/contract";
import {
  createDraft,
  controlBatch,
  sendingOverview,
} from "@/lib/outreach/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
async function route(request: Request, action: "READ" | "DRAFT" | "CONTROL") {
  const employee = await employeeFromRequest(request);
  if (!employee)
    return NextResponse.json(
      { error: "Sign in required." },
      { status: 401, headers },
    );
  if (action !== "READ" && !sameOrigin(request))
    return NextResponse.json(
      { error: "Request origin rejected." },
      { status: 403, headers },
    );
  if (action === "CONTROL" && !employee.isAdmin)
    return NextResponse.json(
      { error: "Only an administrator can approve or control sending." },
      { status: 403, headers },
    );
  try {
    const result =
      action === "READ"
        ? await sendingOverview()
        : action === "DRAFT"
          ? await createDraft(await boundedJson(request), employee.id)
          : await controlBatch(await boundedJson(request), employee.id);
    return NextResponse.json({ result }, { headers });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof SourceError
            ? e.code
            : e instanceof ZodError
              ? e.issues.map((i) => i.message).join(" ")
              : "Sending workspace unavailable.",
      },
      {
        status:
          e instanceof SourceError ? 409 : e instanceof ZodError ? 400 : 503,
        headers,
      },
    );
  }
}
export const GET = (r: Request) => route(r, "READ");
export const POST = (r: Request) => route(r, "DRAFT");
export const PATCH = (r: Request) => route(r, "CONTROL");
