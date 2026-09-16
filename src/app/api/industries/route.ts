import { NextResponse } from "next/server";
import { industryProfiles, prohibitedTargetingNotice } from "@/lib/industry-profiles";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    industries: industryProfiles,
    prohibitedTargetingNotice,
  });
}
