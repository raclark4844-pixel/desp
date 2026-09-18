import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { isAuthorizedInternalRequest } from "../internal-auth";
import { sessionFromRequest, sameOrigin } from "./session";
import { SourceError } from "../lead-sources/contract";
export async function reviewRoute(
  request: Request,
  run: () => Promise<unknown>,
  write = false,
) {
  const headers = { "Cache-Control": "no-store, private", Vary: "Cookie" };
  const hasKey = isAuthorizedInternalRequest(request);
  if (!hasKey && (write || !sessionFromRequest(request)))
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers },
    );
  if (request.method !== "GET" && !sameOrigin(request))
    return NextResponse.json(
      { ok: false, error: "ORIGIN_REJECTED" },
      { status: 403, headers },
    );
  try {
    return NextResponse.json({ ok: true, result: await run() }, { headers });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error:
          e instanceof SourceError
            ? e.code
            : e instanceof ZodError
              ? "INVALID_REVIEW_INPUT"
              : "REVIEW_UNAVAILABLE",
      },
      {
        status:
          e instanceof ZodError
            ? 400
            : e instanceof SourceError
              ? e.code === "TARGET_NOT_FOUND"
                ? 404
                : 409
              : 500,
        headers,
      },
    );
  }
}
