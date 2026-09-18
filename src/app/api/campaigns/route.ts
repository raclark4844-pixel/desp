import { employeeFromRequest } from "@/lib/employee/auth";
import { sameOrigin } from "@/lib/operations/session";
import { isAuthorizedInternalRequest } from "@/lib/internal-auth";
import { NextResponse } from "next/server";
import { campaignIntakeSchema } from "@/lib/campaign-schema";
import {
  createCampaignIntake,
  CustomerIntakeError,
} from "@/lib/campaign-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const machine = isAuthorizedInternalRequest(request);
  const employee = machine ? null : await employeeFromRequest(request);
  if (!machine && !employee) return NextResponse.json({ ok: false, error: "Employee sign-in required." }, { status: 401 });
  if (!machine && !sameOrigin(request)) return NextResponse.json({ ok: false, error: "Request origin rejected." }, { status: 403 });
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = campaignIntakeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "Campaign intake validation failed.",
        issues: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }

  try {
    const result = await createCampaignIntake(
      parsed.data,
      machine || !!employee,
      employee?.id,
    );

    return NextResponse.json(
      {
        ok: true,
        ...result,
        message:
          "Campaign draft created. No lead sourcing or outreach has started.",
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof CustomerIntakeError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }
    console.error("campaign intake failed");
    return NextResponse.json(
      { ok: false, error: "Unable to create the campaign draft." },
      { status: 500 },
    );
  }
}
