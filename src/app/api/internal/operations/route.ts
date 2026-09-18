import { employeeFromRequest } from "@/lib/employee/auth";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { sessionFromRequest } from "@/lib/operations/session";
import { isAuthorizedInternalRequest } from "@/lib/internal-auth";
import { getOperations } from "@/lib/operations/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store, private", Vary: "Cookie" };
  if (!sessionFromRequest(request) && !isAuthorizedInternalRequest(request) && !(await employeeFromRequest(request)))
    return NextResponse.json(
      { ok: false, error: "Sign in to view operations." },
      { status: 401, headers },
    );
  try {
    const params = new URL(request.url).searchParams;
    const result = await getOperations(Object.fromEntries(params));
    return NextResponse.json({ ok: true, result }, { headers });
  } catch (e) {
    const missing =
      e instanceof Error &&
      ["CUSTOMER_NOT_FOUND", "CAMPAIGN_NOT_FOUND"].includes(e.message);
    return NextResponse.json(
      {
        ok: false,
        error:
          e instanceof ZodError
            ? "Check your search and selection."
            : missing
              ? "Selection not found."
              : "Operations data is temporarily unavailable.",
      },
      { status: e instanceof ZodError ? 400 : missing ? 404 : 500, headers },
    );
  }
}
