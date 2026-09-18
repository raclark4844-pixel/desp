import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/operations/session";
import { ZodError } from "zod";
import { SourceError } from "@/lib/lead-sources/contract";
export class EmployeeError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function employeeRoute(
  request: Request,
  run: () => Promise<NextResponse>,
) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  if (request.method !== "GET" && !sameOrigin(request))
    return NextResponse.json(
      { error: "Request origin rejected." },
      { status: 403, headers },
    );
  try {
    const response = await run();
    Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  } catch (error) {
    const status =
      error instanceof EmployeeError
        ? error.status
        : error instanceof ZodError || error instanceof SourceError
          ? 400
          : 503;
    return NextResponse.json(
      {
        error:
          error instanceof EmployeeError
            ? error.message
            : status === 400
              ? "Check the entered fields. Passwords must contain 12–128 characters."
              : "Account service is unavailable. Please try again.",
      },
      { status, headers },
    );
  }
}
