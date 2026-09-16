import { NextResponse } from "next/server";
import { campaignIntakeSchema } from "@/lib/campaign-schema";
import { createCampaignIntake } from "@/lib/campaign-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
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
    const result = await createCampaignIntake(parsed.data);

    return NextResponse.json(
      {
        ok: true,
        ...result,
        message: "Campaign draft created. No lead sourcing or outreach has started.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("campaign intake failed", error);
    return NextResponse.json(
      { ok: false, error: "Unable to create the campaign draft." },
      { status: 500 },
    );
  }
}
