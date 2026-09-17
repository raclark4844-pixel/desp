import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorizedInternalRequest } from "@/lib/internal-auth";
import { dispatchLeadSourceJob } from "@/lib/lead-sources/service";

export const runtime = "nodejs";

const jobIdSchema = z.string().uuid();

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  if (!isAuthorizedInternalRequest(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  const { jobId } = await context.params;
  const parsedId = jobIdSchema.safeParse(jobId);

  if (!parsedId.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid provider job ID." },
      { status: 400 },
    );
  }

  try {
    const result = await dispatchLeadSourceJob(parsedId.data);

    if (result.kind === "not_found") {
      return NextResponse.json(
        { ok: false, error: "Provider job not found." },
        { status: 404 },
      );
    }

    if (result.kind === "invalid_job" || result.kind === "invalid_status") {
      return NextResponse.json(
        { ok: false, error: "Provider job cannot be dispatched.", ...result },
        { status: 409 },
      );
    }

    if (result.kind === "no_source") {
      return NextResponse.json(
        {
          ok: false,
          error: "No eligible lead source is available.",
          ...result,
        },
        { status: 503 },
      );
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("lead source dispatch failed", error);
    return NextResponse.json(
      { ok: false, error: "Unable to dispatch lead source job." },
      { status: 500 },
    );
  }
}
