import { employeeFromRequest } from "@/lib/employee/auth";
import { sameOrigin } from "@/lib/operations/session";
import { NextResponse } from "next/server";
import { z } from "zod";
import { activateCampaign } from "@/lib/campaign-service";
import { isAuthorizedInternalRequest } from "@/lib/internal-auth";
import { dispatchLeadSourceJob } from "@/lib/lead-sources/service";

export const runtime = "nodejs";

const campaignIdSchema = z.string().uuid();

export async function POST(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  const machine = isAuthorizedInternalRequest(request);
  const employee = machine ? null : await employeeFromRequest(request);
  if (!machine && !employee) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  if (!machine && (!employee?.isAdmin || !sameOrigin(request))) {
    return NextResponse.json(
      {
        ok: false,
        error: "An administrator must activate lead collection from this site.",
      },
      { status: 403 },
    );
  }
  if (!machine && request.headers.get("x-confirm-lead-collection") !== "yes") {
    return NextResponse.json(
      {
        ok: false,
        error: "Confirm lead collection and possible provider charges first.",
      },
      { status: 400 },
    );
  }

  const { campaignId } = await context.params;
  const parsedId = campaignIdSchema.safeParse(campaignId);

  if (!parsedId.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid campaign ID." },
      { status: 400 },
    );
  }

  try {
    const result = await activateCampaign(parsedId.data, employee?.id);

    if (result.kind === "not_found") {
      return NextResponse.json(
        { ok: false, error: "Campaign not found." },
        { status: 404 },
      );
    }

    if (result.kind === "already_queued" && result.jobStatus === "SUCCEEDED") {
      return NextResponse.json({
        ok: true,
        ...result,
        routing: { kind: "already_routed", jobId: result.jobId },
      });
    }

    const routing = await dispatchLeadSourceJob(result.jobId);

    if (routing.kind === "no_source") {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Campaign activated, but no eligible lead source is available.",
          activation: result,
          routing,
        },
        { status: 503 },
      );
    }

    if (routing.kind === "invalid_job" || routing.kind === "invalid_status") {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Campaign activated, but the source-routing job could not be dispatched.",
          activation: result,
          routing,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, ...result, routing });
  } catch (error) {
    console.error("campaign activation failed", error);
    return NextResponse.json(
      { ok: false, error: "Unable to activate campaign." },
      { status: 500 },
    );
  }
}
