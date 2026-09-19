import { NextResponse } from "next/server";
import { z } from "zod";
import { employeeFromRequest } from "@/lib/employee/auth";
import { campaignPreparation } from "@/lib/campaign-preparation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function GET(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  if (!(await employeeFromRequest(request)))
    return NextResponse.json(
      { error: "Sign in required." },
      { status: 401, headers },
    );
  const { campaignId } = await context.params;
  if (!z.string().uuid().safeParse(campaignId).success)
    return NextResponse.json(
      { error: "Invalid campaign." },
      { status: 400, headers },
    );
  try {
    const result = await campaignPreparation(campaignId);
    return NextResponse.json(
      result ? { result } : { error: "Campaign not found." },
      { status: result ? 200 : 404, headers },
    );
  } catch {
    return NextResponse.json(
      { error: "Unable to load the preparation checklist." },
      { status: 503, headers },
    );
  }
}
