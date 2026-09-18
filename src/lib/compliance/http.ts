import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { isAuthorizedInternalRequest } from "../internal-auth";
import { boundedJson } from "../lead-sources/http";
import { SourceError } from "../lead-sources/contract";
export async function complianceRoute(
  request: Request,
  run: (body: unknown) => Promise<unknown>,
) {
  const headers = { "Cache-Control": "no-store" };
  if (!isAuthorizedInternalRequest(request))
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers },
    );
  try {
    return NextResponse.json(
      { ok: true, result: await run(await boundedJson(request)) },
      { headers },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof SourceError
            ? error.code
            : error instanceof ZodError
              ? "INVALID_EVIDENCE"
              : "COMPLIANCE_REQUEST_FAILED",
      },
      {
        status:
          error instanceof ZodError
            ? 400
            : error instanceof SourceError
              ? error.code === "TARGET_NOT_FOUND"
                ? 404
                : 409
              : 500,
        headers,
      },
    );
  }
}
